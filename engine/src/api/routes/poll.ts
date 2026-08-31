import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { pollOnce, runQuickPoll } from '../../poller.js';

export function registerPollRoutes(app: Express, db: Database.Database): void {
  // Jira and pull requests only; see runQuickPoll for why the Sentry and GitHub
  // issue pass is left to the interval poller. pollOnce rather than runQuickPoll
  // directly, so this can never run alongside a scheduled cycle.
  app.post('/poll', async (_req, res) => {
    try {
      res.json(await pollOnce(db, runQuickPoll));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
