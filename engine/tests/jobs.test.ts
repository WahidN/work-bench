import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { acquireJob, finishJob, reconcileInterruptedJobs, getJob } from '../src/jobs.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('acquireJob', () => {
  it('acquires a lock when none is running for the target', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('running');
  });

  it('refuses a second lock on the same target while one is running', () => {
    acquireJob(db, 'fix', 'ticket', 1);
    expect(acquireJob(db, 'spar', 'ticket', 1)).toBeNull();
  });

  it('allows a new lock once the previous job on that target is finished', () => {
    const first = acquireJob(db, 'fix', 'ticket', 1)!;
    finishJob(db, first.id, 'done');
    expect(acquireJob(db, 'fix', 'ticket', 1)).not.toBeNull();
  });

  it('does not block a different target', () => {
    acquireJob(db, 'fix', 'ticket', 1);
    expect(acquireJob(db, 'fix', 'ticket', 2)).not.toBeNull();
  });
});

describe('finishJob', () => {
  it('records a failure reason', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1)!;
    finishJob(db, job.id, 'failed', 'boom');
    expect(getJob(db, job.id)).toEqual({ ...job, status: 'failed', error: 'boom' });
  });
});

describe('reconcileInterruptedJobs', () => {
  it('marks every running job as interrupted and returns the count', () => {
    const a = acquireJob(db, 'fix', 'ticket', 1)!;
    const b = acquireJob(db, 'pr-chat', 'pr', 2)!;
    expect(reconcileInterruptedJobs(db)).toBe(2);
    expect(getJob(db, a.id)!.status).toBe('interrupted');
    expect(getJob(db, b.id)!.status).toBe('interrupted');
  });
});
