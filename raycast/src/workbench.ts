import { getPreferenceValues } from '@raycast/api'
import { execFile, spawn } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type Pr = {
  url: string
  number: number
  title: string
  repo: string
  author: string
  reasons: ('assigned' | 'review')[]
  commented?: boolean
}

export type Remark = { path: string; line: number; body: string; inDiff: boolean; posted?: string }

export type Review =
  | { url: string; state: 'running'; pid: number }
  | { url: string; state: 'done'; commit: string; remarks: Remark[] }
  | { url: string; state: 'failed'; error: string }

type ExecFailure = Error & { stderr?: string }

function folder(): string {
  return getPreferenceValues<Preferences>().workbenchFolder || join(homedir(), 'Documents/Projecten/workbench')
}

// Raycast starts an extension without PATH and USER: bun, gh and claude are not found, and claude misses its login.
function environment(): NodeJS.ProcessEnv {
  const home = homedir()
  const PATH = ['/opt/homebrew/bin', `${home}/.bun/bin`, `${home}/.local/bin`, process.env.PATH ?? '/usr/bin:/bin']
  return { ...process.env, PATH: PATH.join(':'), USER: process.env.USER ?? userInfo().username }
}

async function ask<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await run('bun', ['src/cli.ts', ...args], { cwd: folder(), env: environment() })
    return JSON.parse(stdout)
  } catch (failure) {
    throw new Error((failure as ExecFailure).stderr?.trim() || (failure as Error).message)
  }
}

export const listPrs = () => ask<Pr[]>(['prs'])

export const listReviews = () => ask<Review[]>(['reviews'])

export const postRemark = (url: string, commit: string, index: number) =>
  ask<{ id: number; url: string }>(['post', url, commit, String(index)])

// The launch must outlive Raycast: it becomes the Workbench window, or a review that takes minutes.
function launch(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', args, {
      cwd: folder(),
      env: environment(),
      detached: true,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export const openInWorkbench = (url: string) => launch(['src/app.tsx', '--pr', url])

export const startReview = (url: string) => launch(['src/cli.ts', 'review', url])
