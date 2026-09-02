/*
 * Port of app/Workbench/Views/CommandPaletteLogic.swift.
 *
 * The action is data and not a callback, for the same reason it is an enum in the Swift: a
 * closure would make a row impossible to compare, and then these matching rules could only
 * be checked by eye. The shell interprets the action.
 */

import { SECTION_SYMBOL, SECTIONS, type SidebarSection } from './logic'
import type { Project } from './queries'

export type PaletteAction =
  | { kind: 'navigate'; section: SidebarSection }
  | { kind: 'askAgent' }
  | { kind: 'openProject'; project: Project }
  | { kind: 'addTask'; text: string }

export type PaletteRow = {
  id: string
  symbol: string
  label: string
  hint: string
  action: PaletteAction
}

const NAV_HINT: Record<SidebarSection, string> = {
  Today: '⌘1',
  Projects: '⌘2',
  'Pull requests': '⌘3',
  Jira: '⌘4',
}

const NAV_ID: Record<SidebarSection, string> = {
  Today: 'nav-today',
  Projects: 'nav-projects',
  'Pull requests': 'nav-prs',
  Jira: 'nav-jira',
}

/**
 * Shown whenever the query is empty. The four navigation rows take their symbols from the
 * sidebar's own table so the palette and the sidebar cannot drift.
 */
export const paletteCommands: PaletteRow[] = [
  ...SECTIONS.map((section) => ({
    id: NAV_ID[section],
    symbol: SECTION_SYMBOL[section],
    label: `Go to ${section}`,
    hint: NAV_HINT[section],
    action: { kind: 'navigate', section } as PaletteAction,
  })),
  { id: 'ask-agent', symbol: 'sparkles', label: 'Ask the agent', hint: '⌘J', action: { kind: 'askAgent' } },
]

/**
 * Never returns an empty array: an empty query gives the five commands, and a non-empty one
 * always gives at least the add-task row. Enter depends on that.
 */
export function paletteResults(query: string, projects: Project[]): PaletteRow[] {
  const trimmed = query.trim()
  if (trimmed === '') return paletteCommands

  const needle = trimmed.toLowerCase()
  const addTask: PaletteRow = {
    id: 'add-task',
    symbol: 'plus',
    label: `Add task "${trimmed}"`,
    hint: 'Enter',
    action: { kind: 'addTask', text: trimmed },
  }
  const matchedProjects: PaletteRow[] = projects
    .filter((project) => project.name.toLowerCase().includes(needle))
    .map((project) => ({
      id: `project-${project.id}`,
      symbol: 'folder',
      label: project.name,
      hint: 'Project',
      action: { kind: 'openProject', project },
    }))
  // Matching the label and not the hint is what makes "today" find Go to Today while "1"
  // finds nothing but the task it would add.
  const matchedCommands = paletteCommands.filter((row) => row.label.toLowerCase().includes(needle))
  return [addTask, ...matchedProjects, ...matchedCommands]
}

/** Clamps rather than wraps: one rule instead of two, and no surprise at the ends. */
export function movePaletteSelection(selection: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(count - 1, selection + delta))
}
