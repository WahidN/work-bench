import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import * as ticketChat from '../../src/ticketChat.js';
import * as fixPipeline from '../../src/fixPipeline.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/ticketChat.js');
vi.mock('../../src/fixPipeline.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let ticketId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
});

describe('POST /tickets/:id/messages', () => {
  it('runs the chat turn and returns the reply', async () => {
    vi.mocked(ticketChat.sendTicketMessage).mockResolvedValue('sounds good');
    const res = await auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'add retry logic' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'sounds good' });
  });

  it('rejects a second concurrent message with 409', async () => {
    let resolveChat: (v: string) => void;
    vi.mocked(ticketChat.sendTicketMessage).mockReturnValue(new Promise((r) => { resolveChat = r; }));

    const first = auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'a' }).then();
    await new Promise((r) => setTimeout(r, 10));
    const second = await auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'b' });

    expect(second.status).toBe(409);
    resolveChat!('done');
    await first;
  });
});

describe('POST /tickets/:id/create-pr', () => {
  it('runs the fix pipeline and returns its result', async () => {
    vi.mocked(fixPipeline.runFixPipeline).mockResolvedValue({ ticketStatus: 'in_review', prId: 5 });
    const res = await auth(request(app).post(`/tickets/${ticketId}/create-pr`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticketStatus: 'in_review', prId: 5 });
  });

  it('returns 500 with the error message when the pipeline throws', async () => {
    vi.mocked(fixPipeline.runFixPipeline).mockRejectedValue(new Error('implement session produced no changes'));
    const res = await auth(request(app).post(`/tickets/${ticketId}/create-pr`));
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('implement session produced no changes');
  });
});
