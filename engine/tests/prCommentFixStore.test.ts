import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { recordPr } from '../src/prs.js';
import {
  startCommentFix, claimNextQueuedFix, finishCommentFix, listCommentFixes,
  reconcileUnfinishedCommentFixes,
} from '../src/prCommentFixStore.js';

const entry = (commentId: number, instruction: string) => ({
  commentId,
  path: 'src/helpers/sessionToken.ts',
  line: 8,
  comment: 'This only fires once the token is already past its expiry.',
  instruction,
});

let db: Database.Database;
let prId: number;
let otherPrId: number;

beforeEach(() => {
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  prId = recordPr(db, {
    ticketId: null, projectId, branch: 'feat/x', number: 5, url: 'https://x/pull/5', status: 'open',
  }).id;
  otherPrId = recordPr(db, {
    ticketId: null, projectId, branch: 'feat/y', number: 6, url: 'https://x/pull/6', status: 'open',
  }).id;
});

describe('startCommentFix', () => {
  it('stores the fix as queued, with its instruction', () => {
    startCommentFix(db, prId, entry(7, 'clear the cache key too'));

    const [fix] = listCommentFixes(db, prId);
    expect(fix.commentId).toBe(7);
    expect(fix.instruction).toBe('clear the cache key too');
    expect(fix.state).toBe('queued');
    expect(fix.detail).toBeNull();
    expect(fix.finishedAt).toBeNull();
  });

  it('keeps an earlier attempt on the same comment', () => {
    const first = startCommentFix(db, prId, entry(7, 'first try'));
    finishCommentFix(db, first, 'nothing', 'no change made');
    startCommentFix(db, prId, entry(7, 'second try'));

    const fixes = listCommentFixes(db, prId);
    expect(fixes.map((f) => f.instruction)).toEqual(['first try', 'second try']);
    expect(fixes.map((f) => f.state)).toEqual(['nothing', 'queued']);
  });

  it('accepts a second attempt while the first is still queued', () => {
    startCommentFix(db, prId, entry(7, 'first try'));
    startCommentFix(db, prId, entry(7, 'second try'));

    expect(listCommentFixes(db, prId).map((f) => f.state)).toEqual(['queued', 'queued']);
  });

  it('keeps a fix on another comment of the same pull request', () => {
    startCommentFix(db, prId, entry(7, 'one'));
    startCommentFix(db, prId, entry(8, 'two'));

    expect(listCommentFixes(db, prId).map((f) => f.commentId)).toEqual([7, 8]);
  });
});

describe('finishCommentFix', () => {
  it('writes the state, the detail and the finish time', () => {
    const id = startCommentFix(db, prId, entry(7, 'do it'));
    finishCommentFix(db, id, 'failed', 'gh: 403');

    const [fix] = listCommentFixes(db, prId);
    expect(fix.state).toBe('failed');
    expect(fix.detail).toBe('gh: 403');
    expect(fix.finishedAt).not.toBeNull();
  });

  it('leaves no detail on a fix that landed', () => {
    const id = startCommentFix(db, prId, entry(7, 'do it'));
    finishCommentFix(db, id, 'landed', null);

    const [fix] = listCommentFixes(db, prId);
    expect(fix.state).toBe('landed');
    expect(fix.detail).toBeNull();
  });
});

describe('listCommentFixes', () => {
  it('returns only that pull request, ordered by id', () => {
    startCommentFix(db, prId, entry(9, 'mine'));
    startCommentFix(db, otherPrId, entry(10, 'not mine'));
    startCommentFix(db, prId, entry(11, 'mine too'));

    expect(listCommentFixes(db, prId).map((f) => f.instruction)).toEqual(['mine', 'mine too']);
  });

  it('is empty for a pull request with no fixes', () => {
    expect(listCommentFixes(db, prId)).toEqual([]);
  });
});

describe('claimNextQueuedFix', () => {
  it('takes the oldest queued fix of that pull request and marks it running', () => {
    const first = startCommentFix(db, prId, entry(7, 'first'));
    startCommentFix(db, prId, entry(8, 'second'));

    const claimed = claimNextQueuedFix(db, prId);

    expect(claimed!.id).toBe(first);
    expect(claimed!.state).toBe('running');
    expect(listCommentFixes(db, prId).map((f) => f.state)).toEqual(['running', 'queued']);
  });

  it('leaves other pull requests alone', () => {
    startCommentFix(db, otherPrId, entry(9, 'not mine'));

    expect(claimNextQueuedFix(db, prId)).toBeNull();
    expect(listCommentFixes(db, otherPrId)[0].state).toBe('queued');
  });

  it('answers null once nothing is queued', () => {
    const only = startCommentFix(db, prId, entry(7, 'one'));
    claimNextQueuedFix(db, prId);
    finishCommentFix(db, only, 'landed', null);

    expect(claimNextQueuedFix(db, prId)).toBeNull();
  });
});

describe('reconcileUnfinishedCommentFixes', () => {
  it('fails what was running and what was waiting, each with its own reason', () => {
    const running = startCommentFix(db, prId, entry(7, 'interrupted'));
    claimNextQueuedFix(db, prId);
    const queued = startCommentFix(db, prId, entry(8, 'never started'));
    const done = startCommentFix(db, prId, entry(9, 'finished'));
    finishCommentFix(db, done, 'landed', null);

    expect(reconcileUnfinishedCommentFixes(db)).toBe(2);

    const fixes = listCommentFixes(db, prId);
    const wasRunning = fixes.find((f) => f.id === running)!;
    expect(wasRunning.state).toBe('failed');
    expect(wasRunning.detail).toContain('while this fix was running');
    expect(wasRunning.finishedAt).not.toBeNull();

    const wasQueued = fixes.find((f) => f.id === queued)!;
    expect(wasQueued.state).toBe('failed');
    expect(wasQueued.detail).toContain('before this fix started');

    expect(fixes.find((f) => f.id === done)!.state).toBe('landed');
  });

  it('changes nothing when everything had finished', () => {
    expect(reconcileUnfinishedCommentFixes(db)).toBe(0);
  });
});
