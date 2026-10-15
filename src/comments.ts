import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Pr } from './github'

const run = promisify(execFile)

export type RawComment = {
  id: number
  user: { login: string }
  body: string
  path: string
  line: number | null
  original_line: number | null
  in_reply_to_id?: number | null
  html_url: string
  diff_hunk: string
  original_start_line?: number | null
  start_side?: Side | null
}

type Side = 'LEFT' | 'RIGHT'

// GitHub shows this many lines above a comment on one line.
const LINES_ABOVE = 4

type HunkLine = { text: string; old: number; new: number }

// `diff_hunk` runs from the start of its hunk to the commented line, so it is cut to what GitHub shows.
export function cutHunk(hunk: string, start: { line: number; side: Side } | null): string {
  const [header, ...body] = hunk.split('\n')
  const numbers = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
  if (!numbers) return hunk

  let old = Number(numbers[1])
  let next = Number(numbers[2])
  const lines: HunkLine[] = body
    .filter((text) => text !== '' && !text.startsWith('\\'))
    .map((text) => {
      const line = { text, old, new: next }
      if (!text.startsWith('+')) old += 1
      if (!text.startsWith('-')) next += 1
      return line
    })

  const isStart = ({ text, old, new: next }: HunkLine) =>
    start?.side === 'LEFT' ? !text.startsWith('+') && old === start.line : !text.startsWith('-') && next === start?.line
  const from = start ? lines.findIndex(isStart) : -1
  const kept = lines.slice(from >= 0 ? from : Math.max(0, lines.length - LINES_ABOVE))
  if (kept.length === 0) return ''

  const oldCount = kept.filter((line) => !line.text.startsWith('+')).length
  const newCount = kept.filter((line) => !line.text.startsWith('-')).length
  return [`@@ -${kept[0].old},${oldCount} +${kept[0].new},${newCount} @@`, ...kept.map((line) => line.text)].join('\n')
}

function toPatch(path: string, hunk: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, hunk].join('\n')
}

function codeOf(comment: RawComment): string {
  const start = comment.original_start_line ? { line: comment.original_start_line, side: comment.start_side ?? 'RIGHT' } : null
  const hunk = comment.diff_hunk ? cutHunk(comment.diff_hunk, start) : ''
  return hunk ? toPatch(comment.path, hunk) : ''
}

export type Thread = {
  id: number
  url: string
  author: string
  path: string
  line: number
  outdated: boolean
  body: string
  diff: string
  replies: { author: string; body: string }[]
}

export function toThreads(comments: RawComment[]): Thread[] {
  const byId = [...comments].sort((a, b) => a.id - b.id)
  const threads = new Map<number, Thread>()
  for (const comment of byId) {
    if (comment.in_reply_to_id) continue
    threads.set(comment.id, {
      id: comment.id,
      url: comment.html_url,
      author: comment.user.login,
      path: comment.path,
      // GitHub drops `line` once the code under the comment changed, and keeps where it was.
      line: comment.line ?? comment.original_line ?? 0,
      outdated: comment.line === null,
      body: comment.body,
      diff: codeOf(comment),
      replies: [],
    })
  }
  for (const comment of byId) {
    if (!comment.in_reply_to_id) continue
    threads.get(comment.in_reply_to_id)?.replies.push({ author: comment.user.login, body: comment.body })
  }
  return [...threads.values()]
}

export async function loadComments(pr: Pr): Promise<Thread[]> {
  // `--paginate` prints one JSON array per page, so `.[]` turns them into one comment per line.
  const { stdout } = await run('gh', ['api', '--paginate', `repos/${pr.repo}/pulls/${pr.number}/comments`, '--jq', '.[]'], {
    maxBuffer: 32 * 1024 * 1024,
  })
  return toThreads(stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)))
}
