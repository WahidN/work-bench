// engine/tests/prChat.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket } from '../src/tickets.js';
import { recordPr, getPr, listPrMessages } from '../src/prs.js';
import * as git from '../src/git.js';
import * as claude from '../src/claude.js';
import * as review from '../src/review.js';
import { sendPrMessage, isMergeRequest } from '../src/prChat.js';

vi.mock('../src/git.js');
vi.mock('../src/claude.js');
vi.mock('../src/review.js');

let db: Database.Database;
let prId: number;
let ticketId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, {
    ticketId, projectId, branch: 'fix/github-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
  }).id;

  vi.mocked(git.openWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-github-1');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushBranch).mockResolvedValue(undefined);
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
    expect(git.mergePr).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1');
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
    expect(git.pushBranch).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1', 'fix/github-1');
    expect(getPr(db, prId)!.status).toBe('open');
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-github-1');
    const messages = listPrMessages(db, prId);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'also guard the email field' });
  });

  it('replies without pushing when nothing changed', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);
    const result = await sendPrMessage(db, prId, 'do something vague');
    expect(result.reply).toContain("didn't find a change");
    expect(git.pushBranch).not.toHaveBeenCalled();
  });
});
