/*
 * Ports the pure logic behind the two screens: TodayLogic, SidebarLogic, PRsLogic and
 * WorkItemRef. Rules are copied rather than reinterpreted, including the comments that
 * explain why a rule is the way it is, because those are the parts a rewrite silently
 * gets wrong.
 */

import type { Pr, Project, Ticket, Todo } from './queries'

export type SidebarSection = 'Today' | 'Projects' | 'Pull requests' | 'Jira'

export const SECTIONS: SidebarSection[] = ['Today', 'Projects', 'Pull requests', 'Jira']

export const SECTION_SYMBOL: Record<SidebarSection, string> = {
  Today: 'sun-horizon',
  Projects: 'square-grid-2x2',
  'Pull requests': 'arrow-triangle-pull',
  Jira: 'list-bullet-rectangle',
}

const ISSUE_SYMBOL = 'list-bullet-rectangle'
const PULL_REQUEST_SYMBOL = 'arrow-triangle-pull'
const PINNED_TAG = 'Pinned'
const JIRA_TAG = 'Jira'
const NO_PROJECT_NAME = 'No project'

/* ---------------------------------------------------------------- WorkItemRef */

function stripping(prefix: string, id: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/** "acme/atlas" -> "atlas". Null for an unset or empty repo. */
export function repoShortName(githubRepo: string | null): string | null {
  if (!githubRepo) return null
  const parts = githubRepo.split('/')
  const name = parts[parts.length - 1] ?? githubRepo
  return name === '' ? null : name
}

/**
 * The handle used in refs: the GitHub repo name when known, otherwise the first word of
 * the project name, lowercased.
 */
export function projectSlug(project: Project): string {
  const repo = repoShortName(project.githubRepo)
  if (repo) return repo
  return (project.name.split(' ')[0] ?? project.name).toLowerCase()
}

/** "atlas#1284". Falls back to the branch while GitHub has not assigned a number. */
export function pullRequestRef(pr: Pr, project: Project | undefined): string {
  if (pr.number === null) return pr.branch
  if (!project) return `#${pr.number}`
  return `${projectSlug(project)}#${pr.number}`
}

/** "JIRA-ATL-441" -> "ATL-441", "GH-acme/beacon#57" -> "beacon#57". */
export function ticketRef(ticket: Ticket): string {
  switch (ticket.source) {
    case 'jira':
      return stripping('JIRA-', ticket.sourceId)
    case 'sentry':
      return stripping('SENTRY-', ticket.sourceId)
    case 'github': {
      const withoutPrefix = stripping('GH-', ticket.sourceId)
      const lastSlash = withoutPrefix.lastIndexOf('/')
      return lastSlash === -1 ? withoutPrefix : withoutPrefix.slice(lastSlash + 1)
    }
  }
}

/** "JIRA-ATL-441" -> "ATL-441". Null for a manual task, which has no source reference. */
export function todoRef(todo: Todo): string | null {
  if (todo.source !== 'jira' || todo.sourceId === null) return null
  return stripping('JIRA-', todo.sourceId)
}

export function prStatusLabel(status: Pr['status']): string {
  switch (status) {
    case 'open':
      return 'Needs review'
    case 'needs_attention':
      return 'Changes requested'
    case 'merged':
      return 'Merged'
  }
}

export function ticketStatusLabel(status: Ticket['status']): string {
  switch (status) {
    case 'new':
      return 'To do'
    case 'sparring':
      return 'In progress'
    case 'in_review':
      return 'In review'
    case 'done':
      return 'Done'
    case 'needs_attention':
      return 'Blocked'
  }
}

/* ------------------------------------------------------------------- Sidebar */

export function projectDotColor(index: number): string {
  return `var(--wb-dot-${index % 8})`
}

/** Manual or pinned, and not done. */
export function isOpenTask(todo: Todo): boolean {
  return (todo.source === 'manual' || todo.pinned) && !todo.done
}

export function navCount(
  section: SidebarSection,
  data: { todos: Todo[]; jiraTodos: Todo[]; tickets: Ticket[]; prs: Pr[]; projects: Project[] },
): number {
  switch (section) {
    case 'Today':
      return data.todos.filter((todo) => !todo.done).length
    case 'Projects':
      return data.projects.length
    case 'Pull requests':
      return data.prs.length
    // Jira work not yet started. Promoted issues are counted by the pipeline surfaces
    // instead, and they are no longer waiting on the user here.
    case 'Jira':
      return data.jiraTodos.filter(
        (todo) => todo.source === 'jira' && todo.promotedTicketId === null && !todo.done,
      ).length
  }
}

export function projectOpenCount(project: Project, todos: Todo[]): number {
  return todos.filter((todo) => todo.projectId === project.id && isOpenTask(todo)).length
}

export function accountInitials(fullName: string): string {
  const parts = fullName.split(' ').filter((part) => part !== '')
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ''
}

/* --------------------------------------------------------------------- Today */

export type TaskRowSource = 'todo' | 'pinnedTodo' | 'pinnedTicket' | 'pinnedPullRequest'

export type TaskRow = {
  id: string
  source: TaskRowSource
  title: string
  isDone: boolean
  projectName: string
  projectDot: string
  ref: string | null
  refSymbol: string
  tag: string | null
  priority: Todo['priority'] | null
  /** Whether this row would offer a delete control. Manual tasks only. */
  deletable: boolean
}

export type TaskSection = {
  label: string
  color: string
  rows: TaskRow[]
}

/** The local calendar date, matching the engine's `localDate`. */
export function dayString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function projectName(projectId: number | null, projects: Project[]): string {
  if (projectId === null) return NO_PROJECT_NAME
  return projects.find((project) => project.id === projectId)?.name ?? NO_PROJECT_NAME
}

export function projectDot(projectId: number | null, projects: Project[]): string {
  if (projectId === null) return 'var(--wb-n700)'
  const index = projects.findIndex((project) => project.id === projectId)
  return index === -1 ? 'var(--wb-n700)' : projectDotColor(index)
}

export function isOverdue(todo: Todo, today: string): boolean {
  if (todo.dueAt === null) return false
  return todo.dueAt < today
}

function todoRow(todo: Todo, projects: Project[]): TaskRow {
  return {
    id: `todo-${todo.id}`,
    source: 'todo',
    title: todo.text,
    isDone: todo.done,
    projectName: projectName(todo.projectId, projects),
    projectDot: projectDot(todo.projectId, projects),
    ref: todoRef(todo),
    refSymbol: ISSUE_SYMBOL,
    tag: todo.source === 'jira' ? JIRA_TAG : null,
    priority: todo.done ? null : todo.priority,
    deletable: todo.source === 'manual',
  }
}

/**
 * A pinned todo renders like a pinned ticket or PR: accent dot, its ref as the link,
 * tag "Pinned", no priority. Its checkbox unpins rather than completing.
 */
function pinnedTodoRow(todo: Todo, projects: Project[]): TaskRow {
  return {
    id: `todo-${todo.id}`,
    source: 'pinnedTodo',
    title: todo.text,
    isDone: false,
    projectName: projectName(todo.projectId, projects),
    projectDot: 'var(--wb-accent)',
    ref: todoRef(todo),
    refSymbol: ISSUE_SYMBOL,
    tag: PINNED_TAG,
    priority: null,
    // Pinned counts: a task the user created stays theirs to remove whether or not they
    // pulled it onto Today, and a control that vanished on pinning reads as a bug.
    deletable: todo.source === 'manual',
  }
}

function pinnedTicketRow(ticket: Ticket, projects: Project[]): TaskRow {
  return {
    id: `ticket-${ticket.id}`,
    source: 'pinnedTicket',
    title: ticket.title,
    isDone: false,
    projectName: projectName(ticket.projectId, projects),
    projectDot: 'var(--wb-accent)',
    ref: ticketRef(ticket),
    refSymbol: ISSUE_SYMBOL,
    tag: PINNED_TAG,
    priority: null,
    deletable: false,
  }
}

/** A PR carries no title of its own; the issue it was created from supplies it. */
function linkedTitle(pr: Pr, tickets: Ticket[], fallback: string): string {
  return tickets.find((ticket) => ticket.id === pr.ticketId)?.title ?? fallback
}

function pinnedPrRow(pr: Pr, tickets: Ticket[], projects: Project[]): TaskRow {
  const project = projects.find((candidate) => candidate.id === pr.projectId)
  const ref = pullRequestRef(pr, project)
  return {
    id: `pr-${pr.id}`,
    source: 'pinnedPullRequest',
    title: linkedTitle(pr, tickets, ref),
    isDone: false,
    projectName: projectName(pr.projectId, projects),
    projectDot: 'var(--wb-accent)',
    ref,
    refSymbol: PULL_REQUEST_SYMBOL,
    tag: PINNED_TAG,
    priority: null,
    deletable: false,
  }
}

export function taskSections(input: {
  todos: Todo[]
  tickets: Ticket[]
  prs: Pr[]
  projects: Project[]
  today: string
}): TaskSection[] {
  const { todos, tickets, prs, projects, today } = input

  const pinnedTodoRows = todos.filter((todo) => todo.pinned).map((todo) => pinnedTodoRow(todo, projects))
  const unpinned = todos.filter((todo) => !todo.pinned)
  const open = unpinned.filter((todo) => !todo.done)
  const overdue = open.filter((todo) => isOverdue(todo, today)).map((todo) => todoRow(todo, projects))
  const dueToday = open.filter((todo) => !isOverdue(todo, today)).map((todo) => todoRow(todo, projects))
  const done = unpinned.filter((todo) => todo.done).map((todo) => todoRow(todo, projects))

  const pinned = [
    ...pinnedTodoRows,
    ...tickets.filter((ticket) => ticket.pinned).map((ticket) => pinnedTicketRow(ticket, projects)),
    ...prs.filter((pr) => pr.pinned).map((pr) => pinnedPrRow(pr, tickets, projects)),
  ]

  const sections: TaskSection[] = []
  if (overdue.length > 0) {
    sections.push({ label: 'Overdue', color: 'var(--wb-a300)', rows: overdue })
  }
  sections.push({ label: 'Today', color: 'var(--wb-n500)', rows: [...pinned, ...dueToday] })
  if (done.length > 0) {
    sections.push({ label: 'Done', color: 'var(--wb-n700)', rows: done })
  }
  return sections
}

export function priorityLabel(priority: Todo['priority']): string {
  return priority === 'high' ? 'HIGH' : priority === 'med' ? 'MED' : 'LOW'
}

export function priorityColor(priority: Todo['priority']): string {
  return priority === 'high'
    ? 'var(--wb-a300)'
    : priority === 'med'
      ? 'var(--wb-n500)'
      : 'var(--wb-n700)'
}

/* ----------------------------------------------------------------- Today rail */

export type RailItem = {
  id: string
  title: string
  meta: string
  symbol: string
  symbolColor: string
  isPinned: boolean
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

function prStatusColor(status: Pr['status']): string {
  switch (status) {
    case 'open':
      return 'var(--wb-status-needs-review)'
    case 'needs_attention':
      return 'var(--wb-status-changes-requested)'
    case 'merged':
      return 'var(--wb-status-approved)'
  }
}

/** Needs-attention first, then newest. */
function byAttentionThenNewest<T extends { status: string; createdAt: string }>(left: T, right: T): number {
  const leftRank = left.status === 'needs_attention' ? 0 : 1
  const rightRank = right.status === 'needs_attention' ? 0 : 1
  if (leftRank !== rightRank) return leftRank - rightRank
  return right.createdAt.localeCompare(left.createdAt)
}

export function issueRail(tickets: Ticket[], limit = 3): RailItem[] {
  return tickets
    .filter((ticket) => ticket.status !== 'done')
    .sort(byAttentionThenNewest)
    .slice(0, limit)
    .map((ticket) => ({
      id: `ticket-${ticket.id}`,
      title: ticket.title,
      meta: `${ticketRef(ticket)} · ${ticketStatusLabel(ticket.status)}`,
      symbol: ISSUE_SYMBOL,
      symbolColor: ticketStatusColor(ticket.status),
      isPinned: ticket.pinned,
    }))
}

export function pullRequestRail(
  prs: Pr[],
  tickets: Ticket[],
  projects: Project[],
  limit = 3,
): RailItem[] {
  return prs
    .filter((pr) => pr.status !== 'merged')
    .sort(byAttentionThenNewest)
    .slice(0, limit)
    .map((pr) => {
      const ref = pullRequestRef(
        pr,
        projects.find((project) => project.id === pr.projectId),
      )
      return {
        id: `pr-${pr.id}`,
        title: linkedTitle(pr, tickets, ref),
        meta: `${ref} · ${prStatusLabel(pr.status)}`,
        symbol: PULL_REQUEST_SYMBOL,
        symbolColor: prStatusColor(pr.status),
        isPinned: pr.pinned,
      }
    })
}

/* ------------------------------------------------------------ Pull requests */

export type PrFilter = 'assignedToMe' | 'needsReview' | 'mine'

export const PR_FILTERS: PrFilter[] = ['assignedToMe', 'needsReview', 'mine']

export const PR_EMPTY_STATE =
  'Nothing here. Pull requests you open, get assigned, or are asked to review show up automatically.'

export function prFilterLabel(filter: PrFilter): string {
  switch (filter) {
    case 'assignedToMe':
      return 'Assigned to me'
    case 'needsReview':
      return 'Needs review'
    case 'mine':
      return 'Mine'
  }
}

/** A draft is a draft whatever the reviewers said, so it wins. */
export function prReviewStateLabel(pr: Pr): string {
  if (pr.isDraft) return 'Draft'
  switch (pr.reviewState) {
    case 'approved':
      return 'Approved'
    case 'changes_requested':
      return 'Changes requested'
    case 'review_required':
    case null:
      return 'Needs review'
  }
}

export function relativeTime(from: Date, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - from.getTime()) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

/**
 * "acv-website#24", the bare repository name and the number.
 *
 * Either half can be missing: no number drops the "#24", no repo drops the repo name, and
 * both missing gives back an empty string. Shared with the header, which shows the same
 * ref as its heading while a pull request is open, exactly as `PRsLogic.ref` is shared.
 */
export function prListRef(pr: Pr, project: Project | undefined): string {
  const repo = repoShortName(project?.githubRepo ?? null) ?? ''
  return pr.number === null ? repo : `${repo}#${pr.number}`
}

export type PrRow = {
  id: number
  title: string
  ref: string
  projectName: string
  statusLabel: string
  updatedText: string
  pinned: boolean
  messageCount: number
}

function keep(pr: Pr, filter: PrFilter): boolean {
  switch (filter) {
    case 'assignedToMe':
      return pr.assignedToMe
    case 'mine':
      return pr.authoredByMe
    // Whether GitHub asks this user for a review, not what the pull request's overall
    // review decision is. The status label still reports the latter, so a row here can
    // read "Approved" when a colleague approved it and this request stands.
    //
    // Drafts stay out. The predicate this replaced ran through the status label, which
    // answers "Draft" before it looks at the review state, so asking for reviewers on a
    // draft never queued it. That guard is deliberate, not incidental.
    case 'needsReview':
      return pr.reviewRequestedByMe === true && !pr.isDraft
  }
}

export function prRows(prs: Pr[], projects: Project[], filter: PrFilter, now: Date): PrRow[] {
  return prs
    .filter((pr) => keep(pr, filter))
    .map((pr) => {
      const project = projects.find((candidate) => candidate.id === pr.projectId)
      return {
        id: pr.id,
        title: pr.title,
        // The row shows the bare repository name, so "acv-website#24".
        ref: prListRef(pr, project),
        projectName: project?.name ?? '',
        statusLabel: prReviewStateLabel(pr),
        updatedText: pr.githubUpdatedAt
          ? relativeTime(new Date(pr.githubUpdatedAt), now)
          : '',
        pinned: pr.pinned,
        messageCount: pr.messageCount,
      }
    })
}

/* -------------------------------------------------------------------- Header */

export function todayDateString(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function headerKicker(
  section: SidebarSection,
  activeProjectCount: number,
  today: string,
): string {
  switch (section) {
    case 'Today':
      return today
    case 'Projects':
      return `${activeProjectCount} active`
    case 'Pull requests':
      return 'GitHub'
    case 'Jira':
      return 'Jira'
  }
}
