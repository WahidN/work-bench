import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, updateTicketStatus, findTicketBySource } from '../src/tickets.js';
import { recordPr } from '../src/prs.js';
import * as analyze from '../src/analyze.js';
import {
  listTodos, getTodo, createManualTodo, setTodoDone, upsertJiraTodo, reconcileJiraTodos, promoteTodo, getTodayView,
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
});
