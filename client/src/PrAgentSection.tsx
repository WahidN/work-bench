/*
 * Everything the agent does to one pull request, on that pull request's page.
 *
 * Replaces the slide-over panel, which was opened from a row on another screen and covered
 * the page it was about. What it keeps from that panel is the part that was measured: a
 * send holds its request open for as long as the agent runs, which is minutes, so the
 * message goes into the thread the moment it is sent and a line says the agent is working
 * until it finishes. An empty transcript for that whole stretch is how a run that timed out
 * came to look like a button that did nothing.
 *
 * What it drops is the four-target machinery. One target means no kicker, no title and no
 * per-kind placeholder: the page above already says which pull request this is.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { agentElapsed, agentLabel } from './agentsLogic'
import {
  agentsForPr,
  authorLabel,
  reviewedLine,
  showsSentEcho,
  type ChatRole,
  type SentMessage,
} from './prDetailLogic'
import {
  keys,
  usePrThread,
  useRunningAgents,
  useSendPrMessage,
  type ChatMessage,
  type Pr,
  type RunningAgent,
} from './queries'

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div
      data-message={message.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 'var(--wb-s2)',
      }}
    >
      <span
        style={{ fontSize: 'var(--wb-fs-tag)', letterSpacing: 0.8, color: 'var(--wb-n600)' }}
      >
        {authorLabel(message.role as ChatRole)}
      </span>
      <span
        style={{
          maxWidth: 520,
          padding: 'var(--wb-s3) var(--wb-s4)',
          fontSize: 'var(--wb-fs-secondary)',
          lineHeight: 'calc(var(--wb-fs-secondary) + 3px)',
          // Preserves the agent's own line breaks, which it uses for lists.
          whiteSpace: 'pre-wrap',
          color: isUser ? 'var(--wb-a100)' : 'var(--wb-text)',
          background: isUser ? 'var(--wb-a900)' : 'var(--wb-surface)',
          borderRadius: 'var(--wb-radius-md)',
          border: `1px solid ${isUser ? 'var(--wb-a800)' : 'var(--wb-n900)'}`,
          boxSizing: 'border-box',
        }}
      >
        {message.content}
      </span>
    </div>
  )
}

/**
 * The line under the thread while a send is open.
 *
 * A run takes minutes and nothing streams out of it, so there is no progress to report,
 * only that it is still going.
 */
function WorkingLine() {
  return (
    <div
      id="pr-agent-working"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--wb-s2)',
      }}
    >
      <span
        style={{ fontSize: 'var(--wb-fs-tag)', letterSpacing: 0.8, color: 'var(--wb-n600)' }}
      >
        {authorLabel('assistant')}
      </span>
      <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n500)' }}>
        Working, this can take a few minutes
      </span>
    </div>
  )
}

/** One running agent, named for what it is doing and how long it has been at it. */
function AgentRow({ agent, now }: { agent: RunningAgent; now: Date }) {
  return (
    <div
      data-pr-agent={agent.key}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--wb-s3)',
        fontSize: 'var(--wb-fs-table-meta)',
        color: agent.waiting ? 'var(--wb-n600)' : 'var(--wb-accent)',
      }}
    >
      <span style={{ letterSpacing: 0.8, fontSize: 'var(--wb-fs-tag)' }}>
        {agent.waiting ? 'WAITING' : 'RUNNING'}
      </span>
      <span style={{ color: 'var(--wb-text)' }}>{agentLabel(agent)}</span>
      <span style={{ color: 'var(--wb-n600)' }}>{agentElapsed(agent, now)}</span>
    </div>
  )
}

export function PrAgentSection({ pr, onError }: { pr: Pr; onError: (message: string) => void }) {
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<SentMessage | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  const client = useQueryClient()
  const thread = usePrThread(pr.id, true)
  const agents = useRunningAgents()
  const send = useSendPrMessage(pr.id)

  const messages = thread.data?.messages ?? []
  const running = agentsForPr(agents.data?.agents ?? [], pr.id)
  const echoing = showsSentEcho(sent, messages.length)
  /*
   * The pull request as the engine now has it, not the one the page was opened with: a
   * send can move `reviewedAt`, and the line above the thread reads it.
   */
  const live = thread.data ?? pr

  // The stored row has landed, so the echo would be the same message twice.
  useEffect(() => {
    if (!echoing) setSent(null)
  }, [echoing])

  /*
   * Re-read the pull request when the last agent on it finishes.
   *
   * An agent that runs to the end leaves no mutation behind to invalidate anything: a
   * review is started with one request and writes `reviewed_at` minutes later, from a job
   * nothing on this page is awaiting. Without this the page sat on "Not reviewed yet" with
   * the findings already rendered under it, because those come from a query that polls and
   * the pull request itself comes from one that does not.
   *
   * Keyed on the count going to zero rather than on any one agent, so it covers a review,
   * a conflict resolve and a comment fix alike.
   */
  const runningCount = running.length
  const wasRunning = useRef(0)
  useEffect(() => {
    if (wasRunning.current > 0 && runningCount === 0) {
      void client.invalidateQueries({ queryKey: keys.pr(pr.id) })
      void client.invalidateQueries({ queryKey: keys.prReview(pr.id) })
    }
    wasRunning.current = runningCount
  }, [runningCount, client, pr.id])

  useEffect(() => {
    if (messages.length > 0 || echoing) bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, echoing])

  /** The draft survives a failed send, so the user can retry instead of retyping. */
  function submit() {
    const text = draft.trim()
    if (send.isPending || text === '') return
    setSent({ text, countAtSend: messages.length })
    send.mutate(
      { text },
      {
        onSuccess: () => setDraft(''),
        /*
         * The echo goes on an error rather than waiting for the thread to grow. A send
         * refused before the engine stored anything, a 409 or a 400, leaves the thread the
         * length it was, and the alert is what explains it.
         */
        onError: (error) => {
          setSent(null)
          onError(String(error))
        },
      },
    )
  }

  return (
    <div
      id="pr-agent-section"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s4)' }}
    >
      <span
        id="pr-reviewed-line"
        style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}
      >
        {reviewedLine(live, new Date())}
      </span>

      {running.length > 0 && (
        <div
          id="pr-agents"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}
        >
          {running.map((agent) => (
            <AgentRow key={agent.key} agent={agent} now={new Date()} />
          ))}
        </div>
      )}

      {(messages.length > 0 || echoing || send.isPending) && (
        <div
          id="pr-agent-thread"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s4)',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {/*
            * The same bubble as a stored message, because it is the same message. The id is
            * negative so it cannot collide with a row the engine wrote.
            */}
          {echoing && sent !== null && (
            <MessageBubble message={{ id: -1, role: 'user', content: sent.text }} />
          )}
          {send.isPending && <WorkingLine />}
          <div ref={bottom} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s2)' }}>
        <input
          id="pr-agent-draft"
          value={draft}
          disabled={send.isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="Tell the agent what to do on this pull request"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 'var(--wb-s2) var(--wb-s3)',
            fontFamily: 'inherit',
            fontSize: 'var(--wb-fs-secondary)',
            color: 'var(--wb-text)',
            background: 'var(--wb-surface)',
            borderRadius: 'var(--wb-radius-md)',
            border: '1px solid var(--wb-n800)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          id="pr-agent-send"
          aria-label="Send"
          disabled={send.isPending}
          onClick={submit}
          style={{
            padding: '3px var(--wb-s3)',
            fontFamily: 'inherit',
            fontSize: 'var(--wb-fs-label)',
            color: 'var(--wb-accent)',
            background: 'transparent',
            borderRadius: 'var(--wb-radius-sm)',
            border: '1px solid var(--wb-accent)',
            opacity: send.isPending ? 0.5 : 1,
            cursor: send.isPending ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
