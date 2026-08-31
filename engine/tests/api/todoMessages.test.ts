import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createManualTodo, upsertJiraTodo, listTodos, addTodoMessage } from '../../src/todos.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import { createServer } from '../../src/api/server.js';
import { sendTodoMessage } from '../../src/todoChat.js';

vi.mock('../../src/todoChat.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let todoId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  todoId = createManualTodo(db, 'discuss me').id;
});

describe('GET /todos/:id/messages', () => {
  it('returns the thread in order', async () => {
    addTodoMessage(db, todoId, 'user', 'first');
    addTodoMessage(db, todoId, 'assistant', 'second');

    const res = await auth(request(app).get(`/todos/${todoId}/messages`));

    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => [m.role, m.content])).toEqual([
      ['user', 'first'],
      ['assistant', 'second'],
    ]);
  });

  it('returns an empty array for a todo with no thread', async () => {
    const res = await auth(request(app).get(`/todos/${todoId}/messages`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('answers 404 for an unknown todo', async () => {
    const res = await auth(request(app).get('/todos/9999/messages'));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not found');
  });
});

describe('POST /todos/:id/messages', () => {
  it('sends the message and returns the reply', async () => {
    vi.mocked(sendTodoMessage).mockResolvedValue('It is the redirect guard.');

    const res = await auth(request(app).post(`/todos/${todoId}/messages`)).send({ text: 'what is this?' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'It is the redirect guard.' });
    expect(sendTodoMessage).toHaveBeenCalledWith(expect.anything(), todoId, 'what is this?');
  });

  it('answers 400 for missing, non-string or blank text', async () => {
    for (const body of [{}, { text: 42 }, { text: '   ' }]) {
      const res = await auth(request(app).post(`/todos/${todoId}/messages`)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text is required');
    }
    expect(sendTodoMessage).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown todo', async () => {
    const res = await auth(request(app).post('/todos/9999/messages')).send({ text: 'hi' });
    expect(res.status).toBe(404);
    expect(sendTodoMessage).not.toHaveBeenCalled();
  });

  it('answers 409 once the issue has been promoted, because the thread moved to its ticket', async () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, {
      source: 'jira', sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] t',
      url: 'u', body: 'b', projectKey: 'DEMO', statusName: null, statusCategory: null,
    }, project);
    const jiraTodo = listTodos(db).find((t) => t.source === 'jira')!;
    const ticket = createTicket(db, {
      source: 'jira', sourceId: 'JIRA-DEMO-1', projectId: project.id,
      title: 't', body: 'b', url: 'u', analysis: null,
    });
    db.prepare('UPDATE todos SET promoted_ticket_id = ? WHERE id = ?').run(ticket.id, jiraTodo.id);

    const res = await auth(request(app).post(`/todos/${jiraTodo.id}/messages`)).send({ text: 'hi' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('promoted');
    expect(sendTodoMessage).not.toHaveBeenCalled();
  });

  it('answers 500 when the Claude turn throws', async () => {
    vi.mocked(sendTodoMessage).mockRejectedValue(new Error('claude exploded'));

    const res = await auth(request(app).post(`/todos/${todoId}/messages`)).send({ text: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('claude exploded');
  });

  it('requires the bearer token', async () => {
    const res = await request(app).post(`/todos/${todoId}/messages`).send({ text: 'hi' });
    expect(res.status).toBe(401);
  });
});
