import { describe, expect, it } from 'vitest';
import { anchorableLines, splitByAnchor } from '../src/diffAnchors.js';
import type { ReviewFinding } from '../src/types.js';

// One file, one hunk: two context lines, one added, one removed, one context.
// New-side numbering starts at 10, so the added line is 12 and the removed line
// occupies no new-side number at all.
const simpleDiff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,4 @@ export function a() {
 const first = 1;
 const second = 2;
+const added = 3;
-const removed = 4;
 const last = 5;
`;

describe('anchorableLines', () => {
  it('anchors an added line at its new-side number', () => {
    expect(anchorableLines(simpleDiff).get('src/a.ts')?.has(12)).toBe(true);
  });

  it('anchors a context line', () => {
    const lines = anchorableLines(simpleDiff).get('src/a.ts');
    expect(lines?.has(10)).toBe(true);
    expect(lines?.has(11)).toBe(true);
  });

  // A removed line exists only on the left side. Commenting on it needs
  // side LEFT and a different line basis, which is deliberately unsupported.
  it('does not anchor a removed line', () => {
    const lines = anchorableLines(simpleDiff).get('src/a.ts');
    expect(lines?.has(14)).toBe(false);
    expect(Math.max(...(lines ?? new Set([0])))).toBe(13);
  });

  it('does not anchor a line past the end of the hunk', () => {
    expect(anchorableLines(simpleDiff).get('src/a.ts')?.has(99)).toBe(false);
  });

  it('has nothing at all for a file the diff does not touch', () => {
    expect(anchorableLines(simpleDiff).get('src/untouched.ts')).toBeUndefined();
  });

  // The case a single running counter gets wrong: the second hunk restarts at
  // its own header line, it does not continue from where the first one stopped.
  it('restarts numbering at each hunk instead of running straight through', () => {
    const twoHunks = `diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
 one
+two
@@ -80,2 +90,2 @@
 eighty
+ninety
`;
    const lines = anchorableLines(twoHunks).get('src/b.ts');

    expect(lines?.has(1)).toBe(true);
    expect(lines?.has(2)).toBe(true);
    expect(lines?.has(90)).toBe(true);
    expect(lines?.has(91)).toBe(true);
    // The gap between the hunks is not in the diff and must not be commentable.
    expect(lines?.has(3)).toBe(false);
    expect(lines?.has(50)).toBe(false);
  });

  it('keeps several files apart', () => {
    const twoFiles = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
+alpha
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -50,1 +50,1 @@
+beta
`;
    const map = anchorableLines(twoFiles);

    expect(map.get('src/a.ts')?.has(1)).toBe(true);
    expect(map.get('src/a.ts')?.has(50)).toBe(false);
    expect(map.get('src/b.ts')?.has(50)).toBe(true);
    expect(map.get('src/b.ts')?.has(1)).toBe(false);
  });

  it('contributes nothing for a rename or a binary file rather than throwing', () => {
    const noHunks = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/logo.png b/logo.png
index 3333333..4444444 100644
Binary files a/logo.png and b/logo.png differ
`;
    expect(() => anchorableLines(noHunks)).not.toThrow();
    expect(anchorableLines(noHunks).size).toBe(0);
  });

  it('returns nothing for an empty diff', () => {
    expect(anchorableLines('').size).toBe(0);
  });
});

describe('splitByAnchor', () => {
  const finding = (path: string, line: number): ReviewFinding => ({ path, line, body: `about ${path}:${line}` });

  it('keeps a finding whose line is in the diff', () => {
    const { kept, discarded } = splitByAnchor([finding('src/a.ts', 12)], simpleDiff);

    expect(kept).toHaveLength(1);
    expect(kept[0].line).toBe(12);
    expect(discarded).toHaveLength(0);
  });

  it('discards a finding whose line is not in the diff, naming the file and line', () => {
    const { kept, discarded } = splitByAnchor([finding('src/a.ts', 99)], simpleDiff);

    expect(kept).toHaveLength(0);
    expect(discarded).toHaveLength(1);
    expect(discarded[0].reason).toContain('src/a.ts');
    expect(discarded[0].reason).toContain('99');
  });

  it('discards a finding whose file is not in the diff', () => {
    const { discarded } = splitByAnchor([finding('src/nope.ts', 1)], simpleDiff);

    expect(discarded).toHaveLength(1);
    expect(discarded[0].reason).toContain('src/nope.ts');
  });

  // Both halves are returned so the app can show that the review was trimmed
  // rather than silently dropping remarks.
  it('returns the kept and the discarded separately', () => {
    const { kept, discarded } = splitByAnchor(
      [finding('src/a.ts', 12), finding('src/a.ts', 99), finding('src/a.ts', 10)],
      simpleDiff
    );

    expect(kept.map((f) => f.line)).toEqual([12, 10]);
    expect(discarded.map((f) => f.line)).toEqual([99]);
  });

  it('discards everything when the diff is empty', () => {
    const { kept, discarded } = splitByAnchor([finding('src/a.ts', 12)], '');

    expect(kept).toHaveLength(0);
    expect(discarded).toHaveLength(1);
  });

  it('keeps the body untouched on a kept finding', () => {
    const { kept } = splitByAnchor([finding('src/a.ts', 12)], simpleDiff);

    expect(kept[0].body).toBe('about src/a.ts:12');
  });
});
