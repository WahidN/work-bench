import { describe, expect, it, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { getPr, recordPr, upsertGithubPr } from '../src/prs.js';
import * as git from '../src/git.js';
import * as claude from '../src/claude.js';
import * as review from '../src/review.js';
import { acquireJob, finishJob, isJobRunning } from '../src/jobs.js';
import { startCommentFix, listCommentFixes } from '../src/prCommentFixStore.js';
import { buildCommentFixPrompt, drainCommentFixes, runCommentFix } from '../src/prCommentFix.js';
import type { Project } from '../src/types.js';

vi.mock('../src/git.js');
vi.mock('../src/claude.js');
vi.mock('../src/review.js');

let db: Database.Database;
let project: Project;
let prId: number;

const request = {
  commentId: 7,
  path: 'src/helpers/sessionToken.ts',
  line: 8,
  comment: 'This only fires once the token is already past its expiry.',
  instruction: 'compare against the expiry with a margin',
};

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  project = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  });
  prId = recordPr(db, {
    ticketId: null, projectId: project.id, branch: 'fix/session-token', number: 5,
    url: 'https://github.com/x/pull/5', status: 'open',
  }).id;

  vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-session-token');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushDetachedHead).mockResolvedValue(undefined);
  vi.mocked(claude.runClaude).mockResolvedValue('done');
});

describe('buildCommentFixPrompt', () => {
  it('carries the remark, its place and the instruction', () => {
    const prompt = buildCommentFixPrompt({ title: 'Retry card capture', body: '' }, request);

    expect(prompt).toContain('src/helpers/sessionToken.ts');
    expect(prompt).toContain('line 8');
    expect(prompt).toContain(request.comment);
    expect(prompt).toContain(request.instruction);
    expect(prompt).toContain('Retry card capture');
  });

  it('tells the agent not to commit or push', () => {
    const prompt = buildCommentFixPrompt({ title: 't', body: '' }, request);
    expect(prompt).toMatch(/Do not commit/i);
    expect(prompt).toMatch(/push/i);
  });
});

describe('runCommentFix', () => {
  it('commits, pushes and reports that it landed', async () => {
    const result = await runCommentFix(db, getPr(db, prId)!, project, request);

    expect(result).toEqual({ state: 'landed', detail: null });
    expect(git.commitAll).toHaveBeenCalledOnce();
    expect(git.pushDetachedHead).toHaveBeenCalledWith(
      '/repos/demo/.worktrees/fix-session-token', 'fix/session-token'
    );
    expect(git.removeWorktree).toHaveBeenCalledOnce();
  });

  it('does not re-review the pull request or touch its status', async () => {
    await runCommentFix(db, getPr(db, prId)!, project, request);

    expect(review.reviewDiff).not.toHaveBeenCalled();
    expect(getPr(db, prId)!.status).toBe('open');
    expect(getPr(db, prId)!.lastReviewScore).toBeNull();
  });

  it('reports nothing changed, and pushes nothing', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);

    const result = await runCommentFix(db, getPr(db, prId)!, project, request);

    expect(result.state).toBe('nothing');
    expect(result.detail).toBeTruthy();
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
    expect(git.removeWorktree).toHaveBeenCalledOnce();
  });

  it('reports a rejected push as the branch having moved on', async () => {
    vi.mocked(git.pushDetachedHead).mockRejectedValue(
      new Error('! [rejected] stale info: --force-with-lease')
    );

    const result = await runCommentFix(db, getPr(db, prId)!, project, request);

    expect(result.state).toBe('failed');
    expect(result.detail).toMatch(/moved on/i);
    expect(git.removeWorktree).toHaveBeenCalledOnce();
  });

  it('removes the worktree when the run itself fails', async () => {
    vi.mocked(claude.runClaude).mockRejectedValue(new Error('claude: timed out'));

    await expect(runCommentFix(db, getPr(db, prId)!, project, request)).rejects.toThrow('timed out');
    expect(git.removeWorktree).toHaveBeenCalledOnce();
  });

  it('refuses a pull request the user did not author, before opening a worktree', async () => {
    const theirs = upsertGithubPr(db, {
      projectId: project.id, number: 88, title: 'Bump the deploy timeout',
      url: 'https://github.com/x/pull/88', githubUpdatedAt: '2026-08-17T10:00:00Z', isDraft: false,
      authoredByMe: false, assignedToMe: true, reviewRequestedByMe: false,
      reviewState: 'review_required', branch: 'feat/deploy-timeout',
    });

    await expect(runCommentFix(db, theirs, project, request)).rejects.toThrow(/authored/i);
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
    expect(claude.runClaude).not.toHaveBeenCalled();
  });
});

describe('drainCommentFixes', () => {
  const ask = (commentId: number, instruction: string) =>
    startCommentFix(db, prId, { ...request, commentId, instruction });

  it('works through the queue in the order it was asked for', async () => {
    ask(7, 'first');
    ask(8, 'second');
    ask(9, 'third');

    await drainCommentFixes(db, prId);

    expect(vi.mocked(claude.runClaude).mock.calls.map((call) => call[0].prompt))
      .toEqual([
        expect.stringContaining('first'),
        expect.stringContaining('second'),
        expect.stringContaining('third'),
      ]);
    expect(listCommentFixes(db, prId).map((fix) => fix.state))
      .toEqual(['landed', 'landed', 'landed']);
  });

  it('takes and releases the pull request job for each attempt', async () => {
    ask(7, 'first');
    ask(8, 'second');

    await drainCommentFixes(db, prId);

    const jobs = db.prepare('SELECT type, status FROM jobs WHERE target_id = ?').all(prId);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job: any) => job.status === 'done')).toBe(true);
    expect(isJobRunning(db, 'pr', prId)).toBe(false);
  });

  it('waits for a job it cannot take, then runs', async () => {
    const held = acquireJob(db, 'pr-chat', 'pr', prId)!;
    ask(7, 'behind a review');

    const draining = drainCommentFixes(db, prId, { retryMs: 1 });
    await vi.waitFor(() => expect(listCommentFixes(db, prId)[0].state).toBe('queued'));
    expect(claude.runClaude).not.toHaveBeenCalled();

    finishJob(db, held.id, 'done');
    await draining;

    expect(listCommentFixes(db, prId)[0].state).toBe('landed');
  });

  it('records what each attempt reported, and keeps going after one fails', async () => {
    vi.mocked(git.commitAll).mockResolvedValueOnce(false);
    ask(7, 'changes nothing');
    ask(8, 'lands');

    await drainCommentFixes(db, prId);

    expect(listCommentFixes(db, prId).map((fix) => fix.state)).toEqual(['nothing', 'landed']);
  });

  it('keeps going after an attempt throws', async () => {
    vi.mocked(claude.runClaude).mockRejectedValueOnce(new Error('claude: timed out'));
    ask(7, 'throws');
    ask(8, 'lands');

    await drainCommentFixes(db, prId);

    const fixes = listCommentFixes(db, prId);
    expect(fixes[0].state).toBe('failed');
    expect(fixes[0].detail).toContain('timed out');
    expect(fixes[1].state).toBe('landed');
  });

  it('does not start a rival drain for the same pull request', async () => {
    ask(7, 'first');
    ask(8, 'second');

    await Promise.all([drainCommentFixes(db, prId), drainCommentFixes(db, prId)]);

    expect(claude.runClaude).toHaveBeenCalledTimes(2);
    expect(listCommentFixes(db, prId).map((fix) => fix.state)).toEqual(['landed', 'landed']);
  });

  it('does nothing when nothing is queued', async () => {
    await drainCommentFixes(db, prId);
    expect(claude.runClaude).not.toHaveBeenCalled();
  });
});
