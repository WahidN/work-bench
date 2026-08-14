import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listPrs, getPr, listPrMessages, setPrPinned } from '../../prs.js';
import { getProject } from '../../projects.js';
import { sendPrMessage } from '../../prChat.js';
import { acquireJob, finishJob } from '../../jobs.js';
import { openWorktree, getDiff, removeWorktree } from '../../git.js';

export function registerPrsRoutes(app: Express, db: Database.Database): void {
  app.get('/prs', (_req, res) => res.json(listPrs(db)));

  app.get('/prs/:id', (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...pr, messages: listPrMessages(db, pr.id) });
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
      worktreePath = await openWorktree(project, pr.branch);
      res.json({ diff: await getDiff(worktreePath, project.defaultBranch) });
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
