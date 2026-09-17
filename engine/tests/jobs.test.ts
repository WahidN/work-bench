import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import {
  acquireJob, finishJob, reconcileInterruptedJobs, getJob, listRunningAgents,
} from '../src/jobs.js';
import { createProject } from '../src/projects.js';
import { recordPr } from '../src/prs.js';
import { startCommentFix } from '../src/prCommentFixStore.js';

let db: Database.Database;
let projectId: number;

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
});

function aPr(branch: string, title: string): number {
  const pr = recordPr(db, {
    ticketId: null, projectId, branch, number: 5, url: 'https://x/pull/5', status: 'open',
  });
  db.prepare('UPDATE prs SET title = ? WHERE id = ?').run(title, pr.id);
  return pr.id;
}

describe('acquireJob', () => {
  it('acquires a lock when none is running for the target', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1, 'implement');
    expect(job).not.toBeNull();
    expect(job!.status).toBe('running');
  });

  it('refuses a second lock on the same target while one is running', () => {
    acquireJob(db, 'fix', 'ticket', 1, 'implement');
    expect(acquireJob(db, 'spar', 'ticket', 1, 'spar')).toBeNull();
  });

  it('allows a new lock once the previous job on that target is finished', () => {
    const first = acquireJob(db, 'fix', 'ticket', 1, 'implement')!;
    finishJob(db, first.id, 'done');
    expect(acquireJob(db, 'fix', 'ticket', 1, 'implement')).not.toBeNull();
  });

  it('does not block a different target', () => {
    acquireJob(db, 'fix', 'ticket', 1, 'implement');
    expect(acquireJob(db, 'fix', 'ticket', 2, 'implement')).not.toBeNull();
  });
});

describe('finishJob', () => {
  it('records a failure reason', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1, 'implement')!;
    finishJob(db, job.id, 'failed', 'boom');
    expect(getJob(db, job.id)).toEqual({ ...job, status: 'failed', error: 'boom' });
  });
});

describe('reconcileInterruptedJobs', () => {
  it('marks every running job as interrupted and returns the count', () => {
    const a = acquireJob(db, 'fix', 'ticket', 1, 'implement')!;
    const b = acquireJob(db, 'pr-chat', 'pr', 2, 'chat')!;
    expect(reconcileInterruptedJobs(db)).toBe(2);
    expect(getJob(db, a.id)!.status).toBe('interrupted');
    expect(getJob(db, b.id)!.status).toBe('interrupted');
  });
});

describe('acquireJob activity', () => {
  it('stores the activity it is given', () => {
    const job = acquireJob(db, 'pr-chat', 'pr', 1, 'review')!;
    expect(getJob(db, job.id)!.activity).toBe('review');
  });

  it('stores null for a lock held by work that runs no agent', () => {
    const job = acquireJob(db, 'pr-chat', 'pr', 1, null)!;
    expect(getJob(db, job.id)!.activity).toBeNull();
  });
});

describe('listRunningAgents', () => {
  it('is empty when nothing runs', () => {
    expect(listRunningAgents(db)).toEqual([]);
  });

  it('names the running agent and what it works on', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    acquireJob(db, 'pr-chat', 'pr', prId, 'review');

    expect(listRunningAgents(db)).toEqual([
      expect.objectContaining({
        activity: 'review',
        targetType: 'pr',
        targetId: prId,
        title: 'Remove the loading animation',
        waiting: false,
      }),
    ]);
  });

  it('omits a lock held without an agent', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    acquireJob(db, 'pr-chat', 'pr', prId, null);

    expect(listRunningAgents(db)).toEqual([]);
  });

  it('omits jobs that are no longer running', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    const job = acquireJob(db, 'pr-chat', 'pr', prId, 'review')!;
    finishJob(db, job.id, 'done');

    expect(listRunningAgents(db)).toEqual([]);
  });

  it('lists the longest running first', () => {
    const first = aPr('feat/x', 'First');
    const second = aPr('feat/y', 'Second');
    acquireJob(db, 'pr-chat', 'pr', first, 'review');
    acquireJob(db, 'pr-chat', 'pr', second, 'comment-fix');

    expect(listRunningAgents(db).map((agent) => agent.title)).toEqual(['First', 'Second']);
  });

  it('lists a queued fix as waiting', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    startCommentFix(db, prId, {
      commentId: 7, path: 'src/a.ts', line: 3, comment: 'no', instruction: 'fix dit',
    });

    expect(listRunningAgents(db)).toEqual([
      expect.objectContaining({ activity: 'comment-fix', targetId: prId, waiting: true }),
    ]);
  });

  it('lists a running fix once, not twice', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    const fixId = startCommentFix(db, prId, {
      commentId: 7, path: 'src/a.ts', line: 3, comment: 'no', instruction: 'fix dit',
    });
    db.prepare(`UPDATE pr_comment_fixes SET state = 'running' WHERE id = ?`).run(fixId);
    acquireJob(db, 'pr-chat', 'pr', prId, 'comment-fix');

    const agents = listRunningAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].waiting).toBe(false);
  });

  it('puts waiting agents after running ones', () => {
    const running = aPr('feat/x', 'Running');
    const queued = aPr('feat/y', 'Queued');
    acquireJob(db, 'pr-chat', 'pr', running, 'review');
    startCommentFix(db, queued, {
      commentId: 7, path: 'src/a.ts', line: 3, comment: 'no', instruction: 'fix dit',
    });

    expect(listRunningAgents(db).map((agent) => agent.title)).toEqual(['Running', 'Queued']);
  });

  it('drops everything once interrupted jobs are reconciled', () => {
    const prId = aPr('feat/x', 'Remove the loading animation');
    acquireJob(db, 'pr-chat', 'pr', prId, 'review');
    reconcileInterruptedJobs(db);

    expect(listRunningAgents(db)).toEqual([]);
  });
});

describe('running agent identity', () => {
  it('gives every entry a key unique across jobs and queued fixes', () => {
    const prId = aPr('feat/x', 'One');
    const other = aPr('feat/y', 'Two');
    acquireJob(db, 'pr-chat', 'pr', prId, 'review');
    // Two fixes on one pull request, which share every other field.
    startCommentFix(db, other, {
      commentId: 1, path: 'src/a.ts', line: 3, comment: 'a', instruction: 'a',
    });
    startCommentFix(db, other, {
      commentId: 2, path: 'src/a.ts', line: 4, comment: 'b', instruction: 'b',
    });

    const keys = listRunningAgents(db).map((agent) => agent.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('leaves a lock taken without an agent out, whatever holds it', () => {
    const prId = aPr('feat/x', 'One');
    acquireJob(db, 'pr-chat', 'pr', prId, null);

    expect(listRunningAgents(db)).toEqual([]);
  });
});
