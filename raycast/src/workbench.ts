import { getPreferenceValues } from '@raycast/api'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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

type ExecFailure = Error & { stderr?: string }

function folder(): string {
  const chosen = getPreferenceValues<Preferences>().workbenchFolder || join(homedir(), 'Documents/Projecten/workbench')
  if (!existsSync(join(chosen, 'src', 'cli.ts'))) {
    throw new Error(`No Workbench in ${chosen}. Pick it in the 'Workbench folder' preference.`)
  }
  return chosen
}

// Raycast starts an extension without PATH and USER: bun, gh and claude are not found, and claude misses its login.
function environment(): NodeJS.ProcessEnv {
  const home = homedir()
  const PATH = ['/opt/homebrew/bin', `${home}/.bun/bin`, `${home}/.local/bin`, process.env.PATH ?? '/usr/bin:/bin']
  return { ...process.env, PATH: PATH.join(':'), USER: process.env.USER ?? userInfo().username }
}

export async function listPrs(): Promise<Pr[]> {
  try {
    const { stdout } = await run('bun', ['src/cli.ts', 'prs'], { cwd: folder(), env: environment() })
    return JSON.parse(stdout)
  } catch (failure) {
    throw new Error((failure as ExecFailure).stderr?.trim() || (failure as Error).message)
  }
}

// When Workbench is not running, this launch becomes the window, so it must outlive Raycast.
export function openInWorkbench(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const launch = spawn('bun', ['src/app.tsx', '--pr', url], {
      cwd: folder(),
      env: environment(),
      detached: true,
      stdio: 'ignore',
    })
    launch.once('error', reject)
    launch.once('spawn', () => {
      launch.unref()
      resolve()
    })
  })
}
