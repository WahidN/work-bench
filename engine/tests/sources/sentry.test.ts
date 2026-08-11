import { describe, expect, it } from 'vitest';
import { mapSentryIssue } from '../../src/sources/sentry.js';

describe('mapSentryIssue', () => {
  it('assembles the body from event counts, first-seen, and stack', () => {
    const raw = { id: '123', permalink: 'https://sentry.io/x/123', count: 42, userCount: 7, firstSeen: '2026-01-01' };
    const issue = mapSentryIssue(raw, 'acv-frontend', 'auth.ts:10 in login');
    expect(issue.body).toBe('Events: 42, users affected: 7\n\nFirst seen: 2026-01-01\n\nauth.ts:10 in login');
    expect(issue.sourceId).toBe('SENTRY-123');
    expect(issue.projectKey).toBe('acv-frontend');
  });

  it('omits an empty stack section', () => {
    const raw = { id: '124', permalink: 'https://sentry.io/x/124', count: 1, userCount: 1, firstSeen: '2026-01-01' };
    const issue = mapSentryIssue(raw, 'acv-frontend', '');
    expect(issue.body).toBe('Events: 1, users affected: 1\n\nFirst seen: 2026-01-01');
  });
});
