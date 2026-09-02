import type { ReviewFinding, DiscardedFinding } from './types.js';

const FILE_HEADER = /^\+\+\+ b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/// Every (path, line) a comment can be anchored to, taken from the right-hand
/// side of the diff: added lines and the context lines around them.
///
/// A removed line is deliberately absent. It exists only on the left side, so
/// commenting on it would need side LEFT and a line number counted against the
/// old file, and the model would have to pick correctly between the two bases.
/// Anchoring only to code that is actually there is the narrower, safer rule.
///
/// Line numbers restart at each hunk header rather than running continuously:
/// the gap between two hunks is not in the diff and nothing in it is
/// commentable, which a single running counter would get wrong.
export function anchorableLines(diff: string): Map<string, Set<number>> {
  const byPath = new Map<string, Set<number>>();
  let path: string | null = null;
  let line = 0;

  for (const text of diff.split('\n')) {
    const fileHeader = FILE_HEADER.exec(text);
    if (fileHeader) {
      path = fileHeader[1];
      continue;
    }

    const hunkHeader = HUNK_HEADER.exec(text);
    if (hunkHeader) {
      line = Number(hunkHeader[1]);
      continue;
    }

    // Outside a hunk there is nothing to count. A rename or a binary file never
    // reaches a hunk header, so it contributes no entry at all.
    if (path === null || line === 0) continue;

    // `---` and `+++` are consumed above, so a leading + or - here is content.
    if (text.startsWith('-')) continue;
    if (text.startsWith('+') || text.startsWith(' ')) {
      let lines = byPath.get(path);
      if (!lines) {
        lines = new Set();
        byPath.set(path, lines);
      }
      lines.add(line);
      line++;
      continue;
    }

    // Anything else ends the hunk: the next diff --git, an index line, or the
    // "\ No newline at end of file" marker.
    line = 0;
  }

  return byPath;
}

/// Splits findings into the ones that can be published and the ones that cannot.
///
/// A line the model invented is the expected failure here, not an exceptional
/// one, so the discarded half is returned rather than thrown: the user is shown
/// what was dropped instead of being handed a silently shorter review.
export function splitByAnchor(
  findings: ReviewFinding[],
  diff: string
): { kept: ReviewFinding[]; discarded: DiscardedFinding[] } {
  const anchors = anchorableLines(diff);
  const kept: ReviewFinding[] = [];
  const discarded: DiscardedFinding[] = [];

  for (const finding of findings) {
    const lines = anchors.get(finding.path);
    if (!lines) {
      discarded.push({ ...finding, reason: `${finding.path} is not among the files this pull request changes` });
      continue;
    }
    if (!lines.has(finding.line)) {
      discarded.push({ ...finding, reason: `line ${finding.line} of ${finding.path} is not part of the changes` });
      continue;
    }
    kept.push(finding);
  }

  return { kept, discarded };
}
