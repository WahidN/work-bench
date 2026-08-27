import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { adfToText, mapJiraIssue, fetchAssignedJiraIssues } from '../../src/sources/jira.js';
import { getConnection, getAccessToken } from '../../src/sources/jiraAuth.js';
import { getSecret } from '../../src/keychain.js';

vi.mock('../../src/sources/jiraAuth.js');
vi.mock('../../src/keychain.js');

const realFetch = globalThis.fetch;

const connected = {
  hasClientCredentials: true, connected: true,
  siteUrl: 'https://demo.atlassian.net', siteName: 'Demo',
  availableSites: [], callbackUrl: 'http://localhost:4173/oauth/jira/callback',
};

describe('fetchAssignedJiraIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConnection).mockResolvedValue(connected);
    vi.mocked(getAccessToken).mockResolvedValue('at-1');
    vi.mocked(getSecret).mockImplementation(async (account: string) =>
      account === 'jira-cloud-id' ? 'cloud-1' : null
    );
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  function stubSearch(body: any, status = 200): () => { url: string; headers: any }[] {
    const calls: { url: string; headers: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
    }) as any;
    return () => calls;
  }

  const oneIssue = {
    issues: [{
      key: 'DEMO-1',
      fields: { summary: 'Logout loops', description: null, project: { key: 'DEMO' } },
    }],
    isLast: true,
  };

  it('calls the site through api.atlassian.com with a bearer token', async () => {
    const calls = stubSearch(oneIssue);

    await fetchAssignedJiraIssues();

    expect(calls()[0].url).toContain('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/search/jql');
    expect(calls()[0].headers.Authorization).toBe('Bearer at-1');
  });

  it('still asks for every issue assigned to the user, with no status filter', async () => {
    const calls = stubSearch(oneIssue);

    await fetchAssignedJiraIssues();

    const jql = new URL(calls()[0].url).searchParams.get('jql');
    expect(jql).toBe('assignee = currentUser() ORDER BY updated DESC');
    expect(jql).not.toContain('statusCategory');
  });

  // The API host and the browse host are different under OAuth. Getting this wrong
  // points every issue link in the app at api.atlassian.com.
  it('builds browse links from the site url, not the api host', async () => {
    stubSearch(oneIssue);

    const issues = await fetchAssignedJiraIssues();

    expect(issues[0].url).toBe('https://demo.atlassian.net/browse/DEMO-1');
    expect(issues[0].url).not.toContain('api.atlassian.com');
  });

  it('returns nothing and calls nobody when Jira is not connected yet', async () => {
    vi.mocked(getConnection).mockResolvedValue({ ...connected, connected: false });
    const calls = stubSearch(oneIssue);

    expect(await fetchAssignedJiraIssues()).toEqual([]);
    expect(calls()).toHaveLength(0);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('lets a broken refresh surface as an error the app can show', async () => {
    vi.mocked(getAccessToken).mockRejectedValue(
      new Error('Jira login expired, reconnect in Settings (400 refreshing the token)')
    );
    stubSearch(oneIssue);

    await expect(fetchAssignedJiraIssues()).rejects.toThrow(/reconnect in Settings/);
  });

  it('throws on a non-ok search response', async () => {
    stubSearch({ errorMessages: ['nope'] }, 403);

    await expect(fetchAssignedJiraIssues()).rejects.toThrow(/Jira API error 403/);
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
