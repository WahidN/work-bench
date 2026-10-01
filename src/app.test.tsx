import { mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'

import { PrApp } from './app'
import type { Pr, Reason } from './github'
import type { Remark, Reviewed } from './review'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function pr(repo: string, number: number, title: string, reasons: Reason[]): Pr {
  return {
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    title,
    repo,
    author: 'sam',
    updatedAt: '2026-09-30T10:00:00Z',
    reasons,
  }
}

const PRS = [
  pr('acme/web', 1, 'Fix the login form', ['assigned']),
  pr('acme/api', 2, 'Add rate limits', ['assigned', 'review']),
  pr('acme/web', 3, 'Use the new header', ['review']),
]
const TITLES = PRS.map((entry) => entry.title)

async function mount(
  load: () => Promise<Pr[]>,
  review: (pr: Pr) => Promise<Reviewed> = async () => ({ commit: 'abc123', remarks: [] }),
  post: (pr: Pr, commit: string, remark: Remark) => Promise<string> = async () => '',
) {
  const { render, renderer } = createTestRoot({ width: 960, height: 680 })
  render(<PrApp load={load} review={review} post={post} />)
  const app = await connectTest(renderer)
  return { app, renderer }
}

describeNative('pr list', () => {
  it('paints every pull request and filters by repo', async () => {
    const { app, renderer } = await mount(async () => PRS)
    await app.getByText('Fix the login form').waitFor()
    expect(renderer.getPaintedText()).toEqual(expect.arrayContaining(TITLES))

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-list.png')

    await app.getByTestId('repo-acme/api').click()
    const painted = renderer.getPaintedText()
    expect(painted).toContain('Add rate limits')
    expect(painted).not.toContain('Fix the login form')
    expect(painted).not.toContain('Use the new header')

    await app.getByTestId('repo-all').click()
    expect(renderer.getPaintedText()).toEqual(expect.arrayContaining(TITLES))

    await app.close()
  })

  it('marks a pull request found by both searches with both reasons', async () => {
    const { app, renderer } = await mount(async () => PRS)
    await app.getByTestId('repo-acme/api').waitFor()
    await app.getByTestId('repo-acme/api').click()

    const painted = renderer.getPaintedText()
    expect(painted).toContain('Assigned')
    expect(painted).toContain('Review')

    await app.close()
  })

  it('shows the error from gh instead of an empty list', async () => {
    const { app, renderer } = await mount(() => Promise.reject(new Error('gh: not logged in')))
    await app.getByText('gh: not logged in').waitFor()
    expect(renderer.getPaintedText()).not.toContain('No open pull requests')

    await app.close()
  })

  it('keeps the picked repo when refreshing', async () => {
    let calls = 0
    const { app, renderer } = await mount(async () => {
      calls += 1
      return PRS
    })
    await app.getByTestId('repo-acme/api').waitFor()
    await app.getByTestId('repo-acme/api').click()
    await app.getByTestId('refresh').click()
    await app.getByText('Refresh').waitFor()

    expect(calls).toBe(2)
    const painted = renderer.getPaintedText()
    expect(painted).toContain('Add rate limits')
    expect(painted).not.toContain('Fix the login form')

    await app.close()
  })
})

const REMARK: Remark = {
  path: 'src/limits.ts',
  line: 12,
  inDiff: true,
  body: 'Deze limiet telt per proces, dus met drie instances achter de load balancer mag een client drie keer zoveel requests doen. `RateLimiter` in `src/auth.ts` houdt de teller al in Redis bij. Die hergebruiken, of is een limiet per instance hier genoeg?',
}

describeNative('pr review', () => {
  it('reviews a pull request and keeps the remarks after going back', async () => {
    let finish: (reviewed: Reviewed) => void = () => {}
    let calls = 0
    const { app, renderer } = await mount(
      async () => PRS,
      () => {
        calls += 1
        return new Promise((resolve) => (finish = resolve))
      },
    )
    await app.getByTestId('repo-acme/api').waitFor()
    await app.getByTestId('repo-acme/api').click()
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByText('Review with Claude').waitFor()

    await app.getByTestId('review').click()
    await app.getByText('Reviewing').waitFor()
    await app.getByTestId('review').click()
    expect(calls).toBe(1)

    await app.getByTestId('back').click()
    await app.getByText('Pull requests').waitFor()
    expect(renderer.getPaintedText()).not.toContain('Fix the login form')

    finish({ commit: 'abc123', remarks: [REMARK] })
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByTestId('finding-0').waitFor()
    expect(await app.getByTestId('finding-0').textContent()).toBe(`src/limits.ts:12Post${REMARK.body}`)
    expect(renderer.getPaintedText()).toContain('Review again')
    expect(calls).toBe(1)

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-review.png')

    await app.close()
  })

  it('says so when Claude has no remarks', async () => {
    const { app } = await mount(async () => PRS)
    await app.getByTestId('pr-acme/web#1').waitFor()
    await app.getByTestId('pr-acme/web#1').click()
    await app.getByTestId('review').click()
    await app.getByText('Claude found nothing to remark on').waitFor()

    await app.close()
  })

  it('shows why a review failed and lets you start a new one', async () => {
    const { app, renderer } = await mount(
      async () => PRS,
      () => Promise.reject(new Error('claude is not logged in')),
    )
    await app.getByTestId('pr-acme/web#1').waitFor()
    await app.getByTestId('pr-acme/web#1').click()
    await app.getByTestId('review').click()
    await app.getByText('claude is not logged in').waitFor()
    expect(renderer.getPaintedText()).toContain('Review again')

    await app.close()
  })
})

const OUTSIDE: Remark = {
  path: 'src/limits.ts',
  line: 99,
  inDiff: false,
  body: 'Deze check staat buiten de diff, dus GitHub weigert een comment op deze regel.',
}

async function openReviewed(post: (pr: Pr, commit: string, remark: Remark) => Promise<string>) {
  const { app, renderer } = await mount(
    async () => PRS,
    async () => ({ commit: 'abc123', remarks: [REMARK, OUTSIDE] }),
    post,
  )
  await app.getByTestId('pr-acme/api#2').waitFor()
  await app.getByTestId('pr-acme/api#2').click()
  await app.getByTestId('review').click()
  await app.getByTestId('finding-0').waitFor()
  return { app, renderer }
}

describeNative('review posting', () => {
  it('posts a remark once, on the reviewed commit', async () => {
    const posted: [string, string, Remark][] = []
    let answer: (url: string) => void = () => {}
    const { app, renderer } = await openReviewed((pr, commit, remark) => {
      posted.push([pr.url, commit, remark])
      return new Promise((resolve) => (answer = resolve))
    })

    await app.getByTestId('post-0').click()
    await app.getByText('Posting').waitFor()
    await app.getByTestId('post-0').click()
    expect(posted).toEqual([['https://github.com/acme/api/pull/2', 'abc123', REMARK]])

    answer('https://github.com/acme/api/pull/2#discussion_r1')
    await app.getByText('Posted').waitFor()
    expect(await app.getByTestId('post-0').count()).toBe(0)

    expect(renderer.getPaintedText()).toContain('Line not in the diff')
    expect(await app.getByTestId('post-1').count()).toBe(0)

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-post.png')

    await app.close()
  })

  it('shows why a post failed and lets you post again', async () => {
    const { app } = await openReviewed(() =>
      Promise.reject(new Error('Validation Failed (HTTP 422)')),
    )

    await app.getByTestId('post-0').click()
    await app.getByText('Validation Failed (HTTP 422)').waitFor()
    expect(await app.getByTestId('post-0').count()).toBe(1)

    await app.close()
  })
})
