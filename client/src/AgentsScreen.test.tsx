// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsScreen } from './AgentsScreen'
import { Sidebar } from './Sidebar'
import type { RunningAgent } from './agentsLogic'

afterEach(cleanup)

const agent = (over: Partial<RunningAgent> = {}): RunningAgent => ({
  key: 'job-1',
  activity: 'review',
  targetType: 'pr',
  targetId: 7,
  title: 'Remove the loading animation',
  waiting: false,
  startedAt: new Date().toISOString(),
  ...over,
})

describe('AgentsScreen', () => {
  it('says nothing is running when nothing is', () => {
    render(<AgentsScreen agents={[]} onOpenPr={vi.fn()} />)
    expect(screen.getByText(/No agent is running/)).toBeTruthy()
  })

  it('names what the agent does and what it works on', () => {
    render(<AgentsScreen agents={[agent()]} onOpenPr={vi.fn()} />)
    expect(screen.getByText('Remove the loading animation')).toBeTruthy()
    expect(screen.getByText(/Reviewing/)).toBeTruthy()
  })

  it('opens the pull request an agent is working on', () => {
    const onOpenPr = vi.fn()
    const { container } = render(<AgentsScreen agents={[agent()]} onOpenPr={onOpenPr} />)
    fireEvent.click(container.querySelector('[data-agent="7"]') as HTMLElement)
    expect(onOpenPr).toHaveBeenCalledWith(7)
  })

  it('shows a queued fix as waiting rather than working', () => {
    const { container } = render(
      <AgentsScreen agents={[agent({ activity: 'comment-fix', waiting: true })]} onOpenPr={vi.fn()} />,
    )
    expect(screen.getByText(/Waiting its turn/)).toBeTruthy()
    expect(container.querySelector('[data-agent-waiting="true"]')).toBeTruthy()
  })

  it('lists a ticket agent but does not pretend it opens', () => {
    const onOpenPr = vi.fn()
    const { container } = render(
      <AgentsScreen agents={[agent({ targetType: 'ticket', activity: 'triage' })]} onOpenPr={onOpenPr} />,
    )
    fireEvent.click(container.querySelector('[data-agent="7"]') as HTMLElement)
    expect(onOpenPr).not.toHaveBeenCalled()
  })
})

function sidebar(agents: RunningAgent[], onSelect = vi.fn()) {
  return render(
    <Sidebar
      selection="Today"
      onSelect={onSelect}
      onOpenPalette={vi.fn()}
      onOpenSettings={vi.fn()}
      accountName="Wahid"
      selectedProjectId={null}
      onSelectProject={vi.fn()}
      todos={[]}
      jiraTodos={[]}
      tickets={[]}
      prs={[]}
      projects={[]}
      agents={agents}
    />,
  )
}

describe('the sidebar agents row', () => {
  it('is absent when nothing runs', () => {
    const { container } = sidebar([])
    expect(container.querySelector('#sidebar-agents')).toBeNull()
  })

  // Otherwise the last agent finishing pulls the row out from under the user, who is
  // then on a screen with nothing selected in the nav.
  it('stays while its own section is open, even with nothing running', () => {
    const { container } = render(
      <Sidebar
        selection="Agents"
        onSelect={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenSettings={vi.fn()}
        accountName="Wahid"
        selectedProjectId={null}
        onSelectProject={vi.fn()}
        todos={[]}
        jiraTodos={[]}
        tickets={[]}
        prs={[]}
        projects={[]}
        agents={[]}
      />,
    )
    expect(container.querySelector('#sidebar-agents')).toBeTruthy()
    expect(screen.getByText('No agents running')).toBeTruthy()
  })

  it('counts what is running and opens the list', () => {
    const onSelect = vi.fn()
    const { container } = sidebar([agent(), agent({ key: 'job-2', targetId: 8 })], onSelect)
    expect(screen.getByText('2 agents running')).toBeTruthy()
    fireEvent.click(container.querySelector('#sidebar-agents') as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('Agents')
  })
})
