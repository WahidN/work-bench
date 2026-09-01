import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listPrs, getPr, listPrMessages, setPrPinned } from '../../prs.js';
import { getProject } from '../../projects.js';
import { sendPrMessage } from '../../prChat.js';
import { acquireJob, finishJob } from '../../jobs.js';
import { openDetachedWorktree, getDiff, removeWorktree, headSha } from '../../git.js';
import { fetchPrDetailView, postReviewCommentReply, postLineComment } from '../../sources/githubPrDetail.js';
import { draftReviewReply } from '../../prReplyDraft.js';
import { reviewPrDiff } from '../../prReview.js';
import { splitByAnchor } from '../../diffAnchors.js';
import type { ReviewFinding } from '../../types.js';

export function registerPrsRoutes(app: Express, db: Database.Database): void {
  app.get('/prs', (_req, res) => res.json(listPrs(db)));

  app.get('/prs/:id', (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...pr, messages: listPrMessages(db, pr.id) });
  });

  // Reads straight from gh. Unlike GET /prs/:id/diff this opens no worktree and
  // takes no job lock, because opening a screen must not contend with the agent
  // panel or pay for a clone.
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
    try {
      res.json(await fetchPrDetailView(project.githubRepo, pr.number));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post('/prs/:id/review-comments/:commentId/draft', async (req, res) => {
    try {
      const draft = await draftReviewReply(db, Number(req.params.id), Number(req.params.commentId));
      res.json({ draft });
    } catch (err) {
      const message = String(err);
      if (message.includes('not found')) res.status(404).json({ error: message });
      else res.status(500).json({ error: message });
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
      res.json(await postReviewCommentReply(
        project.githubRepo, pr.number, Number(req.params.commentId), text
      ));
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

  /// Reviews the pull request and returns remarks anchored to lines. Writes
  /// nothing: not to GitHub, not to the branch, not to the database. The findings
  /// go to the app, the user reads them, and publishing is a separate call.
  app.post('/prs/:id/review', async (req, res) => {
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

    let worktreePath: string | null = null;
    let failure: string | null = null;
    try {
      worktreePath = await openDetachedWorktree(project, pr.branch);
      const diff = await getDiff(worktreePath, project.defaultBranch);
      // Read from the same checkout the diff came from, so the anchors and the
      // commit they hang off cannot disagree.
      const commitSha = await headSha(worktreePath);
      const findings = await reviewPrDiff(worktreePath, { title: pr.title, body: '' }, diff);
      const { kept, discarded } = splitByAnchor(findings, diff);
      res.json({ findings: kept, discarded, commitSha });
    } catch (err) {
      failure = String(err);
      res.status(500).json({ error: failure });
    } finally {
      if (worktreePath) await removeWorktree(project.repoPath, worktreePath);
      finishJob(db, job.id, failure ? 'failed' : 'done', failure);
    }
  });

  /// Posts the findings the user confirmed, one comment per finding.
  ///
  /// The anchors are checked again here rather than trusted from the review: the
  /// findings have been through the app, where the user could edit them, and the
  /// engine keeps no draft state between the two calls.
  app.post('/prs/:id/review/publish', async (req, res) => {
    const prId = Number(req.params.id);
    const findings: ReviewFinding[] = req.body?.findings;
    if (!Array.isArray(findings) || findings.length === 0) {
      res.status(400).json({ error: 'findings is required' });
      return;
    }

    const pr = getPr(db, prId);
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

    const job = acquireJob(db, 'pr-chat', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    let worktreePath: string | null = null;
    let failure: string | null = null;
    try {
      worktreePath = await openDetachedWorktree(project, pr.branch);
      const diff = await getDiff(worktreePath, project.defaultBranch);
      const commitSha = await headSha(worktreePath);
      const { kept, discarded } = splitByAnchor(findings, diff);

      const posted: ReviewFinding[] = [];
      const failed: Array<ReviewFinding & { error: string }> = discarded.map(
        ({ path, line, body, reason }) => ({ path, line, body, error: reason })
      );

      // One at a time, and one failure does not stop the rest: the endpoint has
      // no batch form, and losing five good comments to one bad one would be a
      // poor trade.
      for (const finding of kept) {
        try {
          await postLineComment(project.githubRepo, pr.number, {
            commitSha, path: finding.path, line: finding.line, body: finding.body,
          });
          posted.push(finding);
        } catch (err) {
          failed.push({ ...finding, error: String(err) });
        }
      }

      res.json({ posted, failed });
    } catch (err) {
      failure = String(err);
      res.status(500).json({ error: failure });
    } finally {
      if (worktreePath) await removeWorktree(project.repoPath, worktreePath);
      finishJob(db, job.id, failure ? 'failed' : 'done', failure);
    }
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
