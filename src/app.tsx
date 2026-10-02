import { useEffect, useMemo, useRef, useState } from 'react'
import { render } from '@gpuix/react'

import { loadComments, type Thread } from './comments'
import { fixRemark, type Fixed } from './fix'
import { fetchLogin, fetchMyPrs, type Pr, type Reason } from './github'
import { inRepo, repoCounts, shortName } from './repos'
import { postRemark, replyTo, type Posted } from './post'
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
  | { state: 'posted'; id: number; url: string }
  | { state: 'failed'; error: string }

type Reply = 'none' | 'sending' | 'sent' | { error: string }

type LoadedThread = { thread: Thread; remark: Remark }

type Loaded = { state: 'loading' } | { state: 'done'; items: LoadedThread[] } | { state: 'failed'; error: string }

type Fix =
  | { state: 'fixing' }
  | { state: 'fixed'; commit: string; reply: Reply }
  | { state: 'nothing'; reason: string }
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
        {pr.commented ? <text style={{ fontSize: 12, color: C.secondary }}>Commented</text> : null}
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
  name,
  remark,
  post,
  onPost,
}: {
  name: string
  remark: Remark
  post: Post | undefined
  onPost: () => void
}) {
  if (!remark.inDiff) return <Status text="Line not in the diff" color={C.ghost} />
  if (post?.state === 'posted') return <Status text="Posted" color={C.secondary} />

  const posting = post?.state === 'posting'
  return <Button testId={`post-${name}`} label={posting ? 'Posting' : 'Post'} onClick={posting ? undefined : onPost} />
}

function FixControl({
  name,
  fix,
  waiting,
  onFix,
}: {
  name: string
  fix: Fix | undefined
  waiting: boolean
  onFix: () => void
}) {
  if (fix?.state === 'fixed') return <Status text={`Fixed in ${fix.commit}`} color={C.secondary} />

  const fixing = fix?.state === 'fixing'
  return <Button testId={`fix-${name}`} label={fixing ? 'Fixing' : 'Fix'} onClick={fixing || waiting ? undefined : onFix} />
}

function Note({ text, color }: { text: string; color: string }) {
  return <text style={{ fontSize: 12, lineHeight: 18, color }}>{text}</text>
}

function FixNote({ fix }: { fix: Fix | undefined }) {
  if (fix?.state === 'nothing') return <Note text={`Claude changed nothing. ${fix.reason}`} color={C.secondary} />
  if (fix?.state === 'failed') return <Note text={fix.error} color={C.error} />
  if (fix?.state !== 'fixed') return null
  if (fix.reply === 'sending') return <Note text="Replying under the comment on GitHub" color={C.secondary} />
  if (fix.reply === 'sent') return <Note text="Replied under the comment on GitHub" color={C.secondary} />
  if (typeof fix.reply === 'object') return <Note text={`The reply failed: ${fix.reply.error}`} color={C.error} />
  return null
}

function RemarkRow({
  name,
  remark,
  post,
  fix,
  canFix,
  waiting,
  onPost,
  onFix,
  author,
  outdated = false,
  replies = [],
}: {
  name: string
  remark: Remark
  post: Post | undefined
  fix: Fix | undefined
  canFix: boolean
  waiting: boolean
  onPost: () => void
  onFix: () => void
  // Set for someone else's comment, which can only be read.
  author?: string
  outdated?: boolean
  replies?: Thread['replies']
}) {
  return (
    <div
      testId={`finding-${name}`}
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
        <text style={{ fontSize: 12, color: C.accent }}>{`${remark.path}:${remark.line}`}</text>
        {outdated ? <text style={{ fontSize: 12, color: C.ghost }}>outdated</text> : null}
        {author ? <text style={{ fontSize: 12, color: C.secondary }}>{author}</text> : null}
        <div style={{ flexGrow: 1 }} />
        {canFix && !author ? <FixControl name={name} fix={fix} waiting={waiting} onFix={onFix} /> : null}
        {author ? null : <PostControl name={name} remark={remark} post={post} onPost={onPost} />}
      </div>
      <text style={{ fontSize: 13, lineHeight: 20, color: C.text }}>{remark.body}</text>
      {replies.map((reply, index) => (
        <Note key={index} text={`${reply.author}: ${reply.body}`} color={C.secondary} />
      ))}
      {post?.state === 'failed' ? <Note text={post.error} color={C.error} /> : null}
      <FixNote fix={fix} />
    </div>
  )
}

function ReviewResult({
  review,
  posts,
  fixes,
  canFix,
  waiting,
  onPost,
  onFix,
}: {
  review: Review | undefined
  posts: Map<Remark, Post>
  fixes: Map<Remark, Fix>
  canFix: boolean
  waiting: boolean
  onPost: (commit: string, remark: Remark) => void
  onFix: (remark: Remark) => void
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
    <>
      {review.remarks.map((remark, index) => (
        <RemarkRow
          key={`remark-${index}`}
          name={String(index)}
          remark={remark}
          post={posts.get(remark)}
          fix={fixes.get(remark)}
          canFix={canFix}
          waiting={waiting}
          onPost={() => onPost(review.commit, remark)}
          onFix={() => onFix(remark)}
        />
      ))}
    </>
  )
}

function CommentsStatus({ loaded }: { loaded: Loaded | undefined }) {
  if (loaded?.state === 'loading') return <Message text="Loading the comments on GitHub" color={C.secondary} />
  if (loaded?.state === 'failed') return <Message text={`The comments did not load: ${loaded.error}`} color={C.error} />
  return null
}

function PrPage({
  pr,
  review,
  loaded,
  me,
  posts,
  fixes,
  canFix,
  onBack,
  onReview,
  onPost,
  onFix,
}: {
  pr: Pr
  review: Review | undefined
  loaded: Loaded | undefined
  me: string | null
  posts: Map<Remark, Post>
  fixes: Map<Remark, Fix>
  canFix: boolean
  onBack: () => void
  onReview: () => void
  onPost: (commit: string, remark: Remark) => void
  onFix: (remark: Remark) => void
}) {
  const running = review?.state === 'running'
  const reviewed = review?.state === 'done' ? review.remarks : []
  // A remark posted in this window comes back from GitHub too. Show it once, as the remark.
  const postedHere = new Set(reviewed.map((remark) => posts.get(remark)).flatMap((post) => (post?.state === 'posted' ? [post.id] : [])))
  const threads = loaded?.state === 'done' ? loaded.items.filter((item) => !postedHere.has(item.thread.id)) : []
  // One fix per pull request: two would race each other's push, and a new review would drop the running one.
  const fixing = [...threads.map((item) => item.remark), ...reviewed].some((remark) => fixes.get(remark)?.state === 'fixing')

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
          onClick={running || fixing ? undefined : onReview}
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

      <virtual-list estimatedItemHeight={120} style={{ flexGrow: 1, minHeight: 0 }}>
        <CommentsStatus loaded={loaded} />
        {threads.map(({ thread, remark }) => (
          <RemarkRow
            key={`thread-${thread.id}`}
            name={`thread-${thread.id}`}
            remark={remark}
            post={posts.get(remark)}
            fix={fixes.get(remark)}
            canFix={canFix && !thread.outdated}
            waiting={fixing}
            onPost={() => {}}
            onFix={() => onFix(remark)}
            author={thread.author === me ? undefined : thread.author}
            outdated={thread.outdated}
            replies={thread.replies}
          />
        ))}
        <ReviewResult
          review={review}
          posts={posts}
          fixes={fixes}
          canFix={canFix}
          waiting={fixing}
          onPost={onPost}
          onFix={onFix}
        />
      </virtual-list>
    </div>
  )
}

export function PrApp({
  load = fetchMyPrs,
  review = reviewPr,
  post = postRemark,
  fix = fixRemark,
  reply = replyTo,
  whoami = fetchLogin,
  comments = loadComments,
}: {
  load?: () => Promise<Pr[]>
  review?: (pr: Pr) => Promise<Reviewed>
  post?: (pr: Pr, commit: string, remark: Remark) => Promise<Posted>
  fix?: (pr: Pr, remark: Remark) => Promise<Fixed>
  reply?: (pr: Pr, commentId: number, body: string) => Promise<string>
  whoami?: () => Promise<string>
  comments?: (pr: Pr) => Promise<Thread[]>
}) {
  const [prs, setPrs] = useState<Pr[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [opened, setOpened] = useState<Pr | null>(null)
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map())
  const [posts, setPosts] = useState<Map<Remark, Post>>(new Map())
  const [fixes, setFixes] = useState<Map<Remark, Fix>>(new Map())
  const [me, setMe] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  // The same comment keeps the same remark object across reloads, so its post and fix state stay with it.
  const threadRemarks = useRef(new Map<number, Remark>())
  // A fix takes minutes, so it reads the posts as they are when it lands, not when it started.
  const latestPosts = useRef(posts)
  latestPosts.current = posts

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
      .then((posted) => setPost(remark, { state: 'posted', ...posted }))
      .catch((failure) => setPost(remark, { state: 'failed', error: errorMessage(failure) }))
  }

  useEffect(() => {
    whoami().then(setMe, () => setMe(null))
  }, [])

  const remarkFor = (thread: Thread): Remark => {
    const known = threadRemarks.current.get(thread.id)
    if (known) return known
    const remark = { path: thread.path, line: thread.line, body: thread.body, inDiff: true }
    threadRemarks.current.set(thread.id, remark)
    return remark
  }

  const setComments = (pr: Pr, next: Loaded) => setLoaded((all) => new Map(all).set(pr.url, next))

  useEffect(() => {
    if (!opened) return
    const pr = opened
    // Keep the comments from the last visit on screen while they load again.
    setLoaded((all) => (all.get(pr.url)?.state === 'done' ? all : new Map(all).set(pr.url, { state: 'loading' })))
    comments(pr)
      .then((threads) => {
        const items = threads.map((thread) => ({ thread, remark: remarkFor(thread) }))
        // Every loaded comment is on GitHub already, so a fix replies under it.
        setPosts((all) => {
          const next = new Map(all)
          for (const { thread, remark } of items) next.set(remark, { state: 'posted', id: thread.id, url: thread.url })
          return next
        })
        setComments(pr, { state: 'done', items })
      })
      .catch((failure) => setComments(pr, { state: 'failed', error: errorMessage(failure) }))
  }, [opened?.url])

  const setFix = (remark: Remark, next: Fix) => setFixes((all) => new Map(all).set(remark, next))

  const startFix = (pr: Pr, remark: Remark) => {
    setFix(remark, { state: 'fixing' })
    fix(pr, remark)
      .then((outcome) => {
        if (outcome.state === 'nothing') return setFix(remark, { state: 'nothing', reason: outcome.reason })

        const posted = latestPosts.current.get(remark)
        if (posted?.state !== 'posted') return setFix(remark, { state: 'fixed', commit: outcome.commit, reply: 'none' })

        const fixed = (next: Reply) => setFix(remark, { state: 'fixed', commit: outcome.commit, reply: next })
        fixed('sending')
        return reply(pr, posted.id, `Gefixt in ${outcome.commit}. ${outcome.reply}`).then(
          () => fixed('sent'),
          (failure) => fixed({ error: errorMessage(failure) }),
        )
      })
      .catch((failure) => setFix(remark, { state: 'failed', error: errorMessage(failure) }))
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
          loaded={loaded.get(opened.url)}
          me={me}
          posts={posts}
          fixes={fixes}
          canFix={me !== null && opened.author === me}
          onBack={() => setOpened(null)}
          onReview={() => startReview(opened)}
          onPost={(commit, remark) => startPost(opened, commit, remark)}
          onFix={(remark) => startFix(opened, remark)}
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
