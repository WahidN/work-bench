import { describe, expect, it } from 'vitest'
import {
  authorLabel,
  canMerge,
  chatSubject,
  chatTargetForTodo,
  targetIsItem,
  targetProjectId,
  targetSymbol,
} from './agentChatLogic'
import type { Pr, Project, Ticket, Todo } from './queries'

/*
 * Mirrors WorkbenchTests/Views/AgentChatLogicTests.swift.
 *
 * The one rule with teeth is `canMerge`: merging squashes and deletes the branch, and it
 * cannot be undone. Everything else here is words on a panel.
 */

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
    ...over,
  } as Project
}

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 7,
    source: 'jira',
    sourceId: 'JIRA-ATL-441',
    title: 'The login loops',
    projectId: 1,
    status: 'new',
    prId: null,
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Ticket
}

function pr(over: Partial<Pr> = {}): Pr {
  return {
    id: 3,
    ticketId: null,
    projectId: 1,
    branch: 'feat/thing',
    number: 24,
    url: '',
    status: 'open',
    lastReviewScore: null,
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
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

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 9,
    source: 'jira',
    sourceId: 'JIRA-ATL-441',
    text: 'The login loops',
    body: '',
    url: null,
    projectId: 1,
    canPromote: true,
    done: false,
    promotedTicketId: null,
    priority: 'med',
    dueAt: null,
    doneAt: null,
    pinned: false,
    statusName: null,
    statusCategory: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Todo
}

describe('canMerge', () => {
  it('is offered only on an open pull request the user wrote', () => {
    expect(canMerge({ kind: 'pullRequest', pr: pr({ authoredByMe: true }) })).toBe(true)
  })

  it('is refused on someone else\'s pull request', () => {
    // The inbox is mostly other people's work, and the default pill even leads with it.
    expect(canMerge({ kind: 'pullRequest', pr: pr({ authoredByMe: false }) })).toBe(false)
  })

  it('is refused on one already merged', () => {
    expect(canMerge({ kind: 'pullRequest', pr: pr({ authoredByMe: true, status: 'merged' }) })).toBe(
      false,
    )
  })

  it('is refused on every other kind of target, and on none', () => {
    expect(canMerge({ kind: 'project', project: project() })).toBe(false)
    expect(canMerge({ kind: 'ticket', ticket: ticket() })).toBe(false)
    expect(canMerge({ kind: 'todo', todo: todo() })).toBe(false)
    expect(canMerge(null)).toBe(false)
  })
})

describe('chatTargetForTodo', () => {
  it('opens the ticket a promoted issue became', () => {
    const promoted = todo({ promotedTicketId: 7 })
    const target = chatTargetForTodo(promoted, [ticket({ id: 7 })])
    expect(target.kind).toBe('ticket')
  })

  it('falls back to the issue when its ticket has not loaded', () => {
    // Rather than dropping the click: the thread reads back empty and a send is refused
    // with an error, which beats a dead button.
    const target = chatTargetForTodo(todo({ promotedTicketId: 7 }), [])
    expect(target.kind).toBe('todo')
  })

  it('opens the issue itself when it was never promoted', () => {
    expect(chatTargetForTodo(todo(), [ticket({ id: 7 })]).kind).toBe('todo')
  })
})

describe('targetProjectId', () => {
  it('is null for a mirrored issue that maps to no project', () => {
    // Most issues in a real database are in that state, so callers must handle it.
    expect(targetProjectId({ kind: 'todo', todo: todo({ projectId: null }) })).toBeNull()
    expect(targetProjectId({ kind: 'project', project: project() })).toBe(1)
    expect(targetProjectId({ kind: 'ticket', ticket: ticket() })).toBe(1)
    expect(targetProjectId({ kind: 'pullRequest', pr: pr() })).toBe(1)
  })
})

describe('targetIsItem', () => {
  it('separates a project from the three kinds of work item', () => {
    expect(targetIsItem({ kind: 'project', project: project() })).toBe(false)
    expect(targetIsItem({ kind: 'ticket', ticket: ticket() })).toBe(true)
  })
})

describe('targetSymbol', () => {
  it('gives a project, and no target at all, the folder', () => {
    expect(targetSymbol({ kind: 'project', project: project() })).toBe('folder')
    expect(targetSymbol(null)).toBe('folder')
    expect(targetSymbol({ kind: 'todo', todo: todo() })).toBe('checklist')
  })
})

describe('chatSubject', () => {
  it('names a project and asks about it', () => {
    const subject = chatSubject({ kind: 'project', project: project() }, project(), undefined)
    expect(subject.kicker).toBe('Project · Atlas')
    expect(subject.placeholder).toBe('Ask about Atlas')
    // A project chat has no project to go back to.
    expect(subject.backToProjectName).toBeNull()
  })

  it('titles a pull request with the issue it came from', () => {
    const subject = chatSubject(
      { kind: 'pullRequest', pr: pr({ ticketId: 7 }) },
      project(),
      ticket(),
    )
    expect(subject.title).toBe('The login loops')
    expect(subject.kicker).toBe('atlas#24 · Needs review')
  })

  it('falls back to the reference when no issue supplies a title', () => {
    const subject = chatSubject({ kind: 'pullRequest', pr: pr() }, project(), undefined)
    expect(subject.title).toBe('atlas#24')
  })

  it('warns when a mirrored issue has no repo behind it', () => {
    const subject = chatSubject(
      { kind: 'todo', todo: todo({ projectId: null }) },
      undefined,
      undefined,
    )
    expect(subject.note).toBe('No repo mapped, discussing the issue text only.')
    expect(subject.backToProjectName).toBeNull()
  })

  it('says nothing extra when the issue does have a repo', () => {
    const subject = chatSubject({ kind: 'todo', todo: todo() }, project(), undefined)
    expect(subject.note).toBeNull()
    expect(subject.kicker).toBe('ATL-441 · Jira')
    expect(subject.backToProjectName).toBe('Atlas')
  })

  it('handles a manual task, which has no reference to name', () => {
    const subject = chatSubject(
      { kind: 'todo', todo: todo({ source: 'manual', sourceId: null }) },
      project(),
      undefined,
    )
    expect(subject.kicker).toBe('Jira')
    expect(subject.placeholder).toBe('Tell the agent what to do on this issue')
  })

  it('offers three prompts for every target', () => {
    const targets = [
      { kind: 'project' as const, project: project() },
      { kind: 'ticket' as const, ticket: ticket() },
      { kind: 'pullRequest' as const, pr: pr() },
      { kind: 'todo' as const, todo: todo() },
    ]
    for (const target of targets) {
      expect(chatSubject(target, project(), undefined).quickPrompts).toHaveLength(3)
    }
  })
})

describe('authorLabel', () => {
  it('names the two sides', () => {
    expect(authorLabel('user')).toBe('YOU')
    expect(authorLabel('assistant')).toBe('AGENT')
  })
})
