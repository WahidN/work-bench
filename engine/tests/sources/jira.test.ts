import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { adfToText, mapJiraIssue, fetchAssignedJiraIssues } from '../../src/sources/jira.js';
import { getSecret } from '../../src/keychain.js';

vi.mock('../../src/keychain.js');

const realFetch = globalThis.fetch;

describe('fetchAssignedJiraIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSecret).mockImplementation(async (name: string) => {
      if (name === 'jira-base-url') return 'https://example.atlassian.net/';
      if (name === 'jira-email') return 'me@example.com';
      if (name === 'jira-api-token') return 'tok';
      return null;
    });
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  /// Captures the search URL. /myself answers ok, so an empty result is treated as a
  /// genuinely empty board rather than a credentials failure.
  function captureRequest(): () => string {
    let captured = '';
    globalThis.fetch = vi.fn(async (url: any) => {
      const asString = String(url);
      if (asString.includes('/myself')) return { ok: true, status: 200, text: async () => '{}' } as any;
      captured = asString;
      return { ok: true, json: async () => ({ issues: [] }) } as any;
    }) as any;
    return () => captured;
  }

  it('asks for every issue assigned to the user, with no status filter at all', async () => {
    const url = captureRequest();

    await fetchAssignedJiraIssues();

    const jql = new URL(url()).searchParams.get('jql');
    expect(jql).toBe('assignee = currentUser() ORDER BY updated DESC');
    // The status filter is deliberately gone. `statusCategory != Done` excluded any
    // workflow status mapped to the Done category, so an issue sitting in In Review
    // or Blocked never reached the app even though the user considers it open.
    expect(jql).not.toContain('statusCategory');
  });

  it('strips a trailing slash from the base url instead of doubling it', async () => {
    const url = captureRequest();

    await fetchAssignedJiraIssues();

    expect(url()).toContain('https://example.atlassian.net/rest/api/3/search/jql?');
  });

  it('returns nothing when the credentials are missing, rather than calling Jira', async () => {
    const url = captureRequest();
    vi.mocked(getSecret).mockResolvedValue(null);

    expect(await fetchAssignedJiraIssues()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(url()).toBe('');
  });

  // The defect this guards: Jira answers a request with rejected credentials with
  // HTTP 200 and an empty list, so a dead token looked exactly like an empty board
  // and the app silently stopped showing new issues.
  it('throws when an empty result turns out to be rejected credentials', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/myself')) {
        return { ok: false, status: 401, text: async () => 'Client must be authenticated' } as any;
      }
      return { ok: true, json: async () => ({ issues: [], isLast: true }) } as any;
    }) as any;

    await expect(fetchAssignedJiraIssues()).rejects.toThrow(/credentials rejected \(401/);
  });

  it('treats an empty result as a genuinely empty board when the credentials are good', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/myself')) return { ok: true, status: 200, text: async () => '{}' } as any;
      return { ok: true, json: async () => ({ issues: [], isLast: true }) } as any;
    }) as any;

    expect(await fetchAssignedJiraIssues()).toEqual([]);
  });

  it('does not spend a request on /myself when issues came back', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          issues: [{
            key: 'DEMO-1',
            fields: { summary: 'Something', description: null, project: { key: 'DEMO' } },
          }],
          isLast: true,
        }),
      } as any;
    }) as any;

    const result = await fetchAssignedJiraIssues();

    expect(result).toHaveLength(1);
    expect(calls.some((url) => url.includes('/myself'))).toBe(false);
  });
});

describe('adfToText', () => {
  it('joins paragraph text nodes with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    };
    expect(adfToText(doc).trim()).toBe('First line\nSecond line');
  });
});

describe('mapJiraIssue', () => {
  it('maps a plain string description', () => {
    const raw = { key: 'ACV-12', fields: { summary: 'Fix login redirect', description: 'Redirect loops on logout.', project: { key: 'ACV' } } };
    const issue = mapJiraIssue(raw, 'https://x.atlassian.net');
    expect(issue).toEqual({
      source: 'jira', sourceId: 'JIRA-ACV-12', title: '[ACV-12] Fix login redirect',
      url: 'https://x.atlassian.net/browse/ACV-12', body: 'Redirect loops on logout.', projectKey: 'ACV',
    });
  });

  it('converts an ADF description', () => {
    const raw = {
      key: 'ACV-13',
      fields: {
        summary: 'Crash on save', project: { key: 'ACV' },
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stack trace attached.' }] }] },
      },
    };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body.trim()).toBe('Stack trace attached.');
  });

  it('returns an empty body when description is null', () => {
    const raw = { key: 'ACV-14', fields: { summary: 'No description', description: null, project: { key: 'ACV' } } };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body).toBe('');
  });
});
