import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { fetchPrDetailView, reviewStateFrom, postReviewCommentReply } from '../../src/sources/githubPrDetail.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

const VIEW = {
  title: 'Retry card capture on 5xx',
  url: 'https://github.com/linku/demo/pull/23',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: 'CHANGES_REQUESTED',
  baseRefName: 'main',
  headRefName: 'atlas/retry-card-capture',
  author: { login: 'wahid' },
  createdAt: '2026-08-12T15:11:00Z',
  additions: 64,
  deletions: 7,
  changedFiles: 3,
  commits: [{ oid: 'a' }, { oid: 'b' }, { oid: 'c' }, { oid: 'd' }],
  reviews: [{ author: { login: 'sana' }, body: 'Overall good.', submittedAt: '2026-08-14T09:00:00Z', state: 'COMMENTED' }],
  comments: [{ author: { login: 'wahid' }, body: 'Rebased.', createdAt: '2026-08-14T10:00:00Z' }],
};

const FILES = [
  { filename: 'src/payments/capture.ts', status: 'modified', additions: 24, deletions: 5, patch: '@@ -14,7 +14,9 @@\n context' },
  { filename: 'assets/huge.bin', status: 'modified', additions: 900, deletions: 900 },
];

const THREADS = {
  data: { repository: { pullRequest: { reviewThreads: { nodes: [
    { isResolved: false, isOutdated: false, path: 'src/payments/capture.ts', line: 8, diffSide: 'RIGHT',
      comments: { nodes: [{ databaseId: 1, author: { login: 'sana' }, body: 'What about the ledger row?', createdAt: '2026-08-14T09:00:00Z' }] } },
  ] } } } },
};

function mockGh() {
  vi.mocked(execa)
    .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW) } as any)
    .mockResolvedValueOnce({ stdout: JSON.stringify([FILES]) } as any)
    .mockResolvedValueOnce({ stdout: JSON.stringify(THREADS) } as any);
}

describe('reviewStateFrom', () => {
  it('maps every GitHub decision, treating an absent decision as review required', () => {
    expect(reviewStateFrom('APPROVED')).toBe('approved');
    expect(reviewStateFrom('CHANGES_REQUESTED')).toBe('changes_requested');
    expect(reviewStateFrom('REVIEW_REQUIRED')).toBe('review_required');
    expect(reviewStateFrom(null)).toBe('review_required');
  });
});

describe('fetchPrDetailView', () => {
  it('keeps every file when the file list spans more than one page', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([[FILES[0]], [FILES[1]]]) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify(THREADS) } as any);

    const detail = await fetchPrDetailView('linku/demo', 23);

    expect(detail.files.map((f) => f.path)).toEqual(['src/payments/capture.ts', 'assets/huge.bin']);
  });

  it('asks gh to page through the file list', async () => {
    mockGh();
    await fetchPrDetailView('linku/demo', 23);
    const filesCall = vi.mocked(execa).mock.calls[1][1] as string[];
    expect(filesCall).toContain('--paginate');
    expect(filesCall).toContain('--slurp');
  });

  it('merges the three gh calls into one payload', async () => {
    mockGh();
    const detail = await fetchPrDetailView('linku/demo', 23);
    expect(detail).toMatchObject({
      title: 'Retry card capture on 5xx',
      baseRefName: 'main',
      headRefName: 'atlas/retry-card-capture',
      commitCount: 4,
      changedFiles: 3,
      additions: 64,
      deletions: 7,
      author: 'wahid',
      reviewState: 'changes_requested',
    });
    expect(detail.files).toHaveLength(2);
    expect(detail.threads[0]).toMatchObject({ path: 'src/payments/capture.ts', line: 8, isResolved: false, diffSide: 'RIGHT' });
    expect(detail.threads[0].comments[0]).toMatchObject({ id: 1, author: 'sana' });
  });

  it('keeps a file GitHub gave no patch for, with patch null', async () => {
    mockGh();
    const detail = await fetchPrDetailView('linku/demo', 23);
    expect(detail.files[1]).toMatchObject({ path: 'assets/huge.bin', patch: null });
  });

  it('normalises a stored browser URL to a slug in every gh call', async () => {
    mockGh();
    await fetchPrDetailView('https://github.com/linku/demo', 23);
    const calls = vi.mocked(execa).mock.calls;
    expect(calls[0][1]).toEqual(expect.arrayContaining(['--repo', 'linku/demo']));
    expect(calls[1][1]).toEqual(expect.arrayContaining(['repos/linku/demo/pulls/23/files?per_page=100']));
    expect(calls[2][1]).toEqual(expect.arrayContaining(['-F', 'owner=linku', '-F', 'name=demo', '-F', 'number=23']));
  });

  it('sorts the conversation oldest first and keeps reviews and comments apart', async () => {
    mockGh();
    const detail = await fetchPrDetailView('linku/demo', 23);
    expect(detail.conversation).toEqual([
      { kind: 'review', author: 'sana', body: 'Overall good.', createdAt: '2026-08-14T09:00:00Z', state: 'COMMENTED' },
      { kind: 'comment', author: 'wahid', body: 'Rebased.', createdAt: '2026-08-14T10:00:00Z', state: null },
    ]);
  });

  it('drops an empty COMMENTED review but keeps an empty approval', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ...VIEW, reviews: [
        { author: { login: 'bot' }, body: '', submittedAt: '2026-08-14T08:00:00Z', state: 'COMMENTED' },
        { author: { login: 'sana' }, body: '', submittedAt: '2026-08-14T09:30:00Z', state: 'APPROVED' },
      ] }) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([FILES]) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify(THREADS) } as any);
    const detail = await fetchPrDetailView('linku/demo', 23);
    expect(detail.conversation.filter((c) => c.kind === 'review')).toEqual([
      { kind: 'review', author: 'sana', body: '', createdAt: '2026-08-14T09:30:00Z', state: 'APPROVED' },
    ]);
  });

  it('asks GitHub for the diff side and carries a LEFT thread through', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([FILES]) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: [
          { isResolved: false, isOutdated: false, path: 'src/payments/capture.ts', line: 40, diffSide: 'LEFT',
            comments: { nodes: [{ databaseId: 9, author: { login: 'sana' }, body: 'why remove this?', createdAt: '2026-08-14T09:00:00Z' }] } },
        ] } } } },
      }) } as any);

    const detail = await fetchPrDetailView('linku/demo', 23);

    expect((vi.mocked(execa).mock.calls[2][1] as string[]).join(' ')).toContain('diffSide');
    expect(detail.threads[0]).toMatchObject({ diffSide: 'LEFT', line: 40 });
  });

  it('leaves an unlabelled thread\'s diff side empty so the app will not anchor it', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify([FILES]) } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: [
          { isResolved: false, isOutdated: false, path: 'a.ts', line: 1,
            comments: { nodes: [] } },
        ] } } } },
      }) } as any);

    expect((await fetchPrDetailView('linku/demo', 23)).threads[0].diffSide).toBe('');
  });
});

describe('postReviewCommentReply', () => {
  it('posts the body as a threaded reply and returns the new comment', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify({ id: 99 }) } as any);
    const created = await postReviewCommentReply('https://github.com/workbench-test-does-not-exist/demo', 23, 7, 'Fixed in the catch.');
    expect(created).toEqual({ id: 99 });
    expect(vi.mocked(execa).mock.calls[0][1]).toEqual([
      'api', 'repos/workbench-test-does-not-exist/demo/pulls/23/comments',
      '-f', 'body=Fixed in the catch.',
      '-F', 'in_reply_to=7',
    ]);
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it('keeps newlines in the body intact', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '{"id":1}' } as any);
    await postReviewCommentReply('workbench-test-does-not-exist/demo', 23, 7, 'line one\nline two');
    expect(vi.mocked(execa).mock.calls[0][1]).toContain('body=line one\nline two');
  });
});
