import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject, addProjectMessage } from '../../src/projects.js';
import * as projectChat from '../../src/projectChat.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/projectChat.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
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
});

describe('GET /projects/:id/messages', () => {
  it('returns the thread in order', async () => {
    addProjectMessage(db, projectId, 'user', 'catch me up');
    addProjectMessage(db, projectId, 'assistant', 'two PRs are waiting');

    const res = await auth(request(app).get(`/projects/${projectId}/messages`));

    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => [m.role, m.content])).toEqual([
      ['user', 'catch me up'],
      ['assistant', 'two PRs are waiting'],
    ]);
  });

  it('returns an empty array for a project with no thread', async () => {
    const res = await auth(request(app).get(`/projects/${projectId}/messages`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('404s for an unknown project', async () => {
    const res = await auth(request(app).get('/projects/999/messages'));
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:id/messages', () => {
  it('runs the chat turn and returns the reply', async () => {
    vi.mocked(projectChat.sendProjectMessage).mockResolvedValue('Start with the refund retry.');

    const res = await auth(request(app).post(`/projects/${projectId}/messages`)).send({ text: 'what first?' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Start with the refund retry.' });
    expect(projectChat.sendProjectMessage).toHaveBeenCalledWith(expect.anything(), projectId, 'what first?');
  });

  it('rejects a blank message with 400 and never calls the chat turn', async () => {
    const res = await auth(request(app).post(`/projects/${projectId}/messages`)).send({ text: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('text is required');
    expect(projectChat.sendProjectMessage).not.toHaveBeenCalled();
  });

  it('404s for an unknown project', async () => {
    const res = await auth(request(app).post('/projects/999/messages')).send({ text: 'hi' });

    expect(res.status).toBe(404);
    expect(projectChat.sendProjectMessage).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when the chat turn throws', async () => {
    vi.mocked(projectChat.sendProjectMessage).mockRejectedValue(new Error('claude timed out'));

    const res = await auth(request(app).post(`/projects/${projectId}/messages`)).send({ text: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('claude timed out');
  });
});
