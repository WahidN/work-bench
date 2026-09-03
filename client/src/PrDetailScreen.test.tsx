// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrDetailScreen } from './PrDetailScreen'
import type { Pr } from './queries'

/*
 * The header link, checked here rather than by eye because it is drawn from the list row
 * and not from the GitHub call: it has to be there on a screen whose detail never loads,
 * and gone on a row that has no pull request yet.
 */

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
