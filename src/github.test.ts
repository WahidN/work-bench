import { describe, expect, it } from 'vitest'

import { markCommented, mergePrs, type SearchResult } from './github'

function result(number: number, updatedAt: string): SearchResult {
  return {
    url: `https://github.com/acme/api/pull/${number}`,
    number,
    title: `PR ${number}`,
    repository: { nameWithOwner: 'acme/api' },
    author: { login: 'sam' },
    updatedAt,
  }
}

describe('mergePrs', () => {
  it('shows a pull request in both searches once, with both reasons', () => {
    const both = result(1, '2026-09-30T10:00:00Z')

    const prs = mergePrs([both], [both])

    expect(prs).toHaveLength(1)
    expect(prs[0].reasons).toEqual(['assigned', 'review'])
  })

  it('keeps the reason of a pull request found by one search', () => {
    const prs = mergePrs([result(1, '2026-09-30T10:00:00Z')], [result(2, '2026-09-30T11:00:00Z')])

    expect(prs.map((pr) => [pr.number, pr.reasons])).toEqual([
      [2, ['review']],
      [1, ['assigned']],
    ])
  })

  it('flattens the repo and author to their names', () => {
    const [pr] = mergePrs([result(1, '2026-09-30T10:00:00Z')], [])

    expect(pr.repo).toBe('acme/api')
    expect(pr.author).toBe('sam')
  })
})

describe('markCommented', () => {
  it('marks the listed pull requests you left a comment on', () => {
    const prs = mergePrs([result(1, '2026-09-30T10:00:00Z'), result(2, '2026-09-30T11:00:00Z')], [])

    const marked = markCommented(prs, [result(2, '2026-09-30T11:00:00Z'), result(9, '2026-09-30T12:00:00Z')])

    expect(marked.map((pr) => [pr.number, pr.commented])).toEqual([
      [2, true],
      [1, false],
    ])
  })
})
