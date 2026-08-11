import type Database from 'better-sqlite3';
import type { Pr, PrMessage, PrStatus } from './types.js';

function rowToPr(row: any): Pr {
  return {
    id: row.id, ticketId: row.ticket_id, projectId: row.project_id, branch: row.branch,
    number: row.number, url: row.url, status: row.status,
    lastReviewScore: row.last_review_score, createdAt: row.created_at,
  };
}

export function getPr(db: Database.Database, id: number): Pr | null {
  const row = db.prepare('SELECT * FROM prs WHERE id = ?').get(id);
  return row ? rowToPr(row) : null;
}

export function listPrs(db: Database.Database, filter: { status?: PrStatus } = {}): Pr[] {
  if (filter.status) {
    return db.prepare('SELECT * FROM prs WHERE status = ? ORDER BY created_at').all(filter.status).map(rowToPr);
  }
  return db.prepare('SELECT * FROM prs ORDER BY created_at').all().map(rowToPr);
}

export interface RecordPrInput {
  ticketId: number;
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
