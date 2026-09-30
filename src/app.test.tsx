import { mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'

import { PrApp } from './app'
import type { Pr, Reason } from './github'
import type { Finding } from './review'

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
  review: (pr: Pr) => Promise<Finding[]> = async () => [],
) {
  const { render, renderer } = createTestRoot({ width: 960, height: 680 })
  render(<PrApp load={load} review={review} />)
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

const FINDING: Finding = {
  path: 'src/limits.ts',
  line: 12,
  body: 'Deze limiet telt per proces, dus met drie instances achter de load balancer mag een client drie keer zoveel requests doen. `RateLimiter` in `src/auth.ts` houdt de teller al in Redis bij. Die hergebruiken, of is een limiet per instance hier genoeg?',
}

describeNative('pr review', () => {
  it('reviews a pull request and keeps the remarks after going back', async () => {
    let finish: (findings: Finding[]) => void = () => {}
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

    finish([FINDING])
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByTestId('finding-0').waitFor()
    expect(await app.getByTestId('finding-0').textContent()).toBe(`src/limits.ts:12${FINDING.body}`)
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
