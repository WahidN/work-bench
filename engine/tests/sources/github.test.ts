import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { mapGithubIssue, fetchGithubIssues } from '../../src/sources/github.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

describe('mapGithubIssue', () => {
  it('maps number, title, body, url', () => {
    const raw = { number: 42, title: 'Crash on save', body: 'Steps to reproduce...', url: 'https://github.com/linku/demo/issues/42' };
    expect(mapGithubIssue(raw, 'linku/demo')).toEqual({
      source: 'github', sourceId: 'GH-linku/demo#42', title: 'Crash on save',
      url: 'https://github.com/linku/demo/issues/42', body: 'Steps to reproduce...', projectKey: 'linku/demo',
    });
  });

  it('defaults a null body to an empty string', () => {
    const raw = { number: 1, title: 't', body: null, url: 'u' };
    expect(mapGithubIssue(raw, 'linku/demo').body).toBe('');
  });
});

describe('fetchGithubIssues', () => {
  it('shells out to gh search issues per repo and maps the results', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([{ number: 1, title: 't', body: 'b', url: 'u' }]),
    } as any);
    const issues = await fetchGithubIssues(['linku/demo']);
    expect(execa).toHaveBeenCalledWith('gh', [
      'search', 'issues', '--assignee=@me', '--state=open', '--repo', 'linku/demo',
      '--json', 'number,title,body,url',
    ]);
    expect(issues).toEqual([{ source: 'github', sourceId: 'GH-linku/demo#1', title: 't', url: 'u', body: 'b', projectKey: 'linku/demo' }]);
  });
});
