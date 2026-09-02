import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listPrs, getPr, listPrMessages, setPrPinned } from '../../prs.js';
import { getProject } from '../../projects.js';
import { sendPrMessage } from '../../prChat.js';
import { acquireJob, finishJob, isJobRunning } from '../../jobs.js';
import { openDetachedWorktree, getDiff, removeWorktree, headSha } from '../../git.js';
import { fetchPrDetailView, postReviewCommentReply, postLineComment } from '../../sources/githubPrDetail.js';
import { reviewPrDiff } from '../../prReview.js';
import { splitByAnchor } from '../../diffAnchors.js';
import {
  replaceReviewFindings, listReviewFindings, getReviewFinding, markFindingPosted, deleteReviewFinding,
} from '../../prReviewStore.js';
import type { PrDetailView } from '../../types.js';

// One GET /prs/:id/detail costs three gh calls (the view, the changed files, the
// review threads), and the screen refetches on every open, so walking back and
// forth through the list pays for all three every time. Sixty seconds is picked to
// cover that walk and little else: long enough that going back and returning is
// free, short enough that nobody has to reason about staleness.
const DETAIL_TTL_MS = 60 * 1000;

// Keyed by database for the same reason poller.ts keys its in-flight guard that
// way: one test's :memory: database must not leak entries into the next.
const detailCache = new WeakMap<
  Database.Database,
  Map<number, { view: PrDetailView; expiresAt: number }>
>();

function cachedDetail(db: Database.Database, prId: number): PrDetailView | null {
  const byPr = detailCache.get(db);
  const entry = byPr?.get(prId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    byPr!.delete(prId);
    return null;
  }
  return entry.view;
}

function storeDetail(db: Database.Database, prId: number, view: PrDetailView): void {
  let byPr = detailCache.get(db);
  if (!byPr) {
    byPr = new Map();
    detailCache.set(db, byPr);
  }
  byPr.set(prId, { view, expiresAt: Date.now() + DETAIL_TTL_MS });
}

/// Anything this engine posts to a pull request makes the held copy wrong, so
/// every write drops it. Without this the screen reloads straight after a reply
/// and shows the conversation as it was before the reply existed.
function invalidateDetail(db: Database.Database, prId: number): void {
  detailCache.get(db)?.delete(prId);
}

export function registerPrsRoutes(app: Express, db: Database.Database): void {
  app.get('/prs', (_req, res) => res.json(listPrs(db)));

  app.get('/prs/:id', (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...pr, messages: listPrMessages(db, pr.id) });
  });

  // Reads from gh, through the short-lived cache above. Unlike GET /prs/:id/diff
  // this opens no worktree and takes no job lock, because opening a screen must
  // not contend with the agent panel or pay for a clone.
  app.get('/prs/:id/detail', async (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    if (pr.number === null) {
      res.status(400).json({ error: 'this PR has no GitHub number yet' });
      return;
    }
    const project = getProject(db, pr.projectId);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }
    if (!project.githubRepo) {
      res.status(400).json({ error: 'project has no GitHub repo configured' });
      return;
    }

    const cached = cachedDetail(db, pr.id);
    if (cached) { res.json(cached); return; }

    try {
      const view = await fetchPrDetailView(project.githubRepo, pr.number);
      storeDetail(db, pr.id, view);
      res.json(view);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post('/prs/:id/review-comments/:commentId/reply', async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    if (pr.number === null) {
      res.status(400).json({ error: 'this PR has no GitHub number yet' });
      return;
    }
    const project = getProject(db, pr.projectId);
    if (!project?.githubRepo) {
      res.status(400).json({ error: 'project has no GitHub repo configured' });
      return;
    }
    try {
      const created = await postReviewCommentReply(
        project.githubRepo, pr.number, Number(req.params.commentId), text
      );
      invalidateDetail(db, pr.id);
      res.json(created);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get('/prs/:id/diff', async (req, res) => {
    const prId = Number(req.params.id);
    const pr = getPr(db, prId);
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    if (pr.status === 'merged') {
      res.status(409).json({ error: 'PR already merged, diff no longer available' });
      return;
    }
    const project = getProject(db, pr.projectId);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }

    // Building the diff opens (and force-removes) the PR's worktree, the same
    // directory a fix pipeline or PR chat may still be using. Take the PR lock.
    const job = acquireJob(db, 'pr-chat', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    let worktreePath: string | null = null;
    let failure: string | null = null;
    try {
      worktreePath = await openDetachedWorktree(project, pr.branch);
      res.json({ diff: await getDiff(worktreePath, project.defaultBranch) });
    } catch (err) {
      failure = String(err);
      res.status(500).json({ error: failure });
    } finally {
      if (worktreePath) await removeWorktree(project.repoPath, worktreePath);
      finishJob(db, job.id, failure ? 'failed' : 'done', failure);
    }
  });

  /// Starts a review and returns at once.
  ///
  /// The agent takes minutes, so awaiting it here would hold a request open long
  /// enough to fail for reasons that have nothing to do with the review. The job
  /// is what records that it is running, and what a failure is reported on, since
  /// by then there is no request left to answer.
  app.post('/prs/:id/review', (req, res) => {
    const prId = Number(req.params.id);
    const pr = getPr(db, prId);
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    const project = getProject(db, pr.projectId);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }

    // Same lock as the diff route: this opens and force-removes the PR's
    // worktree, which a fix pipeline or PR chat may still be using. It is also
    // what stops a second review of the same pull request.
    const job = acquireJob(db, 'pr-chat', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    res.status(202).json({ started: true });

    void (async () => {
      let worktreePath: string | null = null;
      let failure: string | null = null;
      try {
        worktreePath = await openDetachedWorktree(project, pr.branch);
        const diff = await getDiff(worktreePath, project.defaultBranch);
        // Read from the same checkout the diff came from, so the anchors and the
        // commit they hang off cannot disagree.
        const commitSha = await headSha(worktreePath);
        const findings = await reviewPrDiff(worktreePath, { title: pr.title, body: '' }, diff);
        const { kept } = splitByAnchor(findings, diff);
        replaceReviewFindings(db, prId, kept, commitSha);
      } catch (err) {
        failure = String(err);
      } finally {
        if (worktreePath) await removeWorktree(project.repoPath, worktreePath);
        finishJob(db, job.id, failure ? 'failed' : 'done', failure);
      }
    })();
  });

  /// The stored review, with whether the branch has moved past the commit it was
  /// written against. Outdated is reported, never acted on: whether a remark still
  /// applies is the user's judgement.
  app.get('/prs/:id/review', async (req, res) => {
    const prId = Number(req.params.id);
    const pr = getPr(db, prId);
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }

    // Reported alongside the findings because the app cannot infer it: a review
    // still running and one that finished with nothing to say both look like an
    // empty list from outside.
    const running = isJobRunning(db, 'pr', prId);

    const findings = listReviewFindings(db, prId);
    if (findings.length === 0) { res.json({ findings: [], outdated: false, running }); return; }

    const project = getProject(db, pr.projectId);
    let outdated = false;
    // Best effort: a head that cannot be read is not a reason to withhold the
    // remarks, only a reason not to claim they are current.
    if (project) {
      let worktreePath: string | null = null;
      try {
        worktreePath = await openDetachedWorktree(project, pr.branch);
        outdated = (await headSha(worktreePath)) !== findings[0].commitSha;
      } catch {
        outdated = false;
      } finally {
        if (worktreePath) await removeWorktree(project.repoPath, worktreePath);
      }
    }
    res.json({ findings, outdated, running });
  });

  /// Posts one finding. No worktree: the sha stored with it is the anchor, and
  /// GitHub is the authority on whether it will take a comment there.
  app.post('/prs/:id/review/findings/:findingId', async (req, res) => {
    const finding = getReviewFinding(db, Number(req.params.findingId));
    if (!finding) { res.status(404).json({ error: 'not found' }); return; }
    if (finding.posted) { res.status(409).json({ error: 'this comment has already been posted' }); return; }

    const pr = getPr(db, finding.prId);
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    const project = getProject(db, pr.projectId);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }
    if (!project.githubRepo) {
      res.status(400).json({ error: 'this project has no GitHub repo configured, so there is nowhere to post' });
      return;
    }
    if (pr.number === null) {
      res.status(400).json({ error: 'this pull request has no number on GitHub yet' });
      return;
    }

    // The body travels with the request because the user may have edited it on
    // screen, and an edit they abandon should never become the stored text.
    const body = typeof req.body?.body === 'string' && req.body.body.trim() ? req.body.body : finding.body;

    try {
      await postLineComment(project.githubRepo, pr.number, {
        commitSha: finding.commitSha, path: finding.path, line: finding.line, body,
      });
    } catch (err) {
      // 502, not 500: the engine did its part and GitHub refused. Left unposted
      // on purpose, so the user can see it failed and try again.
      res.status(502).json({ error: String(err) });
      return;
    }

    markFindingPosted(db, finding.id);
    invalidateDetail(db, finding.prId);
    res.json({ posted: true });
  });

  app.delete('/prs/:id/review/findings/:findingId', (req, res) => {
    const removed = deleteReviewFinding(db, Number(req.params.findingId));
    if (!removed) { res.status(404).json({ error: 'not found' }); return; }
    res.status(204).end();
  });

  app.post('/prs/:id/messages', async (req, res) => {
    const prId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const job = acquireJob(db, 'pr-chat', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await sendPrMessage(db, prId, text);
      finishJob(db, job.id, 'done');
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/prs/:id/merge', async (req, res) => {
    const prId = Number(req.params.id);
    const job = acquireJob(db, 'merge', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await sendPrMessage(db, prId, 'merge it');
      finishJob(db, job.id, 'done');
      // A merged pull request is a different pull request on screen: state, and
      // whether the merge button should still be there.
      invalidateDetail(db, prId);
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });

  app.patch('/prs/:id/pin', (req, res) => {
    const pinned = req.body?.pinned;
    if (typeof pinned !== 'boolean') { res.status(400).json({ error: 'pinned must be a boolean' }); return; }

    const pr = setPrPinned(db, Number(req.params.id), pinned);
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    res.json(pr);
  });
}
