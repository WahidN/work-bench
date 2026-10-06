import type { Pr } from './github'

export type RepoCount = { repo: string; count: number }

export function shortName(repo: string): string {
  return repo.split('/')[1] ?? repo
}

export function repoCounts(prs: Pr[]): RepoCount[] {
  const counts = new Map<string, number>()
  for (const pr of prs) counts.set(pr.repo, (counts.get(pr.repo) ?? 0) + 1)
  return [...counts]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => shortName(a.repo).localeCompare(shortName(b.repo)))
}

export function inRepo(prs: Pr[], repo: string | null): Pr[] {
  return repo === null ? prs : prs.filter((pr) => pr.repo === repo)
}

export function withoutHidden(prs: Pr[], hidden: string[]): Pr[] {
  return prs.filter((pr) => !hidden.includes(pr.repo))
}
