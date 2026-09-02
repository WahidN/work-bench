// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
import type { Project } from './queries'

/*
 * `commandPaletteLogic.ts` decides which rows exist; this decides which one Enter runs.
 * That split matters because the selection can outlive the row it points at: typing shrinks
 * the list under a selection that was valid a keystroke ago, and Enter then has to do
 * something sensible rather than nothing.
 */

afterEach(cleanup)

const PROJECTS = [
  {
    id: 1,
    name: 'Atlas',
    repoPath: '/repos/atlas',
    defaultBranch: 'main',
    githubRepo: 'acme/atlas',
    jiraProjectKey: null,
    sentryProjectSlug: null,
    status: 'active',
    blurb: '',
    notes: '',
  },
] as Project[]

function setup() {
  const onRun = vi.fn()
  const onClose = vi.fn()
  render(<CommandPalette projects={PROJECTS} onRun={onRun} onClose={onClose} />)
  return { onRun, onClose, field: screen.getByPlaceholderText('Search, or type a task to add it') }
}

function selectedRow(): string | null {
  return document.querySelector('[data-selected]')?.getAttribute('data-palette-row') ?? null
}

describe('opening', () => {
  it('shows the five commands and selects the first', () => {
    setup()
    expect(document.querySelectorAll('[data-palette-row]')).toHaveLength(5)
    expect(selectedRow()).toBe('nav-today')
  })

  it('focuses the field, which is what makes the arrows and Escape reach it', () => {
    const { field } = setup()
    expect(document.activeElement).toBe(field)
  })
})

describe('the arrow keys', () => {
  it('move the selection and clamp at both ends', () => {
    const { field } = setup()
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selectedRow()).toBe('nav-today')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedRow()).toBe('nav-projects')

    for (let index = 0; index < 10; index += 1) fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedRow()).toBe('ask-agent')
  })
})

describe('hover', () => {
  it('moves the selection, so exactly one row is ever highlighted', () => {
    // Otherwise the mouse would point at one row while Enter ran another.
    setup()
    fireEvent.mouseEnter(screen.getByText('Go to Jira'))
    expect(selectedRow()).toBe('nav-jira')
  })
})

describe('Enter', () => {
  it('runs the selected row and closes', () => {
    const { onRun, onClose, field } = setup()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith({ kind: 'navigate', section: 'Projects' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('adds the typed task when nothing else was chosen', () => {
    const { onRun, field } = setup()
    fireEvent.change(field, { target: { value: 'buy milk' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith({ kind: 'addTask', text: 'buy milk' })
  })

  it('still runs something after the list has shrunk under the selection', () => {
    /*
     * Select the fifth row, then type a query that leaves two. The selection is clamped
     * back rather than left pointing past the end, so Enter runs a row instead of nothing.
     */
    const { onRun, field } = setup()
    for (let index = 0; index < 4; index += 1) fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedRow()).toBe('ask-agent')

    fireEvent.change(field, { target: { value: 'atlas' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledOnce()
  })
})

describe('closing', () => {
  it('closes on Escape', () => {
    const { onClose, field } = setup()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on a click outside, and not on one inside', () => {
    const { onClose } = setup()
    fireEvent.click(document.querySelector('#palette') as Element)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('#palette-backdrop') as Element)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('typing', () => {
  it('leads with the task, then the project, then the commands', () => {
    const { field } = setup()
    fireEvent.change(field, { target: { value: 'atlas' } })
    expect(
      [...document.querySelectorAll('[data-palette-row]')].map((row) =>
        row.getAttribute('data-palette-row'),
      ),
    ).toEqual(['add-task', 'project-1'])
  })
})
