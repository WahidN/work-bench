import { randomBytes, createHash } from 'node:crypto';
import { ENGINE_PORT } from '../config.js';
import { getSecret, setSecret } from '../keychain.js';

const AUTH_HOST = 'https://auth.atlassian.com';
const API_HOST = 'https://api.atlassian.com';
const STATE_TTL_MS = 10 * 60 * 1000;

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

function cacheAccessToken(value: string, expiresInSeconds: number): void {
  cachedAccessToken = { value, expiresAt: Date.now() + expiresInSeconds * 1000 };
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

/// Test seam. This module holds process-wide state on purpose (pending states, and
/// later the cached access token and the in-flight refresh), so tests need a way to
/// start from a clean slate.
export function resetJiraAuthStateForTests(): void {
  pendingStates.clear();
  cachedAccessToken = null;
}
