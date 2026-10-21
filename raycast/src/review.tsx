import { Action, ActionPanel, Color, Icon, Image, Keyboard, List, showToast, Toast } from '@raycast/api'
import { MutatePromise, showFailureToast, useCachedPromise } from '@raycast/utils'
import { basename } from 'node:path'
import { useEffect, useState } from 'react'

import { listReviews, postRemark, startReview, type Pr, type Review } from './workbench'

const POLL_MS = 3000

type Status = 'Posted' | 'Not in the diff' | 'Posting' | 'Not posted'

const STATUS_ICON: Record<Status, Image.ImageLike> = {
  Posted: { source: Icon.CheckCircle, tintColor: Color.Green },
  'Not in the diff': Icon.MinusCircle,
  Posting: Icon.CircleProgress,
  'Not posted': Icon.SpeechBubble,
}

export function useReviews() {
  const reviews = useCachedPromise(listReviews)
  const { data, revalidate } = reviews
  const running = data?.some((review) => review.state === 'running') ?? false

  useEffect(() => {
    if (!running) return
    const timer = setInterval(revalidate, POLL_MS)
    return () => clearInterval(timer)
  }, [running, revalidate])

  return reviews
}

async function startReviewOf(url: string, mutate: MutatePromise<Review[] | undefined>) {
  try {
    await mutate(startReview(url), {
      optimisticUpdate: (reviews = []) => [
        ...reviews.filter((review) => review.url !== url),
        { url, state: 'running', pid: 0 },
      ],
      // The review writes 'running' a moment after it starts, so reading now could still show the old review.
      shouldRevalidateAfter: false,
    })
    await showToast({
      style: Toast.Style.Success,
      title: 'Review started',
      message: 'It goes on when you close Raycast',
    })
  } catch (failure) {
    await showFailureToast(failure, { title: 'Could not start the review' })
  }
}

export function ReviewAction({ url, mutate }: { url: string; mutate: MutatePromise<Review[] | undefined> }) {
  return (
    <Action
      title="Review with Claude"
      icon={Icon.Stars}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={() => startReviewOf(url, mutate)}
    />
  )
}

export function ReviewView({ pr }: { pr: Pr }) {
  const { data, isLoading, mutate, revalidate } = useReviews()
  // Kept after a post succeeds, so Post stays away until the file says 'Posted'.
  const [sent, setSent] = useState<string[]>([])
  const review = data?.find((saved) => saved.url === pr.url)

  if (review?.state === 'failed') {
    return (
      <List navigationTitle={pr.title}>
        <List.EmptyView
          icon={Icon.Warning}
          title="The review failed"
          description={review.error}
          actions={
            <ActionPanel>
              <ReviewAction url={pr.url} mutate={mutate} />
            </ActionPanel>
          }
        />
      </List>
    )
  }

  if (review?.state !== 'done') {
    return (
      <List isLoading navigationTitle={pr.title}>
        <List.EmptyView
          icon={Icon.Stars}
          title="Claude is reviewing"
          description="The remarks show here when the review is done. You can close Raycast."
        />
      </List>
    )
  }

  const post = async (index: number) => {
    const key = `${review.commit}:${index}`
    setSent((keys) => [...keys, key])
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Posting' })
    try {
      await postRemark(pr.url, review.commit, index)
      toast.style = Toast.Style.Success
      toast.title = 'Posted'
      revalidate()
    } catch (failure) {
      setSent((keys) => keys.filter((sentKey) => sentKey !== key))
      toast.style = Toast.Style.Failure
      toast.title = 'Could not post'
      toast.message = failure instanceof Error ? failure.message : String(failure)
    }
  }

  return (
    <List navigationTitle={pr.title} isLoading={isLoading} isShowingDetail>
      <List.EmptyView icon={Icon.CheckCircle} title="No remarks" description="Claude found nothing worth a comment." />
      {review.remarks.map((remark, index) => {
        const key = `${review.commit}:${index}`
        const status: Status = remark.posted
          ? 'Posted'
          : !remark.inDiff
            ? 'Not in the diff'
            : sent.includes(key)
              ? 'Posting'
              : 'Not posted'
        return (
          <List.Item
            key={key}
            icon={STATUS_ICON[status]}
            title={`${basename(remark.path)}:${remark.line}`}
            detail={
              <List.Item.Detail
                markdown={remark.body}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="File" text={remark.path} />
                    <List.Item.Detail.Metadata.Label title="Line" text={String(remark.line)} />
                    <List.Item.Detail.Metadata.Label title="Status" text={status} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                {remark.posted ? <Action.OpenInBrowser title="Open Comment" url={remark.posted} /> : null}
                {status === 'Not posted' ? (
                  <Action title="Post" icon={Icon.Upload} onAction={() => post(index)} />
                ) : null}
              </ActionPanel>
            }
          />
        )
      })}
    </List>
  )
}
