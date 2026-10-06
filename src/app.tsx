import { useEffect, useMemo, useRef, useState } from 'react'
import { render, useGpuix } from '@gpuix/react'

import { listenForOrders, orderFeed, readOrder, sendOrder, type Order, type OrderFeed } from './commands'
import { loadComments, type Thread } from './comments'
import { fixRemark, type Fixed } from './fix'
import { fetchLogin, fetchMyPrs, openInBrowser, type Pr, type Reason } from './github'
import { loadHiddenRepos, saveHiddenRepos } from './hidden'
import { inRepo, repoCounts, shortName, withoutHidden } from './repos'
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

type Draft = { open: boolean; text: string }

type LoadedThread = { thread: Thread; remark: Remark }

type Loaded = { state: 'loading' } | { state: 'done'; items: LoadedThread[] } | { state: 'failed'; error: string }

type Fix =
  | { state: 'fixing' }
  | { state: 'fixed'; commit: string; answer: string; reply: Reply }
  | { state: 'nothing'; reason: string; reply: Reply }
  | { state: 'failed'; error: string }

type Answered = Extract<Fix, { reply: Reply }>

function replyText(done: Answered): string {
  return done.state === 'fixed' ? `Gefixt in ${done.commit}. ${done.answer}` : `Geen wijziging nodig. ${done.reason}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type RowAction = { testId: string; label: string; onClick: () => void }

function SidebarRow({
  testId,
  label,
  count,
  active,
  dimmed = false,
  action,
  onClick,
}: {
  testId: string
  label: string
  count: number
  active: boolean
  dimmed?: boolean
  action?: RowAction
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const showAction = hovered && action

  // A hide or show moves the next row under the pointer, so the second click of a double click would hit that row.
  const firstClick = (handler: () => void) => (event: { clickCount?: number }) => {
    if ((event.clickCount ?? 1) === 1) handler()
  }

  // The action sits beside the clickable part, not in it, so its click does not also pick the row.
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: 30,
        borderRadius: 7,
        backgroundColor: active ? C.active : undefined,
        hover: active ? undefined : { backgroundColor: C.hover },
      }}
    >
      <div
        testId={testId}
        onClick={firstClick(onClick)}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 8,
          paddingRight: showAction ? 0 : 8,
          cursor: 'pointer',
        }}
      >
        <text style={{ flexGrow: 1, fontSize: 13, color: dimmed ? C.ghost : active ? C.text : C.secondary }}>
          {label}
        </text>
        {showAction ? null : <text style={{ fontSize: 12, color: C.ghost }}>{String(count)}</text>}
      </div>
      {showAction ? (
        <div
          testId={action.testId}
          onClick={firstClick(action.onClick)}
          style={{ height: '100%', display: 'flex', alignItems: 'center', paddingLeft: 8, paddingRight: 8, cursor: 'pointer' }}
        >
          <text style={{ fontSize: 12, color: C.secondary }}>{action.label}</text>
        </div>
      ) : null}
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
  open,
  onFix,
}: {
  name: string
  fix: Fix | undefined
  waiting: boolean
  open: boolean
  onFix: () => void
}) {
  if (fix?.state === 'fixed') return <Status text={`Fixed in ${fix.commit}`} color={C.secondary} />
  if (open) return null

  const fixing = fix?.state === 'fixing'
  // A new try would be overwritten when this reply comes back.
  const replying = fix?.state === 'nothing' && fix.reply === 'sending'
  return <Button testId={`fix-${name}`} label={fixing ? 'Fixing' : 'Fix'} onClick={fixing || replying || waiting ? undefined : onFix} />
}

function Note({ text, color }: { text: string; color: string }) {
  return <text style={{ fontSize: 12, lineHeight: 18, color }}>{text}</text>
}

function FixBox({
  name,
  text,
  waiting,
  onType,
  onStart,
  onCancel,
}: {
  name: string
  text: string
  waiting: boolean
  onType: (text: string) => void
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
      <textarea
        testId={`context-${name}`}
        value={text}
        placeholder="Extra context for Claude, optional. For example which option to pick, or what to leave alone."
        minRows={2}
        maxRows={6}
        onChange={(event) => onType(event.value ?? '')}
        style={{
          width: '100%',
          padding: 10,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.sidebar,
          fontSize: 13,
          lineHeight: 20,
          color: C.text,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <div style={{ flexGrow: 1 }} />
        <Button testId={`cancel-fix-${name}`} label="Cancel" onClick={onCancel} />
        <Button testId={`start-fix-${name}`} label="Start fix" color={C.accent} onClick={waiting ? undefined : onStart} />
      </div>
    </div>
  )
}

function ReplyNote({ reply }: { reply: Reply }) {
  if (reply === 'sending') return <Note text="Replying under the comment on GitHub" color={C.secondary} />
  if (reply === 'sent') return <Note text="Replied under the comment on GitHub" color={C.secondary} />
  if (typeof reply === 'object') return <Note text={`The reply failed: ${reply.error}`} color={C.error} />
  return null
}

function FixNote({ fix }: { fix: Fix | undefined }) {
  if (fix?.state === 'nothing') {
    return (
      <>
        <Note text={`Claude changed nothing. ${fix.reason}`} color={C.secondary} />
        <ReplyNote reply={fix.reply} />
      </>
    )
  }
  if (fix?.state === 'failed') return <Note text={fix.error} color={C.error} />
  if (fix?.state !== 'fixed') return null
  return <ReplyNote reply={fix.reply} />
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
  draft,
  onDraft,
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
  onFix: (context: string) => void
  draft: Draft | undefined
  onDraft: (next: Draft) => void
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
        {canFix && !author ? (
          <FixControl
            name={name}
            fix={fix}
            waiting={waiting}
            open={draft?.open ?? false}
            onFix={() => onDraft({ open: true, text: draft?.text ?? '' })}
          />
        ) : null}
        {author ? null : <PostControl name={name} remark={remark} post={post} onPost={onPost} />}
      </div>
      <text style={{ fontSize: 13, lineHeight: 20, color: C.text }}>{remark.body}</text>
      {replies.map((reply, index) => (
        <Note key={index} text={`${reply.author}: ${reply.body}`} color={C.secondary} />
      ))}
      {post?.state === 'failed' ? <Note text={post.error} color={C.error} /> : null}
      {canFix && !author && draft?.open ? (
        <FixBox
          name={name}
          text={draft.text}
          waiting={waiting}
          onType={(text) => onDraft({ open: true, text })}
          onStart={() => onFix(draft.text)}
          onCancel={() => onDraft({ open: false, text: draft.text })}
        />
      ) : null}
      <FixNote fix={fix} />
    </div>
  )
}

function ReviewResult({
  review,
  posts,
  fixes,
  replies,
  canFix,
  waiting,
  drafts,
  onPost,
  onFix,
  onDraft,
}: {
  review: Review | undefined
  posts: Map<Remark, Post>
  fixes: Map<Remark, Fix>
  replies: Map<number, Thread['replies']>
  canFix: boolean
  waiting: boolean
  drafts: Map<Remark, Draft>
  onPost: (commit: string, remark: Remark) => void
  onFix: (remark: Remark, context: string) => void
  onDraft: (remark: Remark, next: Draft) => void
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
      {review.remarks.map((remark, index) => {
        const post = posts.get(remark)
        return (
          <RemarkRow
            key={`remark-${index}`}
            name={String(index)}
            remark={remark}
            post={post}
            fix={fixes.get(remark)}
            canFix={canFix}
            waiting={waiting}
            onPost={() => onPost(review.commit, remark)}
            onFix={(context) => onFix(remark, context)}
            draft={drafts.get(remark)}
            onDraft={(next) => onDraft(remark, next)}
            replies={post?.state === 'posted' ? replies.get(post.id) : undefined}
          />
        )
      })}
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
  drafts,
  onBack,
  onOpen,
  onReview,
  onPost,
  onFix,
  onDraft,
}: {
  pr: Pr
  review: Review | undefined
  loaded: Loaded | undefined
  me: string | null
  posts: Map<Remark, Post>
  fixes: Map<Remark, Fix>
  canFix: boolean
  drafts: Map<Remark, Draft>
  onBack: () => void
  onOpen: () => void
  onReview: () => void
  onPost: (commit: string, remark: Remark) => void
  onFix: (remark: Remark, context: string) => void
  onDraft: (remark: Remark, next: Draft) => void
}) {
  const running = review?.state === 'running'
  const reviewed = review?.state === 'done' ? review.remarks : []
  // A remark posted in this window comes back from GitHub too. Show it once, as the remark.
  const postedHere = new Set(reviewed.map((remark) => posts.get(remark)).flatMap((post) => (post?.state === 'posted' ? [post.id] : [])))
  const items = loaded?.state === 'done' ? loaded.items : []
  const threads = items.filter((item) => !postedHere.has(item.thread.id))
  const replies = new Map(items.map(({ thread }) => [thread.id, thread.replies] as const))
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
          <div
            testId="open-on-github"
            onClick={onOpen}
            style={{ cursor: 'pointer', paddingLeft: 6, paddingRight: 6, borderRadius: 5, hover: { backgroundColor: C.hover } }}
          >
            <text style={{ fontSize: 12, color: C.accent }}>Open on GitHub</text>
          </div>
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
            onFix={(context) => onFix(remark, context)}
            draft={drafts.get(remark)}
            onDraft={(next) => onDraft(remark, next)}
            author={thread.author === me ? undefined : thread.author}
            outdated={thread.outdated}
            replies={thread.replies}
          />
        ))}
        <ReviewResult
          review={review}
          posts={posts}
          fixes={fixes}
          replies={replies}
          canFix={canFix}
          waiting={fixing}
          drafts={drafts}
          onPost={onPost}
          onFix={onFix}
          onDraft={onDraft}
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
  openUrl = openInBrowser,
  loadHidden = loadHiddenRepos,
  saveHidden = saveHiddenRepos,
  orders,
}: {
  load?: () => Promise<Pr[]>
  review?: (pr: Pr) => Promise<Reviewed>
  post?: (pr: Pr, commit: string, remark: Remark) => Promise<Posted>
  fix?: (pr: Pr, remark: Remark, context: string) => Promise<Fixed>
  reply?: (pr: Pr, commentId: number, body: string) => Promise<string>
  whoami?: () => Promise<string>
  comments?: (pr: Pr) => Promise<Thread[]>
  openUrl?: (url: string) => void
  loadHidden?: () => Promise<string[]>
  saveHidden?: (repos: string[]) => Promise<void>
  orders?: OrderFeed['subscribe']
}) {
  const [prs, setPrs] = useState<Pr[] | null>(null)
  const [hidden, setHidden] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [opened, setOpened] = useState<Pr | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { renderer } = useGpuix()
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map())
  const [posts, setPosts] = useState<Map<Remark, Post>>(new Map())
  const [fixes, setFixes] = useState<Map<Remark, Fix>>(new Map())
  const [drafts, setDrafts] = useState<Map<Remark, Draft>>(new Map())
  const [me, setMe] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  // The same comment keeps the same remark object across reloads, so its post and fix state stay with it.
  const threadRemarks = useRef(new Map<number, Remark>())
  // A fix or post lands later, so it reads the other side as it is then, not when it started.
  const latestPosts = useRef(posts)
  latestPosts.current = posts
  const latestFixes = useRef(fixes)
  latestFixes.current = fixes

  const refresh = () => {
    setLoading(true)
    setNotice(null)
    load()
      .then((fresh) => {
        setPrs(fresh)
        setError(null)
      })
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  useEffect(() => {
    loadHidden()
      .catch((failure) => {
        setNotice(`Could not read the hidden repos: ${errorMessage(failure)}`)
        return []
      })
      .then(setHidden)
  }, [])

  const setReview = (pr: Pr, next: Review) => setReviews((all) => new Map(all).set(pr.url, next))

  const startReview = (pr: Pr) => {
    setReview(pr, { state: 'running' })
    review(pr)
      .then(({ commit, remarks }) => setReview(pr, { state: 'done', commit, remarks }))
      .catch((failure) => setReview(pr, { state: 'failed', error: errorMessage(failure) }))
  }

  // A review or a fix already runs on it: an order opens the page, but starts nothing on top.
  const busy = (pr: Pr) => {
    const current = reviews.get(pr.url)
    const comments = loaded.get(pr.url)
    const remarks = [
      ...(current?.state === 'done' ? current.remarks : []),
      ...(comments?.state === 'done' ? comments.items.map((item) => item.remark) : []),
    ]
    return current?.state === 'running' || remarks.some((remark) => fixes.get(remark)?.state === 'fixing')
  }

  // Orders come from another launch, like the widget, so the window comes forward for each one.
  useEffect(
    () =>
      orders?.((next) => {
        renderer?.activateWindow?.()
        if (next) setOrder(next)
      }),
    [],
  )

  useEffect(() => {
    if (!order || prs === null || hidden === null) return
    setOrder(null)
    const pr = withoutHidden(prs, hidden).find((entry) => entry.url === order.url)
    if (!pr) {
      setOpened(null)
      setNotice(`This pull request is not in your list: ${order.url}`)
      return
    }
    setNotice(null)
    setOpened(pr)
    if (order.review && !busy(pr)) startReview(pr)
  }, [order, prs, hidden])

  const setPost = (remark: Remark, next: Post) => setPosts((all) => new Map(all).set(remark, next))

  const startPost = (pr: Pr, commit: string, remark: Remark) => {
    setPost(remark, { state: 'posting' })
    post(pr, commit, remark)
      .then((posted) => {
        setPost(remark, { state: 'posted', ...posted })
        const done = latestFixes.current.get(remark)
        if ((done?.state === 'fixed' || done?.state === 'nothing') && done.reply === 'none') sendReply(pr, remark, posted.id, done)
      })
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

  const setDraft = (remark: Remark, next: Draft) => setDrafts((all) => new Map(all).set(remark, next))

  const sendReply = (pr: Pr, remark: Remark, commentId: number, done: Answered) => {
    const answered = (next: Reply) => setFix(remark, { ...done, reply: next })
    answered('sending')
    return reply(pr, commentId, replyText(done)).then(
      () => answered('sent'),
      (failure) => answered({ error: errorMessage(failure) }),
    )
  }

  // The text stays in the draft, so a failed fix can be tried again with it.
  const startFix = (pr: Pr, remark: Remark, context: string) => {
    setDraft(remark, { open: false, text: context })
    setFix(remark, { state: 'fixing' })
    fix(pr, remark, context)
      .then((outcome) => {
        const done: Answered =
          outcome.state === 'nothing'
            ? { state: 'nothing', reason: outcome.reason, reply: 'none' }
            : { state: 'fixed', commit: outcome.commit, answer: outcome.reply, reply: 'none' }
        const posted = latestPosts.current.get(remark)
        if (posted?.state !== 'posted') return setFix(remark, done)
        return sendReply(pr, remark, posted.id, done)
      })
      .catch((failure) => setFix(remark, { state: 'failed', error: errorMessage(failure) }))
  }

  const pick = (repo: string | null) => {
    setPicked(repo)
    setOpened(null)
  }

  const changeHidden = (next: string[]) => {
    setHidden(next)
    saveHidden(next).catch((failure) => setNotice(`Could not save the hidden repos: ${errorMessage(failure)}`))
  }

  const hide = (hiding: string) => {
    changeHidden([...(hidden ?? []), hiding])
    if (picked === hiding) setPicked(null)
    if (opened?.repo === hiding) setOpened(null)
  }

  const unhide = (showing: string) => changeHidden((hidden ?? []).filter((entry) => entry !== showing))

  const listed = useMemo(() => (prs && hidden ? withoutHidden(prs, hidden) : null), [prs, hidden])
  const repos = useMemo(() => repoCounts(listed ?? []), [listed])
  const hiddenRepos = useMemo(() => repoCounts(prs ?? []).filter((entry) => hidden?.includes(entry.repo)), [prs, hidden])
  // A picked repo with nothing left after a refresh falls back to All.
  const repo = repos.some((entry) => entry.repo === picked) ? picked : null
  const visible = inRepo(listed ?? [], repo)

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
          count={listed?.length ?? 0}
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
            action={{ testId: `hide-${entry.repo}`, label: 'Hide', onClick: () => hide(entry.repo) }}
            onClick={() => pick(entry.repo)}
          />
        ))}
        {hiddenRepos.length > 0 ? (
          <>
            <div style={{ flexGrow: 1 }} />
            <div style={{ height: 30, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
              <text style={{ fontSize: 12, color: C.ghost }}>Hidden</text>
            </div>
            {hiddenRepos.map((entry) => (
              <SidebarRow
                key={entry.repo}
                testId={`hidden-${entry.repo}`}
                label={shortName(entry.repo)}
                count={entry.count}
                active={false}
                dimmed
                action={{ testId: `show-${entry.repo}`, label: 'Show', onClick: () => unhide(entry.repo) }}
                onClick={() => unhide(entry.repo)}
              />
            ))}
          </>
        ) : null}
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
          onOpen={() => openUrl(opened.url)}
          onReview={() => startReview(opened)}
          onPost={(commit, remark) => startPost(opened, commit, remark)}
          drafts={drafts}
          onFix={(remark, context) => startFix(opened, remark, context)}
          onDraft={setDraft}
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

          {notice ? (
            <div style={{ flexShrink: 0, paddingLeft: 20, paddingRight: 20, paddingBottom: 8 }}>
              <text style={{ fontSize: 12, lineHeight: 18, color: C.secondary }}>{notice}</text>
            </div>
          ) : null}
          {error ? (
            <Message text={error} color={C.error} />
          ) : listed === null ? (
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

async function takeOrders(): Promise<OrderFeed> {
  const first = readOrder(process.argv.slice(2))
  // Another Workbench is open: hand it the order and quit, so there is only ever one window.
  if (await sendOrder(first)) process.exit(0)
  const feed = orderFeed(first)
  await listenForOrders(feed.push)
  return feed
}

if (isEntryPoint) {
  // `bun --hot` runs this file again on every save, so the socket and its feed are kept on `globalThis`.
  const shared = globalThis as { workbenchOrders?: OrderFeed }
  shared.workbenchOrders ??= await takeOrders()
  render(<PrApp orders={shared.workbenchOrders.subscribe} />, {
    title: 'Workbench',
    width: 960,
    height: 680,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
