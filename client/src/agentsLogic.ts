/*
 * The rules the running agents list follows, kept out of the view so they can be tested.
 *
 * The engine already orders its answer, running first and oldest first within each group,
 * so nothing here re-sorts. What is left is naming: the engine reports an activity, and the
 * user reads a sentence.
 */

import type { RunningAgent } from '../../engine/src/types.ts'
import { relativeTime } from './logic'

export type { RunningAgent }

const ACTIVITY_LABEL: Record<RunningAgent['activity'], string> = {
  review: 'Reviewing',
  'comment-fix': 'Fixing a review comment',
  chat: 'Answering in the chat',
  merge: 'Merging',
  triage: 'Triaging',
  spar: 'Sparring',
  implement: 'Implementing',
}

/**
 * What the agent is doing, in the list's own words.
 *
 * A waiting fix says so instead, because "Fixing a review comment" on something that has
 * not started is the lie this whole screen exists to stop.
 */
export function agentLabel(agent: RunningAgent): string {
  if (agent.waiting) return 'Waiting its turn'
  return ACTIVITY_LABEL[agent.activity]
}

/** The pull request or ticket it is working on, or a stand-in when the title is empty. */
export function agentTarget(agent: RunningAgent): string {
  return agent.title.trim() === '' ? 'Untitled' : agent.title
}

/**
 * How long it has been going. `relativeTime` says "5m ago", which reads wrong for something
 * still running, so the suffix goes and "just now" becomes the start.
 */
export function agentElapsed(agent: RunningAgent, now: Date): string {
  const started = new Date(agent.startedAt)
  if (Number.isNaN(started.getTime())) return ''
  const text = relativeTime(started, now)
  return text === 'just now' ? 'just started' : `for ${text.replace(' ago', '')}`
}

/**
 * The sidebar's one line. Empty when there is nothing at all, which is what hides the row.
 *
 * Waiting is counted apart from running. Calling a queued fix "running" is the confusion
 * this screen exists to remove, and the list says "Waiting its turn" about the same row.
 */
export function agentsSummary(agents: RunningAgent[]): string {
  const running = agents.filter((agent) => !agent.waiting).length
  const waiting = agents.length - running

  const parts: string[] = []
  if (running > 0) parts.push(running === 1 ? '1 agent running' : `${running} agents running`)
  if (waiting > 0) parts.push(`${waiting} waiting`)
  return parts.join(', ')
}

/** Only a pull request has a page to open. A ticket agent is listed but goes nowhere. */
export function canOpenAgent(agent: RunningAgent): boolean {
  return agent.targetType === 'pr'
}
