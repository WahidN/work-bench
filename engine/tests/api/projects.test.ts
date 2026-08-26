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

describe('project status and blurb over the API', () => {
  it('creates a project with a status and a blurb', async () => {
    const res = await auth(request(app).post('/projects')).send({
      name: 'atlas', repoPath: '/repos/atlas', defaultBranch: 'main',
      status: 'planning', blurb: 'Q3 discovery.',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('planning');
    expect(res.body.blurb).toBe('Q3 discovery.');
  });

  it('defaults a created project to active with an empty blurb', async () => {
    const res = await auth(request(app).post('/projects')).send({
      name: 'beacon', repoPath: '/repos/beacon', defaultBranch: 'main',
    });

    expect(res.body.status).toBe('active');
    expect(res.body.blurb).toBe('');
  });

  it('patches the status and the blurb', async () => {
    const created = await auth(request(app).post('/projects')).send({
      name: 'relay', repoPath: '/repos/relay', defaultBranch: 'main',
    });

    const res = await auth(request(app).patch(`/projects/${created.body.id}`)).send({
      status: 'paused', blurb: 'Webhook delivery.',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
    expect(res.body.blurb).toBe('Webhook delivery.');
    expect(res.body.name).toBe('relay');
  });

  it('400s on an unknown status when creating', async () => {
    const res = await auth(request(app).post('/projects')).send({
      name: 'drydock', repoPath: '/repos/drydock', defaultBranch: 'main', status: 'archived',
    });

    expect(res.status).toBe(400);
  });

  it('400s on an unknown status when patching', async () => {
    const created = await auth(request(app).post('/projects')).send({
      name: 'ledger', repoPath: '/repos/ledger', defaultBranch: 'main',
    });

    const res = await auth(request(app).patch(`/projects/${created.body.id}`)).send({ status: 'archived' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /projects/:id/notes', () => {
  it('stores the notes and returns the project', async () => {
    const res = await auth(request(app).put(`/projects/${projectId}/notes`).send({ notes: 'Card capture next.' }));

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Card capture next.');
    expect(res.body.name).toBe('Atlas Payments');
  });

  it('accepts an empty string', async () => {
    await auth(request(app).put(`/projects/${projectId}/notes`).send({ notes: 'something' }));

    const res = await auth(request(app).put(`/projects/${projectId}/notes`).send({ notes: '' }));

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('');
  });

  it('rejects notes that are not a string', async () => {
    const res = await auth(request(app).put(`/projects/${projectId}/notes`).send({ notes: 42 }));

    expect(res.status).toBe(400);
  });

  it('rejects a body with no notes at all', async () => {
    const res = await auth(request(app).put(`/projects/${projectId}/notes`).send({}));

    expect(res.status).toBe(400);
  });

  it('returns 404 for a project that does not exist', async () => {
    const res = await auth(request(app).put('/projects/999/notes').send({ notes: 'x' }));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not found');
  });

  it('leaves the rest of the project alone', async () => {
    await auth(request(app).put(`/projects/${projectId}/notes`).send({ notes: 'notes only' }));

    const res = await auth(request(app).get(`/projects/${projectId}`));

    expect(res.body).toMatchObject({
      name: 'Atlas Payments', repoPath: '/repos/atlas', defaultBranch: 'main', notes: 'notes only',
    });
  });
});
