import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTickets, findTicketBySource, createTicket } from './tickets.js';
import { listPrs } from './prs.js';
import { analyzeIssue } from './analyze.js';
import type { Todo, SourceIssue, Project, Ticket, TicketStatus, PrStatus } from './types.js';

function rowToTodo(row: any): Todo {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, text: row.text, body: row.body, url: row.url,
    projectId: row.project_id, canPromote: !!row.can_promote, done: !!row.done,
    promotedTicketId: row.promoted_ticket_id, createdAt: row.created_at,
  };
}

export function listTodos(db: Database.Database, filter: { done?: boolean } = {}): Todo[] {
  if (filter.done !== undefined) {
    return db.prepare('SELECT * FROM todos WHERE done = ? ORDER BY created_at').all(filter.done ? 1 : 0).map(rowToTodo);
  }
  return db.prepare('SELECT * FROM todos ORDER BY created_at').all().map(rowToTodo);
}

export function getTodo(db: Database.Database, id: number): Todo | null {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function createManualTodo(db: Database.Database, text: string): Todo {
  const result = db
    .prepare(
      `INSERT INTO todos (source, source_id, text, body, can_promote, done, created_at)
       VALUES ('manual', NULL, ?, '', 0, 0, ?)`
    )
    .run(text, new Date().toISOString());
  return rowToTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid));
}

export function setTodoDone(db: Database.Database, id: number, done: boolean): Todo | null {
  db.prepare('UPDATE todos SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function upsertJiraTodo(db: Database.Database, issue: SourceIssue, project: Project | null): void {
  db.prepare(
    `INSERT INTO todos (source, source_id, text, body, url, project_id, can_promote, done, created_at)
     VALUES ('jira', @sourceId, @text, @body, @url, @projectId, @canPromote, 0, @createdAt)
     ON CONFLICT(source, source_id) DO UPDATE SET text = @text, body = @body, url = @url, project_id = @projectId, can_promote = @canPromote`
  ).run({
    sourceId: issue.sourceId,
    text: issue.title,
    body: issue.body,
    url: issue.url,
    projectId: project ? project.id : null,
    canPromote: project ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
}

export async function promoteTodo(db: Database.Database, todoId: number): Promise<Ticket> {
  const todo = getTodo(db, todoId);
  if (!todo) throw new Error(`Todo ${todoId} not found`);
  if (todo.source !== 'jira' || !todo.sourceId) throw new Error(`Todo ${todoId} cannot be promoted (not a Jira item)`);

  const existing = findTicketBySource(db, 'jira', todo.sourceId);
  if (existing) return existing;

  if (!todo.canPromote || todo.projectId === null) throw new Error(`Todo ${todoId} cannot be promoted (no project mapping)`);
  const project = getProject(db, todo.projectId);
  if (!project) throw new Error(`Project ${todo.projectId} not found`);

  const issue: SourceIssue = {
    source: 'jira', sourceId: todo.sourceId, title: todo.text, url: todo.url ?? '',
    body: todo.body, projectKey: project.jiraProjectKey ?? '',
  };
  const analysis = await analyzeIssue(issue, project);
  const ticket = createTicket(db, {
    source: 'jira', sourceId: todo.sourceId, projectId: project.id,
    title: todo.text, body: todo.body, url: todo.url ?? '', analysis,
  });
  db.prepare('UPDATE todos SET done = 1, promoted_ticket_id = ? WHERE id = ?').run(ticket.id, todo.id);
  return ticket;
}

export function reconcileJiraTodos(db: Database.Database, currentSourceIds: string[]): number {
  if (currentSourceIds.length === 0) {
    return db.prepare(`DELETE FROM todos WHERE source = 'jira'`).run().changes;
  }
  const placeholders = currentSourceIds.map(() => '?').join(',');
  return db
    .prepare(`DELETE FROM todos WHERE source = 'jira' AND source_id NOT IN (${placeholders})`)
    .run(...currentSourceIds).changes;
}

export interface TodayItem {
  kind: 'ticket' | 'pr';
  id: number;
  title: string;
  status: TicketStatus | PrStatus;
  reviewScore: number | null;
}

export interface TodayView {
  needsInput: TodayItem[];
  todos: Todo[];
}

export function getTodayView(db: Database.Database): TodayView {
  const tickets = listTickets(db).filter(
    (t) => t.status === 'new' || t.status === 'sparring' || t.status === 'needs_attention'
  );
  const prs = listPrs(db).filter((p) => p.status === 'open' || p.status === 'needs_attention');

  const needsInput: TodayItem[] = [
    ...tickets.map((t) => ({ kind: 'ticket' as const, id: t.id, title: t.title, status: t.status, reviewScore: null })),
    ...prs.map((p) => {
      const ticket = getTicket(db, p.ticketId);
      return {
        kind: 'pr' as const, id: p.id, title: ticket?.title ?? `PR #${p.number ?? p.id}`,
        status: p.status, reviewScore: p.lastReviewScore,
      };
    }),
  ];

  return { needsInput, todos: listTodos(db, { done: false }) };
}
