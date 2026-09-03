// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrDetailScreen, ReviewThreadView } from './PrDetailScreen'
import type { PrReviewThread } from './prDetailLogic'
import type { Pr, StoredCommentFix } from './queries'

afterEach(cleanup)

const pr = (over: Partial<Pr> = {}): Pr => ({
  id: 1,
  ticketId: null,
  projectId: 1,
  branch: 'feat/x',
  number: 45,
  url: 'https://github.com/acme/repo/pull/45',
  status: 'open',
  lastReviewScore: null,
  pinned: false,
  title: 'A pull request',
  reviewState: null,
  isDraft: false,
  githubUpdatedAt: null,
  authoredByMe: true,
  assignedToMe: false,
  reviewRequestedByMe: false,
  messageCount: 3,
  createdAt: new Date().toISOString(),
  ...over,
})

const draw = (row: Pr) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PrDetailScreen pr={row} onBack={() => {}} />
    </QueryClientProvider>,
  )
}

describe('the header link', () => {
  it('is offered and opens the stored url', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { container } = draw(pr())
    const button = container.querySelector('#pr-github-button') as HTMLButtonElement
    expect(button.textContent).toBe('Open on GitHub')
    button.click()
    expect(open).toHaveBeenCalledWith('https://github.com/acme/repo/pull/45', '_blank', 'noopener')
  })

  it('is not offered on a row with no url', () => {
    const { container } = draw(pr({ url: null }))
    expect(container.querySelector('#pr-github-button')).toBeNull()
  })
})

describe('the agent button', () => {
  it('is gone', () => {
    const { container } = draw(pr())
    expect(container.querySelector('#pr-agent-button')).toBeNull()
    expect(container.textContent).not.toContain('Agent')
  })
})

const thread = (over: Partial<PrReviewThread> = {}): PrReviewThread => ({
  path: 'src/helpers/sessionToken.ts',
  line: 8,
  diffSide: 'RIGHT',
  isResolved: false,
  isOutdated: false,
  comments: [
    {
      id: 7,
      author: 'colleague',
      body: 'This only fires once the token is already past its expiry.',
      createdAt: new Date().toISOString(),
    },
  ],
  ...over,
})

const storedFix = (over: Partial<StoredCommentFix> = {}): StoredCommentFix => ({
  id: 1,
  prId: 1,
  commentId: 7,
  path: 'src/helpers/sessionToken.ts',
  line: 8,
  comment: 'This only fires once the token is already past its expiry.',
  instruction: 'compare with a margin',
  state: 'landed',
  detail: null,
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  ...over,
})

describe('a review comment thread', () => {
  it('asks the agent to fix, carrying the comment and its place', () => {
    const onFix = vi.fn().mockResolvedValue(true)
    const { container } = render(
      <ReviewThreadView thread={thread()} canFix fixes={[]} isStarting={false} onFix={onFix} />,
    )

    const box = screen.getByLabelText('Ask the agent to fix src/helpers/sessionToken.ts:8')
    fireEvent.change(box, { target: { value: 'compare with a margin' } })
    fireEvent.click(container.querySelector('[data-fix-start="7"]') as HTMLButtonElement)

    expect(onFix).toHaveBeenCalledWith('compare with a margin')
  })

  it('offers nothing to post to GitHub', () => {
    const { container } = render(
      <ReviewThreadView thread={thread()} canFix fixes={[]} isStarting={false} onFix={vi.fn()} />,
    )
    expect(screen.queryByText('Post')).toBeNull()
    expect(screen.queryByLabelText(/^Reply to/)).toBeNull()
    expect(container.textContent).toContain('Nothing is posted to GitHub')
  })

  it('does not start on a blank instruction', () => {
    const onFix = vi.fn()
    const { container } = render(
      <ReviewThreadView thread={thread()} canFix fixes={[]} isStarting={false} onFix={onFix} />,
    )
    const button = container.querySelector('[data-fix-start="7"]') as HTMLButtonElement

    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onFix).not.toHaveBeenCalled()
  })

  it('shows the comments but no composer on a pull request the user did not write', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread()}
        canFix={false}
        fixes={[]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )

    expect(container.textContent).toContain('already past its expiry')
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('Replying happens on GitHub')
  })

  it('says a fix is running and still offers another', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[storedFix({ state: 'running', finishedAt: null })]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-fix-state="running"]')).toBeTruthy()
    expect(container.querySelector('[data-fix-start="7"]')).toBeTruthy()
  })

  it('says a queued fix is waiting rather than running', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[storedFix({ state: 'queued', detail: null, finishedAt: null })]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-fix-state="queued"]')?.textContent)
      .toContain('Waiting its turn')
  })

  it('shows every attempt on the comment, in order, each with its instruction', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[
          storedFix({ id: 1, instruction: 'first try', state: 'nothing', detail: 'no change' }),
          storedFix({ id: 2, instruction: 'second try', state: 'queued', finishedAt: null }),
        ]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )

    const attempts = [...container.querySelectorAll('[data-fix]')]
    expect(attempts.map((el) => el.getAttribute('data-fix-state'))).toEqual(['nothing', 'queued'])
    expect(attempts[0].textContent).toContain('first try')
    expect(attempts[1].textContent).toContain('second try')
  })

  it('reads differently for each finished outcome, and a failure gives its reason', () => {
    const { container: landed } = render(
      <ReviewThreadView thread={thread()} canFix fixes={[storedFix()]} isStarting={false} onFix={vi.fn()} />,
    )
    expect(landed.querySelector('[data-fix-state="landed"]')?.textContent).toContain('pushed')

    cleanup()
    const { container: nothing } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[storedFix({ state: 'nothing', detail: 'The agent found no change to make for that.' })]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )
    expect(nothing.querySelector('[data-fix-state="nothing"]')?.textContent)
      .toContain('no change to make')

    cleanup()
    const { container: failed } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[storedFix({ state: 'failed', detail: 'The branch moved on while this fix ran.' })]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )
    expect(failed.querySelector('[data-fix-state="failed"]')?.textContent).toContain('moved on')
  })

  it('offers a finished fix a second attempt', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread()}
        canFix
        fixes={[storedFix({ state: 'nothing', detail: 'no change' })]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-fix-start="7"]')).toBeTruthy()
  })

  it('offers no composer on a comment that hangs on no line', () => {
    const { container } = render(
      <ReviewThreadView
        thread={thread({ line: null })}
        canFix
        fixes={[]}
        isStarting={false}
        onFix={vi.fn()}
      />,
    )
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('no line of the diff')
  })
})
