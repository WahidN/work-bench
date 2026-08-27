import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createServer } from '../../src/api/server.js';
import {
  getConnection, saveClientCredentials, createAuthorizationState, consumeAuthorizationState,
  buildAuthorizeUrl, exchangeCode, chooseSite, disconnect, getClientId,
} from '../../src/sources/jiraAuth.js';

vi.mock('../../src/sources/jiraAuth.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

const disconnected = {
  hasClientCredentials: false, connected: false, siteUrl: null, siteName: null,
  availableSites: [], callbackUrl: 'http://localhost:4173/oauth/jira/callback',
};

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  vi.mocked(getConnection).mockResolvedValue(disconnected);
  vi.mocked(getClientId).mockResolvedValue('client-abc');
});

describe('GET /settings/jira', () => {
  it('returns the connection', async () => {
    const res = await auth(request(app).get('/settings/jira'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(disconnected);
  });

  it('requires the bearer token', async () => {
    expect((await request(app).get('/settings/jira')).status).toBe(401);
  });
});

describe('PUT /settings/jira/client', () => {
  it('saves both halves', async () => {
    const res = await auth(request(app).put('/settings/jira/client'))
      .send({ clientId: 'client-abc', clientSecret: 'secret-xyz' });

    expect(res.status).toBe(200);
    expect(saveClientCredentials).toHaveBeenCalledWith('client-abc', 'secret-xyz');
  });

  it('rejects a missing or blank half', async () => {
    for (const body of [{}, { clientId: 'a' }, { clientId: 'a', clientSecret: '  ' }, { clientId: 42, clientSecret: 'b' }]) {
      const res = await auth(request(app).put('/settings/jira/client')).send(body);
      expect(res.status).toBe(400);
    }
    expect(saveClientCredentials).not.toHaveBeenCalled();
  });

  it('never echoes the secret back', async () => {
    const res = await auth(request(app).put('/settings/jira/client'))
      .send({ clientId: 'client-abc', clientSecret: 'secret-xyz' });

    expect(JSON.stringify(res.body)).not.toContain('secret-xyz');
  });
});

describe('POST /settings/jira/authorize', () => {
  it('returns an authorize url', async () => {
    vi.mocked(getConnection).mockResolvedValue({ ...disconnected, hasClientCredentials: true });
    vi.mocked(createAuthorizationState).mockReturnValue({ state: 's', verifier: 'v', challenge: 'c' });
    vi.mocked(buildAuthorizeUrl).mockReturnValue('https://auth.atlassian.com/authorize?state=s');

    const res = await auth(request(app).post('/settings/jira/authorize'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://auth.atlassian.com/authorize?state=s' });
  });

  it('refuses before the client credentials are set', async () => {
    const res = await auth(request(app).post('/settings/jira/authorize'));

    expect(res.status).toBe(400);
    expect(createAuthorizationState).not.toHaveBeenCalled();
  });
});

describe('GET /oauth/jira/callback', () => {
  it('needs no bearer token, because a browser redirect cannot carry one', async () => {
    vi.mocked(consumeAuthorizationState).mockReturnValue({ verifier: 'v' });
    vi.mocked(exchangeCode).mockResolvedValue(undefined);

    const res = await request(app).get('/oauth/jira/callback?code=abc&state=s');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Jira connected');
    expect(exchangeCode).toHaveBeenCalledWith('abc', 'v');
  });

  it('refuses an unknown, expired or replayed state without exchanging anything', async () => {
    vi.mocked(consumeAuthorizationState).mockReturnValue(null);

    const res = await request(app).get('/oauth/jira/callback?code=abc&state=stale');

    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses a request with no code', async () => {
    vi.mocked(consumeAuthorizationState).mockReturnValue({ verifier: 'v' });

    const res = await request(app).get('/oauth/jira/callback?state=s');

    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('reports a failed exchange without leaking the code', async () => {
    vi.mocked(consumeAuthorizationState).mockReturnValue({ verifier: 'v' });
    vi.mocked(exchangeCode).mockRejectedValue(new Error('boom secret-xyz'));

    const res = await request(app).get('/oauth/jira/callback?code=abc123&state=s');

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('abc123');
    expect(res.text).not.toContain('secret-xyz');
  });
});

describe('POST /settings/jira/site', () => {
  it('chooses the site', async () => {
    vi.mocked(chooseSite).mockResolvedValue(undefined);

    const res = await auth(request(app).post('/settings/jira/site')).send({ cloudId: 'cloud-2' });

    expect(res.status).toBe(200);
    expect(chooseSite).toHaveBeenCalledWith('cloud-2');
  });

  it('rejects a missing cloudId', async () => {
    const res = await auth(request(app).post('/settings/jira/site')).send({});

    expect(res.status).toBe(400);
    expect(chooseSite).not.toHaveBeenCalled();
  });

  it('turns a rejected site into a 400', async () => {
    vi.mocked(chooseSite).mockRejectedValue(new Error('That Jira site is not one you have access to'));

    const res = await auth(request(app).post('/settings/jira/site')).send({ cloudId: 'nope' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /settings/jira', () => {
  it('disconnects', async () => {
    vi.mocked(disconnect).mockResolvedValue(undefined);

    const res = await auth(request(app).delete('/settings/jira'));

    expect(res.status).toBe(200);
    expect(disconnect).toHaveBeenCalled();
  });

  it('requires the bearer token', async () => {
    expect((await request(app).delete('/settings/jira')).status).toBe(401);
  });
});
