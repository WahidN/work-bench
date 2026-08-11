import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { registerTodayRoutes } from './routes/today.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerTodosRoutes } from './routes/todos.js';
import { registerTicketsRoutes } from './routes/tickets.js';
import { registerPrsRoutes } from './routes/prs.js';

export function createServer(db: Database.Database, apiToken: string): express.Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.header('authorization') !== `Bearer ${apiToken}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  registerTodayRoutes(app, db);
  registerProjectsRoutes(app, db);
  registerTodosRoutes(app, db);
  registerTicketsRoutes(app, db);
  registerPrsRoutes(app, db);

  // Safety net: an uncaught throw in a route must never leave as an HTML error
  // page with a stack trace. Registered last so it sees every route's errors.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('unhandled API error', err);
    res.status(500).json({ error: String(err) });
  });

  return app;
}
