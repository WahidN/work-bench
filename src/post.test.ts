import { describe, expect, it } from 'vitest'

import type { Pr } from './github'
import { postArgs, replyArgs } from './post'

const PR: Pr = {
  url: 'https://github.com/acme/api/pull/2',
  number: 2,
  title: 'Add rate limits',
  repo: 'acme/api',
  author: 'sam',
  updatedAt: '2026-09-30T10:00:00Z',
  reasons: ['review'],
}

describe('postArgs', () => {
  it('posts one inline comment on the reviewed commit, with the line as a number, and keeps its id', () => {
    const finding = { path: 'src/limits.ts', line: 12, body: 'Deze limiet telt per proces.' }

    expect(postArgs(PR, 'abc123', finding)).toEqual([
      'api',
      'repos/acme/api/pulls/2/comments',
      '-f',
      'body=Deze limiet telt per proces.',
      '-f',
      'commit_id=abc123',
      '-f',
      'path=src/limits.ts',
      '-F',
      'line=12',
      '-f',
      'side=RIGHT',
      '--jq',
      '{id, url: .html_url}',
    ])
  })
})

describe('replyArgs', () => {
  it('replies in the thread of the posted comment', () => {
    expect(replyArgs(PR, 4146166701, 'Gefixt in abc1234. De loop stopt nu.')).toEqual([
      'api',
      'repos/acme/api/pulls/2/comments/4146166701/replies',
      '-f',
      'body=Gefixt in abc1234. De loop stopt nu.',
      '--jq',
      '.html_url',
    ])
  })
})
