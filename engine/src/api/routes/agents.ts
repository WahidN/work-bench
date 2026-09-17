import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listRunningAgents } from '../../jobs.js';

/// Everything Workbench is running, for the app's own list.
///
/// Read-only and cheap on purpose: one query per call, no worktree. The app polls
/// this on a beat, next to a review poll that does open one, and a second route
/// that fought for the job lock would slow down the agents it is meant to show.
export function registerAgentsRoutes(app: Express, db: Database.Database): void {
  app.get('/agents', (_req, res) => res.json({ agents: listRunningAgents(db) }));
}
