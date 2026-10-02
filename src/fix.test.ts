import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findClone, fixArgs, fixPrompt, fixRemark, readFix, repoOf } from './fix'
import type { Pr } from './github'

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

function repo(root: string, name: string, remote?: string) {
  const dir = join(root, name)
  mkdirSync(dir)
  git(dir, 'init', '-q')
  if (remote) git(dir, 'remote', 'add', 'origin', remote)
}

describe('repoOf', () => {
  it('reads the repo from an ssh and an https remote', () => {
    expect(repoOf('git@github.com:LinkuNijmegen/cang-frontend.git\n')).toBe('LinkuNijmegen/cang-frontend')
    expect(repoOf('https://github.com/WahidN/work-bench.git')).toBe('WahidN/work-bench')
    expect(repoOf('https://github.com/WahidN/rts-threejs')).toBe('WahidN/rts-threejs')
  })

  it('ignores a remote that is not on GitHub', () => {
    expect(repoOf('buddy@app.buddy.works:linku-1/performis')).toBeUndefined()
  })
})

describe('findClone', () => {
  it('takes the first folder whose origin is the repo, whatever the folder is called', async () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-'))
    repo(root, 'aaa-no-remote')
    repo(root, 'workbench', 'https://github.com/WahidN/work-bench.git')
    repo(root, 'zzz-second', 'git@github.com:WahidN/work-bench.git')
    mkdirSync(join(root, 'not-a-repo'))

    expect(await findClone('wahidn/work-bench', root)).toBe(join(root, 'workbench'))
  })

  it('says which repo it could not find', async () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-'))

    await expect(findClone('acme/api', root)).rejects.toThrow('No clone of acme/api')
  })
})

describe('fixArgs', () => {
  it('gives claude file tools only, so it cannot run, commit or push', () => {
    const args = fixArgs('Fix this')

    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Edit,Write,Glob,Grep')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })
})

describe('readFix', () => {
  const answer = (output: object) =>
    JSON.stringify({ type: 'result', is_error: false, structured_output: output })

  it('reads the commit message and the reply', () => {
    const fix = { message: 'fix(math): stop the loop at the last value', reply: 'De loop stopt nu bij `i < values.length`.' }

    expect(readFix(answer(fix))).toEqual(fix)
  })

  it('fails when the answer has no commit message', () => {
    expect(() => readFix(answer({ reply: 'Klaar.' }))).toThrow('no commit message')
  })
})

const PR: Pr = {
  url: 'https://github.com/acme/api/pull/7',
  number: 7,
  title: 'Add rate limits',
  repo: 'acme/api',
  author: 'sam',
  updatedAt: '2026-10-01T10:00:00Z',
  reasons: ['assigned'],
}
const FINDING = { path: 'a.ts', line: 1, body: 'Deze regel mist de fix.' }

const FAKE_CLAUDE = `#!/bin/sh
cat > /dev/null
printf '%s' "$2" > "$FAKE_ORIGIN.prompt"
if [ "$FAKE_CLAUDE" != nothing ]; then echo "fixed()" >> a.ts; fi
if [ "$FAKE_CLAUDE" = delete ]; then git --git-dir="$FAKE_ORIGIN" update-ref -d refs/heads/feat/x; fi
if [ "$FAKE_CLAUDE" = move ]; then
  export GIT_AUTHOR_NAME=colleague GIT_AUTHOR_EMAIL=c@x GIT_COMMITTER_NAME=colleague GIT_COMMITTER_EMAIL=c@x
  tree=$(git --git-dir="$FAKE_ORIGIN" rev-parse 'feat/x^{tree}')
  moved=$(git --git-dir="$FAKE_ORIGIN" commit-tree "$tree" -p feat/x -m 'push from a colleague')
  git --git-dir="$FAKE_ORIGIN" update-ref refs/heads/feat/x "$moved"
fi
printf '%s' '{"type":"result","is_error":false,"structured_output":{"message":"fix(api): add the fix","reply":"De fix staat erin."}}'
`
const FAKE_GH = `#!/bin/sh
printf '{"headRefName":"feat/x","isCrossRepository":%s}' "\${FAKE_FORK:-false}"
`

describe('fixRemark', () => {
  const saved = { ...process.env }
  let projects: string
  let origin: string
  let clone: string

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'fix-'))
    origin = join(root, 'origin.git')
    projects = join(root, 'projects')
    clone = join(projects, 'api')
    mkdirSync(projects)
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['clone', '-q', origin, clone])

    // The clone names a GitHub remote, and git quietly sends it to the local origin instead.
    git(clone, 'remote', 'set-url', 'origin', 'https://github.com/acme/api.git')
    git(clone, 'config', `url.${origin}.insteadOf`, 'https://github.com/acme/api.git')
    git(clone, 'config', 'user.name', 'tester')
    git(clone, 'config', 'user.email', 'tester@example.com')
    git(clone, 'checkout', '-q', '-b', 'feat/x')
    writeFileSync(join(clone, 'a.ts'), 'start()\n')
    git(clone, 'add', '-A')
    git(clone, 'commit', '-q', '-m', 'start')
    git(clone, 'push', '-q', 'origin', 'feat/x')

    const hooks = join(root, 'hooks')
    mkdirSync(hooks)
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(hooks, 'pre-commit'), 0o755)
    git(clone, 'config', 'core.hooksPath', hooks)
    writeFileSync(join(clone, 'a.ts'), 'start()\nlocal change\n')

    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
    writeFileSync(join(bin, 'gh'), FAKE_GH)
    chmodSync(join(bin, 'claude'), 0o755)
    chmodSync(join(bin, 'gh'), 0o755)
    process.env.PATH = `${bin}:${saved.PATH}`
    process.env.FAKE_ORIGIN = origin
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  const worktrees = () => git(clone, 'worktree', 'list').split('\n').length

  it('pushes the fix past a failing hook and leaves your working copy alone', async () => {
    process.env.FAKE_CLAUDE = 'edit'

    const fixed = await fixRemark(PR, FINDING, '', projects)

    expect(fixed).toEqual({
      state: 'fixed',
      commit: git(origin, 'rev-parse', '--short', 'feat/x'),
      reply: 'De fix staat erin.',
    })
    expect(git(origin, 'log', '-1', '--format=%s', 'feat/x')).toBe('fix(api): add the fix')
    expect(git(origin, 'show', 'feat/x:a.ts')).toBe('start()\nfixed()')
    expect(readFileSync(join(clone, 'a.ts'), 'utf8')).toBe('start()\nlocal change\n')
    expect(git(clone, 'branch', '--show-current')).toBe('feat/x')
    expect(worktrees()).toBe(1)
  })

  it('pushes nothing when Claude changes nothing', async () => {
    process.env.FAKE_CLAUDE = 'nothing'
    const before = git(origin, 'rev-parse', 'feat/x')

    expect(await fixRemark(PR, FINDING, '', projects)).toEqual({ state: 'nothing', reason: 'De fix staat erin.' })
    expect(git(origin, 'rev-parse', 'feat/x')).toBe(before)
    expect(worktrees()).toBe(1)
  })

  it('refuses to push over a branch that moved on while Claude worked', async () => {
    process.env.FAKE_CLAUDE = 'move'

    await expect(fixRemark(PR, FINDING, '', projects)).rejects.toThrow('The branch moved on')
    expect(git(origin, 'log', '-1', '--format=%s', 'feat/x')).toBe('push from a colleague')
    expect(worktrees()).toBe(1)
  })

  it('does not bring back a branch that was deleted while Claude worked', async () => {
    process.env.FAKE_CLAUDE = 'delete'

    await expect(fixRemark(PR, FINDING, '', projects)).rejects.toThrow('moved on or was deleted')
    expect(git(origin, 'branch', '--list', 'feat/x')).toBe('')
    expect(worktrees()).toBe(1)
  })

  it('hands your context to Claude next to the remark', async () => {
    process.env.FAKE_CLAUDE = 'edit'

    await fixRemark(PR, FINDING, 'Gebruik de bestaande `limit` helper.', projects)

    const prompt = readFileSync(`${origin}.prompt`, 'utf8')
    expect(prompt).toContain(FINDING.body)
    expect(prompt).toContain('Gebruik de bestaande `limit` helper.')
  })

  it('refuses a pull request from a fork', async () => {
    process.env.FAKE_FORK = 'true'

    await expect(fixRemark(PR, FINDING, '', projects)).rejects.toThrow('fork')
  })
})

describe('fixPrompt', () => {
  it('adds your context after the remark', () => {
    const prompt = fixPrompt(PR, FINDING, 'Gebruik `reduce`.')

    expect(prompt).toContain('Extra context from the author of the pull request:\n\nGebruik `reduce`.')
    expect(prompt.indexOf('Gebruik `reduce`.')).toBeGreaterThan(prompt.indexOf(FINDING.body))
  })

  it('leaves the context out when there is none', () => {
    expect(fixPrompt(PR, FINDING, '  ')).not.toContain('Extra context')
  })
})
