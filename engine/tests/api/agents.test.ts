import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { upsertGithubPr } from '../../src/prs.js';
import { acquireJob } from '../../src/jobs.js';
import { startCommentFix } from '../../src/prCommentFixStore.js';
import { createServer } from '../../src/api/server.js';

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let projectId: number;
let prId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'https://github.com/linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  prId = upsertGithubPr(db, {
    projectId, number: 23, title: 'Remove the loading animation',
    url: 'https://github.com/x/pull/23', githubUpdatedAt: '2026-09-17T10:00:00Z',
    isDraft: false, authoredByMe: true, assignedToMe: false, reviewRequestedByMe: false,
    reviewState: 'review_required', mergeable: 'MERGEABLE', branch: 'fix/loading',
  }).id;
  app = createServer(db, TOKEN);
});

describe('GET /agents', () => {
  it('is empty when nothing runs', async () => {
    const res = await auth(request(app).get('/agents')).expect(200);
    expect(res.body).toEqual({ agents: [] });
  });

  it('names a running agent and the pull request it works on', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId, 'review');

    const res = await auth(request(app).get('/agents')).expect(200);
    expect(res.body.agents).toEqual([
      expect.objectContaining({
        activity: 'review',
        targetType: 'pr',
        targetId: prId,
        title: 'Remove the loading animation',
        waiting: false,
      }),
    ]);
  });

  it('leaves out a lock held by work that runs no agent', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId, null);

    const res = await auth(request(app).get('/agents')).expect(200);
    expect(res.body.agents).toEqual([]);
  });

  it('reports a queued fix as waiting', async () => {
    startCommentFix(db, prId, {
      commentId: 7, path: 'src/a.ts', line: 3, comment: 'no', instruction: 'fix dit',
    });

    const res = await auth(request(app).get('/agents')).expect(200);
    expect(res.body.agents).toEqual([
      expect.objectContaining({ activity: 'comment-fix', targetId: prId, waiting: true }),
    ]);
  });

  it('carries when the agent started, so the app can say how long', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId, 'review');

    const res = await auth(request(app).get('/agents')).expect(200);
    expect(typeof res.body.agents[0].startedAt).toBe('string');
  });

  it('refuses without the token', async () => {
    await request(app).get('/agents').expect(401);
  });
});
