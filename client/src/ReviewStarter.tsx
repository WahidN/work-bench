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
import { isRunning } from './prReviewLogic'
import { usePrReview, useStartPrReview } from './queries'

export function ReviewStarter({ prId, onError }: { prId: number; onError: (error: Error) => void }) {
  const [started, setStarted] = useState(false)
  const start = useStartPrReview(prId)
  const review = usePrReview(prId, started)

  useEffect(() => {
    // Released on the engine's answer, not on a timer: an interrupted review reports no
    // running job, and this is what brings the row back rather than leaving it dead.
    if (started && review.dataUpdatedAt !== 0 && !isRunning(review.data)) setStarted(false)
  }, [started, review.dataUpdatedAt, review.data])

  const isBusy = started || start.isPending

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
          onSuccess: () => setStarted(true),
          onError: (error) => {
            setStarted(false)
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
