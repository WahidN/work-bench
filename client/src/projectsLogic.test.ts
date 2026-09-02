import { describe, expect, it } from 'vitest'
import {
  NO_ACTIVITY_TEXT,
  activityText,
  dueLabel,
  openWork,
  prCountLabel,
  projectCards,
  projectFacts,
  projectTaskRows,
} from './projectsLogic'
import type { Pr, Project, Ticket, Todo } from './queries'

/*
 * Mirrors WorkbenchTests/Views/ProjectsLogicTests.swift and
 * ProjectDetailLogicTests.swift.
 *
 * The count that matters most is `openCount`: a real database holds 138 mirrored Jira
 * issues, none of which is a task the user works from, and the card's number has to agree
 * with what the Tasks tab actually lists.
 */

const NOW = new Date('2026-09-02T12:00:00.000Z')

function project(over: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'Atlas',
    repoPath: '/tmp/atlas',
    defaultBranch: 'main',
    githubRepo: 'acme/atlas',
    jiraProjectKey: null,
    sentryProjectSlug: null,
    status: 'active',
    blurb: '',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Project
}

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    source: 'manual',
    sourceId: null,
    text: 'Write it down',
    body: '',
    url: null,
    projectId: 1,
    canPromote: false,
    done: false,
    promotedTicketId: null,
    priority: 'med',
    dueAt: null,
    doneAt: null,
    pinned: false,
    statusName: null,
    statusCategory: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Todo
}

function pr(over: Partial<Pr> = {}): Pr {
  return {
    id: 1,
    ticketId: null,
    projectId: 1,
    branch: 'feat/thing',
    number: 24,
    url: '',
    status: 'open',
    lastReviewScore: null,
    pinned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    title: 'Do the thing',
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

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    source: 'jira',
    sourceId: 'JIRA-MR-3',
    title: 'Look into it',
    projectId: 1,
    status: 'new',
    prId: null,
    pinned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Ticket
}

describe('prCountLabel', () => {
  it('pluralises', () => {
    expect(prCountLabel(0)).toBe('0 PRs')
    expect(prCountLabel(1)).toBe('1 PR')
    expect(prCountLabel(2)).toBe('2 PRs')
  })
})

describe('activityText', () => {
  it('is the newest thing the project owns, because a project has no timestamp', () => {
    const text = activityText(
      project(),
      [todo({ createdAt: '2026-08-25T12:00:00.000Z' })],
      [ticket({ createdAt: '2026-09-02T10:00:00.000Z' })],
      [pr({ createdAt: '2026-07-01T12:00:00.000Z' })],
      NOW,
    )
    expect(text).toBe('2h ago')
  })

  it('says so plainly when the project owns nothing', () => {
    expect(activityText(project(), [], [], [], NOW)).toBe(NO_ACTIVITY_TEXT)
  })

  it('ignores other projects' + "' work", () => {
    expect(
      activityText(project({ id: 1 }), [todo({ projectId: 2 })], [], [], NOW),
    ).toBe(NO_ACTIVITY_TEXT)
  })
})

describe('projectCards', () => {
  it('counts only tasks the user works from', () => {
    // A mirrored Jira issue that is neither manual nor pinned is not one of them.
    const cards = projectCards({
      projects: [project()],
      todos: [
        todo({ id: 1 }),
        todo({ id: 2, source: 'jira', sourceId: 'JIRA-MR-1' }),
        todo({ id: 3, source: 'jira', sourceId: 'JIRA-MR-2', pinned: true }),
        todo({ id: 4, done: true }),
      ],
      tickets: [],
      prs: [],
      now: NOW,
    })
    expect(cards[0].openCount).toBe(2)
  })

  it('counts open pull requests, not merged ones', () => {
    const cards = projectCards({
      projects: [project()],
      todos: [],
      tickets: [],
      prs: [pr({ id: 1 }), pr({ id: 2, status: 'merged' }), pr({ id: 3, status: 'needs_attention' })],
      now: NOW,
    })
    expect(cards[0].prCount).toBe(2)
  })

  it('keeps the projects array order, so the dot matches the sidebar', () => {
    const cards = projectCards({
      projects: [project({ id: 1, name: 'One' }), project({ id: 2, name: 'Two' })],
      todos: [],
      tickets: [],
      prs: [],
      now: NOW,
    })
    expect(cards.map((card) => card.name)).toEqual(['One', 'Two'])
    expect(cards[0].dot).toBe('var(--wb-dot-0)')
    expect(cards[1].dot).toBe('var(--wb-dot-1)')
  })
})

describe('dueLabel', () => {
  it('names only overdue and today', () => {
    expect(dueLabel(todo({ dueAt: '2026-09-01' }), '2026-09-02')).toBe('Overdue')
    expect(dueLabel(todo({ dueAt: '2026-09-02' }), '2026-09-02')).toBe('Today')
    expect(dueLabel(todo({ dueAt: '2026-09-03' }), '2026-09-02')).toBeNull()
    expect(dueLabel(todo({ dueAt: null }), '2026-09-02')).toBeNull()
  })
})

describe('projectTaskRows', () => {
  it('leads with overdue, then creation order, then the done ones', () => {
    const rows = projectTaskRows({
      todos: [
        todo({ id: 1, text: 'later', createdAt: '2026-09-01T00:00:00.000Z' }),
        todo({ id: 2, text: 'done', done: true, createdAt: '2026-08-01T00:00:00.000Z' }),
        todo({ id: 3, text: 'overdue', dueAt: '2026-08-30', createdAt: '2026-09-02T00:00:00.000Z' }),
        todo({ id: 4, text: 'earlier', createdAt: '2026-08-20T00:00:00.000Z' }),
      ],
      project: project(),
      projects: [project()],
      today: '2026-09-02',
    })
    expect(rows.map((row) => row.title)).toEqual(['overdue', 'earlier', 'later', 'done'])
  })

  it('leaves out a mirrored issue that is not pinned', () => {
    const rows = projectTaskRows({
      todos: [todo({ id: 1, source: 'jira', sourceId: 'JIRA-MR-1' })],
      project: project(),
      projects: [project()],
      today: '2026-09-02',
    })
    expect(rows).toEqual([])
  })

  it('keeps a pinned issue looking like the pseudo-task it is on Today', () => {
    const rows = projectTaskRows({
      todos: [todo({ id: 1, source: 'jira', sourceId: 'JIRA-MR-1', pinned: true })],
      project: project(),
      projects: [project()],
      today: '2026-09-02',
    })
    expect(rows[0].source).toBe('pinnedTodo')
    expect(rows[0].tag).toBe('Pinned')
    // Not deletable: a mirrored issue would come back on the next poll.
    expect(rows[0].deletable).toBe(false)
  })

  it('drops the due tag on a completed task', () => {
    const rows = projectTaskRows({
      todos: [todo({ id: 1, dueAt: '2026-08-01', done: true })],
      project: project(),
      projects: [project()],
      today: '2026-09-02',
    })
    expect(rows[0].tag).toBeNull()
  })
})

describe('projectFacts', () => {
  it('agrees with the card on both counts', () => {
    const input = {
      project: project(),
      todos: [todo({ id: 1 }), todo({ id: 2, source: 'jira', sourceId: 'JIRA-MR-1' })],
      tickets: [],
      prs: [pr({ id: 1 }), pr({ id: 2, status: 'merged' })],
      now: NOW,
    }
    const facts = projectFacts(input)
    const card = projectCards({ ...input, projects: [input.project] })[0]
    expect(facts.openTasks).toBe(card.openCount)
    expect(facts.openPrs).toBe(card.prCount)
    expect(facts.status).toBe('Active')
  })
})

describe('openWork', () => {
  it('lists open pull requests before open issues', () => {
    const items = openWork(
      project(),
      [ticket({ id: 1 }), ticket({ id: 2, status: 'done' })],
      [pr({ id: 3 }), pr({ id: 4, status: 'merged' })],
    )
    expect(items.map((item) => item.id)).toEqual(['pr-3', 'ticket-1'])
  })

  it('falls back to the reference when a title is empty', () => {
    const items = openWork(project(), [], [pr({ id: 3, title: '' })])
    expect(items[0].title).toBe('atlas#24')
    expect(items[0].ref).toBe('atlas#24')
  })
})
