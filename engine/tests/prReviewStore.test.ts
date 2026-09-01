import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { recordPr } from '../src/prs.js';
import {
  replaceReviewFindings, listReviewFindings, getReviewFinding, markFindingPosted, deleteReviewFinding,
} from '../src/prReviewStore.js';

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

const findings = [
  { path: 'src/a.ts', line: 12, body: 'first remark' },
  { path: 'src/b.ts', line: 3, body: 'second remark' },
];

describe('replaceReviewFindings', () => {
  it('stores a review and reads it back', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');

    const stored = listReviewFindings(db, prId);
    expect(stored).toHaveLength(2);
    expect(stored[0].path).toBe('src/a.ts');
    expect(stored[0].line).toBe(12);
    expect(stored[0].body).toBe('first remark');
    expect(stored[0].commitSha).toBe('abc123');
    expect(stored[0].posted).toBe(false);
  });

  // A second review replaces the first rather than stacking on it, or the page
  // would fill with duplicate remarks from every run.
  it('replaces whatever the pull request had before', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    replaceReviewFindings(db, prId, [{ path: 'src/c.ts', line: 1, body: 'only remark' }], 'def456');

    const stored = listReviewFindings(db, prId);
    expect(stored).toHaveLength(1);
    expect(stored[0].body).toBe('only remark');
    expect(stored[0].commitSha).toBe('def456');
  });

  it('leaves another pull request untouched', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    replaceReviewFindings(db, otherPrId, [{ path: 'src/z.ts', line: 9, body: 'other' }], 'zzz');

    expect(listReviewFindings(db, prId)).toHaveLength(2);
    expect(listReviewFindings(db, otherPrId)).toHaveLength(1);
  });

  it('storing an empty review clears what was there', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    replaceReviewFindings(db, prId, [], 'def456');

    expect(listReviewFindings(db, prId)).toEqual([]);
  });

  it('returns an empty list for a pull request that was never reviewed', () => {
    expect(listReviewFindings(db, prId)).toEqual([]);
  });

  it('reads back in a stable order', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');

    const first = listReviewFindings(db, prId).map((f) => f.body);
    const second = listReviewFindings(db, prId).map((f) => f.body);
    expect(first).toEqual(second);
    expect(first).toEqual(['first remark', 'second remark']);
  });
});

describe('markFindingPosted', () => {
  it('marks one and leaves the others alone', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    const stored = listReviewFindings(db, prId);

    markFindingPosted(db, stored[0].id);

    const after = listReviewFindings(db, prId);
    expect(after[0].posted).toBe(true);
    expect(after[1].posted).toBe(false);
  });

  it('getReviewFinding reads one back by id', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    const stored = listReviewFindings(db, prId);

    const one = getReviewFinding(db, stored[1].id);
    expect(one?.body).toBe('second remark');
    expect(one?.prId).toBe(prId);
  });

  it('getReviewFinding returns null for an id that does not exist', () => {
    expect(getReviewFinding(db, 9999)).toBeNull();
  });
});

describe('deleteReviewFinding', () => {
  it('removes one and leaves the others', () => {
    replaceReviewFindings(db, prId, findings, 'abc123');
    const stored = listReviewFindings(db, prId);

    expect(deleteReviewFinding(db, stored[0].id)).toBe(true);

    const after = listReviewFindings(db, prId);
    expect(after).toHaveLength(1);
    expect(after[0].body).toBe('second remark');
  });

  it('removing the last one leaves an empty list rather than an error', () => {
    replaceReviewFindings(db, prId, [findings[0]], 'abc123');
    const stored = listReviewFindings(db, prId);

    deleteReviewFinding(db, stored[0].id);

    expect(listReviewFindings(db, prId)).toEqual([]);
  });

  it('reports not found for an id that does not exist', () => {
    expect(deleteReviewFinding(db, 9999)).toBe(false);
  });
});
