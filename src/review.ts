import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import type { Pr } from './github'

const run = promisify(execFile)

export type Finding = { path: string; line: number; body: string }

export type Remark = Finding & { inDiff: boolean }

export type Reviewed = { commit: string; remarks: Remark[] }

type ExecFailure = Error & { killed?: boolean; stdout?: string; stderr?: string }

const TIMEOUT_MS = 15 * 60 * 1000
const DIFF_MAX_BYTES = 32 * 1024 * 1024

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'integer' },
          body: { type: 'string' },
        },
        required: ['path', 'line', 'body'],
      },
    },
  },
  required: ['findings'],
}

export function reviewPrompt(title: string): string {
  return `You are reviewing a pull request titled "${title}". Its diff is on stdin.

Write review remarks about this change. Each remark is posted as a comment on one
line of the diff, on its own, with nothing else around it: no summary, no heading
and no other remark to lean on. Write each one so it reads as a comment a
colleague left on that line.

Only comment on lines the diff shows as added or unchanged. Use the line number
from the new version of the file, and give the file path from the repo root as
plain text: no a/ or b/ prefix, no quotes and no escapes.

Say something only where it is worth a colleague's time. Few sharp remarks beat a
list of everything noticed. If the change is fine, return no findings at all.

Write every remark in Dutch. Keep English technical nouns in English and
unconjugated: "de pull request", "search params", "een datatable". Never translate
them and never give them a Dutch plural. Put identifiers, values and file names
between backticks.

One paragraph per remark, 40 to 90 words, in this order, skipping what does not
apply: what the code literally does, what the reader loses by it, the place in the
diff that already does it right, then two named options or a question. Leave the
author a way out rather than an order. Name the role instead of a pronoun: "de
beheerder moet zelf raden", not "hij moet zelf raden".

No heading, no bold, no severity label, no bullet list, no suggestion block and no
second paragraph about how bad it is. No em dash anywhere.`
}

export function claudeArgs(prompt: string): string[] {
  return [
    '-p',
    prompt,
    '--output-format=json',
    `--json-schema=${JSON.stringify(SCHEMA)}`,
    '--tools',
    '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ]
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 }

// git quotes a path with special or non-ASCII characters, with octal escapes for its UTF-8 bytes.
function unquote(quoted: string): string {
  const bytes: number[] = []
  for (const [, octal, escaped, plain] of quoted.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/g)) {
    if (octal) bytes.push(parseInt(octal, 8))
    else if (escaped) bytes.push(ESCAPES[escaped] ?? escaped.charCodeAt(0))
    else bytes.push(...new TextEncoder().encode(plain))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// git ends a path that has a space with a tab. `/dev/null` has no `b/`, so a deleted file gives none.
function newPath(header: string): string | undefined {
  const raw = header.replace(/\t$/, '')
  const path = raw.startsWith('"') ? unquote(raw) : raw
  return path.startsWith('b/') ? path.slice('b/'.length) : undefined
}

export function diffLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>()
  let lines: Set<number> | undefined
  let next = 0
  // An added line can start with `+++ ` too, so a file name only counts before the first hunk.
  let inHeader = false

  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      inHeader = true
      lines = undefined
    } else if (inHeader && text.startsWith('+++ ')) {
      const path = newPath(text.slice('+++ '.length))
      if (path === undefined) continue
      lines = new Set()
      files.set(path, lines)
    } else if (text.startsWith('@@ ')) {
      inHeader = false
      next = Number(text.match(/\+(\d+)/)?.[1])
    } else if (!inHeader && lines && (text.startsWith('+') || text.startsWith(' '))) {
      lines.add(next)
      next += 1
    }
  }
  return files
}

export function readFindings(stdout: string): Finding[] {
  const output = JSON.parse(stdout)
  const messages = Array.isArray(output) ? output : [output]
  const result = messages.find((message) => message.type === 'result')
  if (!result) throw new Error('Claude gave no answer')
  if (result.is_error) throw new Error(result.result || result.errors?.join('\n') || 'Claude failed')

  const findings = result.structured_output?.findings
  if (!Array.isArray(findings)) throw new Error('Claude gave no remarks list')
  return findings
}

// A failed run exits 1 but still prints its result, which says why better than the exit code.
export function failedRunOutput(failure: ExecFailure): string {
  if (failure.killed) throw new Error('Claude did not finish within 15 minutes')
  // The message holds the whole command line, prompt included, so stderr says why far better.
  if (!failure.stdout) throw new Error(failure.stderr?.trim() || failure.message)
  return failure.stdout
}

export async function reviewPr(pr: Pr): Promise<Reviewed> {
  const { stdout: commit } = await run('gh', ['pr', 'view', pr.url, '--json=headRefOid', '--jq=.headRefOid'])
  const { stdout: diff } = await run('gh', ['pr', 'diff', pr.url], { maxBuffer: DIFF_MAX_BYTES })

  const claude = run('claude', claudeArgs(reviewPrompt(pr.title)), {
    cwd: tmpdir(),
    timeout: TIMEOUT_MS,
  })
  claude.child.stdin?.end(diff)

  const stdout = await claude.then((done) => done.stdout, failedRunOutput)

  const lines = diffLines(diff)
  const remarks = readFindings(stdout).map((finding) => ({
    ...finding,
    inDiff: lines.get(finding.path)?.has(finding.line) ?? false,
  }))
  return { commit: commit.trim(), remarks }
}
