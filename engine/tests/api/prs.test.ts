import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import { recordPr, updatePrStatus } from '../../src/prs.js';
import { acquireJob } from '../../src/jobs.js';
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

describe('POST /prs/:id/review', () => {
  beforeEach(() => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(git.headSha).mockResolvedValue('abc123');
    vi.mocked(git.getDiff).mockResolvedValue(DIFF);
  });

  it('returns the findings that can be anchored and the ones that cannot, separately', async () => {
    vi.mocked(prReview.reviewPrDiff).mockResolvedValue([
      { path: 'src/a.ts', line: 12, body: 'real remark' },
      { path: 'src/a.ts', line: 999, body: 'invented line' },
    ]);

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([{ path: 'src/a.ts', line: 12, body: 'real remark' }]);
    expect(res.body.discarded).toHaveLength(1);
    expect(res.body.discarded[0].reason).toContain('999');
    expect(res.body.commitSha).toBe('abc123');
  });

  it('reviews read-only and cleans the worktree up', async () => {
    vi.mocked(prReview.reviewPrDiff).mockResolvedValue([]);

    await auth(request(app).post(`/prs/${prId}/review`));

    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-gh-1');
    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.pushDetachedHead).not.toHaveBeenCalled();
  });

  it('removes the worktree even when the review throws', async () => {
    vi.mocked(prReview.reviewPrDiff).mockRejectedValue(new Error('claude exploded'));

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(500);
    expect(git.removeWorktree).toHaveBeenCalled();
  });

  it('reports an empty review rather than failing', async () => {
    vi.mocked(prReview.reviewPrDiff).mockResolvedValue([]);

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
  });

  it('refuses a second review while one is running', async () => {
    acquireJob(db, 'pr-chat', 'pr', prId);

    const res = await auth(request(app).post(`/prs/${prId}/review`));

    expect(res.status).toBe(409);
  });

  it('404s an unknown pull request', async () => {
    expect((await auth(request(app).post('/prs/9999/review'))).status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    expect((await request(app).post(`/prs/${prId}/review`)).status).toBe(401);
  });
});

describe('POST /prs/:id/review/publish', () => {
  const finding = { path: 'src/a.ts', line: 12, body: 'real remark' };

  beforeEach(() => {
    vi.mocked(git.openDetachedWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(git.headSha).mockResolvedValue('abc123');
    vi.mocked(git.getDiff).mockResolvedValue(DIFF);
    db.prepare("UPDATE projects SET github_repo = 'linku/demo' WHERE id = 1").run();
  });

  it('posts one comment per confirmed finding', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 1 });

    const res = await auth(request(app).post(`/prs/${prId}/review/publish`).send({
      findings: [finding, { path: 'src/a.ts', line: 13, body: 'second remark' }],
    }));

    expect(res.status).toBe(200);
    expect(githubPrDetail.postLineComment).toHaveBeenCalledTimes(2);
    expect(res.body.posted).toHaveLength(2);
    expect(res.body.failed).toHaveLength(0);
  });

  // The user edited the text in the app, so what arrives is what must be posted.
  it('posts the body it was given rather than re-reviewing', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 1 });

    await auth(request(app).post(`/prs/${prId}/review/publish`).send({
      findings: [{ path: 'src/a.ts', line: 12, body: 'edited by the user' }],
    }));

    expect(githubPrDetail.postLineComment).toHaveBeenCalledWith('linku/demo', 5, {
      commitSha: 'abc123', path: 'src/a.ts', line: 12, body: 'edited by the user',
    });
    expect(prReview.reviewPrDiff).not.toHaveBeenCalled();
  });

  // One bad comment must not cost the user the other five.
  it('reports success and failure per finding instead of failing the whole call', async () => {
    vi.mocked(githubPrDetail.postLineComment)
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error('422 Unprocessable Entity'));

    const res = await auth(request(app).post(`/prs/${prId}/review/publish`).send({
      findings: [finding, { path: 'src/a.ts', line: 13, body: 'second remark' }],
    }));

    expect(res.status).toBe(200);
    expect(res.body.posted).toHaveLength(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].line).toBe(13);
    expect(res.body.failed[0].error).toContain('422');
  });

  it('refuses a finding whose anchor is not in the current diff', async () => {
    vi.mocked(githubPrDetail.postLineComment).mockResolvedValue({ id: 1 });

    const res = await auth(request(app).post(`/prs/${prId}/review/publish`).send({
      findings: [{ path: 'src/a.ts', line: 999, body: 'invented' }],
    }));

    expect(githubPrDetail.postLineComment).not.toHaveBeenCalled();
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].error).toContain('999');
  });

  it('fails with a reason when the project has no GitHub repo configured', async () => {
    db.prepare('UPDATE projects SET github_repo = NULL WHERE id = 1').run();

    const res = await auth(request(app).post(`/prs/${prId}/review/publish`).send({ findings: [finding] }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/github/i);
  });

  it('rejects a body without findings', async () => {
    expect((await auth(request(app).post(`/prs/${prId}/review/publish`).send({}))).status).toBe(400);
  });

  it('404s an unknown pull request', async () => {
    const res = await auth(request(app).post('/prs/9999/review/publish').send({ findings: [finding] }));
    expect(res.status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const res = await request(app).post(`/prs/${prId}/review/publish`).send({ findings: [finding] });
    expect(res.status).toBe(401);
  });
});
