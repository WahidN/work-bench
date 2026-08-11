import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTickets, getTicket, listTicketMessages } from '../../tickets.js';
import { sendTicketMessage } from '../../ticketChat.js';
import { runFixPipeline } from '../../fixPipeline.js';
import { acquireJob, finishJob } from '../../jobs.js';

export function registerTicketsRoutes(app: Express, db: Database.Database): void {
  app.get('/tickets', (_req, res) => res.json(listTickets(db)));

  app.get('/tickets/:id', (req, res) => {
    const ticket = getTicket(db, Number(req.params.id));
    if (!ticket) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...ticket, messages: listTicketMessages(db, ticket.id) });
  });

  app.post('/tickets/:id/messages', async (req, res) => {
    const ticketId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const job = acquireJob(db, 'spar', 'ticket', ticketId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const reply = await sendTicketMessage(db, ticketId, text);
      finishJob(db, job.id, 'done');
      res.json({ reply });
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/tickets/:id/create-pr', async (req, res) => {
    const ticketId = Number(req.params.id);
    const ticket = getTicket(db, ticketId);
    if (!ticket) { res.status(404).json({ error: 'not found' }); return; }
    // The job lock only stops concurrent calls. A second call after the first
    // finished would reset the branch and record a duplicate PR row.
    if (ticket.prId !== null || ticket.status === 'in_review' || ticket.status === 'done') {
      res.status(409).json({ error: 'ticket already has a PR' });
      return;
    }

    const job = acquireJob(db, 'fix', 'ticket', ticketId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await runFixPipeline(db, ticketId);
      finishJob(db, job.id, 'done');
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });
}
