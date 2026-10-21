import { Action, ActionPanel, closeMainWindow, Color, Icon, Keyboard, List } from '@raycast/api'
import { MutatePromise, showFailureToast, useCachedPromise } from '@raycast/utils'

import { ReviewAction, ReviewView, useReviews } from './review'
import { listPrs, openInWorkbench, type Pr, type Review } from './workbench'

const REASON_LABEL: Record<Pr['reasons'][number], string> = { assigned: 'Assigned', review: 'Review' }

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

type PrItemProps = { pr: Pr; review?: Review; mutate: MutatePromise<Review[] | undefined> }

function PrItem({ pr, review, mutate }: PrItemProps) {
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
          {review?.state === 'running' ? null : <ReviewAction url={pr.url} mutate={mutate} />}
          {review ? (
            <Action.Push
              title="Show Review"
              icon={Icon.List}
              shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
              target={<ReviewView pr={pr} />}
            />
          ) : null}
          <Action.CopyToClipboard title="Copy URL" content={pr.url} shortcut={Keyboard.Shortcut.Common.Copy} />
        </ActionPanel>
      }
    />
  )
}

export default function PullRequests() {
  const { data, error, isLoading } = useCachedPromise(listPrs)
  const reviews = useReviews()
  const reviewByUrl = new Map(reviews.data?.map((review) => [review.url, review]))

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter by title or repo">
      {error && !data ? (
        <List.EmptyView icon={Icon.Warning} title="Could not load pull requests" description={error.message} />
      ) : (
        data?.map((pr) => <PrItem key={pr.url} pr={pr} review={reviewByUrl.get(pr.url)} mutate={reviews.mutate} />)
      )}
    </List>
  )
}
