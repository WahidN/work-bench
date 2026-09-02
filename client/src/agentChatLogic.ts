/*
 * Port of app/Workbench/Views/AgentChatLogic.swift.
 *
 * One panel serves four kinds of target, and what changes between them is the words: the
 * kicker, the title, the placeholder and which three quick prompts make sense. Keeping
 * that in one pure function is what makes the panel itself target-agnostic.
 */

import {
  prStatusLabel,
  pullRequestRef,
  ticketRef,
  ticketStatusLabel,
  todoRef,
} from './logic'
import type { Pr, Project, Ticket, Todo } from './queries'

export type ChatRole = 'user' | 'assistant'

export type AgentChatTarget =
  | { kind: 'project'; project: Project }
  | { kind: 'ticket'; ticket: Ticket }
  | { kind: 'pullRequest'; pr: Pr }
  | { kind: 'todo'; todo: Todo }

/**
 * Null for a mirrored Jira issue whose project key maps to no project. Most issues in a
 * real database are in that state, so callers must handle it.
 */
export function targetProjectId(target: AgentChatTarget): number | null {
  switch (target.kind) {
    case 'project':
      return target.project.id
    case 'ticket':
      return target.ticket.projectId
    case 'pullRequest':
      return target.pr.projectId
    case 'todo':
      return target.todo.projectId
  }
}

export function targetIsItem(target: AgentChatTarget): boolean {
  return target.kind !== 'project'
}

/** The SF Symbol the header shows, per target. */
export function targetSymbol(target: AgentChatTarget | null): string {
  switch (target?.kind) {
    case 'pullRequest':
      return 'arrow-triangle-pull'
    case 'ticket':
      return 'list-bullet-rectangle'
    case 'todo':
      return 'checklist'
    case 'project':
    case undefined:
      return 'folder'
  }
}

export type AgentChatSubject = {
  kicker: string
  title: string
  placeholder: string
  quickPrompts: string[]
  backToProjectName: string | null
  /**
   * One line shown above the transcript when the thread is working under a limitation the
   * user should know about. Null for every target but an unmapped Jira issue.
   */
  note: string | null
}

export function chatSubject(
  target: AgentChatTarget,
  project: Project | undefined,
  linkedTicket: Ticket | undefined,
): AgentChatSubject {
  switch (target.kind) {
    case 'project':
      return {
        kicker: `Project · ${target.project.name}`,
        title: target.project.name,
        placeholder: `Ask about ${target.project.name}`,
        quickPrompts: ['What should I do first?', 'Catch me up', 'Draft standup'],
        backToProjectName: null,
        note: null,
      }
    case 'ticket': {
      const ref = ticketRef(target.ticket)
      return {
        kicker: `${ref} · ${ticketStatusLabel(target.ticket.status)}`,
        title: target.ticket.title,
        placeholder: `Tell the agent what to do on ${ref}`,
        quickPrompts: ['Draft a fix plan', 'Reply for me', 'Make this a task'],
        backToProjectName: project?.name ?? null,
        note: null,
      }
    }
    case 'pullRequest': {
      const ref = pullRequestRef(target.pr, project)
      return {
        kicker: `${ref} · ${prStatusLabel(target.pr.status)}`,
        title: linkedTicket?.title ?? ref,
        placeholder: `Tell the agent what to do on ${ref}`,
        quickPrompts: ['Summarise the review comments', 'Reply for me', 'Make this a task'],
        backToProjectName: project?.name ?? null,
        note: null,
      }
    }
    case 'todo': {
      const ref = todoRef(target.todo)
      return {
        kicker: ref === null ? 'Jira' : `${ref} · Jira`,
        title: target.todo.text,
        placeholder: `Tell the agent what to do on ${ref ?? 'this issue'}`,
        quickPrompts: ['What is this about?', 'Draft a plan', 'Is this worth doing?'],
        backToProjectName: project?.name ?? null,
        note:
          target.todo.projectId === null
            ? 'No repo mapped, discussing the issue text only.'
            : null,
      }
    }
  }
}

/**
 * A promoted issue's thread lives on the ticket it became, so the row opens the ticket
 * chat once that ticket is known. A promoted issue whose ticket has not loaded falls back
 * to its own thread rather than dropping the click: the thread reads back empty and a send
 * is refused with an error, which beats a dead button.
 */
export function chatTargetForTodo(todo: Todo, tickets: Ticket[]): AgentChatTarget {
  if (todo.promotedTicketId !== null) {
    const ticket = tickets.find((candidate) => candidate.id === todo.promotedTicketId)
    if (ticket) return { kind: 'ticket', ticket }
  }
  return { kind: 'todo', todo }
}

/**
 * Merging squashes and deletes the branch, which cannot be undone, so it is only offered
 * on a pull request the user wrote. The inbox is full of other people's pull requests, and
 * the default pill even leads with them.
 */
export function canMerge(target: AgentChatTarget | null): boolean {
  if (target?.kind !== 'pullRequest') return false
  return target.pr.status !== 'merged' && target.pr.authoredByMe
}

export function authorLabel(role: ChatRole): string {
  return role === 'user' ? 'YOU' : 'AGENT'
}
