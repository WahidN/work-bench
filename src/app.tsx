import { useEffect, useMemo, useState } from 'react'
import { render } from '@gpuix/react'

import { fetchMyPrs, type Pr, type Reason } from './github'
import { inRepo, repoCounts, shortName } from './repos'
import { postRemark } from './post'
import { reviewPr, type Remark, type Reviewed } from './review'

// GPUI does not inherit `color`, so every <text> sets one from here.
const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  border: '#292929',
  hover: '#E6EAF20D',
  active: '#E6EAF217',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  ghost: '#6B6B6B',
  accent: '#E2795B',
  error: '#F07171',
}

const REASON_LABEL: Record<Reason, string> = { assigned: 'Assigned', review: 'Review' }

type Review =
  | { state: 'running' }
  | { state: 'done'; commit: string; remarks: Remark[] }
  | { state: 'failed'; error: string }

type Post =
  | { state: 'posting' }
  | { state: 'posted'; url: string }
  | { state: 'failed'; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SidebarRow({
  testId,
  label,
  count,
  active,
  onClick,
}: {
  testId: string
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 30,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        cursor: 'pointer',
        backgroundColor: active ? C.active : undefined,
        hover: active ? undefined : { backgroundColor: C.hover },
      }}
    >
      <text style={{ flexGrow: 1, fontSize: 13, color: active ? C.text : C.secondary }}>{label}</text>
      <text style={{ fontSize: 12, color: C.ghost }}>{String(count)}</text>
    </div>
  )
}

function PrRow({ pr, onClick }: { pr: Pr; onClick: () => void }) {
  return (
    <div
      testId={`pr-${pr.repo}#${pr.number}`}
      onClick={onClick}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 8,
        hover: { backgroundColor: C.hover },
      }}
    >
      <text style={{ fontSize: 14, lineHeight: 20, color: C.text }}>{pr.title}</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <text style={{ fontSize: 12, color: C.secondary }}>
          {`${shortName(pr.repo)}#${pr.number}`}
        </text>
        <text style={{ fontSize: 12, color: C.ghost }}>{pr.author}</text>
        {pr.reasons.map((reason) => (
          <text key={reason} style={{ fontSize: 12, color: C.accent }}>
            {REASON_LABEL[reason]}
          </text>
        ))}
      </div>
    </div>
  )
}

function Message({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: 24 }}>
      <text style={{ fontSize: 13, lineHeight: 20, color }}>{text}</text>
    </div>
  )
}

function Button({
  testId,
  label,
  color = C.secondary,
  onClick,
}: {
  testId: string
  label: string
  color?: string
  onClick?: () => void
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        height: 28,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 7,
        display: 'flex',
        alignItems: 'center',
        cursor: onClick ? 'pointer' : undefined,
        opacity: onClick ? 1 : 0.5,
        hover: onClick ? { backgroundColor: C.hover } : undefined,
      }}
    >
      <text style={{ fontSize: 13, color }}>{label}</text>
    </div>
  )
}

// Same inset as a Button, so the label does not jump when Post turns into Posted.
function Status({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ paddingLeft: 12, paddingRight: 12 }}>
      <text style={{ fontSize: 12, color }}>{text}</text>
    </div>
  )
}

function PostControl({
  index,
  remark,
  post,
  onPost,
}: {
  index: number
  remark: Remark
  post: Post | undefined
  onPost: () => void
}) {
  if (!remark.inDiff) return <Status text="Line not in the diff" color={C.ghost} />
  if (post?.state === 'posted') return <Status text="Posted" color={C.secondary} />

  const posting = post?.state === 'posting'
  return <Button testId={`post-${index}`} label={posting ? 'Posting' : 'Post'} onClick={posting ? undefined : onPost} />
}

function RemarkRow({
  index,
  remark,
  post,
  onPost,
}: {
  index: number
  remark: Remark
  post: Post | undefined
  onPost: () => void
}) {
  return (
    <div
      testId={`finding-${index}`}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        paddingTop: 14,
        paddingBottom: 14,
        paddingLeft: 24,
        paddingRight: 24,
        borderTopWidth: 1,
        borderColor: C.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <text style={{ flexGrow: 1, fontSize: 12, color: C.accent }}>{`${remark.path}:${remark.line}`}</text>
        <PostControl index={index} remark={remark} post={post} onPost={onPost} />
      </div>
      <text style={{ fontSize: 13, lineHeight: 20, color: C.text }}>{remark.body}</text>
      {post?.state === 'failed' ? (
        <text style={{ fontSize: 12, lineHeight: 18, color: C.error }}>{post.error}</text>
      ) : null}
    </div>
  )
}

function ReviewResult({
  review,
  posts,
  onPost,
}: {
  review: Review | undefined
  posts: Map<Remark, Post>
  onPost: (commit: string, remark: Remark) => void
}) {
  if (!review) {
    return (
      <Message
        text="Claude reads the diff and writes its remarks here. Nothing goes to GitHub until you press Post."
        color={C.secondary}
      />
    )
  }
  if (review.state === 'running') {
    return <Message text="Claude is reviewing the diff. This can take a few minutes." color={C.secondary} />
  }
  if (review.state === 'failed') return <Message text={review.error} color={C.error} />
  if (review.remarks.length === 0) {
    return <Message text="Claude found nothing to remark on" color={C.secondary} />
  }

  return (
    <virtual-list estimatedItemHeight={120} style={{ flexGrow: 1, minHeight: 0 }}>
      {review.remarks.map((remark, index) => (
        <RemarkRow
          key={index}
          index={index}
          remark={remark}
          post={posts.get(remark)}
          onPost={() => onPost(review.commit, remark)}
        />
      ))}
    </virtual-list>
  )
}

function PrPage({
  pr,
  review,
  posts,
  onBack,
  onReview,
  onPost,
}: {
  pr: Pr
  review: Review | undefined
  posts: Map<Remark, Post>
  onBack: () => void
  onReview: () => void
  onPost: (commit: string, remark: Remark) => void
}) {
  const running = review?.state === 'running'

  return (
    <div style={{ flexGrow: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: 52,
          flexShrink: 0,
          paddingLeft: 12,
          paddingRight: 14,
        }}
      >
        <Button testId="back" label="Back" onClick={onBack} />
        <div style={{ flexGrow: 1 }} />
        <Button
          testId="review"
          label={running ? 'Reviewing' : review ? 'Review again' : 'Review with Claude'}
          color={C.accent}
          onClick={running ? undefined : onReview}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
          paddingLeft: 24,
          paddingRight: 24,
          paddingBottom: 16,
        }}
      >
        <text style={{ fontSize: 17, lineHeight: 24, color: C.text }}>{pr.title}</text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <text style={{ fontSize: 12, color: C.secondary }}>
            {`${shortName(pr.repo)}#${pr.number}`}
          </text>
          <text style={{ fontSize: 12, color: C.ghost }}>{pr.author}</text>
        </div>
      </div>

      <ReviewResult review={review} posts={posts} onPost={onPost} />
    </div>
  )
}

export function PrApp({
  load = fetchMyPrs,
  review = reviewPr,
  post = postRemark,
}: {
  load?: () => Promise<Pr[]>
  review?: (pr: Pr) => Promise<Reviewed>
  post?: (pr: Pr, commit: string, remark: Remark) => Promise<string>
}) {
  const [prs, setPrs] = useState<Pr[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [opened, setOpened] = useState<Pr | null>(null)
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map())
  const [posts, setPosts] = useState<Map<Remark, Post>>(new Map())

  const refresh = () => {
    setLoading(true)
    load()
      .then((fresh) => {
        setPrs(fresh)
        setError(null)
      })
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const setReview = (pr: Pr, next: Review) => setReviews((all) => new Map(all).set(pr.url, next))

  const startReview = (pr: Pr) => {
    setReview(pr, { state: 'running' })
    review(pr)
      .then(({ commit, remarks }) => setReview(pr, { state: 'done', commit, remarks }))
      .catch((failure) => setReview(pr, { state: 'failed', error: errorMessage(failure) }))
  }

  const setPost = (remark: Remark, next: Post) => setPosts((all) => new Map(all).set(remark, next))

  const startPost = (pr: Pr, commit: string, remark: Remark) => {
    setPost(remark, { state: 'posting' })
    post(pr, commit, remark)
      .then((url) => setPost(remark, { state: 'posted', url }))
      .catch((failure) => setPost(remark, { state: 'failed', error: errorMessage(failure) }))
  }

  const pick = (repo: string | null) => {
    setPicked(repo)
    setOpened(null)
  }

  const repos = useMemo(() => repoCounts(prs ?? []), [prs])
  // A picked repo with nothing left after a refresh falls back to All.
  const repo = repos.some((entry) => entry.repo === picked) ? picked : null
  const visible = inRepo(prs ?? [], repo)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: C.canvas,
      }}
    >
      <div
        style={{
          width: 220,
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: 10,
          backgroundColor: C.sidebar,
          borderRightWidth: 1,
          borderColor: C.border,
        }}
      >
        <SidebarRow
          testId="repo-all"
          label="All"
          count={prs?.length ?? 0}
          active={repo === null}
          onClick={() => pick(null)}
        />
        {repos.map((entry) => (
          <SidebarRow
            key={entry.repo}
            testId={`repo-${entry.repo}`}
            label={shortName(entry.repo)}
            count={entry.count}
            active={entry.repo === repo}
            onClick={() => pick(entry.repo)}
          />
        ))}
      </div>

      {opened ? (
        <PrPage
          pr={opened}
          review={reviews.get(opened.url)}
          posts={posts}
          onBack={() => setOpened(null)}
          onReview={() => startReview(opened)}
          onPost={(commit, remark) => startPost(opened, commit, remark)}
        />
      ) : (
        <div style={{ flexGrow: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              height: 52,
              flexShrink: 0,
              paddingLeft: 20,
              paddingRight: 14,
            }}
          >
            <text style={{ fontSize: 15, color: C.text }}>Pull requests</text>
            <text style={{ fontSize: 13, color: C.ghost }}>{String(visible.length)}</text>
            <div style={{ flexGrow: 1 }} />
            <div
              testId="refresh"
              onClick={loading ? undefined : refresh}
              style={{
                height: 28,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 7,
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                opacity: loading ? 0.5 : 1,
                hover: { backgroundColor: C.hover },
              }}
            >
              <text style={{ fontSize: 13, color: C.secondary }}>{loading ? 'Refreshing' : 'Refresh'}</text>
            </div>
          </div>

          {error ? (
            <Message text={error} color={C.error} />
          ) : prs === null ? (
            <Message text="Loading pull requests" color={C.secondary} />
          ) : visible.length === 0 ? (
            <Message text="No open pull requests" color={C.secondary} />
          ) : (
            <virtual-list
              estimatedItemHeight={64}
              style={{ flexGrow: 1, minHeight: 0 }}
            >
              {/* A row is laid out at the list width, so the side padding goes on the row. */}
              {visible.map((pr) => (
                <div key={pr.url} style={{ paddingLeft: 10, paddingRight: 10 }}>
                  <PrRow pr={pr} onClick={() => setOpened(pr)} />
                </div>
              ))}
            </virtual-list>
          )}
        </div>
      )}
    </div>
  )
}

// Only open a window when this file is the program, so a test can import `PrApp`.
const isEntryPoint =
  typeof Bun !== 'undefined' && (Bun.isStandaloneExecutable || Bun.main === import.meta.path)

if (isEntryPoint) {
  render(<PrApp />, {
    title: 'Workbench',
    width: 960,
    height: 680,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
