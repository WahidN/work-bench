import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTickets, findTicketBySource, createTicket } from './tickets.js';
import { listPrs } from './prs.js';
import { analyzeIssue } from './analyze.js';
import type { Todo, SourceIssue, Project, Ticket, TicketStatus, PrStatus, TodoPriority, TodoMessage } from './types.js';

function rowToTodo(row: any): Todo {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, text: row.text, body: row.body, url: row.url,
    projectId: row.project_id, canPromote: !!row.can_promote, done: !!row.done,
    promotedTicketId: row.promoted_ticket_id, priority: row.priority, dueAt: row.due_at,
    doneAt: row.done_at, pinned: !!row.pinned,
    statusName: row.status, statusCategory: row.status_category,
    createdAt: row.created_at,
  };
}

function rowToTodoMessage(row: any): TodoMessage {
  return {
    id: row.id,
    todoId: row.todo_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function listTodoMessages(db: Database.Database, todoId: number): TodoMessage[] {
  return db
    .prepare('SELECT * FROM todo_messages WHERE todo_id = ? ORDER BY id')
    .all(todoId)
    .map(rowToTodoMessage);
}

export function addTodoMessage(
  db: Database.Database,
  todoId: number,
  role: 'user' | 'assistant',
  content: string
): TodoMessage {
  const result = db
    .prepare('INSERT INTO todo_messages (todo_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(todoId, role, content, new Date().toISOString());
  return rowToTodoMessage(
    db.prepare('SELECT * FROM todo_messages WHERE id = ?').get(result.lastInsertRowid)
  );
}

/** The local calendar date as YYYY-MM-DD. Not the UTC date: a task added at 00:30 belongs to that day. */
export function localDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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

export function createManualTodo(
  db: Database.Database,
  text: string,
  options: { priority?: TodoPriority; dueAt?: string; projectId?: number } = {}
): Todo {
  const result = db
    .prepare(
      `INSERT INTO todos (source, source_id, text, body, project_id, can_promote, done, priority, due_at, created_at)
       VALUES ('manual', NULL, ?, '', ?, 0, 0, ?, ?, ?)`
    )
    .run(
      text,
      options.projectId ?? null,
      options.priority ?? 'med',
      options.dueAt ?? localDate(),
      new Date().toISOString()
    );
  return rowToTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid));
}

export function setTodoDone(db: Database.Database, id: number, done: boolean): Todo | null {
  db.prepare('UPDATE todos SET done = ?, done_at = ? WHERE id = ?').run(done ? 1 : 0, done ? localDate() : null, id);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function setTodoPriority(db: Database.Database, id: number, priority: TodoPriority): Todo | null {
  db.prepare('UPDATE todos SET priority = ? WHERE id = ?').run(priority, id);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function setTodoPinned(db: Database.Database, id: number, pinned: boolean): Todo | null {
  db.prepare('UPDATE todos SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return getTodo(db, id);
}

export function upsertJiraTodo(db: Database.Database, issue: SourceIssue, project: Project | null): void {
  db.prepare(
    `INSERT INTO todos (source, source_id, text, body, url, project_id, can_promote, done, status, status_category, created_at)
     VALUES ('jira', @sourceId, @text, @body, @url, @projectId, @canPromote, 0, @statusName, @statusCategory, @createdAt)
     ON CONFLICT(source, source_id) DO UPDATE SET text = @text, body = @body, url = @url, project_id = @projectId, can_promote = @canPromote, status = @statusName, status_category = @statusCategory`
  ).run({
    sourceId: issue.sourceId,
    text: issue.title,
    body: issue.body,
    url: issue.url,
    projectId: project ? project.id : null,
    canPromote: project ? 1 : 0,
    // Overwritten on every poll, not just on insert: an issue transitioned in Jira
    // has to move group, which is the whole point of storing this.
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
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
    // Carried through from what the last poll stored, so the analysis prompt sees the
    // same status the user sees rather than a blank.
    statusName: todo.statusName, statusCategory: todo.statusCategory,
  };
  const analysis = await analyzeIssue(issue, project);
  const ticket = createTicket(db, {
    source: 'jira', sourceId: todo.sourceId, projectId: project.id,
    title: todo.text, body: todo.body, url: todo.url ?? '', analysis,
  });
  // The thread moves with the issue. From here the row opens the ticket chat, and
  // the fix pipeline reads ticket_messages, so leaving history behind would hide it.
  // One transaction: a crash between the copy and the stamp would otherwise leave a
  // promoted issue whose history is still on the todo, or a cleared todo with no
  // ticket to show it. promoteTodo awaits analyzeIssue above and so cannot itself be
  // one transaction, but these three statements come after that await.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO ticket_messages (ticket_id, role, content, created_at)
         SELECT ?, role, content, created_at FROM todo_messages WHERE todo_id = ? ORDER BY id`
    ).run(ticket.id, todo.id);
    db.prepare('DELETE FROM todo_messages WHERE todo_id = ?').run(todo.id);
    db.prepare('UPDATE todos SET done = 1, done_at = ?, promoted_ticket_id = ? WHERE id = ?')
      .run(localDate(), ticket.id, todo.id);
  })();
  return ticket;
}

export function countJiraTodos(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM todos WHERE source = 'jira'`).get() as { n: number };
  return row.n;
}

// todo_messages references todos(id) and foreign keys are enforced at runtime, so
// a thread has to go before the row it hangs off. Without this the poller throws
// FOREIGN KEY constraint failed on the first discussed issue that leaves Jira, and
// reconciliation stops for every project. One transaction so a failure cannot
// leave a thread orphaned from its todo.
export function reconcileJiraTodos(db: Database.Database, currentSourceIds: string[]): number {
  if (currentSourceIds.length === 0) {
    return db.transaction(() => {
      db.prepare(
        `DELETE FROM todo_messages
         WHERE todo_id IN (SELECT id FROM todos WHERE source = 'jira')`
      ).run();
      return db.prepare(`DELETE FROM todos WHERE source = 'jira'`).run().changes;
    })();
  }
  const placeholders = currentSourceIds.map(() => '?').join(',');
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM todo_messages
       WHERE todo_id IN (
         SELECT id FROM todos WHERE source = 'jira' AND source_id NOT IN (${placeholders})
       )`
    ).run(...currentSourceIds);
    return db
      .prepare(`DELETE FROM todos WHERE source = 'jira' AND source_id NOT IN (${placeholders})`)
      .run(...currentSourceIds).changes;
  })();
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

/// Today's task list: the user's own tasks plus anything pinned from another
/// screen, open plus whatever was completed today. An unpinned mirrored Jira
/// todo stays out; one todo per assigned Jira issue would swamp a day view.
export function listTodayTodos(db: Database.Database): Todo[] {
  return db
    .prepare(
      `SELECT * FROM todos
        WHERE (source = 'manual' OR pinned = 1) AND (done = 0 OR done_at = ?)
        ORDER BY created_at`
    )
    .all(localDate())
    .map(rowToTodo);
}

export function getTodayView(db: Database.Database): TodayView {
  const tickets = listTickets(db).filter(
    (t) => t.status === 'new' || t.status === 'sparring' || t.status === 'needs_attention'
  );
  const prs = listPrs(db).filter((p) => p.status === 'open' || p.status === 'needs_attention');

  const needsInput: TodayItem[] = [
    ...tickets.map((t) => ({ kind: 'ticket' as const, id: t.id, title: t.title, status: t.status, reviewScore: null })),
    ...prs.map((p) => {
      const ticket = p.ticketId === null ? null : getTicket(db, p.ticketId);
      return {
        kind: 'pr' as const, id: p.id, title: ticket?.title ?? `PR #${p.number ?? p.id}`,
        status: p.status, reviewScore: p.lastReviewScore,
      };
    }),
  ];

  return { needsInput, todos: listTodayTodos(db) };
}
