import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createManualTodo } from '../../src/todos.js';
import { createTicket } from '../../src/tickets.js';
import { createServer } from '../../src/api/server.js';

let db: Database.Database;
const TOKEN = 'test-token';
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
});

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

describe('auth middleware', () => {
  it('rejects a request with no token', async () => {
    await request(app).get('/today').expect(401);
  });

  it('rejects a request with the wrong token', async () => {
    await request(app).get('/today').set('Authorization', 'Bearer wrong').expect(401);
  });

  it('accepts a request with the right token', async () => {
    await auth(request(app).get('/today')).expect(200);
  });
});

describe('GET /today', () => {
  it('returns needsInput and todos', async () => {
    createManualTodo(db, 'reply to client');
    const res = await auth(request(app).get('/today'));
    expect(res.body.needsInput).toEqual([]);
    expect(res.body.todos[0]).toMatchObject({ text: 'reply to client' });
  });
});

describe('projects routes', () => {
  it('creates, lists, updates, and deletes a project', async () => {
    const created = await auth(request(app).post('/projects')).send({
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    expect(created.status).toBe(201);

    expect((await auth(request(app).get('/projects'))).body).toHaveLength(1);

    const updated = await auth(request(app).patch(`/projects/${created.body.id}`)).send({ defaultBranch: 'develop' });
    expect(updated.body.defaultBranch).toBe('develop');

    await auth(request(app).delete(`/projects/${created.body.id}`)).expect(204);
    expect((await auth(request(app).get('/projects'))).body).toHaveLength(0);
  });

  it('404s for an unknown project id', async () => {
    await auth(request(app).get('/projects/999')).expect(404);
  });

  it('defaults the optional source fields when they are omitted', async () => {
    const res = await auth(request(app).post('/projects')).send({
      name: 'minimal', repoPath: '/repos/minimal', defaultBranch: 'main',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null });
  });

  it('rejects a create with a missing required field as 400 JSON, not a 500', async () => {
    const res = await auth(request(app).post('/projects')).send({ name: 'no-repo-path', defaultBranch: 'main' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('repoPath');
  });

  it('409s on deleting a project that still has a ticket', async () => {
    const created = await auth(request(app).post('/projects')).send({
      name: 'busy', repoPath: '/repos/busy', defaultBranch: 'main',
    });
    createTicket(db, {
      source: 'github', sourceId: 'GH-9', projectId: created.body.id, title: 't', body: 'b', url: 'u', analysis: null,
    });

    const res = await auth(request(app).delete(`/projects/${created.body.id}`));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still has tickets');
  });
});

describe('error handling', () => {
  it('turns an uncaught route throw into JSON instead of an HTML error page', async () => {
    await auth(request(app).post('/projects')).send({ name: 'a', repoPath: '/a', defaultBranch: 'main' });
    const second = await auth(request(app).post('/projects')).send({ name: 'b', repoPath: '/b', defaultBranch: 'main' });

    const res = await auth(request(app).patch(`/projects/${second.body.id}`)).send({ name: 'a' });

    expect(res.status).toBe(500);
    expect(res.type).toBe('application/json');
    expect(res.body.error).toContain('UNIQUE');
  });
});

describe('todos routes', () => {
  it('creates a todo via POST, the Raycast quick-add target', async () => {
    const res = await auth(request(app).post('/todos')).send({ text: 'renew SSL cert' });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe('renew SSL cert');
  });

  it('rejects empty text', async () => {
    await auth(request(app).post('/todos')).send({ text: '' }).expect(400);
  });

  it('marks a todo done via PATCH', async () => {
    const created = await auth(request(app).post('/todos')).send({ text: 'x' });
    const res = await auth(request(app).patch(`/todos/${created.body.id}`)).send({ done: true });
    expect(res.body.done).toBe(true);
  });

  it('POST /todos/:id/promote rejects a manual todo with 400', async () => {
    const created = await auth(request(app).post('/todos')).send({ text: 'not a jira item' });
    const res = await auth(request(app).post(`/todos/${created.body.id}/promote`));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot be promoted');
  });
});
