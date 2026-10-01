import { mkdirSync } from 'node:fs'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'

import { PrApp } from './app'
import type { Thread } from './comments'
import type { Fixed } from './fix'
import type { Pr, Reason } from './github'
import type { Posted } from './post'
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

type Fakes = Partial<ComponentProps<typeof PrApp>>

// Every dependency is faked, so no test can reach the real gh or claude.
async function mount(load: () => Promise<Pr[]>, fakes: Fakes = {}) {
  const { render, renderer } = createTestRoot({ width: 960, height: 680 })
  render(
    <PrApp
      load={load}
      review={async () => ({ commit: 'abc123', remarks: [] })}
      post={async () => ({ id: 1, url: '' })}
      fix={async () => ({ state: 'nothing', reason: '' })}
      reply={async () => ''}
      whoami={async () => 'nobody'}
      comments={async () => []}
      {...fakes}
    />,
  )
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
    const { app, renderer } = await mount(async () => PRS, {
      review: () => {
        calls += 1
        return new Promise((resolve) => (finish = resolve))
      },
    })
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
    const { app, renderer } = await mount(async () => PRS, {
      review: () => Promise.reject(new Error('claude is not logged in')),
    })
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

async function openReviewed(fakes: Fakes) {
  const { app, renderer } = await mount(async () => PRS, {
    review: async () => ({ commit: 'abc123', remarks: [REMARK, OUTSIDE] }),
    ...fakes,
  })
  await app.getByTestId('pr-acme/api#2').waitFor()
  await app.getByTestId('pr-acme/api#2').click()
  await app.getByTestId('review').click()
  await app.getByTestId('finding-0').waitFor()
  return { app, renderer }
}

describeNative('review posting', () => {
  it('posts a remark once, on the reviewed commit', async () => {
    const posted: [string, string, Remark][] = []
    let answer: (posted: Posted) => void = () => {}
    const { app, renderer } = await openReviewed({
      post: (pr, commit, remark) => {
        posted.push([pr.url, commit, remark])
        return new Promise((resolve) => (answer = resolve))
      },
    })

    await app.getByTestId('post-0').click()
    await app.getByText('Posting').waitFor()
    await app.getByTestId('post-0').click()
    expect(posted).toEqual([['https://github.com/acme/api/pull/2', 'abc123', REMARK]])

    answer({ id: 1, url: 'https://github.com/acme/api/pull/2#discussion_r1' })
    await app.getByText('Posted').waitFor()
    expect(await app.getByTestId('post-0').count()).toBe(0)

    expect(renderer.getPaintedText()).toContain('Line not in the diff')
    expect(await app.getByTestId('post-1').count()).toBe(0)

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-post.png')

    await app.close()
  })

  it('shows why a post failed and lets you post again', async () => {
    const { app } = await openReviewed({ post: () => Promise.reject(new Error('Validation Failed (HTTP 422)')) })

    await app.getByTestId('post-0').click()
    await app.getByText('Validation Failed (HTTP 422)').waitFor()
    expect(await app.getByTestId('post-0').count()).toBe(1)

    await app.close()
  })
})

const FIXED: Fixed = { state: 'fixed', commit: 'abc1234', reply: 'De teller staat nu in Redis.' }

describeNative('fixing a remark', () => {
  it('fixes a posted remark, replies under its comment, and lets one fix run at a time', async () => {
    let land: (fixed: Fixed) => void = () => {}
    let fixes = 0
    const replies: [string, number, string][] = []
    const { app, renderer } = await openReviewed({
      whoami: async () => 'sam',
      post: async () => ({ id: 42, url: 'https://github.com/acme/api/pull/2#discussion_r42' }),
      fix: () => {
        fixes += 1
        return new Promise((resolve) => (land = resolve))
      },
      reply: async (pr, id, body) => {
        replies.push([pr.url, id, body])
        return ''
      },
    })

    await app.getByTestId('post-0').click()
    await app.getByText('Posted').waitFor()
    await app.getByTestId('fix-0').click()
    await app.getByText('Fixing').waitFor()
    await app.getByTestId('fix-1').click()
    expect(fixes).toBe(1)

    land(FIXED)
    await app.getByText('Replied under the comment on GitHub').waitFor()
    expect(replies).toEqual([
      ['https://github.com/acme/api/pull/2', 42, 'Gefixt in abc1234. De teller staat nu in Redis.'],
    ])
    expect(renderer.getPaintedText()).toContain('Fixed in abc1234')

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-fix.png')

    await app.close()
  })

  it('keeps Review again off while a fix runs, so the fix stays in view', async () => {
    let reviews = 0
    let fixes = 0
    const { app, renderer } = await openReviewed({
      whoami: async () => 'sam',
      review: async () => {
        reviews += 1
        return { commit: 'abc123', remarks: [REMARK, OUTSIDE] }
      },
      fix: () => {
        fixes += 1
        return new Promise(() => {})
      },
    })

    await app.getByTestId('fix-0').click()
    await app.getByText('Fixing').waitFor()
    await app.getByTestId('review').click()
    await app.getByTestId('fix-1').click()

    expect(reviews).toBe(1)
    expect(fixes).toBe(1)
    expect(renderer.getPaintedText()).toContain('Fixing')

    await app.close()
  })

  it('posts nothing when the fixed remark is not on GitHub', async () => {
    let replies = 0
    const { app, renderer } = await openReviewed({
      whoami: async () => 'sam',
      fix: async () => FIXED,
      reply: async () => {
        replies += 1
        return ''
      },
    })

    await app.getByTestId('fix-0').click()
    await app.getByText('Fixed in abc1234').waitFor()
    expect(replies).toBe(0)
    expect(renderer.getPaintedText().join(' ')).not.toContain('Replied')

    await app.close()
  })

  it('shows a failed reply next to the pushed commit', async () => {
    const { app } = await openReviewed({
      whoami: async () => 'sam',
      post: async () => ({ id: 42, url: '' }),
      fix: async () => FIXED,
      reply: () => Promise.reject(new Error('Not Found (HTTP 404)')),
    })

    await app.getByTestId('post-0').click()
    await app.getByText('Posted').waitFor()
    await app.getByTestId('fix-0').click()
    await app.getByText('The reply failed: Not Found (HTTP 404)').waitFor()
    await app.getByText('Fixed in abc1234').waitFor()

    await app.close()
  })

  it('has no Fix button on a pull request someone else wrote', async () => {
    const { app } = await openReviewed({ whoami: async () => 'someone-else' })

    expect(await app.getByTestId('fix-0').count()).toBe(0)

    await app.close()
  })

  it('says when Claude changed nothing, and lets you try again', async () => {
    const { app } = await openReviewed({
      whoami: async () => 'sam',
      fix: async () => ({ state: 'nothing', reason: 'De limiet telt al per gebruiker.' }),
    })

    await app.getByTestId('fix-0').click()
    await app.getByText('Claude changed nothing. De limiet telt al per gebruiker.').waitFor()
    expect(await app.getByTestId('fix-0').count()).toBe(1)

    await app.close()
  })

  it('shows why a fix failed, and lets you try again', async () => {
    const { app } = await openReviewed({
      whoami: async () => 'sam',
      fix: () => Promise.reject(new Error('The branch moved on while Claude worked. Nothing was pushed.')),
    })

    await app.getByTestId('fix-0').click()
    await app.getByText('The branch moved on while Claude worked. Nothing was pushed.').waitFor()
    expect(await app.getByTestId('fix-0').count()).toBe(1)

    await app.close()
  })
})

function thread(id: number, author: string, body: string, fields: Partial<Thread> = {}): Thread {
  return {
    id,
    url: `https://github.com/acme/api/pull/2#discussion_r${id}`,
    author,
    path: 'src/limits.ts',
    line: 12,
    outdated: false,
    body,
    replies: [],
    ...fields,
  }
}

describeNative('comments from GitHub', () => {
  it('marks the pull requests you commented on in the list', async () => {
    const { app, renderer } = await mount(async () => [PRS[0], { ...PRS[1], commented: true }, PRS[2]])
    await app.getByText('Add rate limits').waitFor()

    expect(renderer.getPaintedText().filter((text) => text === 'Commented')).toHaveLength(1)
    expect(await app.getByTestId('pr-acme/api#2').textContent()).toContain('Commented')

    await app.close()
  })

  it('brings back your posted remarks with their replies, and a colleague comment read-only', async () => {
    const replies: [number, string][] = []
    const { app, renderer } = await mount(async () => PRS, {
      whoami: async () => 'sam',
      comments: async () => [
        thread(10, 'sam', 'Deze limiet telt per proces.', {
          replies: [{ author: 'sam', body: 'Gefixt in abc1234. De teller staat nu in Redis.' }],
        }),
        thread(11, 'kim', 'Kan deze naam duidelijker?', { line: 20 }),
        thread(12, 'sam', 'Deze check mist een test.', { line: 40, outdated: true }),
      ],
      fix: async () => FIXED,
      reply: async (pr, id, body) => {
        replies.push([id, body])
        return ''
      },
    })
    await app.getByTestId('pr-acme/api#2').waitFor()
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByTestId('finding-thread-10').waitFor()

    expect(await app.getByTestId('finding-thread-10').textContent()).toContain('Posted')
    expect(renderer.getPaintedText()).toContain('sam: Gefixt in abc1234. De teller staat nu in Redis.')
    const colleague = await app.getByTestId('finding-thread-11').textContent()
    expect(colleague).toContain('kim')
    expect(colleague).not.toContain('Fix')
    expect(colleague).not.toContain('Post')
    expect(await app.getByTestId('finding-thread-12').textContent()).toContain('outdated')

    mkdirSync('screenshots', { recursive: true })
    renderer.captureScreenshot('screenshots/pr-comments.png')

    await app.getByTestId('fix-thread-10').click()
    await app.getByText('Replied under the comment on GitHub').waitFor()
    expect(replies).toEqual([[10, 'Gefixt in abc1234. De teller staat nu in Redis.']])

    await app.close()
  })

  it('shows a remark posted in this window once when its comment loads again', async () => {
    let loads = 0
    const { app } = await openReviewed({
      post: async () => ({ id: 7, url: 'https://github.com/acme/api/pull/2#discussion_r7' }),
      comments: async () => (loads++ === 0 ? [] : [thread(7, 'sam', REMARK.body)]),
    })

    await app.getByTestId('post-0').click()
    await app.getByText('Posted').waitFor()
    await app.getByTestId('back').click()
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByTestId('finding-0').waitFor()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(loads).toBe(2)
    expect(await app.getByText(REMARK.body).count()).toBe(1)

    await app.close()
  })

  it('says why the comments did not load, and a review still works', async () => {
    let reviews = 0
    const { app } = await mount(async () => PRS, {
      comments: () => Promise.reject(new Error('HTTP 404: Not Found')),
      review: async () => {
        reviews += 1
        return { commit: 'abc123', remarks: [REMARK] }
      },
    })
    await app.getByTestId('pr-acme/api#2').waitFor()
    await app.getByTestId('pr-acme/api#2').click()
    await app.getByText('The comments did not load: HTTP 404: Not Found').waitFor()

    await app.getByTestId('review').click()
    await app.getByTestId('finding-0').waitFor()
    expect(reviews).toBe(1)

    await app.close()
  })
})
