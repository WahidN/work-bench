import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  JIRA_REDIRECT_URI,
  JIRA_SCOPES,
  createAuthorizationState,
  consumeAuthorizationState,
  buildAuthorizeUrl,
  resetJiraAuthStateForTests,
} from '../../src/sources/jiraAuth.js';

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
