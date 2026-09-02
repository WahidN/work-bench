import { describe, expect, it } from 'vitest'
import {
  accountInitials,
  dayString,
  headerKicker,
  isOpenTask,
  isOverdue,
  issueRail,
  navCount,
  prFilterLabel,
  prListRef,
  prReviewStateLabel,
  prRows,
  prStatusLabel,
  priorityColor,
  priorityLabel,
  projectDot,
  projectDotColor,
  projectName,
  projectOpenCount,
  projectSlug,
  pullRequestRail,
  pullRequestRef,
  relativeTime,
  repoShortName,
  taskSections,
  ticketRef,
  ticketStatusLabel,
  todayDateString,
  todoRef,
} from './logic'
import type { Pr, Project, Ticket, Todo } from './queries'

/*
 * Mirrors TodayLogicTests, PRsLogicTests, SidebarLogicTests, WorkItemLabelsTests and
 * AppHeaderLogicTests, which between them are the largest block of tests in the Swift app.
 *
 * `logic.ts` is where the port's silent bugs would live: a ref built from the wrong field,
 * a count that includes the 138 mirrored Jira issues, a section that swallows a task.
 * None of those throw.
 */

const PROJECTS: Project[] = [
  {
    id: 1,
    name: 'Atlas Payments',
    repoPath: '/repos/atlas',
    defaultBranch: 'main',
    githubRepo: 'acme/atlas',
    jiraProjectKey: 'ATL',
    sentryProjectSlug: null,
    status: 'active',
    blurb: '',
    notes: '',
  },
  {
    id: 2,
    name: 'Relay',
    repoPath: '/repos/relay',
    defaultBranch: 'main',
    githubRepo: 'acme/relay',
    jiraProjectKey: 'REL',
    sentryProjectSlug: null,
    status: 'paused',
    blurb: '',
    notes: '',
  },
] as Project[]

const TODAY = '2026-08-14'

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    source: 'manual',
    sourceId: null,
    text: 'Cut the release branch',
    body: '',
    url: null,
    projectId: 1,
    canPromote: false,
    done: false,
    promotedTicketId: null,
    priority: 'med',
    dueAt: TODAY,
    doneAt: null,
    pinned: false,
    statusName: null,
    statusCategory: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Todo
}

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 10,
    source: 'jira',
    sourceId: 'JIRA-ATL-441',
    title: 'Refunds double-charge on retry',
    projectId: 1,
    status: 'new',
    prId: null,
    pinned: false,
    createdAt: '2026-08-10T00:00:00.000Z',
    ...over,
  } as Ticket
}

function pr(over: Partial<Pr> = {}): Pr {
  return {
    id: 20,
    ticketId: null,
    projectId: 1,
    branch: 'feat/refunds',
    number: 1284,
    url: '',
    status: 'open',
    lastReviewScore: null,
    pinned: false,
    createdAt: '2026-08-12T00:00:00.000Z',
    title: 'Retry refunds once',
    reviewState: null,
    isDraft: false,
    githubUpdatedAt: null,
    assignedToMe: false,
    authoredByMe: false,
    reviewRequestedByMe: null,
    messageCount: 0,
    ...over,
  } as Pr
}

/* ------------------------------------------------------------ WorkItemRef */

describe('repoShortName', () => {
  it('takes the last segment', () => {
    expect(repoShortName('acme/atlas')).toBe('atlas')
    expect(repoShortName('atlas')).toBe('atlas')
  })

  it('is null for nothing at all', () => {
    expect(repoShortName(null)).toBeNull()
    expect(repoShortName('')).toBeNull()
    // A trailing slash leaves an empty last segment, which names no repo.
    expect(repoShortName('acme/')).toBeNull()
  })
})

describe('projectSlug', () => {
  it('prefers the GitHub repo name', () => {
    expect(projectSlug(PROJECTS[0])).toBe('atlas')
  })

  it('falls back to the first word of the name, lowercased', () => {
    expect(projectSlug({ ...PROJECTS[0], githubRepo: null } as Project)).toBe('atlas')
    expect(
      projectSlug({ ...PROJECTS[0], githubRepo: null, name: 'Beacon Web' } as Project),
    ).toBe('beacon')
  })
})

describe('pullRequestRef', () => {
  it('joins the slug and the number', () => {
    expect(pullRequestRef(pr(), PROJECTS[0])).toBe('atlas#1284')
  })

  it('falls back to the branch while GitHub has assigned no number', () => {
    expect(pullRequestRef(pr({ number: null }), PROJECTS[0])).toBe('feat/refunds')
  })

  it('drops the slug when the project is unknown', () => {
    expect(pullRequestRef(pr(), undefined)).toBe('#1284')
  })
})

describe('prListRef', () => {
  it('is the bare repo name and the number, which is what a row shows', () => {
    expect(prListRef(pr(), PROJECTS[0])).toBe('atlas#1284')
  })

  it('drops each half independently', () => {
    expect(prListRef(pr({ number: null }), PROJECTS[0])).toBe('atlas')
    expect(prListRef(pr(), undefined)).toBe('#1284')
    expect(prListRef(pr({ number: null }), undefined)).toBe('')
  })
})

describe('ticketRef', () => {
  it('strips the source prefix', () => {
    expect(ticketRef(ticket())).toBe('ATL-441')
    expect(ticketRef(ticket({ source: 'sentry', sourceId: 'SENTRY-9182' }))).toBe('9182')
  })

  it('takes only the last segment of a GitHub reference', () => {
    expect(ticketRef(ticket({ source: 'github', sourceId: 'GH-acme/beacon#57' }))).toBe(
      'beacon#57',
    )
  })
})

describe('todoRef', () => {
  it('is null for a manual task, which has no source reference', () => {
    expect(todoRef(todo())).toBeNull()
    expect(todoRef(todo({ source: 'jira', sourceId: null }))).toBeNull()
  })

  it('strips the prefix from a mirrored issue', () => {
    expect(todoRef(todo({ source: 'jira', sourceId: 'JIRA-ATL-441' }))).toBe('ATL-441')
  })
})

/* ---------------------------------------------------------------- labels */

describe('status labels', () => {
  it('names a pull request status in plain words', () => {
    expect(prStatusLabel('open')).toBe('Needs review')
    expect(prStatusLabel('needs_attention')).toBe('Changes requested')
    expect(prStatusLabel('merged')).toBe('Merged')
  })

  it('names a ticket status in plain words', () => {
    expect(ticketStatusLabel('new')).toBe('To do')
    expect(ticketStatusLabel('sparring')).toBe('In progress')
    expect(ticketStatusLabel('in_review')).toBe('In review')
    expect(ticketStatusLabel('done')).toBe('Done')
    expect(ticketStatusLabel('needs_attention')).toBe('Blocked')
  })
})

describe('prReviewStateLabel', () => {
  it('lets Draft win over whatever the reviewers said', () => {
    expect(prReviewStateLabel(pr({ isDraft: true, reviewState: 'approved' }))).toBe('Draft')
  })

  it('reads the review state otherwise', () => {
    expect(prReviewStateLabel(pr({ reviewState: 'approved' }))).toBe('Approved')
    expect(prReviewStateLabel(pr({ reviewState: 'changes_requested' }))).toBe('Changes requested')
    expect(prReviewStateLabel(pr({ reviewState: 'review_required' }))).toBe('Needs review')
    expect(prReviewStateLabel(pr({ reviewState: null }))).toBe('Needs review')
  })
})

describe('prFilterLabel', () => {
  it('names the three pills', () => {
    expect(prFilterLabel('assignedToMe')).toBe('Assigned to me')
    expect(prFilterLabel('needsReview')).toBe('Needs review')
    expect(prFilterLabel('mine')).toBe('Mine')
  })
})

/* --------------------------------------------------------------- sidebar */

describe('isOpenTask', () => {
  it('counts what the user typed and what they pinned, and nothing else', () => {
    // The 138 mirrored Jira issues in a real database are neither, which is why Today
    // filters them out and why this count has to agree with what the Tasks tab lists.
    expect(isOpenTask(todo())).toBe(true)
    expect(isOpenTask(todo({ source: 'jira', sourceId: 'JIRA-ATL-1', pinned: true }))).toBe(true)
    expect(isOpenTask(todo({ source: 'jira', sourceId: 'JIRA-ATL-1' }))).toBe(false)
    expect(isOpenTask(todo({ done: true }))).toBe(false)
  })
})

describe('navCount', () => {
  const data = {
    todos: [todo({ id: 1 }), todo({ id: 2, done: true })],
    jiraTodos: [
      todo({ id: 3, source: 'jira', sourceId: 'JIRA-ATL-1' }),
      todo({ id: 4, source: 'jira', sourceId: 'JIRA-ATL-2', promotedTicketId: 9 }),
      todo({ id: 5, source: 'jira', sourceId: 'JIRA-ATL-3', done: true }),
    ],
    tickets: [ticket()],
    prs: [pr()],
    projects: PROJECTS,
  }

  it('counts open tasks on Today, done ones excluded', () => {
    expect(navCount('Today', data)).toBe(1)
  })

  it('counts every project and every pull request', () => {
    expect(navCount('Projects', data)).toBe(2)
    expect(navCount('Pull requests', data)).toBe(1)
  })

  it('counts only Jira work not yet started', () => {
    // A promoted issue is counted by the pipeline surfaces instead: it is no longer
    // waiting on the user here.
    expect(navCount('Jira', data)).toBe(1)
  })
})

describe('projectOpenCount', () => {
  it('counts only this project, and only tasks worked from', () => {
    const todos = [
      todo({ id: 1, projectId: 1 }),
      todo({ id: 2, projectId: 2 }),
      todo({ id: 3, projectId: 1, source: 'jira', sourceId: 'JIRA-ATL-1' }),
      todo({ id: 4, projectId: 1, done: true }),
    ]
    expect(projectOpenCount(PROJECTS[0], todos)).toBe(1)
    expect(projectOpenCount(PROJECTS[1], todos)).toBe(1)
  })
})

describe('projectDotColor', () => {
  it('wraps at eight, which is how many dot colours the theme has', () => {
    expect(projectDotColor(0)).toBe('var(--wb-dot-0)')
    expect(projectDotColor(7)).toBe('var(--wb-dot-7)')
    expect(projectDotColor(8)).toBe('var(--wb-dot-0)')
  })
})

describe('accountInitials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(accountInitials('Wahid Linku')).toBe('WL')
    expect(accountInitials('Ada Byron Lovelace')).toBe('AB')
  })

  it('takes two letters from a single word', () => {
    expect(accountInitials('Wahid')).toBe('WA')
  })

  it('is empty for nothing, rather than throwing', () => {
    expect(accountInitials('')).toBe('')
    expect(accountInitials('   ')).toBe('')
  })
})

/* ----------------------------------------------------------------- Today */

describe('dayString', () => {
  it('is the local calendar date, matching the engine', () => {
    // Local, not UTC: a task due today must not read as overdue because the machine is
    // east of Greenwich after midnight.
    expect(dayString(new Date(2026, 7, 14, 23, 30))).toBe('2026-08-14')
    expect(dayString(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05')
  })
})

describe('isOverdue', () => {
  it('is only true for a date before today', () => {
    expect(isOverdue(todo({ dueAt: '2026-08-13' }), TODAY)).toBe(true)
    expect(isOverdue(todo({ dueAt: TODAY }), TODAY)).toBe(false)
    expect(isOverdue(todo({ dueAt: '2026-08-15' }), TODAY)).toBe(false)
  })

  it('treats a missing due date as not overdue', () => {
    expect(isOverdue(todo({ dueAt: null }), TODAY)).toBe(false)
  })
})

describe('projectName and projectDot', () => {
  it('falls back when a task has no project', () => {
    expect(projectName(null, PROJECTS)).toBe('No project')
    expect(projectDot(null, PROJECTS)).toBe('var(--wb-n700)')
  })

  it('falls back when the project is not in the list', () => {
    expect(projectName(99, PROJECTS)).toBe('No project')
    expect(projectDot(99, PROJECTS)).toBe('var(--wb-n700)')
  })

  it('takes the dot by index, so the sidebar and the cards agree', () => {
    expect(projectDot(1, PROJECTS)).toBe('var(--wb-dot-0)')
    expect(projectDot(2, PROJECTS)).toBe('var(--wb-dot-1)')
  })
})

describe('taskSections', () => {
  const base = { tickets: [], prs: [], projects: PROJECTS, today: TODAY }

  it('splits overdue from today by due date', () => {
    const sections = taskSections({
      ...base,
      todos: [todo({ id: 1, dueAt: '2026-08-13' }), todo({ id: 2, dueAt: TODAY })],
    })
    expect(sections.map((section) => section.label)).toEqual(['Overdue', 'Today'])
    expect(sections[0].rows).toHaveLength(1)
    expect(sections[1].rows).toHaveLength(1)
  })

  it('treats a missing due date as today', () => {
    const sections = taskSections({ ...base, todos: [todo({ dueAt: null })] })
    expect(sections.map((section) => section.label)).toEqual(['Today'])
  })

  it('keeps the Today section even with no tasks', () => {
    // An empty Overdue or Done section is noise; an empty Today is the screen.
    expect(taskSections({ ...base, todos: [] }).map((section) => section.label)).toEqual(['Today'])
  })

  it('shows done tasks in their own section without a priority', () => {
    const sections = taskSections({ ...base, todos: [todo({ done: true })] })
    expect(sections.map((section) => section.label)).toEqual(['Today', 'Done'])
    expect(sections[1].rows[0].priority).toBeNull()
    expect(sections[1].rows[0].isDone).toBe(true)
  })

  it('renders pinned items as pseudo-tasks at the top of Today', () => {
    const sections = taskSections({
      ...base,
      todos: [todo({ id: 1, dueAt: TODAY })],
      tickets: [ticket({ pinned: true })],
      prs: [pr({ pinned: true })],
    })
    const today = sections.find((section) => section.label === 'Today')
    expect(today?.rows.map((row) => row.source)).toEqual([
      'pinnedTicket',
      'pinnedPullRequest',
      'todo',
    ])
    expect(today?.rows[0].tag).toBe('Pinned')
    expect(today?.rows[0].projectDot).toBe('var(--wb-accent)')
  })

  it('puts a pinned todo first, ahead of pinned tickets and pull requests', () => {
    const sections = taskSections({
      ...base,
      todos: [todo({ id: 1, source: 'jira', sourceId: 'JIRA-ATL-9', pinned: true })],
      tickets: [ticket({ pinned: true })],
    })
    const today = sections.find((section) => section.label === 'Today')
    expect(today?.rows.map((row) => row.source)).toEqual(['pinnedTodo', 'pinnedTicket'])
  })

  it('lets a manual pinned task keep its delete control', () => {
    // A task the user created stays theirs to remove whether or not they pulled it onto
    // Today, and a control that vanished on pinning reads as a bug.
    const sections = taskSections({ ...base, todos: [todo({ pinned: true })] })
    const row = sections[0].rows[0]
    expect(row.source).toBe('pinnedTodo')
    expect(row.deletable).toBe(true)
  })

  it('never offers to delete a mirrored issue', () => {
    // The next poll would recreate it, and the engine refuses anyway.
    const sections = taskSections({
      ...base,
      todos: [todo({ source: 'jira', sourceId: 'JIRA-ATL-9' })],
    })
    expect(sections[0].rows[0].deletable).toBe(false)
  })

  it('tags a mirrored Jira task and shows its ref', () => {
    const sections = taskSections({
      ...base,
      todos: [todo({ source: 'jira', sourceId: 'JIRA-ATL-441' })],
    })
    const row = sections[0].rows[0]
    expect(row.tag).toBe('Jira')
    expect(row.ref).toBe('ATL-441')
  })

  it('falls back when a task has no project', () => {
    const sections = taskSections({ ...base, todos: [todo({ projectId: null })] })
    expect(sections[0].rows[0].projectName).toBe('No project')
  })

  it('titles a pinned pull request from the issue it came from', () => {
    // A PR carries no title of its own for this purpose; the issue supplies it.
    const sections = taskSections({
      ...base,
      todos: [],
      tickets: [ticket({ id: 10, title: 'Refunds double-charge on retry' })],
      prs: [pr({ pinned: true, ticketId: 10 })],
    })
    expect(sections[0].rows[0].title).toBe('Refunds double-charge on retry')
  })

  it('falls back to the ref when no issue is linked', () => {
    const sections = taskSections({ ...base, todos: [], prs: [pr({ pinned: true })] })
    expect(sections[0].rows[0].title).toBe('atlas#1284')
  })
})

describe('priority', () => {
  it('labels and colours the three levels', () => {
    expect(priorityLabel('high')).toBe('HIGH')
    expect(priorityLabel('med')).toBe('MED')
    expect(priorityLabel('low')).toBe('LOW')
    expect(priorityColor('high')).toBe('var(--wb-a300)')
    expect(priorityColor('med')).toBe('var(--wb-n500)')
    expect(priorityColor('low')).toBe('var(--wb-n700)')
  })
})

/* ------------------------------------------------------------ Today rail */

describe('issueRail', () => {
  it('puts needs-attention first, then newest', () => {
    const items = issueRail([
      ticket({ id: 1, status: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      ticket({ id: 2, status: 'new', createdAt: '2026-08-10T00:00:00.000Z' }),
      ticket({ id: 3, status: 'needs_attention', createdAt: '2026-07-01T00:00:00.000Z' }),
    ])
    expect(items.map((item) => item.id)).toEqual(['ticket-3', 'ticket-2', 'ticket-1'])
  })

  it('drops done issues and caps at three', () => {
    const items = issueRail([
      ticket({ id: 1 }),
      ticket({ id: 2 }),
      ticket({ id: 3 }),
      ticket({ id: 4 }),
      ticket({ id: 5, status: 'done' }),
    ])
    expect(items).toHaveLength(3)
    expect(items.some((item) => item.id === 'ticket-5')).toBe(false)
  })

  it('says the ref and the status in the meta line', () => {
    expect(issueRail([ticket()])[0].meta).toBe('ATL-441 · To do')
  })
})

describe('pullRequestRail', () => {
  it('drops merged pull requests and caps at three', () => {
    const items = pullRequestRail(
      [pr({ id: 1 }), pr({ id: 2 }), pr({ id: 3 }), pr({ id: 4 }), pr({ id: 5, status: 'merged' })],
      [],
      PROJECTS,
    )
    expect(items).toHaveLength(3)
    expect(items.some((item) => item.id === 'pr-5')).toBe(false)
  })

  it('says the ref and the status in the meta line', () => {
    expect(pullRequestRail([pr()], [], PROJECTS)[0].meta).toBe('atlas#1284 · Needs review')
  })
})

/* ----------------------------------------------------- Pull request rows */

describe('relativeTime', () => {
  const now = new Date('2026-08-14T12:00:00.000Z')

  it('reads the way a person would', () => {
    expect(relativeTime(new Date('2026-08-14T11:59:30.000Z'), now)).toBe('just now')
    expect(relativeTime(new Date('2026-08-14T11:45:00.000Z'), now)).toBe('15m ago')
    expect(relativeTime(new Date('2026-08-14T09:00:00.000Z'), now)).toBe('3h ago')
    expect(relativeTime(new Date('2026-08-13T09:00:00.000Z'), now)).toBe('yesterday')
    expect(relativeTime(new Date('2026-08-10T12:00:00.000Z'), now)).toBe('4d ago')
    expect(relativeTime(new Date('2026-07-24T12:00:00.000Z'), now)).toBe('3w ago')
  })

  it('never counts backwards for a clock that is slightly ahead', () => {
    expect(relativeTime(new Date('2026-08-14T12:05:00.000Z'), now)).toBe('just now')
  })
})

describe('prRows', () => {
  const now = new Date('2026-08-14T12:00:00.000Z')

  it('filters on assignment, authorship and a review request', () => {
    const prs = [
      pr({ id: 1, assignedToMe: true }),
      pr({ id: 2, authoredByMe: true }),
      pr({ id: 3, reviewRequestedByMe: true }),
    ]
    expect(prRows(prs, PROJECTS, 'assignedToMe', now).map((row) => row.id)).toEqual([1])
    expect(prRows(prs, PROJECTS, 'mine', now).map((row) => row.id)).toEqual([2])
    expect(prRows(prs, PROJECTS, 'needsReview', now).map((row) => row.id)).toEqual([3])
  })

  it('keeps drafts out of the review queue', () => {
    // Deliberate, not incidental: asking for reviewers on a draft never queued it.
    const prs = [pr({ id: 1, reviewRequestedByMe: true, isDraft: true })]
    expect(prRows(prs, PROJECTS, 'needsReview', now)).toEqual([])
  })

  it('reports the overall review decision even in the review queue', () => {
    // A row here can read "Approved" when a colleague approved it and this request stands.
    const prs = [pr({ id: 1, reviewRequestedByMe: true, reviewState: 'approved' })]
    expect(prRows(prs, PROJECTS, 'needsReview', now)[0].statusLabel).toBe('Approved')
  })

  it('leaves the updated column empty when GitHub sent no timestamp', () => {
    const rows = prRows([pr({ assignedToMe: true })], PROJECTS, 'assignedToMe', now)
    expect(rows[0].updatedText).toBe('')
  })

  it('fills the updated column from the GitHub timestamp', () => {
    const rows = prRows(
      [pr({ assignedToMe: true, githubUpdatedAt: '2026-08-14T09:00:00.000Z' })],
      PROJECTS,
      'assignedToMe',
      now,
    )
    expect(rows[0].updatedText).toBe('3h ago')
  })
})

/* -------------------------------------------------------------- header */

describe('headerKicker', () => {
  it('says something different per section', () => {
    expect(headerKicker('Today', 2, 'Friday, 14 August')).toBe('Friday, 14 August')
    expect(headerKicker('Projects', 2, 'x')).toBe('2 active')
    expect(headerKicker('Pull requests', 2, 'x')).toBe('GitHub')
    expect(headerKicker('Jira', 2, 'x')).toBe('Jira')
  })
})

describe('todayDateString', () => {
  it('is the weekday, the day and the month', () => {
    expect(todayDateString(new Date(2026, 7, 14))).toBe('Friday, August 14')
  })
})
