import { describe, expect, it } from 'vitest'

import { cutHunk, toThreads, type RawComment } from './comments'

function comment(fields: Partial<RawComment> & { id: number }): RawComment {
  return {
    user: { login: 'WahidN' },
    body: 'Deze loop leest een waarde te veel.',
    path: 'src/average.ts',
    line: 3,
    original_line: 3,
    in_reply_to_id: null,
    diff_hunk: '@@ -1,3 +1,3 @@\n let total = 0\n-for (let i = 0; i <= values.length; i++) {\n+for (let i = 0; i < values.length; i++) {',
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
        diff: [
          'diff --git a/src/average.ts b/src/average.ts',
          '--- a/src/average.ts',
          '+++ b/src/average.ts',
          '@@ -1,2 +1,2 @@',
          ' let total = 0',
          '-for (let i = 0; i <= values.length; i++) {',
          '+for (let i = 0; i < values.length; i++) {',
        ].join('\n'),
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
        diff: [
          'diff --git a/src/limits.ts b/src/limits.ts',
          '--- a/src/limits.ts',
          '+++ b/src/limits.ts',
          '@@ -1,2 +1,2 @@',
          ' let total = 0',
          '-for (let i = 0; i <= values.length; i++) {',
          '+for (let i = 0; i < values.length; i++) {',
        ].join('\n'),
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

const HUNK = [
  '@@ -10,7 +10,8 @@ export function limit() {',
  '   const max = 100',
  '   const window = 60',
  '-  let count = 0',
  '+  const count = new Map()',
  '+  const key = user.id',
  '   for (const request of requests) {',
  '     count += 1',
  '   }',
].join('\n')

describe('cutHunk', () => {
  it('keeps the last 4 lines up to the commented line, with their line numbers', () => {
    expect(cutHunk(HUNK, null)).toBe(
      ['@@ -13,3 +13,4 @@', '+  const key = user.id', '   for (const request of requests) {', '     count += 1', '   }'].join('\n'),
    )
  })

  it('keeps a whole range from its first line', () => {
    expect(cutHunk(HUNK, { line: 11, side: 'RIGHT' })).toBe(
      [
        '@@ -11,5 +11,6 @@',
        '   const window = 60',
        '-  let count = 0',
        '+  const count = new Map()',
        '+  const key = user.id',
        '   for (const request of requests) {',
        '     count += 1',
        '   }',
      ].join('\n'),
    )
  })

  it('finds the first line of a range on the removed side', () => {
    expect(cutHunk(HUNK, { line: 12, side: 'LEFT' }).split('\n')[0]).toBe('@@ -12,4 +12,5 @@')
  })

  it('falls back to the last 4 lines when the range start is not in the hunk', () => {
    expect(cutHunk(HUNK, { line: 99, side: 'RIGHT' })).toBe(cutHunk(HUNK, null))
  })

  it('leaves out the note that a file has no newline at the end', () => {
    expect(cutHunk('@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b', null)).toBe('@@ -1,1 +1,1 @@\n-a\n+b')
  })
})

describe('toThreads code', () => {
  it('cuts the code of a range from its old first line, also when the comment is outdated', () => {
    const [thread] = toThreads([
      comment({ id: 30, line: null, original_line: 15, original_start_line: 11, start_side: 'RIGHT', diff_hunk: HUNK }),
    ])

    expect(thread.diff.split('\n').slice(3, 4)).toEqual(['@@ -11,5 +11,6 @@'])
  })

  it('shows no code for a comment without a hunk', () => {
    const [thread] = toThreads([comment({ id: 31, diff_hunk: '' })])

    expect(thread.diff).toBe('')
  })
})
