import { describe, expect, it } from 'vitest'

import { toThreads, type RawComment } from './comments'

function comment(fields: Partial<RawComment> & { id: number }): RawComment {
  return {
    user: { login: 'WahidN' },
    body: 'Deze loop leest een waarde te veel.',
    path: 'src/average.ts',
    line: 3,
    original_line: 3,
    in_reply_to_id: null,
    html_url: `https://github.com/acme/api/pull/2#discussion_r${fields.id}`,
    ...fields,
  }
}

describe('toThreads', () => {
  it('groups the replies under the comment they answer, oldest first', () => {
    const threads = toThreads([
      comment({ id: 12, in_reply_to_id: 10, body: 'Gefixt in abc1234.' }),
      comment({ id: 10 }),
      comment({ id: 11, user: { login: 'sam' }, path: 'src/limits.ts', line: 8, original_line: 8, body: 'Mist een test.' }),
      comment({ id: 13, in_reply_to_id: 10, user: { login: 'sam' }, body: 'Dank.' }),
    ])

    expect(threads).toEqual([
      {
        id: 10,
        url: 'https://github.com/acme/api/pull/2#discussion_r10',
        author: 'WahidN',
        path: 'src/average.ts',
        line: 3,
        outdated: false,
        body: 'Deze loop leest een waarde te veel.',
        replies: [
          { author: 'WahidN', body: 'Gefixt in abc1234.' },
          { author: 'sam', body: 'Dank.' },
        ],
      },
      {
        id: 11,
        url: 'https://github.com/acme/api/pull/2#discussion_r11',
        author: 'sam',
        path: 'src/limits.ts',
        line: 8,
        outdated: false,
        body: 'Mist een test.',
        replies: [],
      },
    ])
  })

  it('keeps the old line of a comment whose line changed, and marks it outdated', () => {
    const [thread] = toThreads([comment({ id: 20, line: null, original_line: 115 })])

    expect(thread.line).toBe(115)
    expect(thread.outdated).toBe(true)
  })
})
