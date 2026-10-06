import { describe, expect, it } from 'vitest'

import type { Pr } from './github'
import { inRepo, repoCounts, withoutHidden } from './repos'

function pr(repo: string, number: number): Pr {
  return {
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    title: `PR ${number}`,
    repo,
    author: 'sam',
    updatedAt: '2026-09-30T10:00:00Z',
    reasons: ['assigned'],
  }
}

const prs = [pr('acme/web', 1), pr('acme/api', 2), pr('acme/web', 3)]

describe('repoCounts', () => {
  it('counts the pull requests per repo, sorted by name', () => {
    expect(repoCounts(prs)).toEqual([
      { repo: 'acme/api', count: 1 },
      { repo: 'acme/web', count: 2 },
    ])
  })

  it('sorts by the name without the owner, which is what the sidebar shows', () => {
    const mixed = [pr('zeta/app', 1), pr('acme/web', 2)]
    expect(repoCounts(mixed).map((entry) => entry.repo)).toEqual(['zeta/app', 'acme/web'])
  })
})

describe('inRepo', () => {
  it('keeps only the picked repo', () => {
    expect(inRepo(prs, 'acme/web').map((entry) => entry.number)).toEqual([1, 3])
  })

  it('keeps everything when no repo is picked', () => {
    expect(inRepo(prs, null)).toEqual(prs)
  })
})

describe('withoutHidden', () => {
  it('drops the pull requests of hidden repos', () => {
    expect(withoutHidden(prs, ['acme/web']).map((entry) => entry.number)).toEqual([2])
  })

  it('keeps everything when nothing is hidden', () => {
    expect(withoutHidden(prs, [])).toEqual(prs)
  })
})
