import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createServer } from '../../src/api/server.js';
import { pollOnce, runQuickPoll } from '../../src/poller.js';

vi.mock('../../src/poller.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

const empty = { jiraTodos: 0, ticketsCreated: 0, prsSynced: 0, sourceErrors: [] };

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
});

describe('POST /poll', () => {
  it('returns the summary of the poll', async () => {
    vi.mocked(pollOnce).mockResolvedValue({
      jiraTodos: 12, ticketsCreated: 0, prsSynced: 3, sourceErrors: [],
    });

    const res = await auth(request(app).post('/poll'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jiraTodos: 12, ticketsCreated: 0, prsSynced: 3, sourceErrors: [] });
  });

  it('runs the quick poll and not the full cycle, so a click cannot hang on Claude', async () => {
    vi.mocked(pollOnce).mockResolvedValue(empty);

    await auth(request(app).post('/poll'));

    expect(pollOnce).toHaveBeenCalledWith(db, runQuickPoll);
  });

  it('passes source errors through so the app can show them', async () => {
    vi.mocked(pollOnce).mockResolvedValue({ ...empty, sourceErrors: ['jira: 401 unauthorized'] });

    const res = await auth(request(app).post('/poll'));

    expect(res.status).toBe(200);
    expect(res.body.sourceErrors).toEqual(['jira: 401 unauthorized']);
  });

  it('answers 500 when the cycle throws', async () => {
    vi.mocked(pollOnce).mockRejectedValue(new Error('boom'));

    const res = await auth(request(app).post('/poll'));

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('boom');
  });

  it('requires the bearer token', async () => {
    const res = await request(app).post('/poll');
    expect(res.status).toBe(401);
  });
});
