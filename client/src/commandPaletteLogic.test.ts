import { describe, expect, it } from 'vitest'
import {
  movePaletteSelection,
  paletteCommands,
  paletteResults,
} from './commandPaletteLogic'
import type { Project } from './queries'

/*
 * Mirrors WorkbenchTests/Views/CommandPaletteLogicTests.swift.
 *
 * The invariant Enter leans on is that the list is never empty: an empty query gives the
 * commands, and anything typed always gives at least the task it would add.
 */

function project(id: number, name: string): Project {
  return {
    id,
    name,
    repoPath: '/tmp/x',
    defaultBranch: 'main',
    githubRepo: null,
    jiraProjectKey: null,
    sentryProjectSlug: null,
    status: 'active',
    blurb: '',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Project
}

const PROJECTS = [project(1, 'Atlas'), project(2, 'Beacon'), project(3, 'atlas-tools')]

describe('paletteCommands', () => {
  it('offers the four sections and the agent', () => {
    expect(paletteCommands.map((row) => row.label)).toEqual([
      'Go to Today',
      'Go to Projects',
      'Go to Pull requests',
      'Go to Jira',
      'Ask the agent',
    ])
  })

  it('takes its symbols from the sidebar, so the two cannot drift', () => {
    expect(paletteCommands[0].symbol).toBe('sun-horizon')
    expect(paletteCommands[3].symbol).toBe('list-bullet-rectangle')
  })
})

describe('paletteResults', () => {
  it('gives the commands for an empty query, and for whitespace', () => {
    expect(paletteResults('', PROJECTS)).toEqual(paletteCommands)
    expect(paletteResults('   ', PROJECTS)).toEqual(paletteCommands)
  })

  it('always leads with the task it would add', () => {
    const rows = paletteResults('buy milk', PROJECTS)
    expect(rows[0].id).toBe('add-task')
    expect(rows[0].label).toBe('Add task "buy milk"')
    expect(rows[0].action).toEqual({ kind: 'addTask', text: 'buy milk' })
  })

  it('is never empty, which is what Enter depends on', () => {
    expect(paletteResults('nothing matches this at all', []).length).toBeGreaterThan(0)
  })

  it('matches projects case-insensitively', () => {
    const rows = paletteResults('atlas', PROJECTS)
    expect(rows.filter((row) => row.action.kind === 'openProject').map((row) => row.label)).toEqual([
      'Atlas',
      'atlas-tools',
    ])
  })

  it('matches a command on its label, never on its hint', () => {
    // "today" finds Go to Today; "1" finds only the task it would add, not ⌘1.
    expect(paletteResults('today', []).some((row) => row.id === 'nav-today')).toBe(true)
    expect(paletteResults('1', []).map((row) => row.id)).toEqual(['add-task'])
  })

  it('trims the task text but searches on the trimmed query too', () => {
    const rows = paletteResults('  Atlas  ', PROJECTS)
    expect(rows[0].label).toBe('Add task "Atlas"')
    expect(rows.some((row) => row.action.kind === 'openProject')).toBe(true)
  })
})

describe('movePaletteSelection', () => {
  it('clamps at both ends rather than wrapping', () => {
    expect(movePaletteSelection(0, -1, 5)).toBe(0)
    expect(movePaletteSelection(4, 1, 5)).toBe(4)
    expect(movePaletteSelection(2, 1, 5)).toBe(3)
    expect(movePaletteSelection(2, -1, 5)).toBe(1)
  })

  it('is 0 for an empty list', () => {
    expect(movePaletteSelection(3, 1, 0)).toBe(0)
  })

  it('clamps a selection already past the end, which a shrinking list can leave behind', () => {
    expect(movePaletteSelection(9, 0, 3)).toBe(2)
  })
})
