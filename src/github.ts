import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type Reason = 'assigned' | 'review'

export type Pr = {
  url: string
  number: number
  title: string
  repo: string
  author: string
  updatedAt: string
  reasons: Reason[]
}

export type SearchResult = {
  url: string
  number: number
  title: string
  repository: { nameWithOwner: string }
  author: { login: string }
  updatedAt: string
}

const FIELDS = 'url,number,title,repository,author,updatedAt'

async function search(filter: string): Promise<SearchResult[]> {
  const { stdout } = await run('gh', [
    'search',
    'prs',
    filter,
    '--state=open',
    '--limit=100',
    `--json=${FIELDS}`,
  ])
  return JSON.parse(stdout)
}

export async function fetchLogin(): Promise<string> {
  const { stdout } = await run('gh', ['api', 'user', '--jq', '.login'])
  return stdout.trim()
}

export async function fetchMyPrs(): Promise<Pr[]> {
  const [assigned, review] = await Promise.all([
    search('--assignee=@me'),
    search('--review-requested=@me'),
  ])
  return mergePrs(assigned, review)
}

export function mergePrs(assigned: SearchResult[], review: SearchResult[]): Pr[] {
  const byUrl = new Map<string, Pr>()

  const add = (result: SearchResult, reason: Reason) => {
    const known = byUrl.get(result.url)
    if (known) {
      known.reasons.push(reason)
      return
    }
    byUrl.set(result.url, {
      url: result.url,
      number: result.number,
      title: result.title,
      repo: result.repository.nameWithOwner,
      author: result.author.login,
      updatedAt: result.updatedAt,
      reasons: [reason],
    })
  }

  assigned.forEach((result) => add(result, 'assigned'))
  review.forEach((result) => add(result, 'review'))

  return [...byUrl.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
