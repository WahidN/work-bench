import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { getTodayView } from '../../todos.js';

export function registerTodayRoutes(app: Express, db: Database.Database): void {
  app.get('/today', (_req, res) => {
    res.json(getTodayView(db));
  });
}
