import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createManualTodo, promoteTodo } from '../../src/todos.js';
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

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
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
