import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import { recordPr } from '../../src/prs.js';
import * as detail from '../../src/sources/githubPrDetail.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/sources/githubPrDetail.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let prId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'https://github.com/linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  const ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, {
    ticketId, projectId, branch: 'fix/x', number: 23, url: 'https://x/pull/23', status: 'open',
  }).id;
  app = createServer(db, TOKEN);
});

describe('GET /prs/:id/detail', () => {
  it('returns the merged payload for a pull request that exists on GitHub', async () => {
    vi.mocked(detail.fetchPrDetailView).mockResolvedValue({
      title: 'Retry card capture on 5xx', url: 'u', state: 'OPEN', isDraft: false,
      reviewState: 'review_required', author: 'wahid', createdAt: '2026-08-12T15:11:00Z',
      baseRefName: 'main', headRefName: 'fix/x', commitCount: 4, changedFiles: 3,
      additions: 64, deletions: 7, files: [], threads: [], conversation: [],
    });
    const res = await auth(request(app).get(`/prs/${prId}/detail`)).expect(200);
    expect(res.body).toMatchObject({ title: 'Retry card capture on 5xx', commitCount: 4 });
    expect(detail.fetchPrDetailView).toHaveBeenCalledWith('https://github.com/linku/demo', 23);
  });

  it('404s an unknown pull request', async () => {
    await auth(request(app).get('/prs/9999/detail')).expect(404);
  });

  it('400s a pull request that has no GitHub number yet', async () => {
    const ticketId = createTicket(db, {
      source: 'github', sourceId: 'GH-2', projectId: 1, title: 'y', body: '', url: 'u', analysis: null,
    }).id;
    const pending = recordPr(db, {
      ticketId, projectId: 1, branch: 'fix/y', number: null, url: null, status: 'open',
    }).id;
    const res = await auth(request(app).get(`/prs/${pending}/detail`)).expect(400);
    expect(res.body.error).toMatch(/no GitHub number/);
  });

  it('502s when gh fails, carrying the real message', async () => {
    vi.mocked(detail.fetchPrDetailView).mockRejectedValue(new Error('gh: not authenticated'));
    const res = await auth(request(app).get(`/prs/${prId}/detail`)).expect(502);
    expect(res.body.error).toMatch(/not authenticated/);
  });
});

describe('POST /prs/:id/review-comments/:commentId/reply', () => {
  it('posts the reply and returns the created comment', async () => {
    vi.mocked(detail.postReviewCommentReply).mockResolvedValue({ id: 99 });
    const res = await auth(request(app).post(`/prs/${prId}/review-comments/7/reply`))
      .send({ text: 'Fixed in the catch.' })
      .expect(200);
    expect(res.body).toEqual({ id: 99 });
    expect(detail.postReviewCommentReply)
      .toHaveBeenCalledWith('https://github.com/linku/demo', 23, 7, 'Fixed in the catch.');
    expect(detail.postReviewCommentReply).toHaveBeenCalledTimes(1);
  });

  it('400s empty or whitespace-only text without calling GitHub', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/reply`)).send({ text: '   ' }).expect(400);
    expect(detail.postReviewCommentReply).not.toHaveBeenCalled();
  });

  it('502s when gh fails', async () => {
    vi.mocked(detail.postReviewCommentReply).mockRejectedValue(new Error('gh: 403'));
    await auth(request(app).post(`/prs/${prId}/review-comments/7/reply`)).send({ text: 'hi' }).expect(502);
  });
});
