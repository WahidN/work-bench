import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import { recordPr, updatePrStatus } from '../../src/prs.js';
import { acquireJob, finishJob, reconcileInterruptedJobs } from '../../src/jobs.js';
import { replaceReviewFindings, listReviewFindings } from '../../src/prReviewStore.js';
import * as prChat from '../../src/prChat.js';
import * as git from '../../src/git.js';
import * as prReview from '../../src/prReview.js';
import * as githubPrDetail from '../../src/sources/githubPrDetail.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/prChat.js');
vi.mock('../../src/git.js');
vi.mock('../../src/prReview.js');
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
  app = createServer(db, TOKEN);
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  const ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, { ticketId, projectId, branch: 'fix/gh-1', number: 5, url: 'https://x/pull/5', status: 'open' }).id;
});

describe('GET /prs/:id/diff', () => {
  it('opens the worktree, returns the diff, and cleans up', async () => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.getDiff).mockResolvedValue('--- a/x.ts\n+++ b/x.ts');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);

    const res = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(res.body).toEqual({ diff: '--- a/x.ts\n+++ b/x.ts' });
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-gh-1');
  });

  it('returns 500 and still cleans up when getDiff throws', async () => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.getDiff).mockRejectedValue(new Error('git diff failed'));
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);

    const res = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('git diff failed');
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-gh-1');
  });

  it('returns 409 and never touches the worktree while another PR job holds the lock', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);

    const res = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(res.status).toBe(409);
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
    expect(git.removeWorktree).not.toHaveBeenCalled();
  });

  it('releases the lock after a successful diff so the next request works', async () => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.getDiff).mockResolvedValue('d');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);

    await auth(request(app).get(`/prs/${prId}/diff`));
    const second = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(second.status).toBe(200);
  });

  it('refuses the diff of a merged PR instead of reopening a deleted branch', async () => {
    updatePrStatus(db, prId, 'merged', 5);

    const res = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already merged');
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
  });
});

describe('POST /prs/:id/messages', () => {
  it('routes through sendPrMessage and returns its result', async () => {
    vi.mocked(prChat.sendPrMessage).mockResolvedValue({ action: 'revised', reply: 'done' });
    const res = await auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'also guard email' });
    expect(res.body).toEqual({ action: 'revised', reply: 'done' });
    expect(prChat.sendPrMessage).toHaveBeenCalledWith(db, prId, 'also guard email');
  });
});

describe('POST /prs/:id/merge', () => {
  it('calls sendPrMessage with the canonical merge phrase, the same path as the chat trigger', async () => {
    vi.mocked(prChat.sendPrMessage).mockResolvedValue({ action: 'merged', reply: 'Merged https://x/pull/5.' });
    const res = await auth(request(app).post(`/prs/${prId}/merge`));
    expect(res.body.action).toBe('merged');
    expect(prChat.sendPrMessage).toHaveBeenCalledWith(db, prId, 'merge it');
  });

  it('rejects a merge while a chat revision is already running on the same PR', async () => {
    let resolveChat: (v: any) => void;
    vi.mocked(prChat.sendPrMessage).mockReturnValueOnce(new Promise((r) => { resolveChat = r; }));

    const chatCall = auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'x' }).then();
    await new Promise((r) => setTimeout(r, 10));
    const mergeCall = await auth(request(app).post(`/prs/${prId}/merge`));

    expect(mergeCall.status).toBe(409);
    resolveChat!({ action: 'revised', reply: 'ok' });
    await chatCall;
  });
});

describe('PATCH /prs/:id/pin', () => {
  it('pins and unpins the PR', async () => {
    const pinned = await auth(request(app).patch(`/prs/${prId}/pin`)).send({ pinned: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned).toBe(true);

    const unpinned = await auth(request(app).patch(`/prs/${prId}/pin`)).send({ pinned: false });
    expect(unpinned.body.pinned).toBe(false);
  });

  it('400s when pinned is not a boolean', async () => {
    const res = await auth(request(app).patch(`/prs/${prId}/pin`)).send({ pinned: 'yes' });
    expect(res.status).toBe(400);
  });

  it('404s for a PR that does not exist', async () => {
    const res = await auth(request(app).patch('/prs/999/pin')).send({ pinned: true });
    expect(res.status).toBe(404);
  });
});

describe('GET /prs and /prs/:id', () => {
  it('returns every field the app decodes, on both the list and the detail', async () => {
    const listed = await auth(request(app).get('/prs'));
    expect(listed.status).toBe(200);
    for (const key of ['title', 'reviewState', 'isDraft', 'githubUpdatedAt', 'authoredByMe', 'assignedToMe', 'messageCount', 'pinned']) {
      expect(listed.body[0]).toHaveProperty(key);
    }
    const detail = await auth(request(app).get(`/prs/${listed.body[0].id}`));
    for (const key of ['title', 'reviewState', 'isDraft', 'githubUpdatedAt', 'authoredByMe', 'assignedToMe', 'messageCount']) {
      expect(detail.body).toHaveProperty(key);
    }
  });
});

// One added line at 12 and one context line at 13, so 999 is reliably outside.
const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -12,2 +12,2 @@
+const added = 3;
 const context = 4;
`;

/// The review runs after the response, so a test that wants to see its effect has
/// to let the microtask queue drain first. Polling the store rather than sleeping
/// a fixed time keeps this from being a slow test that also flakes.
async function waitForFindings(prId: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (listReviewFindings(db, prId).length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

describe('POST /prs/:id/review', () => {
  beforeEach(() => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(git.headSha).mockResolvedValue('abc123');
    vi.mocked(git.getDiff).mockResolvedValue(DIFF);
    vi.mocked(prReview.reviewPrDiff).mockResolvedValue([]);
  });

  // The agent takes minutes. A request held open that long fails for reasons
  // that have nothing to do with the review.
  it('returns at once and does not carry the findings', async () => {
    vi.mocked(prReview.reviewPrDiff).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 1000))
    );

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(202);
    expect(res.body.findings).toBeUndefined();
  });

  it('stores the anchorable findings and drops the rest', async () => {
    vi.mocked(prReview.reviewPrDiff).mockResolvedValue([
      { path: 'src/a.ts', line: 12, body: 'real remark' },
      { path: 'src/a.ts', line: 999, body: 'invented line' },
    ]);

    await auth(request(app).post(`/prs/${prId}/review`));
    await waitForFindings(prId);

    const stored = listReviewFindings(db, prId);
    expect(stored).toHaveLength(1);
    expect(stored[0].body).toBe('real remark');
    expect(stored[0].commitSha).toBe('abc123');
    expect(stored[0].posted).toBe(false);
  });

  it('reviews read-only and cleans the worktree up', async () => {
    await auth(request(app).post(`/prs/${prId}/review`));
    await settle();

    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-gh-1');
    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
  });

  // The request is already answered when this fails, so the job is the only place
  // the failure can be recorded.
  it('records a failed review on the job rather than losing it with the request', async () => {
    vi.mocked(prReview.reviewPrDiff).mockRejectedValue(new Error('claude exploded'));

    await auth(request(app).post(`/prs/${prId}/review`));
    await settle();

    const job = db.prepare(`SELECT status, error FROM jobs WHERE target_id = ? ORDER BY id DESC`).get(prId) as any;
    expect(job.status).toBe('failed');
    expect(job.error).toContain('claude exploded');
    expect(git.removeWorktree).toHaveBeenCalled();
  });

  it('releases the lock when the review finishes, so a second review can run', async () => {
    await auth(request(app).post(`/prs/${prId}/review`));
    await settle();

    const second = await auth(request(app).post(`/prs/${prId}/review`));
    expect(second.status).toBe(202);
  });

  it('refuses a second review while one is running', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(409);
    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
  });

  it('404s an unknown pull request', async () => {
    expect((await auth(request(app).post('/prs/9999/review'))).status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    expect((await request(app).post(`/prs/${prId}/review`)).status).toBe(401);
  });
});

describe('GET /prs/:id/review', () => {
  it('returns the stored findings', async () => {
    replaceReviewFindings(db, prId, [{ path: 'src/a.ts', line: 12, body: 'a remark' }], 'abc123');

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].body).toBe('a remark');
    expect(res.body.findings[0].posted).toBe(false);
  });

  it('is empty for a pull request that was never reviewed', async () => {
    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
  });

  // The app cannot work this out for itself: a review still running and one that
  // finished with nothing to say both look like an empty list.
  it('reports that work is running on the pull request', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.running).toBe(true);
  });

  it('reports nothing running when the job has finished', async () => {
    const job = acquireJob(db, 'pr-chat', 'pr', prId)!;
    finishJob(db, job.id, 'done');

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.running).toBe(false);
  });

  // A review killed by a restart is marked interrupted, not running, so the
  // button does not stay disabled forever waiting for something that is gone.
  it('does not report an interrupted job as running', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);
    reconcileInterruptedJobs(db);

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.running).toBe(false);
  });

  it('reports running even when the pull request has stored findings', async () => {
    replaceReviewFindings(db, prId, [{ path: 'src/a.ts', line: 12, body: 'old remark' }], 'abc123');
    acquireJob(db, 'pr-chat', 'pr', prId);

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.running).toBe(true);
    expect(res.body.findings).toHaveLength(1);
  });

  // Whether the remark still applies is the user's call, so this only reports.
  it('marks the review outdated when the branch has moved past the reviewed commit', async () => {
    replaceReviewFindings(db, prId, [{ path: 'src/a.ts', line: 12, body: 'a remark' }], 'oldsha');
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(git.headSha).mockResolvedValue('newsha');

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.outdated).toBe(true);
    expect(res.body.findings).toHaveLength(1);
  });

  it('is not outdated when the branch is still at the reviewed commit', async () => {
    replaceReviewFindings(db, prId, [{ path: 'src/a.ts', line: 12, body: 'a remark' }], 'samesha');
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(git.headSha).mockResolvedValue('samesha');

    const res = await auth(request(app).get(`/prs/${prId}/review`));

    expect(res.body.outdated).toBe(false);
  });

  it('401s without a bearer token', async () => {
    expect((await request(app).get(`/prs/${prId}/review`)).status).toBe(401);
  });
});

describe('POST /prs/:id/review/findings/:findingId', () => {
  beforeEach(() => {
    db.prepare("UPDATE projects SET github_repo = 'linku/demo' WHERE id = 1").run();
    replaceReviewFindings(db, prId, [
      { path: 'src/a.ts', line: 12, body: 'stored body' },
      { path: 'src/b.ts', line: 3, body: 'other' },
    ], 'abc123');
  });

  const firstId = () => listReviewFindings(db, prId)[0].id;

  it('posts that one finding and marks it posted', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 77 });

    const res = await auth(request(app).post(`/prs/${prId}/review/findings/${firstId()}`)).send({ body: 'stored body' });

    expect(res.status).toBe(200);
    expect(githubPrDetail.postLineComment).toHaveBeenCalledWith('linku/demo', 5, {
      commitSha: 'abc123', path: 'src/a.ts', line: 12, body: 'stored body',
    });
    const after = listReviewFindings(db, prId);
    expect(after[0].posted).toBe(true);
    expect(after[1].posted).toBe(false);
  });

  // The user edited it on screen, so what arrives is what must go to GitHub.
  it('posts the body sent with the request, not the stored one', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 77 });

    await auth(request(app).post(`/prs/${prId}/review/findings/${firstId()}`)).send({ body: 'edited by the user' });

    expect(githubPrDetail.postLineComment).toHaveBeenCalledWith(
      'linku/demo', 5, expect.objectContaining({ body: 'edited by the user' })
    );
  });

  // Never opens a worktree: the stored sha is the anchor. See design.md.
  it('does not open a worktree to post', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 77 });

    await auth(request(app).post(`/prs/${prId}/review/findings/${firstId()}`)).send({ body: 'x' });

    expect(git.openDetachedWorktree).not.toHaveBeenCalled();
  });

  it('reports a GitHub failure and leaves the finding unposted', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockRejectedValue(new Error('422 Unprocessable Entity'));

    const res = await auth(request(app).post(`/prs/${prId}/review/findings/${firstId()}`)).send({ body: 'x' });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('422');
    expect(listReviewFindings(db, prId)[0].posted).toBe(false);
  });

  it('refuses to post the same finding twice', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 77 });
    const id = firstId();
    await auth(request(app).post(`/prs/${prId}/review/findings/${id}`)).send({ body: 'x' });

    const second = await auth(request(app).post(`/prs/${prId}/review/findings/${id}`)).send({ body: 'x' });

    expect(second.status).toBe(409);
    expect(githubPrDetail.postLineComment).toHaveBeenCalledTimes(1);
  });

  it('fails with a reason when the project has no GitHub repo configured', async () => {
    db.prepare('UPDATE projects SET github_repo = NULL WHERE id = 1').run();

    const res = await auth(request(app).post(`/prs/${prId}/review/findings/${firstId()}`)).send({ body: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/github/i);
  });

  it('404s an unknown finding', async () => {
    const res = await auth(request(app).post(`/prs/${prId}/review/findings/9999`)).send({ body: 'x' });
    expect(res.status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const res = await request(app).post(`/prs/${prId}/review/findings/${firstId()}`).send({ body: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /prs/:id/review/findings/:findingId', () => {
  beforeEach(() => {
    replaceReviewFindings(db, prId, [
      { path: 'src/a.ts', line: 12, body: 'first' },
      { path: 'src/b.ts', line: 3, body: 'second' },
    ], 'abc123');
  });

  it('removes that one and leaves the others', async () => {
    const id = listReviewFindings(db, prId)[0].id;

    const res = await auth(request(app).delete(`/prs/${prId}/review/findings/${id}`));

    expect(res.status).toBe(204);
    const after = listReviewFindings(db, prId);
    expect(after).toHaveLength(1);
    expect(after[0].body).toBe('second');
    expect(githubPrDetail.postLineComment).not.toHaveBeenCalled();
  });

  it('404s an unknown finding', async () => {
    expect((await auth(request(app).delete(`/prs/${prId}/review/findings/9999`))).status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const id = listReviewFindings(db, prId)[0].id;
    expect((await request(app).delete(`/prs/${prId}/review/findings/${id}`)).status).toBe(401);
  });
});

