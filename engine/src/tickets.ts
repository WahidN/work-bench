import type Database from 'better-sqlite3';
import type { Ticket, TicketMessage, TicketSource, TicketStatus, Analysis } from './types.js';

function rowToTicket(row: any): Ticket {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, projectId: row.project_id,
    title: row.title, body: row.body, url: row.url,
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    status: row.status, prId: row.pr_id, pinned: !!row.pinned, createdAt: row.created_at,
  };
}

export function getTicket(db: Database.Database, id: number): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  return row ? rowToTicket(row) : null;
}

export function findTicketBySource(db: Database.Database, source: TicketSource, sourceId: string): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE source = ? AND source_id = ?').get(source, sourceId);
  return row ? rowToTicket(row) : null;
}

export function listTickets(db: Database.Database, filter: { status?: TicketStatus } = {}): Ticket[] {
  if (filter.status) {
    return db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY created_at').all(filter.status).map(rowToTicket);
  }
  return db.prepare('SELECT * FROM tickets ORDER BY created_at').all().map(rowToTicket);
}

export interface CreateTicketInput {
  source: TicketSource;
  sourceId: string;
  projectId: number;
  title: string;
  body: string;
  url: string;
  analysis: Analysis | null;
}

export function createTicket(db: Database.Database, input: CreateTicketInput): Ticket {
  const result = db
    .prepare(
      `INSERT INTO tickets (source, source_id, project_id, title, body, url, analysis_json, created_at)
       VALUES (@source, @sourceId, @projectId, @title, @body, @url, @analysisJson, @createdAt)`
    )
    .run({
      ...input,
      analysisJson: input.analysis ? JSON.stringify(input.analysis) : null,
      createdAt: new Date().toISOString(),
    });
  return getTicket(db, Number(result.lastInsertRowid))!;
}

export function setTicketPinned(db: Database.Database, id: number, pinned: boolean): Ticket | null {
  db.prepare('UPDATE tickets SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return getTicket(db, id);
}

export function updateTicketStatus(
  db: Database.Database,
  id: number,
  status: TicketStatus,
  prId: number | null
): Ticket | null {
  db.prepare('UPDATE tickets SET status = ?, pr_id = ? WHERE id = ?').run(status, prId, id);
  return getTicket(db, id);
}

function rowToTicketMessage(row: any): TicketMessage {
  return { id: row.id, ticketId: row.ticket_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function listTicketMessages(db: Database.Database, ticketId: number): TicketMessage[] {
  return db
    .prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id')
    .all(ticketId)
    .map(rowToTicketMessage);
}

export function addTicketMessage(
  db: Database.Database,
  ticketId: number,
  role: 'user' | 'assistant',
  content: string
): TicketMessage {
  const result = db
    .prepare('INSERT INTO ticket_messages (ticket_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(ticketId, role, content, new Date().toISOString());
  return rowToTicketMessage(db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(result.lastInsertRowid));
}
