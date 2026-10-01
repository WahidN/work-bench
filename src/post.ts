import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Pr } from './github'
import type { Finding } from './review'

const run = promisify(execFile)

type ExecFailure = Error & { stderr?: string }

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
    '.html_url',
  ]
}

export async function postRemark(pr: Pr, commit: string, finding: Finding): Promise<string> {
  try {
    const { stdout } = await run('gh', postArgs(pr, commit, finding))
    return stdout.trim()
  } catch (failure) {
    // The command line holds the whole remark, so gh's own message says more.
    throw new Error((failure as ExecFailure).stderr?.trim() || (failure as Error).message)
  }
}
