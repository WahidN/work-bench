import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTodos, createManualTodo, setTodoDone, setTodoPriority, getTodo, promoteTodo, setTodoPinned, listTodoMessages, deleteTodo } from '../../todos.js';
import { getProject } from '../../projects.js';
import { acquireJob, finishJob } from '../../jobs.js';
import { sendTodoMessage } from '../../todoChat.js';

export function registerTodosRoutes(app: Express, db: Database.Database): void {
  app.get('/todos', (req, res) => {
    const done = req.query.done;
    if (done !== undefined && done !== 'open' && done !== 'any') {
      res.status(400).json({ error: 'done must be open or any' });
      return;
    }
    res.json(done === 'any' ? listTodos(db) : listTodos(db, { done: false }));
  });

  app.post('/todos', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    // A todo whose project does not exist would appear on no project screen at all,
    // so this is a 400 rather than a silently stored null.
    const projectId = req.body?.projectId ?? undefined;
    if (projectId !== undefined) {
      if (!Number.isInteger(projectId)) {
        res.status(400).json({ error: 'projectId must be a number' });
        return;
      }
      if (!getProject(db, projectId)) {
        res.status(400).json({ error: 'projectId does not exist' });
        return;
      }
    }
    res.status(201).json(createManualTodo(db, text, { projectId }));
  });

  const PRIORITIES = ['high', 'med', 'low'];

  app.patch('/todos/:id', (req, res) => {
    const id = Number(req.params.id);
    const { done, priority } = req.body ?? {};

    if (done === undefined && priority === undefined) {
      res.status(400).json({ error: 'done or priority is required' });
      return;
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      res.status(400).json({ error: 'priority must be high, med or low' });
      return;
    }
    if (done !== undefined && typeof done !== 'boolean') {
      res.status(400).json({ error: 'done must be a boolean' });
      return;
    }
    let todo = getTodo(db, id);
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }

    if (done !== undefined) todo = setTodoDone(db, id, done);
    if (priority !== undefined) todo = setTodoPriority(db, id, priority);
    res.json(todo);
  });

  app.delete('/todos/:id', (req, res) => {
    try {
      deleteTodo(db, Number(req.params.id));
    } catch (err) {
      // deleteTodo owns both refusals so the rule holds for any caller, not just the
      // app; the route only decides which status each one deserves.
      const message = String(err);
      if (message.includes('not found')) res.status(404).json({ error: message });
      else if (message.includes('cannot be deleted')) res.status(400).json({ error: message });
      else throw err;
      return;
    }
    res.status(204).end();
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

  app.patch('/todos/:id/pin', (req, res) => {
    const pinned = req.body?.pinned;
    if (typeof pinned !== 'boolean') { res.status(400).json({ error: 'pinned must be a boolean' }); return; }

    const todo = setTodoPinned(db, Number(req.params.id), pinned);
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }
    res.json(todo);
  });

  app.get('/todos/:id/messages', (req, res) => {
    const todo = getTodo(db, Number(req.params.id));
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }
    res.json(listTodoMessages(db, todo.id));
  });

  app.post('/todos/:id/messages', async (req, res) => {
    const todoId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const todo = getTodo(db, todoId);
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }
    // promoteTodo moves the thread onto the ticket, so a write here would land in a
    // table nothing reads. Say so rather than accepting invisible messages.
    if (todo.promotedTicketId !== null) {
      res.status(409).json({ error: 'this issue has been promoted, the thread is on its ticket' });
      return;
    }

    try {
      const reply = await sendTodoMessage(db, todoId, text);
      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
