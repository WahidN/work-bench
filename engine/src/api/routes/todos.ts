import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTodos, createManualTodo, setTodoDone, promoteTodo } from '../../todos.js';

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
    try {
      res.json(await promoteTodo(db, Number(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });
}
