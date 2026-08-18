import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { fetchMyOpenPrs, fetchPrDetail } from '../../src/sources/githubPrs.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

function hit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: 24, title: 'Guard the deploy', url: 'https://github.com/linku/demo/pull/24',
    updatedAt: '2026-08-14T09:46:24Z', isDraft: false,
    repository: { nameWithOwner: 'linku/demo' }, ...overrides,
  };
}

describe('fetchMyOpenPrs', () => {
  it('unions the author and assignee searches and flags both', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify([hit()]) } as any);
    const prs = await fetchMyOpenPrs(['linku/demo']);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ repo: 'linku/demo', number: 24, authoredByMe: true, assignedToMe: true });
  });

  it('flags a PR that only the assignee search returned', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([hit()]) } as any);
    const prs = await fetchMyOpenPrs(['linku/demo']);
    expect(prs[0]).toMatchObject({ authoredByMe: false, assignedToMe: true });
  });

  it('drops a PR whose repo maps to no project', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([hit({ repository: { nameWithOwner: 'linku/other' } })]),
    } as any);
    expect(await fetchMyOpenPrs(['linku/demo'])).toEqual([]);
  });

  it('accepts a project that stored the full repository URL', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify([hit()]) } as any);
    const prs = await fetchMyOpenPrs(['https://github.com/linku/demo']);
    expect(prs).toHaveLength(1);
  });

  it('matches a project that stored the repo in different casing', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([hit({ repository: { nameWithOwner: 'Linku/ACV-Website' } })]),
    } as any);
    const prs = await fetchMyOpenPrs(['linku/acv-website']);
    expect(prs).toHaveLength(1);
    // GitHub's own casing is kept, because gh pr view is called with it later.
    expect(prs[0].repo).toBe('Linku/ACV-Website');
  });

  it('returns nothing when there are no mapped repos, without shelling out', async () => {
    expect(await fetchMyOpenPrs([])).toEqual([]);
    expect(execa).not.toHaveBeenCalled();
  });
});

describe('fetchPrDetail', () => {
  it('maps the gh review decision and returns the head branch', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ reviewDecision: 'CHANGES_REQUESTED', headRefName: 'feat/x' }),
    } as any);
    expect(await fetchPrDetail('linku/demo', 24)).toEqual({ reviewState: 'changes_requested', headRefName: 'feat/x' });
  });

  it('treats an empty decision as review required', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ reviewDecision: '', headRefName: 'feat/x' }),
    } as any);
    expect((await fetchPrDetail('linku/demo', 24)).reviewState).toBe('review_required');
  });

  it('asks gh for both fields in one call', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '{}' } as any);
    await fetchPrDetail('linku/demo', 24);
    expect(execa).toHaveBeenCalledWith('gh', [
      'pr', 'view', '24', '--repo', 'linku/demo', '--json', 'reviewDecision,headRefName',
    ]);
  });
});
