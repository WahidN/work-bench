import { describe, expect, it } from 'vitest'

import type { Pr } from './github'
import { postArgs } from './post'

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
  it('posts one inline comment on the reviewed commit, with the line as a number', () => {
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
      '.html_url',
    ])
  })
})
