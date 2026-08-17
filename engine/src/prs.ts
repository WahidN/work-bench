import type Database from 'better-sqlite3';
import type { Pr, PrMessage, PrStatus, PrReviewState } from './types.js';

// Every route that returns a PR hands it to Swift, whose decoder has no defaults,
// so the message count has to ride along on every read rather than only the list.
const PR_SELECT = `SELECT p.*, (SELECT COUNT(*) FROM pr_messages m WHERE m.pr_id = p.id) AS message_count FROM prs p`;

function rowToPr(row: any): Pr {
  return {
    id: row.id, ticketId: row.ticket_id, projectId: row.project_id, branch: row.branch,
    number: row.number, url: row.url, status: row.status,
    lastReviewScore: row.last_review_score, pinned: !!row.pinned, createdAt: row.created_at,
    title: row.title, reviewState: row.review_state as PrReviewState | null,
    isDraft: !!row.is_draft, githubUpdatedAt: row.github_updated_at,
    authoredByMe: !!row.authored_by_me, assignedToMe: !!row.assigned_to_me,
    messageCount: Number(row.message_count ?? 0),
  };
}

export function getPr(db: Database.Database, id: number): Pr | null {
  const row = db.prepare(`${PR_SELECT} WHERE p.id = ?`).get(id);
  return row ? rowToPr(row) : null;
}

export function listPrs(db: Database.Database, filter: { status?: PrStatus } = {}): Pr[] {
  if (filter.status) {
    return db.prepare(`${PR_SELECT} WHERE p.status = ? ORDER BY p.created_at`).all(filter.status).map(rowToPr);
  }
  return db.prepare(`${PR_SELECT} ORDER BY p.created_at`).all().map(rowToPr);
}

export interface RecordPrInput {
  ticketId: number | null;
  projectId: number;
  branch: string;
  number: number | null;
  url: string | null;
  status: PrStatus;
}

export function recordPr(db: Database.Database, input: RecordPrInput): Pr {
  const result = db
    .prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at)
       VALUES (@ticketId, @projectId, @branch, @number, @url, @status, @createdAt)`
    )
    .run({ ...input, createdAt: new Date().toISOString() });
  return getPr(db, Number(result.lastInsertRowid))!;
}

export function setPrPinned(db: Database.Database, id: number, pinned: boolean): Pr | null {
  db.prepare('UPDATE prs SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return getPr(db, id);
}

export function updatePrStatus(
  db: Database.Database,
  id: number,
  status: PrStatus,
  lastReviewScore: number | null
): Pr | null {
  db.prepare('UPDATE prs SET status = ?, last_review_score = ? WHERE id = ?').run(status, lastReviewScore, id);
  return getPr(db, id);
}

function rowToPrMessage(row: any): PrMessage {
  return { id: row.id, prId: row.pr_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function listPrMessages(db: Database.Database, prId: number): PrMessage[] {
  return db.prepare('SELECT * FROM pr_messages WHERE pr_id = ? ORDER BY id').all(prId).map(rowToPrMessage);
}

export function addPrMessage(db: Database.Database, prId: number, role: 'user' | 'assistant', content: string): PrMessage {
  const result = db
    .prepare('INSERT INTO pr_messages (pr_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(prId, role, content, new Date().toISOString());
  return rowToPrMessage(db.prepare('SELECT * FROM pr_messages WHERE id = ?').get(result.lastInsertRowid));
}
