/*
 * Port of app/Workbench/Views/PrDetailLogic.swift.
 *
 * Pure, and deliberately ported before anything renders it: the rules here are the kind
 * whose bugs are silent. A miscounted line does not throw, it attaches a reviewer's
 * comment to the wrong code.
 */

import type { PrDetailFile, PrDetailView, PrReviewThread } from '../../engine/src/types.ts'

export type { PrDetailFile, PrDetailView, PrReviewThread }

export type DiffLineKind = 'hunkHeader' | 'context' | 'addition' | 'deletion'

export type DiffLine = {
  id: number
  kind: DiffLineKind
  oldNumber: number | null
  newNumber: number | null
  text: string
}

export type DiffRow = {
  id: number
  line: DiffLine
  /** Threads anchored to this line, rendered directly under it. */
  threads: PrReviewThread[]
}

export type PrFileSection = {
  id: string
  file: PrDetailFile
  rows: DiffRow[]
  /**
   * Threads whose line no longer exists in the diff. Shown at the end of the file rather
   * than dropped, so an outdated comment is never lost.
   */
  trailingThreads: PrReviewThread[]
  missingPatchNote: string | null
  churn: string
}

/**
 * Reads "@@ -14,3 +14,4 @@ trailing context" into its two starting numbers.
 *
 * Splitting on "@" first is what keeps trailing context out of it: that context can
 * itself contain "+" or "-" tokens, and a function signature with a default argument
 * would otherwise be read as a line number.
 */
export function hunkStarts(header: string): { old: number; new: number } {
  // `.filter(part => part !== '')` is doing real work, and leaving it out is a silent
  // catastrophe rather than a visible bug.
  //
  // The Swift is `header.split(separator: "@").first`, and Swift's `split` omits empty
  // subsequences by default. JavaScript's does not: `'@@ -14,3 +14,4 @@'.split('@')` is
  // `['', '', ' -14,3 +14,4 ', '', '']`, so taking `[0]` yields an empty string, every
  // hunk falls back to starting at line 1, and every review thread then anchors to the
  // wrong line. Caught by the unit test before any of it was rendered.
  const firstSegment = header.split('@').find((part) => part !== '') ?? ''
  const numbers = firstSegment
    .split(' ')
    .filter((part) => part.startsWith('-') || part.startsWith('+'))
    .map((part) => Number.parseInt(part.slice(1).split(',')[0] ?? '', 10))
    .filter((value) => Number.isFinite(value))

  return { old: numbers[0] ?? 1, new: numbers.length > 1 ? numbers[1] : 1 }
}

/**
 * Walks a unified patch, carrying the old and new line counters forward from each hunk
 * header, so a comment anchored to a new-file line can be found.
 */
export function diffLines(patch: string): DiffLine[] {
  if (patch === '') return []

  const result: DiffLine[] = []
  let oldNumber = 0
  let newNumber = 0

  for (const raw of patch.split('\n')) {
    const id = result.length

    if (raw.startsWith('@@')) {
      const starts = hunkStarts(raw)
      oldNumber = starts.old
      newNumber = starts.new
      result.push({ id, kind: 'hunkHeader', oldNumber: null, newNumber: null, text: raw })
    } else if (raw.startsWith('+')) {
      result.push({ id, kind: 'addition', oldNumber: null, newNumber, text: raw.slice(1) })
      newNumber += 1
    } else if (raw.startsWith('-')) {
      result.push({ id, kind: 'deletion', oldNumber, newNumber: null, text: raw.slice(1) })
      oldNumber += 1
    } else if (raw.startsWith('\\')) {
      // Git's "no newline at end of file" marker. Not a real diff line: emit nothing and
      // leave both counters untouched.
      continue
    } else {
      const text = raw.startsWith(' ') ? raw.slice(1) : raw
      result.push({ id, kind: 'context', oldNumber, newNumber, text })
      oldNumber += 1
      newNumber += 1
    }
  }

  return result
}

/**
 * GitHub omits the patch for three different reasons and they need three different words.
 * A rename with no churn and a binary file both look like "no diff" in the payload, so
 * blaming size for either is simply wrong. Null means there is a diff to render.
 */
export function missingPatchNote(file: PrDetailFile): string | null {
  if (file.patch !== null && file.patch !== undefined) return null

  const hasChurn = file.additions > 0 || file.deletions > 0
  if (file.status === 'renamed' && !hasChurn) return 'Renamed, with no content changes.'
  // An empty file reaches here too: the payload cannot tell it from binary.
  if (!hasChurn) return 'Binary or empty file, so there is no text diff.'
  return 'GitHub did not return a diff for this file, it is too large.'
}

export function churn(file: PrDetailFile): string {
  return `+${file.additions} -${file.deletions}`
}

/** A thread's identity, matching the Swift `PrReviewThread.id`. */
export function threadId(thread: PrReviewThread): string {
  return `${thread.path}:${thread.line ?? -1}:${thread.comments[0]?.id ?? 0}`
}

export function sections(detail: PrDetailView): PrFileSection[] {
  return detail.files.map((file) => {
    const lines = diffLines(file.patch ?? '')
    const fileThreads = detail.threads.filter((thread) => thread.path === file.path)

    const byLineId = new Map<number, PrReviewThread[]>()
    const trailing: PrReviewThread[] = []

    for (const thread of fileThreads) {
      // A LEFT thread's line counts against the base file, so matching it against a
      // new-file number would attach a reviewer's comment to unrelated code. Showing it
      // at the end of the file is wrong-ish; showing it against the wrong line is just
      // wrong.
      const match =
        thread.diffSide === 'RIGHT' && thread.line !== null
          ? lines.find((line) => line.newNumber === thread.line)
          : undefined

      if (match) {
        const existing = byLineId.get(match.id)
        if (existing) existing.push(thread)
        else byLineId.set(match.id, [thread])
      } else {
        trailing.push(thread)
      }
    }

    return {
      id: file.path,
      file,
      rows: lines.map((line) => ({ id: line.id, line, threads: byLineId.get(line.id) ?? [] })),
      trailingThreads: trailing,
      missingPatchNote: missingPatchNote(file),
      churn: churn(file),
    }
  })
}

export type PrFactsParts = {
  branches: string
  commits: string
  files: string
  churn: string
}

export function factsParts(detail: PrDetailView): PrFactsParts {
  return {
    branches: `${detail.headRefName} → ${detail.baseRefName}`,
    commits: `${detail.commitCount} commit${detail.commitCount === 1 ? '' : 's'}`,
    files: `${detail.changedFiles} file${detail.changedFiles === 1 ? '' : 's'} changed`,
    churn: `+${detail.additions} -${detail.deletions}`,
  }
}

export function openedLine(detail: PrDetailView, authoredByMe: boolean): string {
  const who = authoredByMe ? 'you' : detail.author
  const date = new Date(detail.createdAt)
  if (Number.isNaN(date.getTime())) return `opened by ${who}`
  // "d MMM" with the POSIX locale, matching the Swift formatter.
  const formatted = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
  return `opened ${formatted} by ${who}`
}

export function tabCounts(detail: PrDetailView): { files: number; conversation: number } {
  return { files: detail.files.length, conversation: detail.conversation.length }
}
