/*
 * Port of app/Workbench/Views/PrDetailScreen.swift, 563 lines and the largest file in the
 * app: facts header, review section, tab counts, files and conversation.
 *
 * Three behaviours here are the ones worth reading the Swift for, because they all exist
 * to stop the screen lying:
 *
 *   - The summary is painted from the list row first, so a slow or failing GitHub call
 *     still leaves a screen that says which pull request you are looking at.
 *   - A review error belongs to the remark that failed, not to the screen. One bad anchor
 *     says nothing about the other five.
 *   - Merge is offered only on a pull request you wrote. The engine refuses anything
 *     else, but a squash merge is irreversible, so the button is not offered at all
 *     rather than offered and then denied.
 */

import { useEffect, useState } from 'react'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import { PrFileSection } from './PrFileSection'
import { openInBrowser } from './engineAgent'
import { prReviewStateLabel, relativeTime } from './logic'
import { factsParts, openedLine, sections, tabCounts, threadId } from './prDetailLogic'
import type { PrReviewThread } from './prDetailLogic'
import {
  canPost,
  isRunning,
  outdatedLabel,
  summary,
  type StoredReviewFinding,
} from './prReviewLogic'
import {
  useDiscardPrFinding,
  useMergePr,
  usePostPrFinding,
  usePostReviewReply,
  usePrDetail,
  usePrReview,
  useStartPrReview,
  type Pr,
} from './queries'

type Tab = 'files' | 'conversation'

const TABS: Tab[] = ['files', 'conversation']

/* --------------------------------------------------------------- controls */

function OutlineButton({
  label,
  color,
  disabled,
  onClick,
  id,
}: {
  label: string
  color: string
  disabled?: boolean
  onClick: () => void
  id?: string
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 'var(--wb-s2) var(--wb-s4)',
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-secondary)',
        fontWeight: 'var(--wb-weight-heading)',
        color,
        background: 'transparent',
        border: `1px solid ${color}`,
        borderRadius: 'var(--wb-radius-md)',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

/* ------------------------------------------------------- review section */

function FindingCard({
  finding,
  body,
  isPosting,
  error,
  onEdit,
  onPost,
  onDiscard,
}: {
  finding: StoredReviewFinding
  body: string
  isPosting: boolean
  error: string | null
  onEdit: (body: string) => void
  onPost: () => void
  onDiscard: () => void
}) {
  return (
    <div
      data-finding={finding.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s2)',
        padding: 'var(--wb-s3)',
        background: 'var(--wb-bg)',
        borderRadius: 'var(--wb-radius-sm)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s2)',
          fontSize: 'var(--wb-fs-table-meta)',
        }}
      >
        <span
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--wb-accent)',
          }}
        >
          {finding.path}:{finding.line}
        </span>
        {finding.posted && <span style={{ color: 'var(--wb-status-approved)' }}>Posted</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--wb-s2)' }}>
          {canPost(finding) && (
            <>
              <button
                onClick={onPost}
                disabled={isPosting}
                style={{
                  padding: 0,
                  fontFamily: 'inherit',
                  fontSize: 'var(--wb-fs-table-meta)',
                  color: 'var(--wb-status-approved)',
                  background: 'transparent',
                  border: 'none',
                  cursor: isPosting ? 'default' : 'pointer',
                }}
              >
                Post
              </button>
              <button
                onClick={onDiscard}
                aria-label="Discard this comment"
                style={{
                  display: 'flex',
                  padding: 0,
                  color: 'var(--wb-n600)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <Icon name="trash" size={12} />
              </button>
            </>
          )}
        </span>
      </div>

      {finding.posted ? (
        <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n500)' }}>{body}</span>
      ) : (
        <textarea
          value={body}
          onChange={(event) => onEdit(event.target.value)}
          style={{
            minHeight: 56,
            padding: 'var(--wb-s2)',
            fontFamily: 'inherit',
            fontSize: 'var(--wb-fs-secondary)',
            color: 'var(--wb-text)',
            background: 'var(--wb-surface)',
            border: 'none',
            borderRadius: 'var(--wb-radius-sm)',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      )}

      {/* On the remark that failed, not on the screen. */}
      {error !== null && (
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-negative)' }}>
          {error}
        </span>
      )}
    </div>
  )
}

/* --------------------------------------------------------- review thread */

function ReviewThreadView({
  thread,
  isBusy,
  onPost,
}: {
  thread: PrReviewThread
  isBusy: boolean
  onPost: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const isBlank = text.trim() === ''
  const commentId = thread.comments[0]?.id ?? 0

  const age = (createdAt: string) => {
    const date = new Date(createdAt)
    return Number.isNaN(date.getTime()) ? null : relativeTime(date, new Date())
  }

  return (
    <div
      data-review-thread={threadId(thread)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s2)',
        padding: 'var(--wb-s4)',
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: '1px solid var(--wb-n800)',
        boxSizing: 'border-box',
      }}
    >
      {thread.comments.map((comment) => (
        <div
          key={comment.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s1)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s2)' }}>
            <span
              style={{
                fontSize: 'var(--wb-fs-table-meta)',
                fontWeight: 'var(--wb-weight-heading)',
                color: 'var(--wb-text)',
              }}
            >
              {comment.author}
            </span>
            {age(comment.createdAt) !== null && (
              <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>
                {age(comment.createdAt)}
              </span>
            )}
            {!thread.isResolved && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--wb-fs-tag)',
                  color: 'var(--wb-n400)',
                  padding: '1px 7px',
                  border: '1px solid var(--wb-n800)',
                  borderRadius: 'var(--wb-radius-sm)',
                }}
              >
                Unresolved
              </span>
            )}
          </div>
          <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n300)' }}>
            {comment.body}
          </span>
        </div>
      ))}

      {/*
        A thread GitHub returned without comments has no id to reply to, and the reply
        endpoint would 404 on the 0 the parent falls back to.
      */}
      {commentId !== 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write a reply…"
            aria-label={`Reply to ${thread.comments[0]?.author ?? 'this comment'}`}
            style={{
              minHeight: 72,
              padding: 'var(--wb-s2)',
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: 'var(--wb-text)',
              background: 'var(--wb-bg)',
              border: '1px solid var(--wb-n800)',
              borderRadius: 'var(--wb-radius-sm)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
            <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>
              This will be posted to GitHub.
            </span>
            <button
              onClick={() => {
                void onPost(text).then((landed) => {
                  // Emptied only on a post that actually landed, so a failed one leaves
                  // the text to retry.
                  if (landed) setText('')
                })
              }}
              disabled={isBusy || isBlank}
              style={{
                marginLeft: 'auto',
                padding: 'var(--wb-s1) 0',
                fontFamily: 'inherit',
                fontSize: 'var(--wb-fs-table-meta)',
                fontWeight: 'var(--wb-weight-heading)',
                color: isBusy || isBlank ? 'var(--wb-n700)' : 'var(--wb-accent)',
                background: 'transparent',
                border: 'none',
                cursor: isBusy || isBlank ? 'default' : 'pointer',
              }}
            >
              {isBusy ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------ conversation item */

function ConversationItem({
  item,
}: {
  item: { author: string; body: string; state: string | null }
}) {
  const label =
    item.state === 'APPROVED'
      ? 'Approved'
      : item.state === 'CHANGES_REQUESTED'
        ? 'Changes requested'
        : null
  const color =
    item.state === 'APPROVED'
      ? 'var(--wb-status-approved)'
      : 'var(--wb-status-changes-requested)'

  return (
    <div
      data-conversation-item=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s2)',
        padding: 'var(--wb-s4)',
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: '1px solid var(--wb-n900)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
        <span
          style={{
            fontSize: 'var(--wb-fs-secondary)',
            fontWeight: 'var(--wb-weight-heading)',
            color: 'var(--wb-text)',
          }}
        >
          {item.author}
        </span>
        {label !== null && (
          <span
            style={{
              fontSize: 'var(--wb-fs-tag)',
              color,
              padding: '1px 7px',
              border: `1px solid ${color}`,
              borderRadius: 'var(--wb-radius-sm)',
            }}
          >
            {label}
          </span>
        )}
      </div>
      {item.body !== '' && (
        <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n300)' }}>
          {item.body}
        </span>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- screen */

export function PrDetailScreen({
  pr,
  onBack,
}: {
  pr: Pr
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('files')
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [alert, setAlert] = useState<string | null>(null)

  const detail = usePrDetail(pr.id)
  const review = usePrReview(pr.id)

  const startReview = useStartPrReview(pr.id)
  const postFinding = usePostPrFinding(pr.id)
  const discardFinding = useDiscardPrFinding(pr.id)
  const postReply = usePostReviewReply(pr.id)
  const merge = useMergePr(pr.id)

  /*
   * The in-progress edit and the per-finding error. Local on purpose, and for the same
   * reason PrReviewViewModel keeps them: neither should outlive the screen, and neither
   * belongs to the engine.
   *
   * The edited body is deliberately kept after a successful post. The route stores only
   * `posted`, never the text it sent, so dropping the overlay would replace what GitHub
   * received with the original the agent wrote.
   */
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [findingErrors, setFindingErrors] = useState<Record<number, string>>({})
  const [postingIds, setPostingIds] = useState<Set<number>>(new Set())
  const [busyCommentIds, setBusyCommentIds] = useState<Set<number>>(new Set())

  /*
   * Matches `PrReviewViewModel.didStart`: set the moment a review is started, before any
   * load has reported the job. Without it the button flickers back to enabled between the
   * start call returning and the next load.
   */
  const [didStart, setDidStart] = useState(false)
  useEffect(() => {
    // The engine's answer replaces the optimistic flag, which is what releases the button
    // when a review finishes and also when one was interrupted and is never coming back.
    if (review.dataUpdatedAt !== 0) setDidStart(false)
  }, [review.dataUpdatedAt])

  const findings = review.data?.findings ?? []
  const isReviewBusy = startReview.isPending || isRunning(review.data) || didStart
  const outdated = outdatedLabel(review.data?.outdated ?? false)

  const bodyOf = (finding: StoredReviewFinding) => edits[finding.id] ?? finding.body

  const facts = detail.data ? factsParts(detail.data) : null
  const counts = detail.data ? tabCounts(detail.data) : null
  const fileSections = detail.data ? sections(detail.data) : []

  /*
   * GitHub's own page for this pull request. Null on a row created before the pull
   * request existed, so the link is offered only once there is a page to open.
   */
  const prUrl = pr.url

  function toggleFile(id: string) {
    setCollapsedFiles((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function post(finding: StoredReviewFinding) {
    setPostingIds((current) => new Set(current).add(finding.id))
    setFindingErrors((current) => {
      const next = { ...current }
      delete next[finding.id]
      return next
    })
    try {
      await postFinding.mutateAsync({ findingId: finding.id, body: bodyOf(finding) })
    } catch (error) {
      setFindingErrors((current) => ({ ...current, [finding.id]: String(error) }))
    } finally {
      setPostingIds((current) => {
        const next = new Set(current)
        next.delete(finding.id)
        return next
      })
    }
  }

  /** Answers whether the reply reached GitHub, so a failed post leaves the text to retry. */
  async function reply(commentId: number, text: string): Promise<boolean> {
    if (busyCommentIds.has(commentId)) return false
    setBusyCommentIds((current) => new Set(current).add(commentId))
    try {
      await postReply.mutateAsync({ commentId, text })
      return true
    } catch (error) {
      setAlert(String(error))
      return false
    } finally {
      setBusyCommentIds((current) => {
        const next = new Set(current)
        next.delete(commentId)
        return next
      })
    }
  }

  return (
    <div
      id="pr-detail-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s6)',
        padding: 'var(--wb-s8)',
        maxWidth: 1180,
        background: 'var(--wb-bg)',
        boxSizing: 'border-box',
      }}
    >
      <button
        id="pr-back"
        onClick={onBack}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s2)',
          padding: 'var(--wb-s1) 0',
          fontFamily: 'inherit',
          fontSize: 'var(--wb-fs-secondary)',
          color: 'var(--wb-n500)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <Icon name="arrow-left" size={13} />
        All pull requests
      </button>

      {/* summary */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <span
            style={{
              fontSize: 'var(--wb-fs-tag)',
              color: 'var(--wb-n400)',
              padding: '2px 8px',
              border: '1px solid var(--wb-n800)',
              borderRadius: 'var(--wb-radius-sm)',
            }}
          >
            {prReviewStateLabel(pr)}
          </span>
          {detail.data && (
            <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
              {openedLine(detail.data, pr.authoredByMe)}
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--wb-s3)' }}>
            {prUrl !== null && (
              <OutlineButton
                id="pr-github-button"
                label="Open on GitHub"
                color="var(--wb-n500)"
                onClick={() => {
                  void openInBrowser(prUrl).catch((error: unknown) => setAlert(String(error)))
                }}
              />
            )}
            {/*
              Offered whoever wrote it, unlike Merge: the review queue is mostly other
              people's work, and that is what needs reviewing.
            */}
            <OutlineButton
              id="pr-review-button"
              label={isReviewBusy ? 'Reviewing…' : 'Review this PR'}
              color={isReviewBusy ? 'var(--wb-n700)' : 'var(--wb-accent)'}
              disabled={isReviewBusy}
              onClick={() => {
                startReview.mutate(undefined, {
                  onSuccess: () => setDidStart(true),
                  // Nothing was started, so the button has to come back.
                  onError: (error) => {
                    setDidStart(false)
                    setAlert(String(error))
                  },
                })
              }}
            />
            {pr.authoredByMe && (
              <OutlineButton
                id="pr-merge-button"
                label={merge.isPending ? 'Merging…' : 'Merge'}
                color="var(--wb-status-approved)"
                disabled={merge.isPending}
                onClick={() => {
                  merge.mutate(undefined, {
                    onSuccess: (result) => {
                      if (result.action === 'refused') setAlert(result.reply)
                    },
                    onError: (error) => setAlert(String(error)),
                  })
                }}
              />
            )}
          </span>
        </div>

        <span
          id="pr-title"
          style={{
            fontSize: 'var(--wb-fs-screen-title)',
            fontWeight: 'var(--wb-weight-heading)',
            color: 'var(--wb-text)',
          }}
        >
          {detail.data?.title ?? pr.title}
        </span>

        {facts && (
          <div
            id="pr-facts"
            style={{
              display: 'flex',
              gap: 'var(--wb-s4)',
              fontSize: 'var(--wb-fs-table-meta)',
              color: 'var(--wb-n600)',
            }}
          >
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--wb-n400)',
              }}
            >
              {facts.branches}
            </span>
            <span>{facts.commits}</span>
            <span>{facts.files}</span>
            <span style={{ color: 'var(--wb-status-approved)' }}>{facts.churn}</span>
          </div>
        )}
      </div>

      {/*
        The review as part of the pull request, not as a dialog over it. It arrives while
        the user is elsewhere and waits here until they deal with it.
      */}
      {findings.length > 0 && (
        <div
          id="pr-review-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s3)',
            padding: 'var(--wb-s4)',
            background: 'color-mix(in srgb, var(--wb-n900) 50%, transparent)',
            borderRadius: 'var(--wb-radius-md)',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
            <span
              style={{
                fontSize: 'var(--wb-fs-secondary)',
                fontWeight: 'var(--wb-weight-heading)',
                color: 'var(--wb-text)',
              }}
            >
              Review
            </span>
            <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
              {summary(findings)}
            </span>
            {outdated !== null && (
              <span
                style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-status-blocked)' }}
              >
                {outdated}
              </span>
            )}
          </div>
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              body={bodyOf(finding)}
              isPosting={postingIds.has(finding.id)}
              error={findingErrors[finding.id] ?? null}
              onEdit={(body) => setEdits((current) => ({ ...current, [finding.id]: body }))}
              onPost={() => void post(finding)}
              onDiscard={() =>
                discardFinding.mutate(
                  { findingId: finding.id },
                  { onError: (error) => setAlert(String(error)) },
                )
              }
            />
          ))}
        </div>
      )}

      {/* tab bar */}
      <div
        id="pr-tab-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s1)',
          padding: 'var(--wb-s1)',
          background: 'color-mix(in srgb, var(--wb-n900) 50%, transparent)',
          borderRadius: 'var(--wb-radius-md)',
          boxSizing: 'border-box',
        }}
      >
        {TABS.map((option) => (
          <button
            key={option}
            data-tab={option}
            onClick={() => setTab(option)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--wb-s2)',
              padding: 'var(--wb-s2) var(--wb-s4)',
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: option === tab ? 'var(--wb-text)' : 'var(--wb-n500)',
              background: option === tab ? 'var(--wb-surface)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--wb-radius-sm)',
              cursor: 'pointer',
            }}
          >
            <Icon name={option === 'files' ? 'doc-text' : 'bubble-left'} size={13} />
            {option === 'files' ? 'Files changed' : 'Conversation'}
            <span style={{ color: 'var(--wb-n600)', fontVariantNumeric: 'tabular-nums' }}>
              {counts === null ? '' : option === 'files' ? counts.files : counts.conversation}
            </span>
          </button>
        ))}
      </div>

      {/* content */}
      {detail.isLoading ? (
        <p style={{ margin: 0, fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n600)' }}>
          Loading from GitHub…
        </p>
      ) : detail.data === undefined ? (
        <p style={{ margin: 0, fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n600)' }}>
          Could not reach GitHub. The pull request's own details are shown above.
        </p>
      ) : tab === 'files' ? (
        fileSections.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n600)' }}>
            This pull request changes no files.
          </p>
        ) : (
          <div
            id="pr-files"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s4)' }}
          >
            {fileSections.map((section) => (
              <PrFileSection
                key={section.id}
                section={section}
                isExpanded={!collapsedFiles.has(section.id)}
                onToggle={() => toggleFile(section.id)}
                threadContent={(thread) => {
                  const commentId = thread.comments[0]?.id ?? 0
                  return (
                    <ReviewThreadView
                      thread={thread}
                      isBusy={busyCommentIds.has(commentId)}
                      onPost={(text) => reply(commentId, text)}
                    />
                  )
                }}
              />
            ))}
          </div>
        )
      ) : detail.data.conversation.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n600)' }}>
          No reviews or comments yet.
        </p>
      ) : (
        <div
          id="pr-conversation"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s4)' }}
        >
          {detail.data.conversation.map((item, index) => (
            <ConversationItem key={index} item={item} />
          ))}
        </div>
      )}

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </div>
  )
}
