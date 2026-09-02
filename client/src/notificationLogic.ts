/*
 * Port of app/Workbench/Views/ReviewNotificationLogic.swift, plus the newly-appeared rules
 * that live inline in ContentView.
 *
 * Two signals, deliberately separate. `needsInput` drives the badge and the newly-appeared
 * notifications, and the engine filters review-requested pull requests out of it on
 * purpose: a colleague's pull request arriving is not worth interrupting anyone about.
 * A finished review is the opposite case, work the user started themselves, so it gets its
 * own signal rather than widening that list and dragging those pull requests back into the
 * badge.
 */

import { isDone, unposted, type PrReviewView } from './prReviewLogic'
import type { TodayView } from './queries'

export type TodayItem = TodayView['needsInput'][number]

/** `TodayItem.uniqueKey`. Two kinds share an id space, so the kind has to be in the key. */
export function itemKey(item: TodayItem): string {
  return `${item.kind}-${item.id}`
}

/**
 * What appeared since the last look.
 *
 * The first cycle announces nothing, which is what `isFirstCycle` guards in the app: on
 * launch every item is new, and a notification per open ticket is not a welcome.
 */
export function newlyAppeared(items: TodayItem[], previousKeys: Set<string>): TodayItem[] {
  return items.filter((item) => !previousKeys.has(itemKey(item)))
}

export function needsInputTitle(item: TodayItem): string {
  if (item.status === 'needs_attention') {
    return item.kind === 'ticket' ? 'Fix failed, needs attention' : 'PR needs attention'
  }
  return item.kind === 'ticket' ? 'Ticket ready to spar' : 'PR ready for review'
}

/* --------------------------------------------------- a finished review */

export const REVIEW_TITLE = 'Review ready'

export function reviewBody(prTitle: string, count: number): string {
  const comments = count === 1 ? '1 comment' : `${count} comments`
  return `${comments} to post on ${prTitle}`
}

/**
 * Pull requests whose review has something left to post and has not been announced yet.
 * Sorted so the order is stable rather than whatever the map happened to hold.
 */
export function reviewsToAnnounce(
  reviews: Map<number, PrReviewView>,
  alreadyAnnounced: Set<number>,
): number[] {
  return [...reviews.entries()]
    .filter(([prId, review]) => !alreadyAnnounced.has(prId) && !isDone(review.findings))
    .map(([prId]) => prId)
    .sort((left, right) => left - right)
}

/** How many comments the announcement should claim, which is what is left to post. */
export function unpostedCount(review: PrReviewView): number {
  return unposted(review.findings).length
}
