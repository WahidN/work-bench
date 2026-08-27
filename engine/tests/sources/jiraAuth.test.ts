import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  JIRA_REDIRECT_URI,
  JIRA_SCOPES,
  createAuthorizationState,
  consumeAuthorizationState,
  buildAuthorizeUrl,
  resetJiraAuthStateForTests,
  exchangeCode,
  fetchAccessibleSites,
  getAccessToken,
} from '../../src/sources/jiraAuth.js';
import { getSecret, setSecret } from '../../src/keychain.js';

vi.mock('../../src/keychain.js');

const realFetch = globalThis.fetch;

function stubSecrets(values: Record<string, string | null>): void {
  vi.mocked(getSecret).mockImplementation(async (account: string) => values[account] ?? null);
}

/// Routes each Atlassian host to a canned response and records what was sent.
function stubAtlassian(options: {
  token?: { status?: number; body?: any };
  sites?: { status?: number; body?: any };
}): { tokenBodies: () => any[]; urls: () => string[] } {
  const tokenBodies: any[] = [];
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const asString = String(url);
    urls.push(asString);
    // Checked first on purpose: the sites endpoint is /oauth/token/accessible-resources,
    // so it contains the token path as a substring and would otherwise be misrouted.
    if (asString.includes('accessible-resources')) {
      const status = options.sites?.status ?? 200;
      return { ok: status < 400, status, json: async () => options.sites?.body ?? [] } as any;
    }
    if (asString.includes('/oauth/token')) {
      tokenBodies.push(JSON.parse(init.body));
      const status = options.token?.status ?? 200;
      return { ok: status < 400, status, json: async () => options.token?.body ?? {} } as any;
    }
    throw new Error(`unexpected fetch to ${asString}`);
  }) as any;
  return { tokenBodies: () => tokenBodies, urls: () => urls };
}

beforeEach(() => {
  resetJiraAuthStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the redirect uri', () => {
  it('is built from the engine port and is the exact value Atlassian must be given', () => {
    expect(JIRA_REDIRECT_URI).toBe('http://localhost:4173/oauth/jira/callback');
  });

  it('asks for read-only scopes plus offline access', () => {
    expect(JIRA_SCOPES).toBe('read:jira-work read:jira-user offline_access');
    expect(JIRA_SCOPES).not.toContain('write');
  });
});

describe('createAuthorizationState', () => {
  it('gives a different state every time', () => {
    const first = createAuthorizationState();
    const second = createAuthorizationState();
    expect(first.state).not.toBe(second.state);
    expect(first.state.length).toBeGreaterThanOrEqual(32);
  });

  it('produces a challenge that is the S256 hash of the verifier', () => {
    const { verifier, challenge } = createAuthorizationState();
    const expected = createHash('sha256').update(verifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });
});

describe('consumeAuthorizationState', () => {
  it('returns the verifier once and then refuses a replay', () => {
    const { state, verifier } = createAuthorizationState();

    expect(consumeAuthorizationState(state)).toEqual({ verifier });
    expect(consumeAuthorizationState(state)).toBeNull();
  });

  it('refuses a state it never issued', () => {
    expect(consumeAuthorizationState('nonsense')).toBeNull();
  });

  it('refuses a state older than ten minutes', () => {
    vi.useFakeTimers();
    const { state } = createAuthorizationState();

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(consumeAuthorizationState(state)).toBeNull();
  });

  it('accepts a state still inside the window', () => {
    vi.useFakeTimers();
    const { state, verifier } = createAuthorizationState();

    vi.advanceTimersByTime(9 * 60 * 1000);

    expect(consumeAuthorizationState(state)).toEqual({ verifier });
  });
});

describe('buildAuthorizeUrl', () => {
  it('carries everything Atlassian needs', () => {
    const url = new URL(buildAuthorizeUrl('client-abc', 'state-xyz', 'challenge-123'));

    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('scope')).toBe(JIRA_SCOPES);
    expect(url.searchParams.get('redirect_uri')).toBe(JIRA_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never puts a secret in the url', () => {
    const url = buildAuthorizeUrl('client-abc', 'state-xyz', 'challenge-123');
    expect(url).not.toContain('client_secret');
  });
});

describe('exchangeCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSecrets({ 'jira-client-id': 'client-abc', 'jira-client-secret': 'secret-xyz' });
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  it('sends the code, the verifier and the exact redirect uri', async () => {
    const captured = stubAtlassian({
      token: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } },
      sites: { body: [{ id: 'cloud-1', url: 'https://demo.atlassian.net', name: 'Demo' }] },
    });

    await exchangeCode('code-1', 'verifier-1');

    expect(captured.tokenBodies()[0]).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-abc',
      client_secret: 'secret-xyz',
      code: 'code-1',
      redirect_uri: JIRA_REDIRECT_URI,
      code_verifier: 'verifier-1',
    });
  });

  it('stores the refresh token, and the site when there is exactly one', async () => {
    stubAtlassian({
      token: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } },
      sites: { body: [{ id: 'cloud-1', url: 'https://demo.atlassian.net', name: 'Demo' }] },
    });

    await exchangeCode('code-1', 'verifier-1');

    expect(setSecret).toHaveBeenCalledWith('jira-refresh-token', 'rt-1');
    expect(setSecret).toHaveBeenCalledWith('jira-cloud-id', 'cloud-1');
    expect(setSecret).toHaveBeenCalledWith('jira-site-url', 'https://demo.atlassian.net');
    expect(setSecret).toHaveBeenCalledWith('jira-site-name', 'Demo');
  });

  // The refresh token is the only way back in, and Atlassian rotates it, so it must
  // be safe on disk before anything that can fail runs.
  it('stores the refresh token before it looks up the sites', async () => {
    const order: string[] = [];
    vi.mocked(setSecret).mockImplementation(async (account: string) => { order.push(`set:${account}`); });
    globalThis.fetch = vi.fn(async (url: any) => {
      const asString = String(url);
      // accessible-resources first: its path contains /oauth/token as a substring.
      if (asString.includes('accessible-resources')) {
        order.push('fetch:sites');
        return { ok: true, status: 200, json: async () => [] } as any;
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }) } as any;
    }) as any;

    await exchangeCode('code-1', 'verifier-1');

    expect(order.indexOf('set:jira-refresh-token')).toBeLessThan(order.indexOf('fetch:sites'));
  });

  it('stores no site when several came back, leaving the choice to the app', async () => {
    stubAtlassian({
      token: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } },
      sites: { body: [
        { id: 'cloud-1', url: 'https://one.atlassian.net', name: 'One' },
        { id: 'cloud-2', url: 'https://two.atlassian.net', name: 'Two' },
      ] },
    });

    await exchangeCode('code-1', 'verifier-1');

    expect(setSecret).toHaveBeenCalledWith('jira-refresh-token', 'rt-1');
    expect(setSecret).not.toHaveBeenCalledWith('jira-cloud-id', expect.anything());
  });

  it('throws when Atlassian rejects the exchange', async () => {
    stubAtlassian({ token: { status: 400, body: { error: 'invalid_grant' } } });

    await expect(exchangeCode('code-1', 'verifier-1')).rejects.toThrow(/exchange failed \(400\)/);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('explains itself when offline_access was left out of the app scopes', async () => {
    stubAtlassian({ token: { body: { access_token: 'at-1', expires_in: 3600 } } });

    await expect(exchangeCode('code-1', 'verifier-1')).rejects.toThrow(/offline_access/);
  });

  it('refuses to run without client credentials', async () => {
    stubSecrets({});
    stubAtlassian({});

    await expect(exchangeCode('code-1', 'verifier-1')).rejects.toThrow(/client credentials/);
  });
});

describe('fetchAccessibleSites', () => {
  afterEach(() => { globalThis.fetch = realFetch; });

  it('maps id, url and name and drops the rest', async () => {
    stubAtlassian({ sites: { body: [
      { id: 'cloud-1', url: 'https://demo.atlassian.net', name: 'Demo', scopes: ['read:jira-work'], avatarUrl: 'x' },
    ] } });

    expect(await fetchAccessibleSites('at-1')).toEqual([
      { id: 'cloud-1', url: 'https://demo.atlassian.net', name: 'Demo' },
    ]);
  });

  it('throws when the lookup fails', async () => {
    stubAtlassian({ sites: { status: 403 } });

    await expect(fetchAccessibleSites('at-1')).rejects.toThrow(/site lookup failed \(403\)/);
  });
});

describe('getAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetJiraAuthStateForTests();
    stubSecrets({
      'jira-client-id': 'client-abc',
      'jira-client-secret': 'secret-xyz',
      'jira-refresh-token': 'rt-old',
    });
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  it('refreshes with the stored token and returns the new access token', async () => {
    const captured = stubAtlassian({
      token: { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 } },
    });

    expect(await getAccessToken()).toBe('at-new');
    expect(captured.tokenBodies()[0]).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-abc',
      client_secret: 'secret-xyz',
      refresh_token: 'rt-old',
    });
  });

  // Atlassian kills the old refresh token when it issues a new one.
  it('stores the rotated refresh token', async () => {
    stubAtlassian({ token: { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 } } });

    await getAccessToken();

    expect(setSecret).toHaveBeenCalledWith('jira-refresh-token', 'rt-new');
  });

  it('reuses a cached token instead of refreshing again', async () => {
    const captured = stubAtlassian({ token: { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 } } });

    await getAccessToken();
    await getAccessToken();

    expect(captured.tokenBodies()).toHaveLength(1);
  });

  it('refreshes again once the cached token is inside the last minute of its life', async () => {
    const captured = stubAtlassian({ token: { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 120 } } });

    vi.useFakeTimers();
    await getAccessToken();
    vi.advanceTimersByTime(70 * 1000);
    await getAccessToken();

    expect(captured.tokenBodies()).toHaveLength(2);
  });

  // Two concurrent refreshes would each spend the rotating token; one wins and the
  // loser's token is dead, silently logging the user out.
  it('performs one token request for two concurrent callers', async () => {
    let release: (value: any) => void;
    const gate = new Promise((resolve) => { release = resolve; });
    let tokenCalls = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/oauth/token')) {
        tokenCalls++;
        await gate;
        return { ok: true, status: 200, json: async () => ({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }) } as any;
      }
      throw new Error('unexpected fetch');
    }) as any;

    const first = getAccessToken();
    const second = getAccessToken();
    release!(null);

    expect(await first).toBe('at-new');
    expect(await second).toBe('at-new');
    expect(tokenCalls).toBe(1);
  });

  it('asks the user to reconnect when the refresh is rejected, and keeps the stored token', async () => {
    stubAtlassian({ token: { status: 400, body: { error: 'invalid_grant' } } });

    await expect(getAccessToken()).rejects.toThrow(/reconnect in Settings/);
    expect(setSecret).not.toHaveBeenCalledWith('jira-refresh-token', expect.anything());
  });

  it('allows a later attempt after a failure instead of wedging', async () => {
    stubAtlassian({ token: { status: 400 } });
    await expect(getAccessToken()).rejects.toThrow();

    const captured = stubAtlassian({ token: { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 } } });
    expect(await getAccessToken()).toBe('at-new');
    expect(captured.tokenBodies()).toHaveLength(1);
  });

  it('says Jira is not connected when there is no refresh token', async () => {
    stubSecrets({ 'jira-client-id': 'client-abc', 'jira-client-secret': 'secret-xyz' });
    stubAtlassian({});

    await expect(getAccessToken()).rejects.toThrow(/not connected/);
  });
});
