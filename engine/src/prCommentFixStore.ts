import type Database from 'better-sqlite3';
import type { CommentFixState, StoredCommentFix } from './types.js';

function rowToFix(row: any): StoredCommentFix {
  return {
    id: row.id,
    prId: row.pr_id,
    commentId: row.comment_id,
    path: row.path,
    line: row.line,
    comment: row.comment,
    instruction: row.instruction,
    state: row.state,
    detail: row.detail,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export interface CommentFixEntry {
  commentId: number;
  path: string;
  line: number;
  comment: string;
  instruction: string;
}

export function startCommentFix(
  db: Database.Database,
  prId: number,
  entry: CommentFixEntry
): number {
  const result = db
    .prepare(
      `INSERT INTO pr_comment_fixes
         (pr_id, comment_id, path, line, comment, instruction, state, detail, created_at, finished_at)
       VALUES (@prId, @commentId, @path, @line, @comment, @instruction, 'queued', NULL, @createdAt, NULL)`
    )
    .run({ ...entry, prId, createdAt: new Date().toISOString() });
  return Number(result.lastInsertRowid);
}

export function claimNextQueuedFix(
  db: Database.Database,
  prId: number
): StoredCommentFix | null {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT * FROM pr_comment_fixes WHERE pr_id = ? AND state = 'queued' ORDER BY id LIMIT 1`)
      .get(prId);
    if (!row) return null;
    const claimed = rowToFix(row);
    db.prepare(`UPDATE pr_comment_fixes SET state = 'running' WHERE id = ?`).run(claimed.id);
    return { ...claimed, state: 'running' as CommentFixState };
  })();
}

export function finishCommentFix(
  db: Database.Database,
  id: number,
  state: Exclude<CommentFixState, 'queued' | 'running'>,
  detail: string | null
): void {
  db.prepare('UPDATE pr_comment_fixes SET state = ?, detail = ?, finished_at = ? WHERE id = ?')
    .run(state, detail, new Date().toISOString(), id);
}

export function listCommentFixes(db: Database.Database, prId: number): StoredCommentFix[] {
  return db
    .prepare('SELECT * FROM pr_comment_fixes WHERE pr_id = ? ORDER BY id')
    .all(prId)
    .map(rowToFix);
}

export function reconcileUnfinishedCommentFixes(db: Database.Database): number {
  const now = new Date().toISOString();
  const fail = db.prepare(
    'UPDATE pr_comment_fixes SET state = \'failed\', detail = ?, finished_at = ? WHERE state = ?'
  );
  return db.transaction(() => {
    const running = fail.run('The engine restarted while this fix was running.', now, 'running');
    const queued = fail.run('The engine restarted before this fix started.', now, 'queued');
    return running.changes + queued.changes;
  })();
}
