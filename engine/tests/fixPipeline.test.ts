import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket } from '../src/tickets.js';
import { getPr, listPrMessages } from '../src/prs.js';
import * as git from '../src/git.js';
import * as implement from '../src/implement.js';
import * as review from '../src/review.js';
import { runFixPipeline, passComment, failComment } from '../src/fixPipeline.js';

vi.mock('../src/git.js');
vi.mock('../src/implement.js');
vi.mock('../src/review.js');

let db: Database.Database;
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

  vi.mocked(git.createFixWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-github-1');
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushBranch).mockResolvedValue(undefined);
  vi.mocked(git.getDiff).mockResolvedValue('diff');
  vi.mocked(git.createPr).mockResolvedValue('https://github.com/x/pull/142');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.markPrDraft).mockResolvedValue(undefined);
  vi.mocked(implement.implementFix).mockResolvedValue(undefined);
});

describe('runFixPipeline', () => {
  it('marks the ticket in_review and records a passing PR on the first round', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await runFixPipeline(db, ticketId);

    expect(result.ticketStatus).toBe('in_review');
    expect(getTicket(db, ticketId)!.status).toBe('in_review');
    expect(getPr(db, result.prId)!.status).toBe('open');
    expect(implement.implementFix).toHaveBeenCalledTimes(1);
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-github-1');
  });

  it('retries with findings then marks needs_attention after 3 failing rounds', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 3, completeness: 3, quality: 3, tests: 3, regressionRisk: 3, findings: ['still broken'],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(false);
    vi.mocked(review.averageScore).mockReturnValue(3);

    const result = await runFixPipeline(db, ticketId);

    expect(result.ticketStatus).toBe('needs_attention');
    expect(getTicket(db, ticketId)!.status).toBe('needs_attention');
    expect(getPr(db, result.prId)!.status).toBe('needs_attention');
    expect(implement.implementFix).toHaveBeenCalledTimes(3);
    expect(git.markPrDraft).toHaveBeenCalled();
    const messages = listPrMessages(db, result.prId);
    expect(messages[messages.length - 1].content).toContain('still broken');
  });

  it('throws when the implement session produces no changes, but still cleans up the worktree', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);
    await expect(runFixPipeline(db, ticketId)).rejects.toThrow('implement session produced no changes');
    expect(git.removeWorktree).toHaveBeenCalled();
  });
});

describe('passComment / failComment', () => {
  const score = { correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: ['x'] };

  it('passComment includes the round count and per-dimension scores', () => {
    expect(passComment(score, 2)).toContain('after 2 round(s)');
    expect(passComment(score, 2)).toContain('correctness 5');
  });

  it('failComment lists unresolved findings', () => {
    expect(failComment(score)).toContain('- x');
  });
});
