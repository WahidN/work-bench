import { execFile } from 'node:child_process'
import { access, mkdtemp, readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { Pr } from './github'
import { failedRunOutput, readAnswer, type Finding } from './review'

const run = promisify(execFile)

export type Fixed = { state: 'fixed'; commit: string; reply: string } | { state: 'nothing'; reason: string }

type ExecFailure = Error & { stderr?: string }

const PROJECTS = join(homedir(), 'Documents', 'Projecten')
const CLONE_DEPTH = 4
const SKIPPED = new Set(['node_modules', 'vendor', 'dist', 'build'])
const TIMEOUT_MS = 15 * 60 * 1000

const SCHEMA = {
  type: 'object',
  properties: { message: { type: 'string' }, reply: { type: 'string' } },
  required: ['message', 'reply'],
}

async function git(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], { timeout: TIMEOUT_MS })
    return stdout.trim()
  } catch (failure) {
    throw new Error((failure as ExecFailure).stderr?.trim() || (failure as Error).message)
  }
}

// `git@github.com:owner/repo.git` and `https://github.com/owner/repo` both name `owner/repo`.
export function repoOf(remote: string): string | undefined {
  return remote.trim().match(/github\.com[:/](.+?)(?:\.git)?\/?$/)?.[1]
}

// Clones often sit in a group folder, or even inside another clone, so this looks a few levels deep.
// Level by level, so the clone nearest to the root wins.
export async function findClone(repo: string, root = PROJECTS): Promise<string> {
  let level = [root]
  for (let depth = 0; depth < CLONE_DEPTH && level.length > 0; depth++) {
    const next: string[] = []
    for (const dir of level) {
      const entries = await readdir(dir, { withFileTypes: true }).catch((failure) => {
        if (dir === root) throw failure
        return []
      })
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name)) next.push(join(dir, entry.name))
      }
    }
    next.sort()
    for (const dir of next) {
      if (!(await access(join(dir, '.git')).then(() => true, () => false))) continue
      const remote = await git(dir, ['config', '--get', 'remote.origin.url']).catch(() => '')
      if (repoOf(remote)?.toLowerCase() === repo.toLowerCase()) return dir
    }
    level = next
  }
  throw new Error(`No clone of ${repo} within ${CLONE_DEPTH} levels of ~/Documents/Projecten`)
}

export function fixPrompt(pr: Pr, finding: Finding, context = ''): string {
  const extra = context.trim()
    ? `\nExtra context from the author of the pull request:\n\n${context.trim()}\n\nDo not quote or mention this context in the reply.\n`
    : ''
  return `You are fixing one review remark on the pull request titled "${pr.title}".

The remark is about \`${finding.path}\`, around line ${finding.line}:

${finding.body}
${extra}
Make the smallest change in the working tree that answers this remark. Read the
current file first, because the line number may have moved. Change nothing else.

Then return:
- message: one commit subject in English, Conventional Commits style, lower case
  after the colon, 4 to 6 words, no period. For example: fix(search): skip empty queries
- reply: one or two short sentences in Dutch that say how the change answers the
  remark, for whoever reads the remark on GitHub. Put identifiers between
  backticks. No greeting, no em dash, and do not start with "Gefixt".

If the remark needs no change, change no file and say why in reply.`
}

export function fixArgs(prompt: string): string[] {
  return [
    '-p',
    prompt,
    '--output-format=json',
    `--json-schema=${JSON.stringify(SCHEMA)}`,
    '--tools',
    'Read,Edit,Write,Glob,Grep',
    '--permission-mode',
    'acceptEdits',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ]
}

export function readFix(stdout: string): { message: string; reply: string } {
  const answer = readAnswer(stdout)
  if (typeof answer?.message !== 'string' || !answer.message.trim()) throw new Error('Claude gave no commit message')
  return { message: answer.message.trim(), reply: String(answer.reply ?? '').trim() }
}

export async function fixRemark(pr: Pr, finding: Finding, context = '', root = PROJECTS): Promise<Fixed> {
  const { stdout } = await run('gh', ['pr', 'view', pr.url, '--json=headRefName,isCrossRepository'])
  const { headRefName: branch, isCrossRepository } = JSON.parse(stdout)
  if (isCrossRepository) throw new Error('This pull request comes from a fork, so its branch is not in origin')

  const clone = await findClone(pr.repo, root)
  // A remote-tracking ref, not FETCH_HEAD, so two fixes in one clone do not overwrite each other.
  await git(clone, ['fetch', 'origin', branch])
  const tip = await git(clone, ['rev-parse', `refs/remotes/origin/${branch}`])
  const worktree = await mkdtemp(join(tmpdir(), 'workbench-fix-'))
  // Detached, because the clone may have this branch checked out, and git allows only one checkout per branch.
  await git(clone, ['worktree', 'add', '--detach', worktree, tip])

  try {
    const claude = run('claude', fixArgs(fixPrompt(pr, finding, context)), { cwd: worktree, timeout: TIMEOUT_MS })
    claude.child.stdin?.end()
    const { message, reply } = readFix(await claude.then((done) => done.stdout, failedRunOutput))

    if (!(await git(worktree, ['status', '--porcelain']))) return { state: 'nothing', reason: reply }

    await git(worktree, ['add', '-A'])
    await git(worktree, ['commit', '--no-verify', '-m', message])
    // The lease holds the push to the fetched tip: a fast-forward when nothing changed, and refused when
    // the branch moved on or was deleted, so a merged pull request does not get its branch back.
    const lease = `--force-with-lease=refs/heads/${branch}:${tip}`
    await git(worktree, ['push', '--no-verify', lease, 'origin', `HEAD:refs/heads/${branch}`]).catch((failure: Error) => {
      if (/\[rejected\]|fetch first|non-fast-forward|stale info/.test(failure.message)) {
        throw new Error('The branch moved on or was deleted while Claude worked. Nothing was pushed.')
      }
      throw failure
    })
    return { state: 'fixed', commit: await git(worktree, ['rev-parse', '--short', 'HEAD']), reply }
  } finally {
    await git(clone, ['worktree', 'remove', '--force', worktree]).catch(() => {})
  }
}
