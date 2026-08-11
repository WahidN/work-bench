import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import {
  createTicket, getTicket, findTicketBySource, updateTicketStatus,
  addTicketMessage, listTicketMessages, listTickets,
} from '../src/tickets.js';
import { recordPr } from '../src/prs.js';

let db: Database.Database;
let projectId: number;

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
});

describe('tickets', () => {
  it('creates a ticket with analysis and reads it back', () => {
    const ticket = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check',
      body: 'desc', url: 'https://x',
      analysis: { summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: ['a.ts'], confidence: 'high' },
    });
    expect(ticket.status).toBe('new');
    expect(getTicket(db, ticket.id)).toEqual(ticket);
  });

  it('findTicketBySource dedups on source+sourceId', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    expect(findTicketBySource(db, 'github', 'GH-demo#1')).toEqual(created);
    expect(findTicketBySource(db, 'github', 'GH-demo#2')).toBeNull();
  });

  it('updateTicketStatus updates status and optionally links a PR', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    const pr = recordPr(db, {
      ticketId: created.id, projectId, branch: 'fix/demo', number: 1, url: 'https://x', status: 'open',
    });
    const updated = updateTicketStatus(db, created.id, 'in_review', pr.id);
    expect(updated).toEqual({ ...created, status: 'in_review', prId: pr.id });
  });

  it('records and lists chat messages in order', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    addTicketMessage(db, created.id, 'user', 'cap it at 30s');
    addTicketMessage(db, created.id, 'assistant', 'done');
    const messages = listTicketMessages(db, created.id);
    expect(messages.map((m) => m.content)).toEqual(['cap it at 30s', 'done']);
  });

  it('listTickets filters by status', () => {
    createTicket(db, { source: 'github', sourceId: 'GH-demo#1', projectId, title: 't1', body: 'b', url: 'u', analysis: null });
    const t2 = createTicket(db, { source: 'github', sourceId: 'GH-demo#2', projectId, title: 't2', body: 'b', url: 'u', analysis: null });
    updateTicketStatus(db, t2.id, 'in_review', null);
    expect(listTickets(db, { status: 'in_review' }).map((t) => t.id)).toEqual([t2.id]);
  });
});
