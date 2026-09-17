import { describe, expect, it } from 'vitest'
import {
  agentElapsed, agentLabel, agentTarget, agentsSummary, canOpenAgent, type RunningAgent,
} from './agentsLogic'

const agent = (over: Partial<RunningAgent> = {}): RunningAgent => ({
  key: 'job-1',
  activity: 'review',
  targetType: 'pr',
  targetId: 1,
  title: 'Remove the loading animation',
  waiting: false,
  startedAt: '2026-09-17T10:00:00.000Z',
  ...over,
})

describe('agentLabel', () => {
  it('names what a running agent is doing', () => {
    expect(agentLabel(agent({ activity: 'review' }))).toBe('Reviewing')
    expect(agentLabel(agent({ activity: 'comment-fix' }))).toBe('Fixing a review comment')
    expect(agentLabel(agent({ activity: 'merge' }))).toBe('Merging')
  })

  it('says a waiting fix is waiting rather than fixing', () => {
    expect(agentLabel(agent({ activity: 'comment-fix', waiting: true }))).toBe('Waiting its turn')
  })
})

describe('agentTarget', () => {
  it('is the title it works on', () => {
    expect(agentTarget(agent())).toBe('Remove the loading animation')
  })

  it('stands in for a title the engine could not read', () => {
    expect(agentTarget(agent({ title: '  ' }))).toBe('Untitled')
  })
})

describe('agentElapsed', () => {
  it('reads as time spent, not as time past', () => {
    const now = new Date('2026-09-17T10:06:00.000Z')
    expect(agentElapsed(agent(), now)).toBe('for 6m')
  })

  it('says it just started under a minute', () => {
    const now = new Date('2026-09-17T10:00:30.000Z')
    expect(agentElapsed(agent(), now)).toBe('just started')
  })

  it('is empty when the engine sent something unreadable', () => {
    expect(agentElapsed(agent({ startedAt: 'nonsense' }), new Date())).toBe('')
  })
})

describe('agentsSummary', () => {
  it('is empty when nothing runs, which is what hides the row', () => {
    expect(agentsSummary([])).toBe('')
  })

  it('counts one and many', () => {
    expect(agentsSummary([agent()])).toBe('1 agent running')
    expect(agentsSummary([agent(), agent(), agent()])).toBe('3 agents running')
  })

  // A queued fix is not running, and the list beside this says so about the same row.
  it('counts waiting apart from running', () => {
    expect(agentsSummary([agent(), agent({ waiting: true })])).toBe('1 agent running, 1 waiting')
  })

  it('says only waiting when nothing has started', () => {
    expect(agentsSummary([agent({ waiting: true })])).toBe('1 waiting')
  })
})

describe('canOpenAgent', () => {
  it('opens a pull request but not a ticket', () => {
    expect(canOpenAgent(agent({ targetType: 'pr' }))).toBe(true)
    expect(canOpenAgent(agent({ targetType: 'ticket' }))).toBe(false)
  })
})
