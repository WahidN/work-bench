/*
 * Port of app/Workbench/Views/JiraLogic.swift.
 *
 * The grouping rules are the part worth reading twice. Every row has to come out of
 * `statusGroups` exactly once, and an unrecognised status category has to sort last rather
 * than be guessed into a bucket: filing closed work as active is worse than filing it at
 * the bottom.
 */

import { projectDotColor, ticketStatusLabel, todoRef } from './logic'
import type { Project, Ticket, Todo } from './queries'

export const JIRA_EMPTY_STATE = 'No Jira issues in this project.'
export const UNKNOWN_STATUS_LABEL = 'Status not known yet'

export type JiraProjectGroup = {
  key: string
  displayName: string
  dot: string
  openCount: number
}

export type JiraRow = {
  id: number
  todo: Todo
  title: string
  ref: string
  stateLabel: string | null
  stateColor: string | null
  showsPromote: boolean
  showsCreatePr: boolean
  ticketId: number | null
  isPinned: boolean
  showsPin: boolean
  url: string | null
}

export type JiraStatusGroup = {
  /** The status name, or a sentinel for the issues whose status is not known. */
  id: string
  label: string
  count: number
  rows: JiraRow[]
}

/** "JIRA-MR-123" becomes "MR". Null for a manual task, or a reference with no prefix. */
export function jiraProjectKey(todo: Todo): string | null {
  const ref = todoRef(todo)
  if (ref === null) return null
  const dash = ref.indexOf('-')
  if (dash === -1) return null
  const key = ref.slice(0, dash)
  return key === '' ? null : key
}

/**
 * The trailing digits of a reference: "MR-123" gives 123, so a project's newest issues
 * lead instead of sorting "MR-12" before "MR-2".
 */
function issueNumber(todo: Todo): number | null {
  const ref = todoRef(todo)
  if (ref === null) return null
  const dash = ref.lastIndexOf('-')
  if (dash === -1) return null
  // Swift's `Int(...)` refuses a string with anything non-numeric in it, so a suffix like
  // "12a" is no number at all rather than 12.
  const tail = ref.slice(dash + 1)
  return /^-?\d+$/.test(tail) ? Number.parseInt(tail, 10) : null
}

/**
 * A PR can be created once an issue has been analysed and has no PR yet. The engine
 * rejects the rest with a 409, so do not offer the action then.
 */
function canCreatePr(ticket: Ticket | undefined): boolean {
  if (!ticket) return false
  return ticket.prId === null && (ticket.status === 'new' || ticket.status === 'sparring')
}

function ticketStatusColor(status: Ticket['status']): string {
  switch (status) {
    case 'new':
      return 'var(--wb-status-needs-review)'
    case 'sparring':
      return 'var(--wb-status-changes-requested)'
    case 'in_review':
    case 'done':
      return 'var(--wb-status-approved)'
    case 'needs_attention':
      return 'var(--wb-status-blocked)'
  }
}

export function jiraGroups(todos: Todo[], projects: Project[]): JiraProjectGroup[] {
  const counts = new Map<string, number>()
  for (const todo of todos) {
    const key = jiraProjectKey(todo)
    if (key === null) continue
    // Every mirrored issue makes a group, but only work not yet started counts.
    counts.set(key, (counts.get(key) ?? 0) + (todo.promotedTicketId === null ? 1 : 0))
  }

  return [...counts.keys()]
    .sort((left, right) => {
      const leftCount = counts.get(left) ?? 0
      const rightCount = counts.get(right) ?? 0
      if (leftCount !== rightCount) return rightCount - leftCount
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map((key) => {
      const index = projects.findIndex((project) => project.jiraProjectKey === key)
      return {
        key,
        displayName: index === -1 ? key : projects[index].name,
        dot: index === -1 ? 'var(--wb-n700)' : projectDotColor(index),
        openCount: counts.get(key) ?? 0,
      }
    })
}

export function initialJiraSelection(todos: Todo[]): string | null {
  return jiraGroups(todos, [])[0]?.key ?? null
}

export function jiraRows(todos: Todo[], key: string, tickets: Ticket[]): JiraRow[] {
  return todos
    .filter((todo) => jiraProjectKey(todo) === key)
    .sort((left, right) => {
      const leftNumber = issueNumber(left) ?? -1
      const rightNumber = issueNumber(right) ?? -1
      if (leftNumber !== rightNumber) return rightNumber - leftNumber
      const leftRef = todoRef(left) ?? ''
      const rightRef = todoRef(right) ?? ''
      return leftRef < rightRef ? -1 : leftRef > rightRef ? 1 : 0
    })
    .map((todo) => {
      const ticket =
        todo.promotedTicketId === null
          ? undefined
          : tickets.find((candidate) => candidate.id === todo.promotedTicketId)
      return {
        id: todo.id,
        todo,
        title: todo.text,
        ref: todoRef(todo) ?? '',
        stateLabel: ticket ? ticketStatusLabel(ticket.status) : null,
        stateColor: ticket ? ticketStatusColor(ticket.status) : null,
        showsPromote: todo.canPromote && todo.promotedTicketId === null,
        showsCreatePr: canCreatePr(ticket),
        ticketId: ticket?.id ?? null,
        isPinned: todo.pinned,
        showsPin: todo.promotedTicketId === null,
        url: todo.url === null || todo.url === '' ? null : todo.url,
      }
    })
}

/**
 * Category order: active work first, then waiting, then finished, then anything this code
 * does not recognise. An unrecognised category sorts last rather than being guessed into a
 * bucket, because filing closed work as active is worse than filing it at the bottom.
 */
function categoryRank(category: string | null | undefined): number {
  switch (category) {
    case 'in_progress':
      return 0
    case 'todo':
      return 1
    case 'done':
      return 2
    default:
      return 3
  }
}

/**
 * Splits one project's rows into a group per distinct status name. Every row comes out
 * exactly once: an issue with no status lands in a single trailing group rather than being
 * dropped, which matters because every issue mirrored before statuses were recorded has
 * none until the next poll.
 */
export function jiraStatusGroups(rows: JiraRow[]): JiraStatusGroup[] {
  if (rows.length === 0) return []

  // Keyed by status name so two issues in "Blocked" share a group. A null name is its own
  // key, and its category is null too, so it ranks last.
  const buckets = new Map<string, JiraRow[]>()
  for (const row of rows) {
    const name = row.todo.statusName ?? UNKNOWN_STATUS_LABEL
    const existing = buckets.get(name)
    if (existing) existing.push(row)
    else buckets.set(name, [row])
  }

  return [...buckets.entries()]
    .map(([name, grouped]) => ({
      id: name,
      label: name,
      count: grouped.length,
      rows: grouped,
    }))
    .sort((left, right) => {
      const leftRank = categoryRank(left.rows[0]?.todo.statusCategory)
      const rightRank = categoryRank(right.rows[0]?.todo.statusCategory)
      if (leftRank !== rightRank) return leftRank - rightRank
      if (left.count !== right.count) return right.count - left.count
      return left.label < right.label ? -1 : left.label > right.label ? 1 : 0
    })
}
