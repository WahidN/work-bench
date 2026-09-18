// engine/tests/api/chatFailure.test.ts
//
// Every chat route stores the user's message before it runs the agent, so a run
// that dies leaves a question with nothing under it. These cover the four routes
// together, because that gap was the same shape in all of them.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject, listProjectMessages } from '../../src/projects.js';
import { createTicket, listTicketMessages } from '../../src/tickets.js';
import { createManualTodo, listTodoMessages } from '../../src/todos.js';
import { upsertGithubPr, listPrMessages } from '../../src/prs.js';
import * as prChat from '../../src/prChat.js';
import * as ticketChat from '../../src/ticketChat.js';
import * as todoChat from '../../src/todoChat.js';
import * as projectChat from '../../src/projectChat.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/prChat.js');
vi.mock('../../src/ticketChat.js');
vi.mock('../../src/todoChat.js');
vi.mock('../../src/projectChat.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let projectId: number;
let ticketId: number;
let todoId: number;
let prId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

function timeoutError(): Error {
  const err = new Error('Command timed out after 1800000 milliseconds: claude -p');
  (err as any).timedOut = true;
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
  todoId = createManualTodo(db, 'discuss me', { projectId }).id;
  prId = upsertGithubPr(db, {
    projectId, number: 77, title: 'Remove the filter tags', url: 'https://github.com/x/pull/77',
    githubUpdatedAt: '2026-09-17T10:00:00Z', isDraft: false, authoredByMe: true,
    assignedToMe: false, reviewRequestedByMe: false, reviewState: 'review_required',
    mergeable: 'MERGEABLE', branch: 'chore/remove-unused-schemas',
  }).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a failed send answers in the thread', () => {
  it('POST /prs/:id/messages, on a timeout', async () => {
    vi.mocked(prChat.sendPrMessage).mockRejectedValue(timeoutError());

    const res = await auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'fix the merge conflict' });

    expect(res.status).toBe(500);
    const messages = listPrMessages(db, prId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('30 minutes');
  });

  it('POST /tickets/:id/messages', async () => {
    vi.mocked(ticketChat.sendTicketMessage).mockRejectedValue(new Error('boom'));

    const res = await auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'a' });

    expect(res.status).toBe(500);
    expect(listTicketMessages(db, ticketId).map((m) => m.role)).toEqual(['assistant']);
  });

  it('POST /todos/:id/messages', async () => {
    vi.mocked(todoChat.sendTodoMessage).mockRejectedValue(new Error('boom'));

    const res = await auth(request(app).post(`/todos/${todoId}/messages`)).send({ text: 'a' });

    expect(res.status).toBe(500);
    expect(listTodoMessages(db, todoId).map((m) => m.role)).toEqual(['assistant']);
  });

  it('POST /projects/:id/messages', async () => {
    vi.mocked(projectChat.sendProjectMessage).mockRejectedValue(new Error('boom'));

    const res = await auth(request(app).post(`/projects/${projectId}/messages`)).send({ text: 'a' });

    expect(res.status).toBe(500);
    expect(listProjectMessages(db, projectId).map((m) => m.role)).toEqual(['assistant']);
  });

  // The merge button runs the same turn, so a failed merge has the same gap.
  it('POST /prs/:id/merge', async () => {
    vi.mocked(prChat.sendPrMessage).mockRejectedValue(new Error('gh pr merge failed'));

    const res = await auth(request(app).post(`/prs/${prId}/merge`)).send({});

    expect(res.status).toBe(500);
    const messages = listPrMessages(db, prId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('gh pr merge failed');
  });
});

describe('a send that works is untouched', () => {
  it('stores no failure message', async () => {
    vi.mocked(prChat.sendPrMessage).mockResolvedValue({ action: 'revised', reply: 'pushed' });

    const res = await auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'rename it' });

    expect(res.status).toBe(200);
    // sendPrMessage is mocked, so it writes no rows of its own. What matters is
    // that the route added none either.
    expect(listPrMessages(db, prId)).toHaveLength(0);
  });
});
