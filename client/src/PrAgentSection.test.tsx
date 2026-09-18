// @vitest-environment jsdom
//
// The section that replaces the slide-over panel. The wait is the part worth testing: a
// send holds its request open for as long as the agent runs, and an empty transcript for
// that whole stretch is how a run that timed out looked like a button that did nothing.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrAgentSection } from './PrAgentSection'
import { keys, type ChatMessage, type Pr, type RunningAgent } from './queries'
import { engine } from './engineClient'

vi.mock('./engineClient', () => ({
  engine: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  EngineError: class extends Error {},
}))

afterEach(cleanup)

const pr = (over: Partial<Pr> = {}): Pr =>
  ({
    id: 7, ticketId: null, projectId: 1, branch: 'feat/x', number: 77,
    url: 'https://github.com/x/pull/77', status: 'open', lastReviewScore: null, pinned: false,
    title: 'Remove the filter tags', reviewState: null, mergeable: null, isDraft: false,
    githubUpdatedAt: null, authoredByMe: true, assignedToMe: false, reviewRequestedByMe: false,
    messageCount: 0, reviewedAt: null, createdAt: '2026-09-18T10:00:00Z', ...over,
  }) as Pr

const agent = (over: Partial<RunningAgent> = {}): RunningAgent => ({
  key: 'job-1', activity: 'review', targetType: 'pr', targetId: 7,
  title: 'Remove the filter tags', waiting: false,
  startedAt: new Date().toISOString(), ...over,
})

/** What the engine answers, swapped between renders to stand in for a refetch. */
let thread: ChatMessage[]
let running: RunningAgent[]
let row: Pr

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom has no layout, so it implements no scrolling.
  Element.prototype.scrollIntoView = vi.fn()
  thread = []
  running = []
  row = pr()
  vi.mocked(engine.get).mockImplementation(async (path: string) => {
    if (path === '/agents') return { agents: running } as never
    return { ...row, messages: thread } as never
  })
})

function draw(over: Partial<Pr> = {}, onError = vi.fn()) {
  row = pr(over)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    onError,
    client,
    ...render(
      <QueryClientProvider client={client}>
        <PrAgentSection pr={row} onError={onError} />
      </QueryClientProvider>,
    ),
  }
}

function type(container: HTMLElement, text: string) {
  fireEvent.change(container.querySelector('#pr-agent-draft') as HTMLInputElement, {
    target: { value: text },
  })
  fireEvent.click(container.querySelector('#pr-agent-send') as HTMLElement)
}

describe('whether it has been reviewed', () => {
  it('says so when it has not', async () => {
    draw()
    await waitFor(() => expect(screen.getByText('Not reviewed yet')).toBeTruthy())
  })

  it('says when it was', async () => {
    draw({ reviewedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
    await waitFor(() => expect(screen.getByText(/Reviewed 2h ago/)).toBeTruthy())
  })
})

describe('what is running on it', () => {
  it('names the agent working on this pull request', async () => {
    running = [agent()]
    const { container } = draw()
    await waitFor(() => expect(container.querySelector('[data-pr-agent="job-1"]')).toBeTruthy())
    expect(screen.getByText('Reviewing')).toBeTruthy()
  })

  it('names a conflict resolve for what it is', async () => {
    running = [agent({ activity: 'conflicts' })]
    draw()
    await waitFor(() => expect(screen.getByText('Resolving the merge conflict')).toBeTruthy())
  })

  /*
   * Caught by hand, not by a test: the review landed, the five findings rendered, and the
   * line above them still read "Not reviewed yet". A review is started with one request
   * and writes `reviewed_at` minutes later from a job nothing on the page is awaiting, so
   * there is no mutation to hang an invalidation off.
   */
  it('re-reads the pull request when its last agent finishes', async () => {
    running = [agent()]
    const { container, client } = draw()
    await waitFor(() => expect(container.querySelector('[data-pr-agent="job-1"]')).toBeTruthy())
    expect(screen.getByText('Not reviewed yet')).toBeTruthy()

    // The review finishes: the agent goes, and the engine now answers with reviewedAt set.
    // The invalidation stands in for the agents beat, which is the only thing that notices.
    running = []
    row = { ...row, reviewedAt: new Date(Date.now() - 60 * 1000).toISOString() }
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.agents })
    })

    await waitFor(() => expect(screen.getByText(/Reviewed/)).toBeTruthy())
    expect(screen.queryByText('Not reviewed yet')).toBeNull()
  })

  it('leaves out an agent on another pull request', async () => {
    running = [agent({ key: 'job-9', targetId: 8 })]
    const { container } = draw()
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    expect(container.querySelector('#pr-agents')).toBeNull()
  })
})

describe('telling the agent what to do', () => {
  it('shows the message and says the agent is working', async () => {
    let finish: (v: unknown) => void = () => {}
    vi.mocked(engine.post).mockReturnValue(new Promise((resolve) => { finish = resolve }))

    const { container } = draw()
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    type(container, 'fix the retry guard')

    await waitFor(() => expect(screen.getByText('fix the retry guard')).toBeTruthy())
    expect(container.querySelector('#pr-agent-working')).toBeTruthy()
    expect((container.querySelector('#pr-agent-draft') as HTMLInputElement).disabled).toBe(true)

    await act(async () => { finish({ action: 'revised', reply: 'pushed' }) })
  })

  it('shows the stored message once, and stops saying it is working', async () => {
    vi.mocked(engine.post).mockImplementation(async () => {
      thread = [
        { id: 1, role: 'user', content: 'fix the retry guard' },
        { id: 2, role: 'assistant', content: 'pushed, review passed 4.4/5' },
      ]
      return { action: 'revised', reply: 'pushed' } as never
    })

    const { container } = draw()
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    type(container, 'fix the retry guard')

    await waitFor(() => expect(screen.getByText('pushed, review passed 4.4/5')).toBeTruthy())
    expect(screen.getAllByText('fix the retry guard')).toHaveLength(1)
    expect(container.querySelector('#pr-agent-working')).toBeNull()
    expect((container.querySelector('#pr-agent-draft') as HTMLInputElement).value).toBe('')
  })

  // The engine records a failed run in the thread, so the section refetches on a failure
  // too and the reason is readable where the question is.
  it('keeps the draft and raises the failure', async () => {
    const onError = vi.fn()
    vi.mocked(engine.post).mockImplementation(async () => {
      thread = [
        { id: 1, role: 'user', content: 'fix the retry guard' },
        { id: 2, role: 'assistant', content: 'The agent ran for 30 minutes without finishing.' },
      ]
      throw new Error('POST /prs/7/messages returned 500')
    })

    const { container } = draw({}, onError)
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    type(container, 'fix the retry guard')

    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(container.querySelector('#pr-agent-working')).toBeNull()
    expect((container.querySelector('#pr-agent-draft') as HTMLInputElement).value).toBe(
      'fix the retry guard',
    )
    await waitFor(() => expect(screen.getByText(/ran for 30 minutes/)).toBeTruthy())
  })

  // A 409 stores nothing, so the thread comes back the length it was. The echo has to go
  // anyway, or it sits there as a message that was never sent.
  it('drops the echo when the send was refused before anything was stored', async () => {
    vi.mocked(engine.post).mockRejectedValue(new Error('returned 409'))

    const { container } = draw()
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    type(container, 'fix the retry guard')

    await waitFor(() => expect(container.querySelector('#pr-agent-working')).toBeNull())
    expect(screen.queryByText('fix the retry guard')).toBeNull()
  })

  it('sends nothing for an empty draft', async () => {
    const { container } = draw()
    await waitFor(() => expect(container.querySelector('#pr-agent-draft')).toBeTruthy())
    type(container, '   ')
    expect(engine.post).not.toHaveBeenCalled()
  })
})
