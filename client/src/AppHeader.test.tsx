// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader'

/*
 * The header's two buttons are not the same button relabelled: on Projects the second is
 * Add project and everywhere else it is Agent, and they do different things. The busy state
 * on Refresh matters for the same reason it does in the Swift, where the button is
 * `.disabled(isBusy)`: a poll takes seconds against Jira and GitHub, and a second click
 * would queue another one behind it.
 */

afterEach(cleanup)

describe('the Refresh button', () => {
  it('says Refresh and calls back when idle', () => {
    const onRefresh = vi.fn()
    render(<AppHeader section="Today" activeProjectCount={0} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByText('Refresh'))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('says Refreshing, disables itself and shows a spinner while busy', () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <AppHeader section="Today" activeProjectCount={0} isRefreshing onRefresh={onRefresh} />,
    )
    const button = screen.getByText('Refreshing').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(container.querySelector('[data-spinner]')).toBeTruthy()

    fireEvent.click(button)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('the second button', () => {
  it('is Add project on Projects, and adds', () => {
    const onAddProject = vi.fn()
    const onOpenAgent = vi.fn()
    render(
      <AppHeader
        section="Projects"
        activeProjectCount={2}
        onAddProject={onAddProject}
        onOpenAgent={onOpenAgent}
      />,
    )
    fireEvent.click(screen.getByText('Add project'))
    expect(onAddProject).toHaveBeenCalledOnce()
    expect(onOpenAgent).not.toHaveBeenCalled()
  })

  it('is Agent everywhere else, and opens the panel', () => {
    const onAddProject = vi.fn()
    const onOpenAgent = vi.fn()
    render(
      <AppHeader
        section="Jira"
        activeProjectCount={2}
        onAddProject={onAddProject}
        onOpenAgent={onOpenAgent}
      />,
    )
    fireEvent.click(screen.getByText('Agent'))
    expect(onOpenAgent).toHaveBeenCalledOnce()
    expect(onAddProject).not.toHaveBeenCalled()
  })
})

describe('the kicker and the heading', () => {
  it('name the section by default', () => {
    render(<AppHeader section="Projects" activeProjectCount={3} />)
    expect(screen.getByText('3 active')).toBeTruthy()
    expect(screen.getByText('Projects')).toBeTruthy()
  })

  it('take the overrides while a pull request is open', () => {
    render(
      <AppHeader
        section="Pull requests"
        activeProjectCount={3}
        kickerOverride="GitHub · Atlas"
        headingOverride="atlas#1284"
      />,
    )
    expect(screen.getByText('GitHub · Atlas')).toBeTruthy()
    expect(screen.getByText('atlas#1284')).toBeTruthy()
    // And the section name is gone, rather than showing beside the override.
    expect(screen.queryByText('GitHub')).toBeNull()
  })
})
