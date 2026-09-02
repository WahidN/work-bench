import { describe, expect, it } from 'vitest'
import {
  diffLines,
  hunkStarts,
  missingPatchNote,
  sections,
  type PrDetailFile,
  type PrDetailView,
  type PrReviewThread,
} from './prDetailLogic'

/*
 * These cover the rules whose bugs are silent rather than loud: a miscounted line does
 * not throw, it attaches a reviewer's comment to the wrong code.
 */

describe('hunkStarts', () => {
  it('reads both starting numbers', () => {
    expect(hunkStarts('@@ -14,3 +14,4 @@')).toEqual({ old: 14, new: 14 })
    expect(hunkStarts('@@ -1,0 +1,120 @@')).toEqual({ old: 1, new: 1 })
    expect(hunkStarts('@@ -200,7 +215,9 @@')).toEqual({ old: 200, new: 215 })
  })

  it('ignores trailing context', () => {
    expect(hunkStarts('@@ -14,3 +14,4 @@ func doThing() {')).toEqual({ old: 14, new: 14 })
  })

  it('is not fooled by plus or minus signs in the trailing context', () => {
    // The reason the Swift splits on "@" before looking for signs: a signature with a
    // default argument would otherwise be read as a line number.
    expect(hunkStarts('@@ -8,2 +9,3 @@ func offset(by value: Int = -1) -> Int {')).toEqual({
      old: 8,
      new: 9,
    })
  })

  it('handles a single-line hunk where the count is omitted', () => {
    expect(hunkStarts('@@ -5 +5 @@')).toEqual({ old: 5, new: 5 })
  })
})

describe('diffLines', () => {
  it('returns nothing for an empty patch', () => {
    expect(diffLines('')).toEqual([])
  })

  it('carries both counters across a hunk header', () => {
    const lines = diffLines(['@@ -10,3 +10,4 @@', ' context', '-removed', '+added', ' tail'].join('\n'))

    expect(lines.map((line) => [line.kind, line.oldNumber, line.newNumber, line.text])).toEqual([
      ['hunkHeader', null, null, '@@ -10,3 +10,4 @@'],
      ['context', 10, 10, 'context'],
      ['deletion', 11, null, 'removed'],
      ['addition', null, 11, 'added'],
      ['context', 12, 12, 'tail'],
    ])
  })

  it('gives an addition only a new number and a deletion only an old one', () => {
    const lines = diffLines('@@ -1,1 +1,1 @@\n-gone\n+here')
    expect(lines[1]).toMatchObject({ kind: 'deletion', oldNumber: 1, newNumber: null })
    expect(lines[2]).toMatchObject({ kind: 'addition', oldNumber: null, newNumber: 1 })
  })

  it('emits no line for the no-newline marker and leaves both counters untouched', () => {
    const withMarker = diffLines('@@ -1,2 +1,2 @@\n context\n\\ No newline at end of file\n+added')
    const without = diffLines('@@ -1,2 +1,2 @@\n context\n+added')

    expect(withMarker).toHaveLength(3)
    expect(withMarker.map((line) => line.kind)).toEqual(['hunkHeader', 'context', 'addition'])
    // The marker must not shift the numbering of anything after it.
    expect(withMarker.map((line) => line.newNumber)).toEqual(without.map((line) => line.newNumber))
    expect(withMarker.map((line) => line.oldNumber)).toEqual(without.map((line) => line.oldNumber))
  })

  it('treats a line with no prefix as context, keeping its text intact', () => {
    // GitHub patches sometimes carry a bare empty line for an empty context line.
    const lines = diffLines('@@ -1,1 +1,1 @@\n')
    expect(lines[1]).toMatchObject({ kind: 'context', text: '' })
  })

  it('does not mistake +++ and --- headers for content when they appear mid-patch', () => {
    // They are still additions and deletions to this parser, exactly as in the Swift:
    // the engine hands over per-file patches, so file headers never reach it.
    const lines = diffLines('@@ -1,1 +1,1 @@\n+++ added text')
    expect(lines[1]).toMatchObject({ kind: 'addition', text: '++ added text' })
  })

  it('handles multiple hunks, resetting the counters at each header', () => {
    const lines = diffLines(
      ['@@ -1,1 +1,1 @@', ' first', '@@ -50,1 +60,1 @@', ' second'].join('\n'),
    )
    expect(lines[1]).toMatchObject({ oldNumber: 1, newNumber: 1 })
    expect(lines[3]).toMatchObject({ oldNumber: 50, newNumber: 60 })
  })
})

function file(overrides: Partial<PrDetailFile> = {}): PrDetailFile {
  return { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: null, ...overrides }
}

function thread(overrides: Partial<PrReviewThread> = {}): PrReviewThread {
  return {
    path: 'src/a.ts',
    line: 1,
    diffSide: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    comments: [{ id: 1, author: 'someone', body: 'a note', createdAt: '2026-01-01T00:00:00Z' }],
    ...overrides
  } as PrReviewThread
}

function detail(overrides: Partial<PrDetailView> = {}): PrDetailView {
  return {
    title: 'a pull request',
    url: 'https://example.invalid/1',
    state: 'OPEN',
    isDraft: false,
    reviewState: null,
    author: 'someone',
    createdAt: '2026-01-01T00:00:00Z',
    baseRefName: 'main',
    headRefName: 'feat/thing',
    commitCount: 1,
    changedFiles: 1,
    additions: 1,
    deletions: 1,
    files: [],
    threads: [],
    conversation: [],
    ...overrides,
  } as PrDetailView
}

describe('missingPatchNote', () => {
  it('names a rename with no churn as a rename', () => {
    expect(missingPatchNote(file({ status: 'renamed', additions: 0, deletions: 0 }))).toBe(
      'Renamed, with no content changes.',
    )
  })

  it('names no churn as binary or empty rather than blaming size', () => {
    expect(missingPatchNote(file({ additions: 0, deletions: 0 }))).toBe(
      'Binary or empty file, so there is no text diff.',
    )
  })

  it('blames size only when there is churn but no patch', () => {
    expect(missingPatchNote(file({ additions: 900, deletions: 20 }))).toBe(
      'GitHub did not return a diff for this file, it is too large.',
    )
  })

  it('returns null when there is a patch to render', () => {
    expect(missingPatchNote(file({ patch: '@@ -1,1 +1,1 @@\n+x' }))).toBeNull()
  })

  it('treats a renamed file that also changed as too large, not as a rename', () => {
    expect(missingPatchNote(file({ status: 'renamed', additions: 5, deletions: 0 }))).toBe(
      'GitHub did not return a diff for this file, it is too large.',
    )
  })
})

describe('sections', () => {
  const patch = '@@ -10,2 +10,2 @@\n context\n+added'

  it('anchors a RIGHT thread to the row with the matching new number', () => {
    const result = sections(
      detail({
        files: [file({ patch })],
        threads: [thread({ line: 11, diffSide: 'RIGHT' })],
      }),
    )

    const anchored = result[0].rows.filter((row) => row.threads.length > 0)
    expect(anchored).toHaveLength(1)
    expect(anchored[0].line).toMatchObject({ kind: 'addition', newNumber: 11 })
    expect(result[0].trailingThreads).toHaveLength(0)
  })

  it('never matches a LEFT thread against a new-file line number', () => {
    // The whole point: line 11 exists as a new number here, so a naive match would
    // attach this base-file comment to unrelated code.
    const result = sections(
      detail({
        files: [file({ patch })],
        threads: [thread({ line: 11, diffSide: 'LEFT' })],
      }),
    )

    expect(result[0].rows.every((row) => row.threads.length === 0)).toBe(true)
    expect(result[0].trailingThreads).toHaveLength(1)
  })

  it('keeps an outdated thread with a null line instead of dropping it', () => {
    const result = sections(
      detail({ files: [file({ patch })], threads: [thread({ line: null, isOutdated: true })] }),
    )
    expect(result[0].trailingThreads).toHaveLength(1)
  })

  it('trails a thread whose line is no longer in the diff', () => {
    const result = sections(
      detail({ files: [file({ patch })], threads: [thread({ line: 9999 })] }),
    )
    expect(result[0].trailingThreads).toHaveLength(1)
  })

  it('groups several threads on one line', () => {
    const result = sections(
      detail({
        files: [file({ patch })],
        threads: [
          thread({ line: 11, comments: [{ id: 1, author: 'a', body: 'x', createdAt: 'z' }] }),
          thread({ line: 11, comments: [{ id: 2, author: 'b', body: 'y', createdAt: 'z' }] }),
        ],
      }),
    )
    const anchored = result[0].rows.filter((row) => row.threads.length > 0)
    expect(anchored).toHaveLength(1)
    expect(anchored[0].threads).toHaveLength(2)
  })

  it('does not leak a thread from one file into another', () => {
    const result = sections(
      detail({
        files: [file({ path: 'src/a.ts', patch }), file({ path: 'src/b.ts', patch })],
        threads: [thread({ path: 'src/b.ts', line: 11 })],
      }),
    )
    expect(result[0].rows.every((row) => row.threads.length === 0)).toBe(true)
    expect(result[1].rows.filter((row) => row.threads.length > 0)).toHaveLength(1)
  })

  it('carries the note and churn for a file with no patch', () => {
    const result = sections(detail({ files: [file({ additions: 0, deletions: 0 })] }))
    expect(result[0].missingPatchNote).toBe('Binary or empty file, so there is no text diff.')
    expect(result[0].churn).toBe('+0 -0')
    expect(result[0].rows).toHaveLength(0)
  })
})
