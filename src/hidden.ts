import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const HIDDEN_FILE = join(homedir(), '.config', 'workbench', 'hidden-repos.json')

export async function loadHiddenRepos(file = HIDDEN_FILE): Promise<string[]> {
  const text = await readFile(file, 'utf8').catch((failure) => {
    if (failure.code === 'ENOENT') return '[]'
    throw failure
  })
  return JSON.parse(text)
}

export async function saveHiddenRepos(repos: string[], file = HIDDEN_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(repos, null, 2)}\n`)
}
