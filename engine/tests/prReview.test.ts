import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { buildPrReviewPrompt, isReviewFindings, reviewPrDiff } from '../src/prReview.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
+const added = 3;
`;

describe('buildPrReviewPrompt', () => {
  it('carries the pull request title and the diff', () => {
    const prompt = buildPrReviewPrompt({ title: 'Herbouw meldingsbalk', body: '' }, diff);

    expect(prompt).toContain('Herbouw meldingsbalk');
    expect(prompt).toContain('const added = 3;');
  });

  it('asks for a path, a line and a body per finding', () => {
    const prompt = buildPrReviewPrompt({ title: 't', body: '' }, diff);

    expect(prompt).toContain('path');
    expect(prompt).toContain('line');
    expect(prompt).toContain('body');
  });

  it('says the answer is JSON only', () => {
    expect(buildPrReviewPrompt({ title: 't', body: '' }, diff)).toContain('ONLY JSON');
  });

  // The scored review still exists for the fix pipeline and the chat. This one
  // must not ask for those dimensions, because nothing here reads them and a
  // model asked for both shapes tends to return a blend of the two.
  it('does not ask for scores', () => {
    const prompt = buildPrReviewPrompt({ title: 't', body: '' }, diff);

    expect(prompt).not.toContain('correctness');
    expect(prompt).not.toContain('regressionRisk');
    expect(prompt).not.toContain('Score each dimension');
  });

  // The remark is posted on its own under a line, with nothing around it, so it
  // has to read as a standalone comment rather than an item in a list.
  it('tells the model each remark stands alone under its line', () => {
    expect(buildPrReviewPrompt({ title: 't', body: '' }, diff).toLowerCase()).toContain('on its own');
  });
});

describe('isReviewFindings', () => {
  it('accepts a well-formed findings array', () => {
    expect(isReviewFindings({ findings: [{ path: 'src/a.ts', line: 3, body: 'why' }] })).toBe(true);
  });

  it('accepts an empty findings array, which means the review found nothing', () => {
    expect(isReviewFindings({ findings: [] })).toBe(true);
  });

  it('rejects a finding without a path', () => {
    expect(isReviewFindings({ findings: [{ line: 3, body: 'why' }] })).toBe(false);
  });

  it('rejects a finding without a line', () => {
    expect(isReviewFindings({ findings: [{ path: 'src/a.ts', body: 'why' }] })).toBe(false);
  });

  it('rejects a finding without a body', () => {
    expect(isReviewFindings({ findings: [{ path: 'src/a.ts', line: 3 }] })).toBe(false);
  });

  it('rejects a non-numeric line', () => {
    expect(isReviewFindings({ findings: [{ path: 'src/a.ts', line: '3', body: 'why' }] })).toBe(false);
  });

  it('rejects an empty body, which would post a comment saying nothing', () => {
    expect(isReviewFindings({ findings: [{ path: 'src/a.ts', line: 3, body: '  ' }] })).toBe(false);
  });

  it('rejects a missing findings key', () => {
    expect(isReviewFindings({})).toBe(false);
    expect(isReviewFindings(null)).toBe(false);
  });

  // The guard against the two review shapes being confused: a scored review must
  // not be mistaken for this one.
  it('rejects a payload shaped like the old scored review', () => {
    const scored = { correctness: 4, completeness: 4, quality: 4, tests: 4, regressionRisk: 4, findings: ['a remark'] };

    expect(isReviewFindings(scored)).toBe(false);
  });
});

describe('reviewPrDiff', () => {
  it('runs read-only: Read, Grep and Glob and nothing else', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: '{"findings":[{"path":"src/a.ts","line":1,"body":"why"}]}',
    } as any);

    await reviewPrDiff('/repos/demo/.worktrees/feat-x', { title: 't', body: '' }, diff);

    const args = vi.mocked(execa).mock.calls[0][1] as string[];
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe('Read,Grep,Glob');
    // The boundary that makes "reviewing changes nothing" a property of the
    // system rather than of the model's cooperation.
    expect(allowed).not.toContain('Write');
    expect(allowed).not.toContain('Edit');
    expect(allowed).not.toContain('Bash');
  });

  it('runs in the worktree it was given', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '{"findings":[]}' } as any);

    await reviewPrDiff('/repos/demo/.worktrees/feat-x', { title: 't', body: '' }, diff);

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.anything(),
      expect.objectContaining({ cwd: '/repos/demo/.worktrees/feat-x' })
    );
  });

  it('returns the findings the model produced', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: '{"findings":[{"path":"src/a.ts","line":1,"body":"duplicated helper"}]}',
    } as any);

    const findings = await reviewPrDiff('/w', { title: 't', body: '' }, diff);

    expect(findings).toEqual([{ path: 'src/a.ts', line: 1, body: 'duplicated helper' }]);
  });

  it('returns nothing when the review found nothing', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '{"findings":[]}' } as any);

    expect(await reviewPrDiff('/w', { title: 't', body: '' }, diff)).toEqual([]);
  });
});
