import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, updateTicketStatus, findTicketBySource } from '../src/tickets.js';
import { recordPr } from '../src/prs.js';
import * as analyze from '../src/analyze.js';
import {
  listTodos, getTodo, createManualTodo, setTodoDone, upsertJiraTodo, reconcileJiraTodos, promoteTodo, getTodayView,
  setTodoPriority, setTodoPinned, listTodayTodos, localDate, listTodoMessages, addTodoMessage,
} from '../src/todos.js';

vi.mock('../src/analyze.js');

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
});

describe('manual todos', () => {
  it('creates and lists an open manual todo', () => {
    createManualTodo(db, 'reply to client');
    expect(listTodos(db, { done: false }).map((t) => t.text)).toEqual(['reply to client']);
  });

  it('setTodoDone marks it done and it drops out of the open filter', () => {
    const todo = createManualTodo(db, 'renew SSL cert');
    setTodoDone(db, todo.id, true);
    expect(listTodos(db, { done: false })).toEqual([]);
    expect(listTodos(db, { done: true })[0].done).toBe(true);
  });

  it('defaults a new manual todo to med priority and due today', () => {
    const todo = createManualTodo(db, 'reply to client');
    expect(todo.priority).toBe('med');
    expect(todo.dueAt).toBe(localDate());
    expect(todo.doneAt).toBeNull();
  });

  it('stamps done_at when completed and clears it when reopened', () => {
    const todo = createManualTodo(db, 'renew SSL cert');
    expect(setTodoDone(db, todo.id, true)!.doneAt).toBe(localDate());
    expect(setTodoDone(db, todo.id, false)!.doneAt).toBeNull();
  });

  it('setTodoPriority writes the new priority and leaves done untouched', () => {
    const todo = createManualTodo(db, 'cut the release branch');
    const updated = setTodoPriority(db, todo.id, 'high');
    expect(updated!.priority).toBe('high');
    expect(updated!.done).toBe(false);
  });

  it('rejects a priority outside the allowed set', () => {
    const todo = createManualTodo(db, 'bogus');
    expect(() => setTodoPriority(db, todo.id, 'urgent' as any)).toThrow(/CHECK/);
  });
});

describe('listTodayTodos', () => {
  it('returns open todos and the ones completed today, but not older completions', () => {
    const open = createManualTodo(db, 'still open');
    const doneToday = createManualTodo(db, 'done today');
    const doneLastWeek = createManualTodo(db, 'done last week');
    setTodoDone(db, doneToday.id, true);
    setTodoDone(db, doneLastWeek.id, true);
    db.prepare(`UPDATE todos SET done_at = '2026-08-01' WHERE id = ?`).run(doneLastWeek.id);

    expect(listTodayTodos(db).map((t) => t.id)).toEqual([open.id, doneToday.id]);
  });

  const jiraIssue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO' };

  it('excludes a mirrored jira todo even though it is open', () => {
    const open = createManualTodo(db, 'still open');
    upsertJiraTodo(db, jiraIssue, null);

    expect(listTodayTodos(db).map((t) => t.id)).toEqual([open.id]);
  });

  it('excludes a jira todo completed today', () => {
    const open = createManualTodo(db, 'still open');
    upsertJiraTodo(db, jiraIssue, null);
    const jiraTodo = listTodos(db).find((t) => t.source === 'jira')!;
    setTodoDone(db, jiraTodo.id, true);

    expect(listTodayTodos(db).map((t) => t.id)).toEqual([open.id]);
  });

  it('includes a manual todo completed today', () => {
    const doneToday = createManualTodo(db, 'done today');
    setTodoDone(db, doneToday.id, true);

    expect(listTodayTodos(db).map((t) => t.id)).toEqual([doneToday.id]);
  });

  it('includes a pinned jira todo', () => {
    upsertJiraTodo(db, { source: 'jira', sourceId: 'JIRA-MR-1', title: '[MR-1] Fix the importer', url: 'https://x/browse/MR-1', body: '', projectKey: 'MR' }, null);
    const [jira] = listTodos(db).filter((t) => t.source === 'jira');
    setTodoPinned(db, jira.id, true);

    expect(listTodayTodos(db).map((t) => t.id)).toContain(jira.id);
  });

  it('still excludes an unpinned jira todo', () => {
    upsertJiraTodo(db, { source: 'jira', sourceId: 'JIRA-MR-2', title: '[MR-2] Rotate the keys', url: 'https://x/browse/MR-2', body: '', projectKey: 'MR' }, null);

    expect(listTodayTodos(db)).toEqual([]);
  });

  it('excludes a pinned todo completed on an earlier day', () => {
    const todo = createManualTodo(db, 'old pinned task');
    setTodoPinned(db, todo.id, true);
    setTodoDone(db, todo.id, true);
    db.prepare(`UPDATE todos SET done_at = '2026-08-01' WHERE id = ?`).run(todo.id);

    expect(listTodayTodos(db)).toEqual([]);
  });
});

describe('upsertJiraTodo / reconcileJiraTodos', () => {
  const issue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO' };

  it('inserts a new jira todo with canPromote true and its body stored, when a project maps to it', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const [todo] = listTodos(db);
    expect(todo).toMatchObject({
      source: 'jira', sourceId: 'JIRA-DEMO-1', body: 'Redirect loop on logout.', canPromote: true, projectId: project.id,
    });
  });

  it('sets canPromote false when no project maps to it', () => {
    upsertJiraTodo(db, issue, null);
    expect(listTodos(db)[0].canPromote).toBe(false);
  });

  it('updates the existing row instead of duplicating on a second upsert', () => {
    upsertJiraTodo(db, issue, null);
    upsertJiraTodo(db, { ...issue, title: '[DEMO-1] Update env vars (urgent)' }, null);
    expect(listTodos(db)).toHaveLength(1);
    expect(listTodos(db)[0].text).toBe('[DEMO-1] Update env vars (urgent)');
  });

  it('reconcileJiraTodos removes jira todos no longer in the current fetch but keeps manual ones', () => {
    upsertJiraTodo(db, issue, null);
    createManualTodo(db, 'unrelated manual item');
    const removed = reconcileJiraTodos(db, []);
    expect(removed).toBe(1);
    expect(listTodos(db).map((t) => t.text)).toEqual(['unrelated manual item']);
  });

  it('reconcileJiraTodos keeps a todo whose sourceId is still present', () => {
    upsertJiraTodo(db, issue, null);
    const removed = reconcileJiraTodos(db, ['JIRA-DEMO-1']);
    expect(removed).toBe(0);
    expect(listTodos(db)).toHaveLength(1);
  });
});

describe('promoteTodo', () => {
  const issue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO' };

  it('analyzes the issue, creates a ticket, and links the todo to it', async () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const todo = listTodos(db)[0];
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const ticket = await promoteTodo(db, todo.id);

    expect(ticket.source).toBe('jira');
    expect(ticket.sourceId).toBe('JIRA-DEMO-1');
    expect(ticket.analysis).toEqual({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high' });
    const updated = getTodo(db, todo.id)!;
    expect(updated.done).toBe(true);
    expect(updated.promotedTicketId).toBe(ticket.id);
  });

  it('is idempotent, a second call returns the existing ticket instead of duplicating it', async () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const todo = listTodos(db)[0];
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const first = await promoteTodo(db, todo.id);
    const second = await promoteTodo(db, todo.id);

    expect(second.id).toBe(first.id);
    expect(analyze.analyzeIssue).toHaveBeenCalledTimes(1);
  });

  it('throws when the todo cannot be promoted (no project mapping)', async () => {
    upsertJiraTodo(db, issue, null);
    const todo = listTodos(db)[0];
    await expect(promoteTodo(db, todo.id)).rejects.toThrow('cannot be promoted');
  });
});

describe('getTodayView', () => {
  it('includes tickets needing sparring, PRs needing review, and open todos; excludes done/merged', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    const newTicket = createTicket(db, { source: 'github', sourceId: 'GH-1', projectId: project.id, title: 'New ticket', body: 'b', url: 'u', analysis: null });
    const doneTicket = createTicket(db, { source: 'github', sourceId: 'GH-2', projectId: project.id, title: 'Done ticket', body: 'b', url: 'u', analysis: null });
    const prTicket = createTicket(db, { source: 'github', sourceId: 'GH-3', projectId: project.id, title: 'PR ticket', body: 'b', url: 'u', analysis: null });
    updateTicketStatus(db, doneTicket.id, 'done', null);
    updateTicketStatus(db, prTicket.id, 'in_review', null);
    const openPr = recordPr(db, { ticketId: prTicket.id, projectId: project.id, branch: 'fix/gh-3', number: 5, url: 'u', status: 'open' });
    recordPr(db, { ticketId: doneTicket.id, projectId: project.id, branch: 'fix/gh-2', number: 6, url: 'u', status: 'merged' });
    createManualTodo(db, 'unrelated task');

    const view = getTodayView(db);

    expect(view.needsInput).toEqual(
      expect.arrayContaining([
        { kind: 'ticket', id: newTicket.id, title: 'New ticket', status: 'new', reviewScore: null },
        { kind: 'pr', id: openPr.id, title: 'PR ticket', status: 'open', reviewScore: null },
      ])
    );
    expect(view.needsInput.some((i) => i.id === doneTicket.id && i.kind === 'ticket')).toBe(false);
    expect(view.todos.map((t) => t.text)).toEqual(['unrelated task']);
  });

  it('falls back to the PR number for a PR that has no ticket', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    db.prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at)
       VALUES (NULL, ?, 'feat/header', 23, 'u', 'open', '2026-08-12T17:31:06.792Z')`
    ).run(project.id);

    const view = getTodayView(db);

    expect(view.needsInput.map((i) => i.title)).toEqual(['PR #23']);
  });
});

describe('pinning a todo', () => {
  it('defaults to not pinned and toggles both ways', () => {
    const todo = createManualTodo(db, 'reply to client');

    expect(todo.pinned).toBe(false);
    expect(setTodoPinned(db, todo.id, true)!.pinned).toBe(true);
    expect(setTodoPinned(db, todo.id, false)!.pinned).toBe(false);
  });

  it('returns null for a todo that does not exist', () => {
    expect(setTodoPinned(db, 999, true)).toBeNull();
  });

  it('leaves done and priority untouched', () => {
    const todo = createManualTodo(db, 'cut the release branch', { priority: 'high' });
    const pinned = setTodoPinned(db, todo.id, true)!;

    expect(pinned.done).toBe(false);
    expect(pinned.priority).toBe('high');
  });
});

describe('createManualTodo with a project', () => {
  it('stores the project id', () => {
    const project = createProject(db, {
      name: 'Atlas', repoPath: '/repos/atlas', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });

    const todo = createManualTodo(db, 'Fix the header', { projectId: project.id });

    expect(todo.projectId).toBe(project.id);
    expect(todo.source).toBe('manual');
  });

  it('still stores null when no project is given, which is what Today does', () => {
    expect(createManualTodo(db, 'Fix the header').projectId).toBeNull();
  });
});

describe('todo messages', () => {
  it('stores a thread and lists it in insertion order', () => {
    const todo = createManualTodo(db, 'discuss me');

    addTodoMessage(db, todo.id, 'user', 'what is this about?');
    addTodoMessage(db, todo.id, 'assistant', 'A logout redirect loop.');

    expect(listTodoMessages(db, todo.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'what is this about?'],
      ['assistant', 'A logout redirect loop.'],
    ]);
  });

  it('returns the stored row, with the todo id mapped from snake case', () => {
    const todo = createManualTodo(db, 'discuss me');

    const message = addTodoMessage(db, todo.id, 'user', 'hi');

    expect(message.todoId).toBe(todo.id);
    expect(message.id).toBeGreaterThan(0);
    expect(message.createdAt).not.toBe('');
  });

  it('keeps two todos threads apart', () => {
    const first = createManualTodo(db, 'first');
    const second = createManualTodo(db, 'second');
    addTodoMessage(db, first.id, 'user', 'about the first');

    expect(listTodoMessages(db, second.id)).toEqual([]);
  });
});
