/*
 * The Review action on a row of the pull request list.
 *
 * Ports the `startReview(of:)` behaviour in PRsScreen.swift, comment included: it starts
 * the review and opens nothing, because there is nothing to open yet. The review takes
 * minutes, announces itself when it is done, and is read on the pull request's own page.
 *
 * The row is disabled straight away and released when the engine stops reporting work on
 * that pull request, so it does not stay dead for the rest of the session, and comes back
 * if the review was interrupted.
 *
 * A component per row rather than one shared model, because that is what makes the
 * following cheap: the review query only runs for a pull request the user actually
 * started, which is `startedReviewIds` by another name. A shared hook would have to poll
 * every visible row.
 */

import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { shouldReleaseReview } from './prReviewLogic'
import { usePrReview, useStartPrReview } from './queries'

export function ReviewStarter({ prId, onError }: { prId: number; onError: (error: Error) => void }) {
  /*
   * The `dataUpdatedAt` the review query had at the moment of starting, or null when no
   * review has been started from this row. Null and 0 are different answers, which is why
   * this is not a boolean plus a number.
   *
   * A plain boolean released the row immediately. The query hands back whatever is cached
   * under this pull request's key even while it is disabled, so once the user has opened
   * this pull request's page there is a `{running: false}` sitting there from before the
   * click. Releasing on "the engine says not running" then fired on that stale answer,
   * before the refetch the start had triggered landed, and the row came straight back to
   * "Review" while a review was in fact running.
   *
   * Comparing against the baseline rather than against the clock is what makes it exact:
   * `dataUpdatedAt` changes when, and only when, a fetch resolves, so a changed value is
   * an answer about this review and an unchanged one is the answer from before it.
   */
  const [baseline, setBaseline] = useState<number | null>(null)
  const start = useStartPrReview(prId)
  const review = usePrReview(prId, baseline !== null)

  useEffect(() => {
    // Released on the engine's answer, not on a timer: an interrupted review reports no
    // running job, and this is what brings the row back rather than leaving it dead.
    if (shouldReleaseReview(baseline, review.dataUpdatedAt, review.data)) setBaseline(null)
  }, [baseline, review.dataUpdatedAt, review.data])

  const isBusy = baseline !== null || start.isPending

  return (
    <button
      data-review-action={prId}
      aria-label="Review this pull request"
      title="Review this pull request and draft comments on its lines"
      disabled={isBusy}
      onClick={(event) => {
        // The whole row navigates on click, and reviewing is not navigating.
        event.stopPropagation()
        start.mutate(undefined, {
          // The stale timestamp, deliberately: it is the thing the next fetch has to
          // differ from. 0 when this pull request's review has never been read.
          onSuccess: () => setBaseline(review.dataUpdatedAt),
          onError: (error) => {
            // Nothing was started, so the row has to come back.
            setBaseline(null)
            onError(error)
          },
        })
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 0,
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-table-meta)',
        color: isBusy ? 'var(--wb-n700)' : 'var(--wb-n400)',
        background: 'transparent',
        border: 'none',
        cursor: isBusy ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="checklist" size={12} />
      {isBusy ? 'Reviewing…' : 'Review'}
    </button>
  )
}
