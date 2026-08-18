import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { mapGithubIssue, fetchGithubIssues, toRepoSlug } from '../../src/sources/github.js';

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

  it('passes owner/name to gh when the project stores the full repository URL', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([{ number: 1, title: 't', body: 'b', url: 'u' }]),
    } as any);
    await fetchGithubIssues(['https://github.com/LinkuNijmegen/acv-website']);
    expect(execa).toHaveBeenCalledWith('gh', [
      'search', 'issues', '--assignee=@me', '--state=open', '--repo', 'LinkuNijmegen/acv-website',
      '--json', 'number,title,body,url',
    ]);
  });

  // The poller matches an issue back to its project by comparing projectKey with
  // the stored githubRepo, so the stored value has to survive the fetch as it is.
  it('keeps the stored repo value as the project key', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([{ number: 1, title: 't', body: 'b', url: 'u' }]),
    } as any);
    const issues = await fetchGithubIssues(['https://github.com/LinkuNijmegen/acv-website']);
    expect(issues[0].projectKey).toBe('https://github.com/LinkuNijmegen/acv-website');
    expect(issues[0].sourceId).toBe('GH-https://github.com/LinkuNijmegen/acv-website#1');
  });
});

describe('toRepoSlug', () => {
  it('leaves an owner/name slug alone', () => {
    expect(toRepoSlug('linku/demo')).toBe('linku/demo');
  });

  it('strips the github.com prefix, a trailing slash and a .git suffix', () => {
    expect(toRepoSlug('https://github.com/linku/demo')).toBe('linku/demo');
    expect(toRepoSlug('http://www.github.com/linku/demo/')).toBe('linku/demo');
    expect(toRepoSlug('https://github.com/linku/demo.git')).toBe('linku/demo');
  });
});
