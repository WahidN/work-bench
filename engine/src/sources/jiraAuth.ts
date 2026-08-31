import { randomBytes, createHash } from 'node:crypto';
import { ENGINE_PORT } from '../config.js';
import { getSecret, setSecret, deleteSecret } from '../keychain.js';

const AUTH_HOST = 'https://auth.atlassian.com';
const API_HOST = 'https://api.atlassian.com';
const STATE_TTL_MS = 10 * 60 * 1000;
// Refresh a minute before expiry rather than on it, so a request that starts just
// before the boundary does not arrive with a token that died in flight.
const REFRESH_MARGIN_MS = 60 * 1000;

/// The exact string Atlassian must be configured with. Assembled once, here.
export const JIRA_REDIRECT_URI = `http://localhost:${ENGINE_PORT}/oauth/jira/callback`;

/// Read-only, plus offline_access which is what yields a refresh token.
export const JIRA_SCOPES = 'read:jira-work read:jira-user offline_access';

interface PendingState {
  verifier: string;
  createdAt: number;
}

const pendingStates = new Map<string, PendingState>();

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createAuthorizationState(): { state: string; verifier: string; challenge: string } {
  const state = randomBytes(32).toString('hex');
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  pendingStates.set(state, { verifier, createdAt: Date.now() });
  return { state, verifier, challenge };
}

/// Single use and time limited. The callback route is the only unauthenticated
/// route on this engine, and this function is what protects it: a state that was
/// never issued, has already been spent, or is older than ten minutes gets nothing.
export function consumeAuthorizationState(state: string): { verifier: string } | null {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return { verifier: entry.verifier };
}

export function buildAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: JIRA_SCOPES,
    redirect_uri: JIRA_REDIRECT_URI,
    state,
    response_type: 'code',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_HOST}/authorize?${params}`;
}

export interface JiraSite {
  id: string;
  url: string;
  name: string;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let refreshInFlight: Promise<string> | null = null;

function cacheAccessToken(value: string, expiresInSeconds: number): void {
  cachedAccessToken = { value, expiresAt: Date.now() + expiresInSeconds * 1000 };
}

/// The one way to get a bearer token for Jira. Refreshes when needed, and never more
/// than once at a time: Atlassian rotates the refresh token on every use, so two
/// concurrent refreshes would spend it twice and silently log the user out.
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cachedAccessToken.value;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = refreshAccessToken().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function refreshAccessToken(): Promise<string> {
  const clientId = await getSecret('jira-client-id');
  const clientSecret = await getSecret('jira-client-secret');
  const refreshToken = await getSecret('jira-refresh-token');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Jira is not connected');

  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    // The stored token is deliberately left alone. It may still be good and this may
    // be transient; discarding the only way back in on a 500 would force a needless
    // re-login.
    throw new Error(`Jira login expired, reconnect in Settings (${res.status} refreshing the token)`);
  }

  const data: any = await res.json();
  // Persisted before the access token is handed out. A crash between receiving the
  // rotated token and storing it breaks the chain and forces a full re-login.
  if (data.refresh_token) await setSecret('jira-refresh-token', data.refresh_token);
  cacheAccessToken(data.access_token, data.expires_in);
  return data.access_token;
}

export async function fetchAccessibleSites(accessToken: string): Promise<JiraSite[]> {
  const res = await fetch(`${API_HOST}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Jira site lookup failed (${res.status})`);
  const data: any = await res.json();
  return (data ?? []).map((site: any) => ({ id: site.id, url: site.url, name: site.name }));
}

async function persistSite(site: JiraSite): Promise<void> {
  await setSecret('jira-cloud-id', site.id);
  await setSecret('jira-site-url', site.url);
  await setSecret('jira-site-name', site.name);
}

export async function exchangeCode(code: string, verifier: string): Promise<void> {
  const clientId = await getSecret('jira-client-id');
  const clientSecret = await getSecret('jira-client-secret');
  if (!clientId || !clientSecret) throw new Error('Jira client credentials are not set');

  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: JIRA_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Jira token exchange failed (${res.status})`);

  const data: any = await res.json();
  if (!data.refresh_token) {
    throw new Error('Jira returned no refresh token. Add offline_access to the app scopes and connect again.');
  }

  // Stored before the site lookup, which can fail: this token is the only way back
  // in without a fresh consent, and Atlassian rotates it on every use.
  await setSecret('jira-refresh-token', data.refresh_token);
  cacheAccessToken(data.access_token, data.expires_in);

  // One site needs no question. Several are left for the app to choose, and
  // getConnection re-resolves them, so an engine restart in between is harmless.
  const sites = await fetchAccessibleSites(data.access_token);
  if (sites.length === 1) await persistSite(sites[0]);
}

export interface JiraConnection {
  hasClientCredentials: boolean;
  connected: boolean;
  siteUrl: string | null;
  siteName: string | null;
  /// Non-empty only while a site still has to be chosen.
  availableSites: JiraSite[];
  /// The exact value to paste into the Atlassian console, so the user never retypes it.
  callbackUrl: string;
}

export async function saveClientCredentials(clientId: string, clientSecret: string): Promise<void> {
  await setSecret('jira-client-id', clientId);
  await setSecret('jira-client-secret', clientSecret);
}

/// Only the id, never the secret, and only so the authorize URL can be built.
export async function getClientId(): Promise<string> {
  const clientId = await getSecret('jira-client-id');
  if (!clientId) throw new Error('Jira client credentials are not set');
  return clientId;
}

export async function getConnection(): Promise<JiraConnection> {
  const [clientId, clientSecret, refreshToken, cloudId, siteUrl, siteName] = await Promise.all([
    getSecret('jira-client-id'),
    getSecret('jira-client-secret'),
    getSecret('jira-refresh-token'),
    getSecret('jira-cloud-id'),
    getSecret('jira-site-url'),
    getSecret('jira-site-name'),
  ]);

  let availableSites: JiraSite[] = [];
  // Consent happened but no site was chosen, which also covers an engine restart in
  // between. Resolving here means that state never needs a fresh consent. A failure
  // is swallowed: the status endpoint must answer even when Atlassian is unreachable.
  if (refreshToken && !cloudId) {
    try {
      availableSites = await fetchAccessibleSites(await getAccessToken());
    } catch {
      availableSites = [];
    }
  }

  return {
    hasClientCredentials: !!clientId && !!clientSecret,
    connected: !!refreshToken && !!cloudId && !!siteUrl,
    siteUrl: siteUrl ?? null,
    siteName: siteName ?? null,
    availableSites,
    callbackUrl: JIRA_REDIRECT_URI,
  };
}

export async function chooseSite(cloudId: string): Promise<void> {
  const sites = await fetchAccessibleSites(await getAccessToken());
  const site = sites.find((candidate) => candidate.id === cloudId);
  if (!site) throw new Error('That Jira site is not one you have access to');
  await persistSite(site);
}

export async function disconnect(): Promise<void> {
  // The client credentials stay, so reconnecting does not mean pasting them again.
  for (const account of ['jira-refresh-token', 'jira-cloud-id', 'jira-site-url', 'jira-site-name']) {
    // deleteSecret throws when the item was never there, which is not a failure here.
    try {
      await deleteSecret(account);
    } catch {
      // nothing to remove
    }
  }
  cachedAccessToken = null;
  refreshInFlight = null;
}

/// Test seam. This module holds process-wide state on purpose (pending states, and
/// later the cached access token and the in-flight refresh), so tests need a way to
/// start from a clean slate.
export function resetJiraAuthStateForTests(): void {
  pendingStates.clear();
  cachedAccessToken = null;
  refreshInFlight = null;
}
