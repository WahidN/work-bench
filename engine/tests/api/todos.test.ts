import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createManualTodo, promoteTodo, setTodoDone, getTodo, listTodos, upsertJiraTodo } from '../../src/todos.js';
import { createProject } from '../../src/projects.js';
import { createServer } from '../../src/api/server.js';

// Only promoteTodo is faked; the rest of the module stays real so the todo rows
// the route reads are genuine.
vi.mock('../../src/todos.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/todos.js')>()),
  promoteTodo: vi.fn(),
}));

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let todoId: number;
let projectId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  projectId = createProject(db, {
    name: 'Atlas Payments', repoPath: '/repos/atlas', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  todoId = createManualTodo(db, 'promote me').id;
});

describe('POST /todos/:id/promote', () => {
  it('rejects a second concurrent promote with 409 instead of running two analyses', async () => {
    let resolvePromote: (ticket: any) => void;
    vi.mocked(promoteTodo).mockReturnValueOnce(new Promise((r) => { resolvePromote = r; }));

    const first = auth(request(app).post(`/todos/${todoId}/promote`)).then();
    await new Promise((r) => setTimeout(r, 10));
    const second = await auth(request(app).post(`/todos/${todoId}/promote`));

    expect(second.status).toBe(409);
    expect(promoteTodo).toHaveBeenCalledTimes(1);

    resolvePromote!({ id: 1 });
    await first;
  });

  it('releases the lock so a later promote is allowed again', async () => {
    vi.mocked(promoteTodo).mockResolvedValue({ id: 7 } as any);

    await auth(request(app).post(`/todos/${todoId}/promote`));
    const second = await auth(request(app).post(`/todos/${todoId}/promote`));

    expect(second.status).toBe(200);
  });

  it('404s when the todo does not exist', async () => {
    vi.mocked(promoteTodo).mockRejectedValue(new Error('Todo 999 not found'));

    const res = await auth(request(app).post('/todos/999/promote'));

    expect(res.status).toBe(404);
  });

  it('400s when the todo cannot be promoted', async () => {
    vi.mocked(promoteTodo).mockRejectedValue(new Error('Todo 1 cannot be promoted (not a Jira item)'));

    const res = await auth(request(app).post(`/todos/${todoId}/promote`));

    expect(res.status).toBe(400);
  });

  it('500s when the underlying analysis fails', async () => {
    vi.mocked(promoteTodo).mockRejectedValue(new Error('Claude did not return valid JSON after 2 attempts'));

    const res = await auth(request(app).post(`/todos/${todoId}/promote`));

    expect(res.status).toBe(500);
  });
});

describe('PATCH /todos/:id', () => {
  it('marks a todo done', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({ done: true });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(res.body.doneAt).not.toBeNull();
  });

  it('changes only the priority and leaves done alone', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({ priority: 'high' });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('high');
    expect(res.body.done).toBe(false);
  });

  it('does not reopen a completed todo when only the priority is sent', async () => {
    setTodoDone(db, todoId, true);

    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({ priority: 'low' });

    expect(res.body.done).toBe(true);
    expect(res.body.priority).toBe('low');
  });

  it('400s when done is not a boolean', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({ done: 'false' });

    expect(res.status).toBe(400);
  });

  it('400s on an unknown priority', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({ priority: 'urgent' });

    expect(res.status).toBe(400);
  });

  it('400s when neither done nor priority is sent', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}`)).send({});

    expect(res.status).toBe(400);
  });

  it('404s for a todo that does not exist', async () => {
    const res = await auth(request(app).patch('/todos/999')).send({ done: true });

    expect(res.status).toBe(404);
  });
});

describe('GET /todos', () => {
  it('returns only open todos by default', async () => {
    setTodoDone(db, todoId, true);

    const res = await auth(request(app).get('/todos'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns completed todos too when asked for any', async () => {
    setTodoDone(db, todoId, true);

    const res = await auth(request(app).get('/todos?done=any'));

    expect(res.body).toHaveLength(1);
    expect(res.body[0].done).toBe(true);
  });

  it('400s on an unknown done filter', async () => {
    const res = await auth(request(app).get('/todos?done=maybe'));

    expect(res.status).toBe(400);
  });
});

describe('PATCH /todos/:id/pin', () => {
  it('pins and unpins the todo', async () => {
    const pinned = await auth(request(app).patch(`/todos/${todoId}/pin`)).send({ pinned: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned).toBe(true);

    const unpinned = await auth(request(app).patch(`/todos/${todoId}/pin`)).send({ pinned: false });
    expect(unpinned.body.pinned).toBe(false);
  });

  it('400s when pinned is not a boolean', async () => {
    const res = await auth(request(app).patch(`/todos/${todoId}/pin`)).send({ pinned: 'yes' });
    expect(res.status).toBe(400);
  });

  it('404s for a todo that does not exist', async () => {
    const res = await auth(request(app).patch('/todos/999/pin')).send({ pinned: true });
    expect(res.status).toBe(404);
  });
});

describe('POST /todos with a project', () => {
  it('creates the task against that project', async () => {
    const res = await auth(request(app).post('/todos').send({ text: 'Fix the header', projectId }));

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(projectId);
  });

  it('rejects a project that does not exist, rather than hiding the task', async () => {
    const res = await auth(request(app).post('/todos').send({ text: 'Fix it', projectId: 999 }));

    expect(res.status).toBe(400);
  });

  it('rejects a projectId that is not a number', async () => {
    const res = await auth(request(app).post('/todos').send({ text: 'Fix it', projectId: 'atlas' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('projectId must be a number');
  });

  it('rejects a projectId that is not a number at all', async () => {
    const res = await auth(request(app).post('/todos').send({ text: 'Fix it', projectId: true }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('projectId must be a number');
  });

  it('still accepts a task with no project', async () => {
    const res = await auth(request(app).post('/todos').send({ text: 'Fix it' }));

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBeNull();
  });
});

describe('DELETE /todos/:id', () => {
  const issue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO', statusName: null, statusCategory: null };

  it('deletes a manual todo', async () => {
    const res = await auth(request(app).delete(`/todos/${todoId}`));

    expect(res.status).toBe(204);
    expect(getTodo(db, todoId)).toBeNull();
  });

  it('400s for a mirrored jira issue, with a reason, and leaves it in place', async () => {
    upsertJiraTodo(db, issue, null);
    const jira = listTodos(db).find((t) => t.source === 'jira')!;

    const res = await auth(request(app).delete(`/todos/${jira.id}`));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be deleted/);
    expect(getTodo(db, jira.id)).not.toBeNull();
  });

  it('404s for a todo that does not exist', async () => {
    const res = await auth(request(app).delete('/todos/999'));

    expect(res.status).toBe(404);
  });

  it('401s without a bearer token, and the todo survives', async () => {
    const res = await request(app).delete(`/todos/${todoId}`);

    expect(res.status).toBe(401);
    expect(getTodo(db, todoId)).not.toBeNull();
  });
});
