import type Database from 'better-sqlite3';
import type { Job, JobType, JobTargetType } from './types.js';

function rowToJob(row: any): Job {
  return {
    id: row.id, type: row.type, targetType: row.target_type, targetId: row.target_id,
    status: row.status, error: row.error, createdAt: row.created_at,
  };
}

export function getJob(db: Database.Database, id: number): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

/// Whether anything is working on this target right now.
///
/// The same condition `acquireJob` refuses on, which is what makes it the honest
/// answer to "can a review be started". It covers any job on the target, not only
/// a review: a chat revision holds the same lock, and a review could not start
/// during one either.
export function isJobRunning(
  db: Database.Database,
  targetType: JobTargetType,
  targetId: number
): boolean {
  return !!db
    .prepare(`SELECT id FROM jobs WHERE target_type = ? AND target_id = ? AND status = 'running'`)
    .get(targetType, targetId);
}

export function acquireJob(
  db: Database.Database,
  type: JobType,
  targetType: JobTargetType,
  targetId: number
): Job | null {
  const running = db
    .prepare(`SELECT id FROM jobs WHERE target_type = ? AND target_id = ? AND status = 'running'`)
    .get(targetType, targetId);
  if (running) return null;

  const result = db
    .prepare(`INSERT INTO jobs (type, target_type, target_id, status, created_at) VALUES (?, ?, ?, 'running', ?)`)
    .run(type, targetType, targetId, new Date().toISOString());
  return getJob(db, Number(result.lastInsertRowid));
}

export function finishJob(
  db: Database.Database,
  jobId: number,
  status: 'done' | 'failed',
  error: string | null = null
): void {
  db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run(status, error, jobId);
}

export function reconcileInterruptedJobs(db: Database.Database): number {
  const result = db
    .prepare(`UPDATE jobs SET status = 'interrupted', error = 'engine restarted mid-job' WHERE status = 'running'`)
    .run();
  return result.changes;
}
