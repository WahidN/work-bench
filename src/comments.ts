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
}

export type Thread = {
  id: number
  url: string
  author: string
  path: string
  line: number
  outdated: boolean
  body: string
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
