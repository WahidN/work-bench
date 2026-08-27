import { randomBytes, createHash } from 'node:crypto';
import { ENGINE_PORT } from '../config.js';

const AUTH_HOST = 'https://auth.atlassian.com';
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

/// Test seam. This module holds process-wide state on purpose (pending states, and
/// later the cached access token and the in-flight refresh), so tests need a way to
/// start from a clean slate.
export function resetJiraAuthStateForTests(): void {
  pendingStates.clear();
}
