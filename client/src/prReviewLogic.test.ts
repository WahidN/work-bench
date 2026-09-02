import { describe, expect, it } from 'vitest'
import {
  canPost,
  isDone,
  isRunning,
  outdatedLabel,
  summary,
  unposted,
  type StoredReviewFinding,
} from './prReviewLogic'

/*
 * Mirrors WorkbenchTests/Views/PrReviewLogicTests.swift. The distinction these guard is
 * "finished" against "absent": a review whose every remark has been posted has nothing
 * left to offer, and so looks from the outside exactly like no review at all.
 */

function finding(id: number, posted: boolean): StoredReviewFinding {
  return {
    id,
    prId: 1,
    path: 'src/engine.rs',
    line: 12,
    body: 'This drops the error.',
    commitSha: 'abc123',
    posted,
    createdAt: '2026-09-01T10:00:00Z',
  }
}

describe('canPost', () => {
  it('refuses a remark already on GitHub', () => {
    expect(canPost(finding(1, true))).toBe(false)
    expect(canPost(finding(1, false))).toBe(true)
  })
})

describe('unposted', () => {
  it('keeps only what is still to post', () => {
    const findings = [finding(1, true), finding(2, false), finding(3, true)]
    expect(unposted(findings).map((item) => item.id)).toEqual([2])
  })
})

describe('isDone', () => {
  it('is true for a review whose every remark has been posted', () => {
    expect(isDone([finding(1, true), finding(2, true)])).toBe(true)
  })

  it('is true for no findings at all, which the caller has to tell apart itself', () => {
    expect(isDone([])).toBe(true)
  })

  it('is false while anything is left', () => {
    expect(isDone([finding(1, true), finding(2, false)])).toBe(false)
  })
})

describe('summary', () => {
  it('counts what is left, not what the review produced', () => {
    // Three remarks, two already posted. Saying "3 comments to post" would keep
    // promising work that is finished.
    expect(summary([finding(1, true), finding(2, true), finding(3, false)])).toBe(
      '1 comment to post',
    )
  })

  it('pluralises on the remaining count', () => {
    expect(summary([finding(1, false), finding(2, false)])).toBe('2 comments to post')
    expect(summary([])).toBe('0 comments to post')
  })
})

describe('outdatedLabel', () => {
  it('says the branch moved on, and nothing otherwise', () => {
    expect(outdatedLabel(true)).toBe('Written against an earlier commit')
    expect(outdatedLabel(false)).toBeNull()
  })
})

describe('isRunning', () => {
  it('treats a payload without the field as not running', () => {
    // The engine gained `running` after the first release, so a client can meet one that
    // does not send it. Reading that as "running" would disable the button forever.
    expect(isRunning({ findings: [], outdated: false })).toBe(false)
    expect(isRunning(undefined)).toBe(false)
    expect(isRunning({ findings: [], outdated: false, running: true })).toBe(true)
  })
})
