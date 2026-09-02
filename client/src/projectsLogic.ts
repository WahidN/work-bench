/*
 * Port of app/Workbench/Views/ProjectsLogic.swift and ProjectDetailLogic.swift.
 *
 * `relativeTime` and `isOpenTask` are not repeated here: the Swift has them on
 * ProjectsLogic and the port already has them in logic.ts, where Today and the pull
 * request list were the first callers. Copying them in would be the drift the shared
 * helper exists to prevent.
 */

import {
  isOpenTask,
  projectDot,
  projectDotColor,
  projectName,
  pullRequestRef,
  relativeTime,
  ticketRef,
  todoRef,
  type TaskRow,
} from './logic'
import type { Pr, Project, Ticket, Todo } from './queries'

export const PROJECTS_EMPTY_STATE = 'No projects yet. Add one to get started.'
export const NO_ACTIVITY_TEXT = 'no activity yet'
export const NO_TASKS_TEXT = 'No tasks for this project yet.'
export const NO_OPEN_WORK_TEXT = 'Nothing open.'
export const NOTES_PLACEHOLDER = 'Notes for this project. Saved as you type.'

const ISSUE_SYMBOL = 'list-bullet-rectangle'
const PULL_REQUEST_SYMBOL = 'arrow-triangle-pull'

export function projectStatusLabel(status: Project['status']): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'paused':
      return 'Paused'
    case 'planning':
      return 'Planning'
  }
}

export function prCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'PR' : 'PRs'}`
}

export function activeCount(projects: Project[]): number {
  return projects.filter((project) => project.status === 'active').length
}

/**
 * Projects carry no timestamp of their own, so "updated" is the newest thing the project
 * owns: a task, an issue or a pull request.
 */
export function activityText(
  project: Project,
  todos: Todo[],
  tickets: Ticket[],
  prs: Pr[],
  now: Date,
): string {
  const stamps = [
    ...todos.filter((todo) => todo.projectId === project.id).map((todo) => todo.createdAt),
    ...tickets.filter((ticket) => ticket.projectId === project.id).map((ticket) => ticket.createdAt),
    ...prs.filter((pr) => pr.projectId === project.id).map((pr) => pr.createdAt),
  ]

  const times = stamps.map((stamp) => new Date(stamp).getTime()).filter((time) => !Number.isNaN(time))
  if (times.length === 0) return NO_ACTIVITY_TEXT
  return relativeTime(new Date(Math.max(...times)), now)
}

export type ProjectCard = {
  id: number
  project: Project
  name: string
  dot: string
  statusLabel: string
  blurb: string
  openCount: number
  prCount: number
  activity: string
}

/**
 * Cards keep the order of the projects array, because the dot colour is taken by index the
 * same way the sidebar takes it, and the two must agree.
 */
export function projectCards(input: {
  projects: Project[]
  todos: Todo[]
  tickets: Ticket[]
  prs: Pr[]
  now: Date
}): ProjectCard[] {
  const { projects, todos, tickets, prs, now } = input
  return projects.map((project, index) => ({
    id: project.id,
    project,
    name: project.name,
    dot: projectDotColor(index),
    statusLabel: projectStatusLabel(project.status),
    blurb: project.blurb,
    openCount: todos.filter((todo) => todo.projectId === project.id && isOpenTask(todo)).length,
    prCount: prs.filter((pr) => pr.projectId === project.id && pr.status !== 'merged').length,
    activity: activityText(project, todos, tickets, prs, now),
  }))
}

/* ------------------------------------------------------------ Project detail */

/**
 * "Overdue" or "Today" for a dated task, null for one with no due date. This takes the tag
 * slot on the shared row, the same way Today puts "Pinned" and "Jira" there.
 */
export function dueLabel(todo: Todo, today: string): string | null {
  if (todo.dueAt === null) return null
  if (todo.dueAt < today) return 'Overdue'
  if (todo.dueAt === today) return 'Today'
  return null
}

/** The pinned pseudo-task row, kept identical to Today's so the two screens cannot drift. */
function pinnedRow(todo: Todo, projects: Project[]): TaskRow {
  return {
    id: `todo-${todo.id}`,
    source: 'pinnedTodo',
    title: todo.text,
    isDone: false,
    projectName: projectName(todo.projectId, projects),
    projectDot: 'var(--wb-accent)',
    ref: todoRef(todo),
    refSymbol: ISSUE_SYMBOL,
    tag: 'Pinned',
    priority: null,
    deletable: todo.source === 'manual',
  }
}

/**
 * The plain row on this screen, which differs from Today's in two ways: the tag is the due
 * label rather than "Jira", and there is no priority, because the Tasks tab offers no way
 * to change one.
 */
function plainRow(todo: Todo, projects: Project[], today: string): TaskRow {
  return {
    id: `todo-${todo.id}`,
    source: 'todo',
    title: todo.text,
    isDone: todo.done,
    projectName: projectName(todo.projectId, projects),
    projectDot: projectDot(todo.projectId, projects),
    ref: todoRef(todo),
    refSymbol: ISSUE_SYMBOL,
    tag: todo.done ? null : dueLabel(todo, today),
    priority: null,
    deletable: todo.source === 'manual',
  }
}

/**
 * Manual tasks and pinned Jira issues for this project. Overdue first, then the rest by
 * creation, then anything completed. A pinned issue keeps the pseudo-task look and the
 * unpin checkbox it already has on Today.
 */
export function projectTaskRows(input: {
  todos: Todo[]
  project: Project
  projects: Project[]
  today: string
}): TaskRow[] {
  const { todos, project, projects, today } = input
  const mine = todos.filter(
    (todo) => todo.projectId === project.id && (todo.source === 'manual' || todo.pinned),
  )

  const open = mine
    .filter((todo) => !todo.done)
    .sort((left, right) => {
      const leftOverdue = dueLabel(left, today) === 'Overdue'
      const rightOverdue = dueLabel(right, today) === 'Overdue'
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1
      return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0
    })

  const done = mine
    .filter((todo) => todo.done)
    .sort((left, right) =>
      left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0,
    )

  return [...open, ...done].map((todo) =>
    todo.pinned ? pinnedRow(todo, projects) : plainRow(todo, projects, today),
  )
}

export type ProjectFacts = {
  status: string
  openTasks: number
  openPrs: number
  lastActivity: string
}

export function projectFacts(input: {
  project: Project
  todos: Todo[]
  tickets: Ticket[]
  prs: Pr[]
  now: Date
}): ProjectFacts {
  const { project, todos, tickets, prs, now } = input
  return {
    status: projectStatusLabel(project.status),
    openTasks: todos.filter((todo) => todo.projectId === project.id && isOpenTask(todo)).length,
    openPrs: prs.filter((pr) => pr.projectId === project.id && pr.status !== 'merged').length,
    lastActivity: activityText(project, todos, tickets, prs, now),
  }
}

export type OpenWorkItem = {
  id: string
  kind: 'pullRequest' | 'ticket'
  targetId: number
  ref: string
  title: string
  symbol: string
}

export function openWork(project: Project, tickets: Ticket[], prs: Pr[]): OpenWorkItem[] {
  const prItems: OpenWorkItem[] = prs
    .filter((pr) => pr.projectId === project.id && pr.status !== 'merged')
    .map((pr) => {
      const ref = pullRequestRef(pr, project)
      return {
        id: `pr-${pr.id}`,
        kind: 'pullRequest',
        targetId: pr.id,
        ref,
        // An empty title falls back to the ref rather than rendering a dash of nothing.
        title: pr.title === '' ? ref : pr.title,
        symbol: PULL_REQUEST_SYMBOL,
      }
    })

  const ticketItems: OpenWorkItem[] = tickets
    .filter((ticket) => ticket.projectId === project.id && ticket.status !== 'done')
    .map((ticket) => {
      const ref = ticketRef(ticket)
      return {
        id: `ticket-${ticket.id}`,
        kind: 'ticket',
        targetId: ticket.id,
        ref,
        title: ticket.title === '' ? ref : ticket.title,
        symbol: ISSUE_SYMBOL,
      }
    })

  return [...prItems, ...ticketItems]
}
