import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { recordPr, upsertGithubPr } from '../../src/prs.js';
import { acquireJob } from '../../src/jobs.js';
import { listCommentFixes } from '../../src/prCommentFixStore.js';
import * as fix from '../../src/prCommentFix.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/prCommentFix.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let projectId: number;
let prId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

const body = {
  instruction: 'compare against the expiry with a margin',
  comment: 'This only fires once the token is already past its expiry.',
  path: 'src/helpers/sessionToken.ts',
  line: 8,
};

function theirPr(): number {
  return upsertGithubPr(db, {
    projectId, number: 88, title: 'Bump the deploy timeout', url: 'https://github.com/x/pull/88',
    githubUpdatedAt: '2026-08-17T10:00:00Z', isDraft: false, authoredByMe: false,
    assignedToMe: true, reviewRequestedByMe: false, reviewState: 'review_required',
    branch: 'feat/deploy-timeout',
  }).id;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'https://github.com/linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  prId = recordPr(db, {
    ticketId: null, projectId, branch: 'fix/session-token', number: 23,
    url: 'https://x/pull/23', status: 'open',
  }).id;
  app = createServer(db, TOKEN);
  vi.mocked(fix.drainCommentFixes).mockResolvedValue(undefined);
});

describe('POST /prs/:id/review-comments/:commentId/fix', () => {
  it('queues a fix, with the comment it answers', async () => {
    const res = await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body))
      .expect(202);

    expect(res.body).toEqual({ queued: true });
    const [stored] = listCommentFixes(db, prId);
    expect(stored.commentId).toBe(7);
    expect(stored.instruction).toBe(body.instruction);
    expect(stored.path).toBe(body.path);
    expect(stored.line).toBe(body.line);
    expect(stored.comment).toBe(body.comment);
  });

  it('accepts several on one pull request without waiting', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body)).expect(202);
    await auth(request(app).post(`/prs/${prId}/review-comments/8/fix`).send(body)).expect(202);
    await auth(request(app).post(`/prs/${prId}/review-comments/9/fix`).send(body)).expect(202);

    expect(listCommentFixes(db, prId).map((fix) => fix.commentId)).toEqual([7, 8, 9]);
  });

  it('accepts a second attempt on the same comment', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body)).expect(202);
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`)
      .send({ ...body, instruction: 'try it another way' })).expect(202);

    expect(listCommentFixes(db, prId).map((fix) => fix.instruction))
      .toEqual([body.instruction, 'try it another way']);
  });

  it('sets the drain going for that pull request', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body)).expect(202);

    expect(fix.drainCommentFixes).toHaveBeenCalledWith(db, prId);
  });

  it('404s on a pull request that does not exist', async () => {
    await auth(request(app).post('/prs/999/review-comments/7/fix').send(body)).expect(404);
    expect(fix.drainCommentFixes).not.toHaveBeenCalled();
  });

  it('400s on a blank instruction', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send({ ...body, instruction: '   ' }))
      .expect(400);
    expect(listCommentFixes(db, prId)).toEqual([]);
  });

  it('400s when the comment it answers is missing', async () => {
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send({ instruction: 'do it' }))
      .expect(400);
    expect(listCommentFixes(db, prId)).toEqual([]);
  });

  it('403s on a pull request the user did not author, and stores nothing', async () => {
    const id = theirPr();

    const res = await auth(request(app).post(`/prs/${id}/review-comments/7/fix`).send(body))
      .expect(403);

    expect(res.body.error).toMatch(/authored/i);
    expect(listCommentFixes(db, id)).toEqual([]);
    expect(fix.drainCommentFixes).not.toHaveBeenCalled();
  });

  it('queues rather than refusing while something else holds the pull request', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);

    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body)).expect(202);

    expect(listCommentFixes(db, prId)[0].state).toBe('queued');
  });
});

describe('GET /prs/:id/comment-fixes', () => {
  it('returns an empty list when nothing has been asked for', async () => {
    const res = await auth(request(app).get(`/prs/${prId}/comment-fixes`)).expect(200);
    expect(res.body).toEqual({ fixes: [] });
  });

  it('returns only that pull request', async () => {
    const other = upsertGithubPr(db, {
      projectId, number: 24, title: 'Other', url: 'u', githubUpdatedAt: '2026-08-17T10:00:00Z',
      isDraft: false, authoredByMe: true, assignedToMe: false, reviewRequestedByMe: false,
      reviewState: null, branch: 'feat/other',
    }).id;
    await auth(request(app).post(`/prs/${prId}/review-comments/7/fix`).send(body)).expect(202);
    await auth(request(app).post(`/prs/${other}/review-comments/9/fix`).send(body)).expect(202);

    const res = await auth(request(app).get(`/prs/${prId}/comment-fixes`)).expect(200);
    expect(res.body.fixes).toHaveLength(1);
    expect(res.body.fixes[0].commentId).toBe(7);
  });

  it('404s on a pull request that does not exist', async () => {
    await auth(request(app).get('/prs/999/comment-fixes')).expect(404);
  });
});

describe('GET /prs/:id/review while a fix runs', () => {
  it('does not remove the worktree a fix is working in', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);
    const findings = await import('../../src/prReviewStore.js');
    findings.replaceReviewFindings(db, prId, [{ path: 'a.ts', line: 1, body: 'x' }], 'abc123');
    const git = await import('../../src/git.js');
    const spy = vi.spyOn(git, 'removeWorktree');

    const res = await auth(request(app).get(`/prs/${prId}/review`)).expect(200);

    expect(res.body.findings).toHaveLength(1);
    expect(res.body.outdated).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
