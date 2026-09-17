import type Database from 'better-sqlite3';
import type { Job, JobType, JobTargetType, JobActivity, RunningAgent } from './types.js';

function rowToJob(row: any): Job {
  return {
    id: row.id, type: row.type, targetType: row.target_type, targetId: row.target_id,
    status: row.status, activity: row.activity ?? null, error: row.error,
    createdAt: row.created_at,
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

/// `activity` is what will actually run under this lock, or null when the caller
/// only needs the worktree and runs no agent. It is required rather than optional
/// so a new lock cannot pick up an agent's visibility by forgetting to say.
export function acquireJob(
  db: Database.Database,
  type: JobType,
  targetType: JobTargetType,
  targetId: number,
  activity: JobActivity | null
): Job | null {
  const running = db
    .prepare(`SELECT id FROM jobs WHERE target_type = ? AND target_id = ? AND status = 'running'`)
    .get(targetType, targetId);
  if (running) return null;

  const result = db
    .prepare(
      `INSERT INTO jobs (type, target_type, target_id, status, activity, created_at)
       VALUES (?, ?, ?, 'running', ?, ?)`
    )
    .run(type, targetType, targetId, activity, new Date().toISOString());
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

/// Every agent Workbench is running, plus the fixes waiting to start.
///
/// Running work comes from the jobs table, filtered on a recorded activity: the
/// diff route and the head-sha check hold the same lock and run only git, and the
/// head-sha check runs every 30 seconds per pull request from the app's
/// notification loop. Listing those would show an agent that does not exist.
///
/// Waiting work comes from pr_comment_fixes, because a queued fix holds no lock
/// yet. `queued` and `running` are disjoint states, so a fix that has started is
/// listed once, by its job.
///
/// A triage job's target is a todo id in the ticket namespace, which is why the
/// title is read per activity rather than from one table.
export function listRunningAgents(db: Database.Database): RunningAgent[] {
  const running = db
    .prepare(
      `SELECT j.id, j.activity, j.target_type, j.target_id, j.created_at,
              CASE
                WHEN j.target_type = 'pr' THEN (SELECT p.title FROM prs p WHERE p.id = j.target_id)
                WHEN j.activity = 'triage' THEN (SELECT t.text FROM todos t WHERE t.id = j.target_id)
                ELSE (SELECT t.title FROM tickets t WHERE t.id = j.target_id)
              END AS title
         FROM jobs j
        WHERE j.status = 'running' AND j.activity IS NOT NULL
        ORDER BY j.created_at, j.id`
    )
    .all() as any[];

  const waiting = db
    .prepare(
      `SELECT f.id, f.pr_id, f.created_at, (SELECT p.title FROM prs p WHERE p.id = f.pr_id) AS title
         FROM pr_comment_fixes f
        WHERE f.state = 'queued'
        ORDER BY f.created_at, f.id`
    )
    .all() as any[];

  return [
    ...running.map((row) => ({
      key: `job-${row.id}`,
      activity: row.activity as JobActivity,
      targetType: row.target_type as JobTargetType,
      targetId: row.target_id as number,
      title: (row.title as string | null) ?? '',
      waiting: false,
      startedAt: row.created_at as string,
    })),
    ...waiting.map((row) => ({
      key: `fix-${row.id}`,
      activity: 'comment-fix' as JobActivity,
      targetType: 'pr' as JobTargetType,
      targetId: row.pr_id as number,
      title: (row.title as string | null) ?? '',
      waiting: true,
      startedAt: row.created_at as string,
    })),
  ];
}
