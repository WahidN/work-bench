import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket, listTicketMessages } from '../src/tickets.js';
import * as claude from '../src/claude.js';
import { sendTicketMessage, buildSparPrompt } from '../src/ticketChat.js';

vi.mock('../src/claude.js');

let db: Database.Database;
let ticketId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;
});

describe('sendTicketMessage', () => {
  it('records the user message, moves status to sparring, and records the reply', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('Want me to cap the backoff too?');

    const reply = await sendTicketMessage(db, ticketId, 'add retry logic');

    expect(reply).toBe('Want me to cap the backoff too?');
    expect(getTicket(db, ticketId)!.status).toBe('sparring');
    expect(listTicketMessages(db, ticketId).map((m) => [m.role, m.content])).toEqual([
      ['user', 'add retry logic'],
      ['assistant', 'Want me to cap the backoff too?'],
    ]);
  });

  it('leaves status as sparring on a later message rather than resetting it', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('ok');
    await sendTicketMessage(db, ticketId, 'first');
    await sendTicketMessage(db, ticketId, 'second');
    expect(getTicket(db, ticketId)!.status).toBe('sparring');
  });
});

describe('buildSparPrompt', () => {
  it('includes prior turns when there is history', () => {
    const prompt = buildSparPrompt('t', 'b', [{ role: 'user', content: 'hey', id: 1, ticketId: 1, createdAt: '' }]);
    expect(prompt).toContain('You: hey');
  });

  it('omits the discussion section on the first message', () => {
    expect(buildSparPrompt('t', 'b', [])).not.toContain('Discussion so far');
  });
});
