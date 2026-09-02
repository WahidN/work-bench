import { describe, expect, it } from 'vitest'
import {
  REVIEW_TITLE,
  itemKey,
  needsInputTitle,
  newlyAppeared,
  reviewBody,
  reviewsToAnnounce,
  unpostedCount,
} from './notificationLogic'
import type { TodayItem } from './notificationLogic'
import type { PrReviewView, StoredReviewFinding } from './prReviewLogic'

/*
 * Mirrors WorkbenchTests/Views/ReviewNotificationLogicTests.swift.
 *
 * A notification is the one thing in this app that interrupts someone, so the rule worth
 * guarding is when it stays quiet: nothing on the first look, nothing twice for the same
 * pull request, and nothing for a review with nothing left to post.
 */

function item(over: Partial<TodayItem> = {}): TodayItem {
  return {
    kind: 'ticket',
    id: 1,
    title: 'The login loops',
    status: 'new',
    reviewScore: null,
    ...over,
  } as TodayItem
}

function finding(id: number, posted: boolean): StoredReviewFinding {
  return {
    id,
    prId: 1,
    path: 'src/a.ts',
    line: 1,
    body: 'x',
    commitSha: 'abc',
    posted,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function review(findings: StoredReviewFinding[]): PrReviewView {
  return { findings, outdated: false, running: false }
}

describe('itemKey', () => {
  it('carries the kind, because the two share an id space', () => {
    expect(itemKey(item({ kind: 'ticket', id: 7 }))).toBe('ticket-7')
    expect(itemKey(item({ kind: 'pr', id: 7 }))).toBe('pr-7')
    expect(itemKey(item({ kind: 'ticket', id: 7 }))).not.toBe(itemKey(item({ kind: 'pr', id: 7 })))
  })
})

describe('newlyAppeared', () => {
  it('finds only what was not there before', () => {
    const items = [item({ id: 1 }), item({ id: 2 }), item({ kind: 'pr', id: 1 })]
    const previous = new Set(['ticket-1'])
    expect(newlyAppeared(items, previous).map(itemKey)).toEqual(['ticket-2', 'pr-1'])
  })

  it('finds nothing when nothing changed', () => {
    const items = [item({ id: 1 })]
    expect(newlyAppeared(items, new Set(['ticket-1']))).toEqual([])
  })
})

describe('needsInputTitle', () => {
  it('says which kind needs attention', () => {
    expect(needsInputTitle(item({ kind: 'ticket', status: 'needs_attention' }))).toBe(
      'Fix failed, needs attention',
    )
    expect(needsInputTitle(item({ kind: 'pr', status: 'needs_attention' }))).toBe(
      'PR needs attention',
    )
  })

  it('says what is ready otherwise', () => {
    expect(needsInputTitle(item({ kind: 'ticket', status: 'new' }))).toBe('Ticket ready to spar')
    expect(needsInputTitle(item({ kind: 'pr', status: 'open' }))).toBe('PR ready for review')
  })
})

describe('reviewsToAnnounce', () => {
  it('announces a review with something left to post', () => {
    const reviews = new Map([[3, review([finding(1, false)])]])
    expect(reviewsToAnnounce(reviews, new Set())).toEqual([3])
  })

  it('stays quiet for a review whose every remark has been posted', () => {
    // Finished, not absent. There is nothing left to act on, so nothing to interrupt for.
    const reviews = new Map([[3, review([finding(1, true)])]])
    expect(reviewsToAnnounce(reviews, new Set())).toEqual([])
  })

  it('stays quiet for a review that found nothing', () => {
    expect(reviewsToAnnounce(new Map([[3, review([])]]), new Set())).toEqual([])
  })

  it('never announces the same pull request twice', () => {
    const reviews = new Map([[3, review([finding(1, false)])]])
    expect(reviewsToAnnounce(reviews, new Set([3]))).toEqual([])
  })

  it('sorts, so the order does not depend on the map', () => {
    const reviews = new Map([
      [9, review([finding(1, false)])],
      [2, review([finding(2, false)])],
      [5, review([finding(3, false)])],
    ])
    expect(reviewsToAnnounce(reviews, new Set())).toEqual([2, 5, 9])
  })
})

describe('reviewBody', () => {
  it('counts what is left, and pluralises on it', () => {
    expect(reviewBody('Fix the login', 1)).toBe('1 comment to post on Fix the login')
    expect(reviewBody('Fix the login', 4)).toBe('4 comments to post on Fix the login')
  })

  it('has a title of its own', () => {
    expect(REVIEW_TITLE).toBe('Review ready')
  })
})

describe('unpostedCount', () => {
  it('counts what is left, never what the review produced', () => {
    expect(unpostedCount(review([finding(1, true), finding(2, true), finding(3, false)]))).toBe(1)
  })
})
