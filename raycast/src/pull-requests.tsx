import { Action, ActionPanel, closeMainWindow, Color, Icon, Keyboard, List } from '@raycast/api'
import { showFailureToast, useCachedPromise, useCachedState } from '@raycast/utils'
import { useState } from 'react'

import { ReviewAction, ReviewView, useReviews } from './review'
import { listPrs, openInWorkbench, type Pr, type Review } from './workbench'

const REASON_LABEL: Record<Pr['reasons'][number], string> = { assigned: 'Assigned', review: 'Review' }

// Each load sends 3 GitHub searches, and GitHub blocks a burst of them for minutes.
const RELOAD_AFTER_MS = 60 * 1000

async function openPr(url: string) {
  try {
    await openInWorkbench(url)
    await closeMainWindow()
  } catch (failure) {
    await showFailureToast(failure, { title: 'Could not open Workbench' })
  }
}

function reviewAccessories(review?: Review): List.Item.Accessory[] {
  if (review?.state === 'running') return [{ tag: 'Reviewing', icon: Icon.Stars }]
  if (review?.state === 'failed') return [{ tag: { value: 'Review failed', color: Color.Red } }]
  if (review?.state === 'done') {
    const count = review.remarks.length
    return [{ tag: `${count} ${count === 1 ? 'remark' : 'remarks'}` }]
  }
  return []
}

type PrItemProps = { pr: Pr; review?: Review; revalidate: () => void; refresh: () => void }

function PrItem({ pr, review, revalidate, refresh }: PrItemProps) {
  return (
    <List.Item
      title={pr.title}
      subtitle={`${pr.repo}#${pr.number}`}
      keywords={pr.repo.split('/')}
      accessories={[
        ...reviewAccessories(review),
        ...(pr.commented ? [{ tag: 'Commented' }] : []),
        { text: pr.reasons.map((reason) => REASON_LABEL[reason]).join(', ') },
        { text: pr.author, icon: Icon.Person },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={pr.url} />
          <Action title="Open in Workbench" icon={Icon.Window} onAction={() => openPr(pr.url)} />
          {review?.state === 'running' ? null : <ReviewAction url={pr.url} revalidate={revalidate} />}
          {review ? (
            <Action.Push
              title="Show Review"
              icon={Icon.List}
              shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
              target={<ReviewView pr={pr} />}
            />
          ) : null}
          <Action.CopyToClipboard title="Copy URL" content={pr.url} shortcut={Keyboard.Shortcut.Common.Copy} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
            onAction={refresh}
          />
        </ActionPanel>
      }
    />
  )
}

export default function PullRequests() {
  const [loadedAt, setLoadedAt] = useCachedState('prs-loaded-at', 0)
  const [load, setLoad] = useState(() => Date.now() - loadedAt > RELOAD_AFTER_MS)
  const { data, error, isLoading, revalidate } = useCachedPromise(listPrs, [], {
    execute: load,
    onData: () => setLoadedAt(Date.now()),
  })
  const refresh = () => {
    if (isLoading) return
    // Without execute, the hook shows no spinner, so the first Refresh turns it on.
    if (load) revalidate()
    else setLoad(true)
  }
  const reviews = useReviews()
  const reviewByUrl = new Map(reviews.data?.map((review) => [review.url, review]))

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter by title or repo">
      {error && !data ? (
        <List.EmptyView icon={Icon.Warning} title="Could not load pull requests" description={error.message} />
      ) : (
        data?.map((pr) => (
          <PrItem
            key={pr.url}
            pr={pr}
            review={reviewByUrl.get(pr.url)}
            revalidate={reviews.revalidate}
            refresh={refresh}
          />
        ))
      )}
    </List>
  )
}
