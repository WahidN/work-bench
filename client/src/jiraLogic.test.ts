import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_STATUS_LABEL,
  initialJiraSelection,
  jiraGroups,
  jiraProjectKey,
  jiraRows,
  jiraStatusGroups,
} from './jiraLogic'
import type { Project, Ticket, Todo } from './queries'

/*
 * Mirrors WorkbenchTests/Views/JiraLogicTests.swift. The rule these mostly guard is that
 * every row comes out of `jiraStatusGroups` exactly once, because the two ways to break
 * that are both silent: an issue with no status vanishing, and an unrecognised category
 * being filed as active work.
 */

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    source: 'jira',
    sourceId: 'JIRA-MR-12',
    text: 'Fix the thing',
    body: '',
    url: null,
    projectId: null,
    canPromote: true,
    done: false,
    promotedTicketId: null,
    priority: 'med',
    dueAt: null,
    doneAt: null,
    pinned: false,
    statusName: 'In Progress',
    statusCategory: 'in_progress',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Todo
}

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 50,
    source: 'jira',
    sourceId: 'JIRA-MR-12',
    title: 'Fix the thing',
    projectId: null,
    status: 'new',
    prId: null,
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Ticket
}

describe('jiraProjectKey', () => {
  it('takes the prefix of the reference', () => {
    expect(jiraProjectKey(todo({ sourceId: 'JIRA-MR-123' }))).toBe('MR')
  })

  it('is null for a manual task, which has no reference at all', () => {
    expect(jiraProjectKey(todo({ source: 'manual', sourceId: null }))).toBeNull()
  })

  it('is null for a reference with no project prefix', () => {
    // "JIRA-123" leaves the bare "123", which carries no dash and so names no project.
    // The Swift's `ref.firstIndex(of: "-")` returns nil here for the same reason.
    expect(jiraProjectKey(todo({ sourceId: 'JIRA-123' }))).toBeNull()
    expect(jiraProjectKey(todo({ sourceId: 'JIRA-' }))).toBeNull()
    expect(jiraProjectKey(todo({ sourceId: 'JIRA--12' }))).toBeNull()
  })
})

describe('jiraGroups', () => {
  it('counts only work not yet started, but still makes a group', () => {
    // A project whose every issue has been promoted still appears, at zero. Dropping it
    // would make the pipeline look like it lost the project.
    const groups = jiraGroups(
      [
        todo({ id: 1, sourceId: 'JIRA-MR-1' }),
        todo({ id: 2, sourceId: 'JIRA-MR-2', promotedTicketId: 9 }),
        todo({ id: 3, sourceId: 'JIRA-AB-1', promotedTicketId: 9 }),
      ],
      [],
    )
    expect(groups.map((group) => [group.key, group.openCount])).toEqual([
      ['MR', 1],
      ['AB', 0],
    ])
  })

  it('sorts by open count, then alphabetically', () => {
    const groups = jiraGroups(
      [
        todo({ id: 1, sourceId: 'JIRA-ZZ-1' }),
        todo({ id: 2, sourceId: 'JIRA-AA-1' }),
        todo({ id: 3, sourceId: 'JIRA-MM-1' }),
        todo({ id: 4, sourceId: 'JIRA-MM-2' }),
      ],
      [],
    )
    expect(groups.map((group) => group.key)).toEqual(['MM', 'AA', 'ZZ'])
  })

  it('names a group after the project that claims the key, and falls back to the key', () => {
    const projects = [{ id: 1, name: 'Atlas', jiraProjectKey: 'MR' } as Project]
    const groups = jiraGroups([todo({ sourceId: 'JIRA-MR-1' })], projects)
    expect(groups[0].displayName).toBe('Atlas')

    const unclaimed = jiraGroups([todo({ sourceId: 'JIRA-XX-1' })], projects)
    expect(unclaimed[0].displayName).toBe('XX')
  })

  it('has no selection to offer when there are no mirrored issues', () => {
    expect(initialJiraSelection([])).toBeNull()
    expect(initialJiraSelection([todo({ source: 'manual', sourceId: null })])).toBeNull()
  })
})

describe('jiraRows', () => {
  it('leads with the newest issue number rather than sorting as text', () => {
    // "MR-12" before "MR-2" is what sorting the reference as a string gives.
    const rows = jiraRows(
      [
        todo({ id: 1, sourceId: 'JIRA-MR-2' }),
        todo({ id: 2, sourceId: 'JIRA-MR-12' }),
        todo({ id: 3, sourceId: 'JIRA-MR-7' }),
      ],
      'MR',
      [],
    )
    expect(rows.map((row) => row.ref)).toEqual(['MR-12', 'MR-7', 'MR-2'])
  })

  it('offers Create PR only for an analysed issue with no pull request yet', () => {
    const promoted = todo({ id: 1, promotedTicketId: 50 })
    expect(jiraRows([promoted], 'MR', [ticket({ status: 'new', prId: null })])[0].showsCreatePr).toBe(
      true,
    )
    // Already has one: the engine answers 409, so the action is not offered.
    expect(jiraRows([promoted], 'MR', [ticket({ status: 'new', prId: 7 })])[0].showsCreatePr).toBe(
      false,
    )
    // Past sparring: not a state a PR is created from.
    expect(
      jiraRows([promoted], 'MR', [ticket({ status: 'in_review', prId: null })])[0].showsCreatePr,
    ).toBe(false)
  })

  it('hides promote and pin once an issue has been promoted', () => {
    const row = jiraRows([todo({ promotedTicketId: 50 })], 'MR', [ticket()])[0]
    expect(row.showsPromote).toBe(false)
    expect(row.showsPin).toBe(false)
  })

  it('treats an empty url as no url', () => {
    expect(jiraRows([todo({ url: '' })], 'MR', [])[0].url).toBeNull()
    expect(jiraRows([todo({ url: 'https://jira/MR-12' })], 'MR', [])[0].url).toBe(
      'https://jira/MR-12',
    )
  })
})

describe('jiraStatusGroups', () => {
  it('puts issues with no status in one trailing group rather than dropping them', () => {
    const rows = jiraRows(
      [
        todo({ id: 1, sourceId: 'JIRA-MR-1', statusName: 'In Progress', statusCategory: 'in_progress' }),
        todo({ id: 2, sourceId: 'JIRA-MR-2', statusName: null, statusCategory: null }),
        todo({ id: 3, sourceId: 'JIRA-MR-3', statusName: null, statusCategory: null }),
      ],
      'MR',
      [],
    )
    const groups = jiraStatusGroups(rows)
    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ['In Progress', 1],
      [UNKNOWN_STATUS_LABEL, 2],
    ])
    // Every row, exactly once.
    expect(groups.flatMap((group) => group.rows).length).toBe(3)
  })

  it('orders active work first, then waiting, then done, then unrecognised', () => {
    const rows = jiraRows(
      [
        todo({ id: 1, sourceId: 'JIRA-MR-1', statusName: 'Released', statusCategory: 'done' }),
        todo({ id: 2, sourceId: 'JIRA-MR-2', statusName: 'Weird', statusCategory: 'sideways' as never }),
        todo({ id: 3, sourceId: 'JIRA-MR-3', statusName: 'Backlog', statusCategory: 'todo' }),
        todo({ id: 4, sourceId: 'JIRA-MR-4', statusName: 'Doing', statusCategory: 'in_progress' }),
      ],
      'MR',
      [],
    )
    expect(jiraStatusGroups(rows).map((group) => group.label)).toEqual([
      'Doing',
      'Backlog',
      'Released',
      'Weird',
    ])
  })

  it('breaks a rank tie on size, then on name', () => {
    const rows = jiraRows(
      [
        todo({ id: 1, sourceId: 'JIRA-MR-1', statusName: 'Zeta', statusCategory: 'todo' }),
        todo({ id: 2, sourceId: 'JIRA-MR-2', statusName: 'Alpha', statusCategory: 'todo' }),
        todo({ id: 3, sourceId: 'JIRA-MR-3', statusName: 'Beta', statusCategory: 'todo' }),
        todo({ id: 4, sourceId: 'JIRA-MR-4', statusName: 'Beta', statusCategory: 'todo' }),
      ],
      'MR',
      [],
    )
    expect(jiraStatusGroups(rows).map((group) => group.label)).toEqual(['Beta', 'Alpha', 'Zeta'])
  })

  it('has no groups for no rows', () => {
    expect(jiraStatusGroups([])).toEqual([])
  })
})
