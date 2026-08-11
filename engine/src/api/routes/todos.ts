import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTodos, createManualTodo, setTodoDone, promoteTodo } from '../../todos.js';
import { acquireJob, finishJob } from '../../jobs.js';

export function registerTodosRoutes(app: Express, db: Database.Database): void {
  app.get('/todos', (_req, res) => res.json(listTodos(db, { done: false })));

  app.post('/todos', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    res.status(201).json(createManualTodo(db, text));
  });

  app.patch('/todos/:id', (req, res) => {
    const todo = setTodoDone(db, Number(req.params.id), Boolean(req.body?.done));
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }
    res.json(todo);
  });

  app.post('/todos/:id/promote', async (req, res) => {
    const todoId = Number(req.params.id);

    // Promoting runs a real Claude analysis, so two fast clicks would otherwise
    // both analyse and then collide on the ticket's UNIQUE(source, source_id).
    // Todo ids live in their own table but share the 'ticket' lock namespace,
    // so at worst a todo and a ticket with the same id block each other.
    const job = acquireJob(db, 'triage', 'ticket', todoId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const ticket = await promoteTodo(db, todoId);
      finishJob(db, job.id, 'done');
      res.json(ticket);
    } catch (err) {
      const message = String(err);
      finishJob(db, job.id, 'failed', message);
      if (message.includes('not found')) res.status(404).json({ error: message });
      else if (message.includes('cannot be promoted')) res.status(400).json({ error: message });
      else res.status(500).json({ error: message });
    }
  });
}
