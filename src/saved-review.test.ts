import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { Pr } from './github'
import type { Reviewed } from './review'
import { loadReview, loadReviews, postSaved, reviewFile, runReview, saveReview } from './saved-review'

const URL = 'https://github.com/acme/api/pull/2'

const PR: Pr = {
  url: URL,
  number: 2,
  title: 'Add rate limits',
  repo: 'acme/api',
  author: 'sam',
  updatedAt: '2026-09-30T10:00:00Z',
  reasons: ['review'],
}

const REVIEWED: Reviewed = {
  commit: 'abc123',
  remarks: [
    { path: 'src/limits.ts', line: 12, body: 'Deze limiet telt per proces.', inDiff: true },
    { path: 'src/old.ts', line: 3, body: 'Deze regel staat niet in de diff.', inDiff: false },
  ],
}

// macOS gives no pid above 99998, so this process never exists.
const GONE_PID = 999999

const folder = () => mkdtempSync(join(tmpdir(), 'reviews-'))

describe('reviewFile', () => {
  it('keeps a review per owner, repo and number', () => {
    expect(reviewFile(URL, '/reviews')).toBe('/reviews/acme/api/2.json')
  })

  it('refuses a URL that is not a pull request', () => {
    expect(() => reviewFile('https://github.com/acme/api/issues/2', '/reviews')).toThrow('Not a pull request URL')
  })
})

describe('saved reviews', () => {
  it('reads nothing for a pull request without a review', async () => {
    expect(await loadReview(URL, folder())).toBeNull()
    expect(await loadReviews(join(folder(), 'missing'))).toEqual([])
  })

  it('reads back what it saved, and leaves no temp file', async () => {
    const reviews = folder()
    await saveReview({ url: URL, state: 'done', ...REVIEWED }, reviews)

    expect(await loadReview(URL, reviews)).toEqual({ url: URL, state: 'done', ...REVIEWED })
    expect(readdirSync(join(reviews, 'acme', 'api'))).toEqual(['2.json'])
  })

  it('reads a running review whose process is gone as failed', async () => {
    const reviews = folder()
    await saveReview({ url: URL, state: 'running', pid: GONE_PID }, reviews)

    expect(await loadReview(URL, reviews)).toEqual({
      url: URL,
      state: 'failed',
      error: 'The review stopped before it was done',
    })
  })

  it('lists the reviews of every repo', async () => {
    const reviews = folder()
    const other = 'https://github.com/acme/web/pull/7'
    await saveReview({ url: URL, state: 'running', pid: process.pid }, reviews)
    await saveReview({ url: other, state: 'failed', error: 'gh failed' }, reviews)

    expect(await loadReviews(reviews)).toEqual(
      expect.arrayContaining([
        { url: URL, state: 'running', pid: process.pid },
        { url: other, state: 'failed', error: 'gh failed' },
      ]),
    )
  })
})

describe('runReview', () => {
  it('saves running while Claude reviews, then the commit and the remarks', async () => {
    const reviews = folder()
    const review = vi.fn(async () => {
      expect(await loadReview(URL, reviews)).toEqual({ url: URL, state: 'running', pid: process.pid })
      return REVIEWED
    })

    await runReview(URL, { prs: async () => [PR], review, folder: reviews })

    expect(review).toHaveBeenCalledWith(PR)
    expect(await loadReview(URL, reviews)).toEqual({ url: URL, state: 'done', ...REVIEWED })
  })

  it('saves the error when the review fails', async () => {
    const reviews = folder()
    const review = async () => {
      throw new Error('Claude did not finish within 15 minutes')
    }

    await runReview(URL, { prs: async () => [PR], review, folder: reviews })

    expect(await loadReview(URL, reviews)).toEqual({
      url: URL,
      state: 'failed',
      error: 'Claude did not finish within 15 minutes',
    })
  })

  it('saves an error for a pull request that is not in the list', async () => {
    const reviews = folder()

    await runReview(URL, { prs: async () => [], review: async () => REVIEWED, folder: reviews })

    expect(await loadReview(URL, reviews)).toEqual({
      url: URL,
      state: 'failed',
      error: 'This pull request is not in your list',
    })
  })

  it('refuses while a review of the same pull request runs', async () => {
    const reviews = folder()
    await saveReview({ url: URL, state: 'running', pid: process.pid }, reviews)
    const review = vi.fn(async () => REVIEWED)

    await expect(runReview(URL, { prs: async () => [PR], review, folder: reviews })).rejects.toThrow(
      'A review of this pull request is still running',
    )
    expect(review).not.toHaveBeenCalled()
  })
})

describe('postSaved', () => {
  const saved = async () => {
    const reviews = folder()
    await saveReview({ url: URL, state: 'done', ...REVIEWED }, reviews)
    return reviews
  }

  it('posts the remark on the reviewed commit and saves its comment URL', async () => {
    const reviews = await saved()
    const posted = { id: 41, url: 'https://github.com/acme/api/pull/2#discussion_r41' }
    const post = vi.fn(async () => posted)

    expect(await postSaved(URL, 'abc123', 0, { post, folder: reviews })).toEqual(posted)
    expect(post).toHaveBeenCalledWith({ repo: 'acme/api', number: 2 }, 'abc123', REVIEWED.remarks[0])
    expect(await loadReview(URL, reviews)).toMatchObject({
      remarks: [{ ...REVIEWED.remarks[0], posted: posted.url }, REVIEWED.remarks[1]],
    })
  })

  it('refuses a commit that is not the saved review', async () => {
    const post = vi.fn()

    await expect(postSaved(URL, 'def456', 0, { post, folder: await saved() })).rejects.toThrow(
      'The saved review is not of commit def456',
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses a line outside the diff and a remark that is posted already', async () => {
    const reviews = await saved()
    const post = vi.fn(async () => ({ id: 41, url: 'https://github.com/acme/api/pull/2#discussion_r41' }))

    await expect(postSaved(URL, 'abc123', 1, { post, folder: reviews })).rejects.toThrow('not in the diff')
    await postSaved(URL, 'abc123', 0, { post, folder: reviews })
    await expect(postSaved(URL, 'abc123', 0, { post, folder: reviews })).rejects.toThrow('already posted')
    expect(post).toHaveBeenCalledTimes(1)
  })
})
