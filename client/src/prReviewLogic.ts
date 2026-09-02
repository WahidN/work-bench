/*
 * Port of app/Workbench/Views/PrReviewLogic.swift.
 *
 * The rules the review section follows, kept out of the view so they can be tested.
 */

import type { StoredReviewFinding } from '../../engine/src/types.ts'

export type { StoredReviewFinding }

/**
 * The stored review as the engine reports it.
 *
 * The Swift `PrReview` declares `running` optional so a payload written before the engine
 * sent it still decodes. The same allowance is kept here rather than dropped, because the
 * engine on disk can be older than the client talking to it.
 */
export type PrReviewView = {
  findings: StoredReviewFinding[]
  outdated: boolean
  running?: boolean
}

export const EMPTY_REVIEW: PrReviewView = { findings: [], outdated: false, running: false }

export function isRunning(review: PrReviewView | undefined): boolean {
  return review?.running ?? false
}

/**
 * Whether a row that started a review may go back to offering one.
 *
 * `baseline` is the review query's `dataUpdatedAt` at the moment of starting, or null when
 * this row started nothing. The comparison is against that rather than against a clock,
 * because the query serves whatever is cached under the pull request's key even while it
 * is switched off: after the user has once opened the pull request's page, a stale
 * `{running: false}` is sitting there from before the click. Reading that as the engine's
 * answer released the row while the review it had just started was still running.
 *
 * `dataUpdatedAt` changes when, and only when, a fetch resolves. So a changed value is an
 * answer about this review, and an unchanged one is the answer from before it.
 */
export function shouldReleaseReview(
  baseline: number | null,
  dataUpdatedAt: number,
  review: PrReviewView | undefined,
): boolean {
  if (baseline === null) return false
  return dataUpdatedAt !== baseline && !isRunning(review)
}

/**
 * A remark already on GitHub is not offered again. Posting it twice would duplicate the
 * comment, and the engine refuses it anyway.
 */
export function canPost(finding: StoredReviewFinding): boolean {
  return !finding.posted
}

export function unposted(findings: StoredReviewFinding[]): StoredReviewFinding[] {
  return findings.filter((finding) => !finding.posted)
}

/**
 * Nothing left to act on. Distinct from "no review": a review every remark of which has
 * been posted is finished, not absent.
 */
export function isDone(findings: StoredReviewFinding[]): boolean {
  return unposted(findings).length === 0
}

/**
 * Counts what is still to post, never the total the review produced, which would keep
 * promising work already finished.
 */
export function summary(findings: StoredReviewFinding[]): string {
  const left = unposted(findings).length
  return left === 1 ? '1 comment to post' : `${left} comments to post`
}

/**
 * Says the branch moved on. Reporting only: the remarks stay postable, because whether
 * they still apply is the user's call.
 */
export function outdatedLabel(outdated: boolean): string | null {
  return outdated ? 'Written against an earlier commit' : null
}
