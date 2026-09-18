// engine/tests/prChat.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket, setTicketPinned } from '../src/tickets.js';
import { recordPr, getPr, listPrMessages, setPrPinned, upsertGithubPr } from '../src/prs.js';
import * as git from '../src/git.js';
import * as claude from '../src/claude.js';
import * as review from '../src/review.js';
import { sendPrMessage, isMergeRequest, isConflictRequest, buildRevisePrompt } from '../src/prChat.js';

vi.mock('../src/git.js');
vi.mock('../src/claude.js');
vi.mock('../src/review.js');

let db: Database.Database;
let prId: number;
let ticketId: number;
let projectId: number;

// An ingested pull request: no ticket, and its own title is all the context there is.
function ingestedPr(authoredByMe = false) {
  return upsertGithubPr(db, {
    projectId, number: 88, title: 'Bump the deploy timeout', url: 'https://github.com/x/pull/88',
    githubUpdatedAt: '2026-08-17T10:00:00Z', isDraft: false, authoredByMe,
    assignedToMe: true, reviewRequestedByMe: false, reviewState: 'review_required', mergeable: 'MERGEABLE', branch: 'feat/deploy-timeout',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, {
    ticketId, projectId, branch: 'fix/github-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
  }).id;

  vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-github-1');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushDetachedHead).mockResolvedValue(undefined);
  vi.mocked(git.getDiff).mockResolvedValue('diff');
  vi.mocked(claude.runClaude).mockResolvedValue('done');
});

describe('isMergeRequest', () => {
  it('matches the exact merge phrases case-insensitively and with trailing punctuation', () => {
    expect(isMergeRequest('merge it')).toBe(true);
    expect(isMergeRequest('  Merge It  ')).toBe(true);
    expect(isMergeRequest('merge it.')).toBe(true);
    expect(isMergeRequest('Merge this!')).toBe(true);
    expect(isMergeRequest('go ahead and merge')).toBe(true);
  });

  it('does not match a revision instruction', () => {
    expect(isMergeRequest('also guard the email field')).toBe(false);
  });

  it('does not match a negated or conditional instruction that mentions merging', () => {
    expect(isMergeRequest("don't merge this yet, first fix the typo")).toBe(false);
    expect(isMergeRequest('do not merge it until CI passes')).toBe(false);
    expect(isMergeRequest('before we merge this, add a test')).toBe(false);
    expect(isMergeRequest('why did you merge this?')).toBe(false);
    expect(isMergeRequest('merge it?')).toBe(false);
  });
});

describe('sendPrMessage: merge', () => {
  it('runs mergePr, marks the PR merged, and the ticket done', async () => {
    const result = await sendPrMessage(db, prId, 'merge it');

    expect(result.action).toBe('merged');
    expect(git.mergePr).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1', '142');
    expect(getPr(db, prId)!.status).toBe('merged');
    expect(getTicket(db, ticketId)!.status).toBe('done');
  });

  it('falls back to the url when the number is null', async () => {
    const noNumberPrId = recordPr(db, {
      ticketId: null, projectId, branch: 'fix/no-number', number: null,
      url: 'https://github.com/x/pull/777', status: 'open',
    }).id;

    await sendPrMessage(db, noNumberPrId, 'merge it');

    expect(git.mergePr).toHaveBeenCalledWith(
      '/repos/demo/.worktrees/fix-github-1',
      'https://github.com/x/pull/777'
    );
  });

  it('fails fast and never opens a worktree when the PR has neither number nor url', async () => {
    const barePrId = recordPr(db, {
      ticketId: null, projectId, branch: 'fix/bare', number: null, url: null, status: 'open',
    }).id;

    await expect(sendPrMessage(db, barePrId, 'merge it')).rejects.toThrow(String(barePrId));
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
  });

  it('clears the pin on both the PR and its ticket', async () => {
    setPrPinned(db, prId, true);
    setTicketPinned(db, ticketId, true);

    await sendPrMessage(db, prId, 'merge it');

    expect(getPr(db, prId)!.pinned).toBe(false);
    expect(getTicket(db, ticketId)!.pinned).toBe(false);
    expect(getPr(db, prId)!.status).toBe('merged');
    expect(getTicket(db, ticketId)!.status).toBe('done');
  });
});

describe('sendPrMessage: revise', () => {
  it('implements the revision, pushes, re-reviews, and records the outcome', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await sendPrMessage(db, prId, 'also guard the email field');

    expect(result.action).toBe('revised');
    expect(claude.runClaude).toHaveBeenCalled();
    expect(git.pushDetachedHead).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1', 'fix/github-1');
    expect(getPr(db, prId)!.status).toBe('open');
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-github-1');
    const messages = listPrMessages(db, prId);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'also guard the email field' });
  });

  it('replies without pushing when nothing changed', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);
    const result = await sendPrMessage(db, prId, 'do something vague');
    expect(result.reply).toContain("didn't find a change");
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
  });

  it('reviews against the ticket when the PR has one', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    await sendPrMessage(db, prId, 'also guard the email field');

    expect(review.reviewDiff).toHaveBeenCalledWith(
      '/repos/demo/.worktrees/fix-github-1',
      expect.objectContaining({ title: 'Fix null check', body: 'b' }),
      'diff'
    );
    expect(vi.mocked(claude.runClaude).mock.calls[0][0].prompt).toContain('Fix null check');
  });
});

describe('sendPrMessage: a PR with no ticket', () => {
  it('revises using the pull request title instead of a ticket', async () => {
    const pr = ingestedPr(true);
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/feat-deploy-timeout');
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await sendPrMessage(db, pr.id, 'also guard the email field');

    expect(result.action).toBe('revised');
    expect(vi.mocked(claude.runClaude).mock.calls[0][0].prompt).toContain('Bump the deploy timeout');
    expect(review.reviewDiff).toHaveBeenCalledWith(
      '/repos/demo/.worktrees/feat-deploy-timeout',
      { title: 'Bump the deploy timeout', body: '' },
      'diff'
    );
    expect(listPrMessages(db, pr.id).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('merges without touching a ticket', async () => {
    const pr = ingestedPr(true);
    const result = await sendPrMessage(db, pr.id, 'merge it');

    expect(result.action).toBe('merged');
    expect(getPr(db, pr.id)!.status).toBe('merged');
  });

  it('stores nothing for a pull request that does not exist', async () => {
    await expect(sendPrMessage(db, 999, 'hello')).rejects.toThrow('PR 999 not found');
    expect(listPrMessages(db, 999)).toEqual([]);
  });
});

describe('sendPrMessage: the authorship gate', () => {
  it('refuses to merge a pull request the user did not author, and never touches git', async () => {
    const pr = ingestedPr(false);

    const result = await sendPrMessage(db, pr.id, 'merge it');

    expect(result.action).toBe('refused');
    expect(result.reply).toContain(pr.url);
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
    expect(git.mergePr).not.toHaveBeenCalled();
    expect(getPr(db, pr.id)!.status).not.toBe('merged');
    const messages = listPrMessages(db, pr.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('still merges exactly as before when the pull request is authored by the user', async () => {
    const pr = ingestedPr(true);

    const result = await sendPrMessage(db, pr.id, 'merge it');

    expect(result.action).toBe('merged');
    expect(git.mergePr).toHaveBeenCalled();
    expect(getPr(db, pr.id)!.status).toBe('merged');
  });

  it('merges a PR the fix pipeline just recorded, with no poll cycle in between', async () => {
    // prId comes straight from recordPr in beforeEach, with no poller run and no
    // manual authorship fix-up: recordPr itself must already mark it authored.
    const result = await sendPrMessage(db, prId, 'merge it');

    expect(result.action).toBe('merged');
    expect(git.mergePr).toHaveBeenCalled();
  });

  it('refuses to revise a pull request the user did not author, and never touches git', async () => {
    const pr = ingestedPr(false);

    const result = await sendPrMessage(db, pr.id, 'also guard the email field');

    expect(result.action).toBe('refused');
    expect(result.reply).toContain(pr.url);
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
    expect(claude.runClaude).not.toHaveBeenCalled();
    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
    expect(listPrMessages(db, pr.id).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('still revises a pull request the user authored', async () => {
    const pr = ingestedPr(true);
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/feat-deploy-timeout');
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await sendPrMessage(db, pr.id, 'also guard the email field');

    expect(result.action).toBe('revised');
    expect(git.pushDetachedHead).toHaveBeenCalled();
  });
});

describe('isConflictRequest', () => {
  it('matches a request about a merge conflict', () => {
    expect(isConflictRequest('fix the merge conflict in this branch')).toBe(true);
    expect(isConflictRequest('resolve the conflicts with main')).toBe(true);
    expect(isConflictRequest('Fix The Merge Conflicts')).toBe(true);
  });

  // isMergeRequest owns these, and it runs first.
  it('does not match a merge request', () => {
    expect(isConflictRequest('merge it')).toBe(false);
    expect(isConflictRequest('go ahead and merge')).toBe(false);
  });

  it('does not match a file that happens to be called conflict', () => {
    expect(isConflictRequest('rename conflict.ts to clash.ts')).toBe(false);
    expect(isConflictRequest('add a test for the conflict resolver')).toBe(false);
  });

  it('does not match an ordinary revision', () => {
    expect(isConflictRequest('also guard the email field')).toBe(false);
  });
});

describe('buildRevisePrompt', () => {
  const subject = { title: 'Remove the filter tags', body: '' };

  it('says the worktree is a detached checkout with no merge in progress', () => {
    const prompt = buildRevisePrompt(subject, 'rename it', 'main', null);

    expect(prompt).toContain('detached checkout');
    expect(prompt).toContain('no merge is in progress');
  });

  it('says the merge is in progress and names the conflicting files', () => {
    const prompt = buildRevisePrompt(subject, 'fix the merge conflict', 'main', {
      state: 'conflicts',
      files: ['sanityConfig/schemas/index.ts', 'src/queries/filterTags.ts'],
    });

    expect(prompt).toContain('origin/main');
    expect(prompt).toContain('merge is in progress');
    expect(prompt).toContain('sanityConfig/schemas/index.ts');
    expect(prompt).toContain('src/queries/filterTags.ts');
    expect(prompt).not.toContain('no merge is in progress');
  });
});

describe('sendPrMessage: a request about a merge conflict', () => {
  beforeEach(() => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);
    vi.mocked(git.mergeBranchInto).mockResolvedValue(undefined);
  });

  // The case that burned 30 minutes: the worktree is a clean checkout of the
  // branch head, so there was no conflict in it to fix.
  it('merges the default branch in before the agent runs, and names the files', async () => {
    vi.mocked(git.conflictsWith).mockResolvedValue({
      state: 'conflicts', files: ['sanityConfig/schemas/index.ts'],
    });

    const result = await sendPrMessage(db, prId, 'fix the merge conflict in this branch');

    expect(git.mergeBranchInto).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1', 'origin/main');
    expect(claude.runClaude).toHaveBeenCalled();
    expect(vi.mocked(claude.runClaude).mock.calls[0][0].prompt).toContain('sanityConfig/schemas/index.ts');
    expect(result.action).toBe('revised');
    expect(git.pushDetachedHead).toHaveBeenCalled();
  });

  it('answers without running the agent when the branch merges cleanly', async () => {
    vi.mocked(git.conflictsWith).mockResolvedValue({ state: 'clean' });

    const result = await sendPrMessage(db, prId, 'fix the merge conflict in this branch');

    expect(claude.runClaude).not.toHaveBeenCalled();
    expect(git.mergeBranchInto).not.toHaveBeenCalled();
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain('no conflict');
    const messages = listPrMessages(db, prId);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(git.removeWorktree).toHaveBeenCalled();
  });

  // Git could not say, so the request is run rather than refused. A refusal
  // built on a check that failed is the silence this is meant to end.
  it('runs the agent when the conflict check could not answer', async () => {
    vi.mocked(git.conflictsWith).mockResolvedValue({ state: 'unknown' });

    await sendPrMessage(db, prId, 'fix the merge conflict in this branch');

    expect(claude.runClaude).toHaveBeenCalled();
    expect(git.mergeBranchInto).not.toHaveBeenCalled();
  });

  it('starts no merge for a revision that is not about conflicts', async () => {
    await sendPrMessage(db, prId, 'also guard the email field');

    expect(git.conflictsWith).not.toHaveBeenCalled();
    expect(git.mergeBranchInto).not.toHaveBeenCalled();
    expect(claude.runClaude).toHaveBeenCalled();
  });
});
