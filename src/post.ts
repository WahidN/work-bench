import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Pr } from './github'
import type { Finding } from './review'

const run = promisify(execFile)

type ExecFailure = Error & { stderr?: string }

export type Posted = { id: number; url: string }

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await run('gh', args)
    return stdout.trim()
  } catch (failure) {
    // The command line holds the whole text, so gh's own message says more.
    throw new Error((failure as ExecFailure).stderr?.trim() || (failure as Error).message)
  }
}

export function postArgs(pr: Pr, commit: string, finding: Finding): string[] {
  return [
    'api',
    `repos/${pr.repo}/pulls/${pr.number}/comments`,
    '-f',
    `body=${finding.body}`,
    '-f',
    `commit_id=${commit}`,
    '-f',
    `path=${finding.path}`,
    '-F',
    `line=${finding.line}`,
    '-f',
    'side=RIGHT',
    '--jq',
    '{id, url: .html_url}',
  ]
}

export async function postRemark(pr: Pr, commit: string, finding: Finding): Promise<Posted> {
  return JSON.parse(await gh(postArgs(pr, commit, finding)))
}

export function replyArgs(pr: Pr, commentId: number, body: string): string[] {
  return ['api', `repos/${pr.repo}/pulls/${pr.number}/comments/${commentId}/replies`, '-f', `body=${body}`, '--jq', '.html_url']
}

export async function replyTo(pr: Pr, commentId: number, body: string): Promise<string> {
  return gh(replyArgs(pr, commentId, body))
}
