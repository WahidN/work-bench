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
    const { prs, truncated } = await fetchMyOpenPrs(['linku/demo']);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ repo: 'linku/demo', number: 24, authoredByMe: true, assignedToMe: true });
    expect(truncated).toBe(false);
  });

  it('flags a PR that only the assignee search returned', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([hit()]) } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any);
    const { prs } = await fetchMyOpenPrs(['linku/demo']);
    expect(prs[0]).toMatchObject({ authoredByMe: false, assignedToMe: true, reviewRequestedByMe: false });
  });

  it('drops a PR whose repo maps to no project', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([hit({ repository: { nameWithOwner: 'linku/other' } })]),
    } as any);
    expect((await fetchMyOpenPrs(['linku/demo'])).prs).toEqual([]);
  });

  it('accepts a project that stored the full repository URL', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify([hit()]) } as any);
    const { prs } = await fetchMyOpenPrs(['https://github.com/linku/demo']);
    expect(prs).toHaveLength(1);
  });

  it('matches a project that stored the repo in different casing', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([hit({ repository: { nameWithOwner: 'Linku/ACV-Website' } })]),
    } as any);
    const { prs } = await fetchMyOpenPrs(['linku/acv-website']);
    expect(prs).toHaveLength(1);
    // GitHub's own casing is kept, because gh pr view is called with it later.
    expect(prs[0].repo).toBe('Linku/ACV-Website');
  });

  it('returns nothing when there are no mapped repos, without shelling out', async () => {
    expect((await fetchMyOpenPrs([])).prs).toEqual([]);
    expect(execa).not.toHaveBeenCalled();
  });

  it('flags truncated when a search hits the result cap', async () => {
    const capped = Array.from({ length: 100 }, (_, i) => hit({ number: i + 1, url: `https://github.com/linku/demo/pull/${i + 1}` }));
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: JSON.stringify(capped) } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any);
    const { truncated } = await fetchMyOpenPrs(['linku/demo']);
    expect(truncated).toBe(true);
  });

  it('does not flag truncated when neither search hits the cap', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify([hit()]) } as any);
    const { truncated } = await fetchMyOpenPrs(['linku/demo']);
    expect(truncated).toBe(false);
  });

  it('asks gh for review requests as well as authored and assigned', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '[]' } as any);
    await fetchMyOpenPrs(['linku/demo']);
    const filters = vi.mocked(execa).mock.calls.map((call) => (call[1] as string[])[2]);
    expect(filters).toEqual(['--author=@me', '--assignee=@me', '--review-requested=@me']);
  });

  it('flags a PR that only the review-requested search returned', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([hit()]) } as any);
    const { prs } = await fetchMyOpenPrs(['linku/demo']);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ authoredByMe: false, assignedToMe: false, reviewRequestedByMe: true });
  });

  it('carries all three flags for a PR every search returned, without duplicating it', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify([hit()]) } as any);
    const { prs } = await fetchMyOpenPrs(['linku/demo']);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ authoredByMe: true, assignedToMe: true, reviewRequestedByMe: true });
  });

  it('drops a review-requested PR whose repo maps to no project', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({
        stdout: JSON.stringify([hit({ repository: { nameWithOwner: 'linku/other' } })]),
      } as any);
    expect((await fetchMyOpenPrs(['linku/demo'])).prs).toEqual([]);
  });

  it('flags truncated when only the review-requested search hits the cap', async () => {
    const capped = Array.from({ length: 100 }, (_, i) => hit({ number: i + 1, url: `https://github.com/linku/demo/pull/${i + 1}` }));
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: '[]' } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify(capped) } as any);
    const { truncated } = await fetchMyOpenPrs(['linku/demo']);
    expect(truncated).toBe(true);
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
