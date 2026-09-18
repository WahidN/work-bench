import { describe, expect, it } from 'vitest'
import {
  agentsForPr,
  authorLabel,
  diffLines,
  hunkStarts,
  missingPatchNote,
  offersConflictResolve,
  reviewedLine,
  sections,
  showsSentEcho,
  type PrDetailFile,
  type PrDetailView,
  type PrReviewThread,
} from './prDetailLogic'
import type { Pr, RunningAgent } from './queries'

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

/* ------------------------------------------------- The agent on this page */

const NOW = new Date('2026-09-18T12:00:00Z')

const pr = (over: Partial<Pr> = {}): Pr =>
  ({
    id: 7, ticketId: null, projectId: 1, branch: 'feat/x', number: 77, url: 'u',
    status: 'open', lastReviewScore: null, pinned: false, title: 'A pull request',
    reviewState: null, mergeable: null, isDraft: false, githubUpdatedAt: null,
    authoredByMe: true, assignedToMe: false, reviewRequestedByMe: false,
    messageCount: 0, reviewedAt: null, createdAt: NOW.toISOString(), ...over,
  }) as Pr

const agent = (over: Partial<RunningAgent> = {}): RunningAgent => ({
  key: 'job-1', activity: 'review', targetType: 'pr', targetId: 7,
  title: 'A pull request', waiting: false, startedAt: NOW.toISOString(), ...over,
})

describe('reviewedLine', () => {
  it('says a pull request has not been reviewed', () => {
    expect(reviewedLine(pr(), NOW)).toBe('Not reviewed yet')
  })

  it('says when it was reviewed', () => {
    const line = reviewedLine(pr({ reviewedAt: '2026-09-18T10:00:00Z' }), NOW)
    expect(line).toContain('Reviewed')
    expect(line).toContain('2h ago')
  })

  // The two answer different questions. GitHub's decision is whether a person approved it;
  // this is whether Workbench has read the diff.
  it('does not read GitHub approval as a Workbench review', () => {
    expect(reviewedLine(pr({ reviewState: 'approved' }), NOW)).toBe('Not reviewed yet')
  })

  it('survives a timestamp it cannot parse', () => {
    expect(reviewedLine(pr({ reviewedAt: 'not a date' }), NOW)).toBe('Reviewed')
  })
})

describe('agentsForPr', () => {
  it('keeps the agents on this pull request', () => {
    expect(agentsForPr([agent(), agent({ key: 'job-2', activity: 'conflicts' })], 7)).toHaveLength(2)
  })

  it('drops an agent on another pull request', () => {
    expect(agentsForPr([agent({ targetId: 8 })], 7)).toEqual([])
  })

  // Ticket ids and pull request ids are separate sequences, so a ticket can carry the
  // same number as the open pull request. Matching on the id alone would list it.
  it('drops an agent on a ticket that shares the id', () => {
    expect(agentsForPr([agent({ targetType: 'ticket', targetId: 7 })], 7)).toEqual([])
  })

  it('reads an empty list as nothing running', () => {
    expect(agentsForPr([], 7)).toEqual([])
  })
})

describe('offersConflictResolve', () => {
  it('offers on a conflicting pull request', () => {
    expect(offersConflictResolve(pr({ mergeable: 'CONFLICTING' }))).toBe(true)
  })

  it('does not offer on a mergeable one', () => {
    expect(offersConflictResolve(pr({ mergeable: 'MERGEABLE' }))).toBe(false)
  })

  // GitHub computes this lazily. Offering the action on an answer it has not worked out
  // is offering it on a premise nothing has checked.
  it('does not offer while GitHub has not worked it out', () => {
    expect(offersConflictResolve(pr({ mergeable: 'UNKNOWN' }))).toBe(false)
    expect(offersConflictResolve(pr({ mergeable: null }))).toBe(false)
  })

  // Resolving force-pushes the branch, so the engine refuses it on anyone else's work
  // and the button could only ever produce that refusal. Merge follows the same rule.
  it('does not offer on a pull request someone else wrote', () => {
    expect(offersConflictResolve(pr({ mergeable: 'CONFLICTING', authoredByMe: false }))).toBe(false)
  })
})

describe('showsSentEcho', () => {
  it('shows nothing when nothing was sent', () => {
    expect(showsSentEcho(null, 4)).toBe(false)
  })

  it('shows the echo while the thread is still the length it was', () => {
    expect(showsSentEcho({ text: 'fix the merge conflict', countAtSend: 4 }, 4)).toBe(true)
  })

  it('drops the echo once the thread comes back longer', () => {
    expect(showsSentEcho({ text: 'fix the merge conflict', countAtSend: 4 }, 5)).toBe(false)
  })

  // A pull request the poller rewrote mid-send can come back shorter. Showing the echo is
  // still the honest answer: the message is not in what came back.
  it('keeps the echo when the thread comes back shorter', () => {
    expect(showsSentEcho({ text: 'a', countAtSend: 4 }, 2)).toBe(true)
  })
})

describe('authorLabel', () => {
  it('names both sides of the thread', () => {
    expect(authorLabel('user')).toBe('YOU')
    expect(authorLabel('assistant')).toBe('AGENT')
  })
})
