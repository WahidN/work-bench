/*
 * Port of app/Workbench/Views/AgentChatPanel.swift.
 *
 * A slide-over on the sidebar's raised tone. One panel for four kinds of target; what
 * differs between them is in agentChatLogic.ts, and what differs about their threads is in
 * `useThread` below.
 *
 * The thing to understand before changing anything here: a send runs a headless Claude
 * session, so the request stays open for minutes. Nothing polls, nothing times out, and
 * the composer is disabled for the whole wait. That is not a placeholder for something
 * better; it is what the app does, because the engine answers when the agent has answered.
 */

import { useEffect, useRef, useState } from 'react'
import { DiffView } from './DiffView'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import {
  authorLabel,
  canMerge,
  chatSubject,
  targetSymbol,
  type AgentChatTarget,
  type ChatRole,
} from './agentChatLogic'
import {
  useMergePr,
  usePrDiff,
  usePrThread,
  useProjectThread,
  useSendPrMessage,
  useSendProjectMessage,
  useSendTicketMessage,
  useSendTodoMessage,
  useTicketThread,
  useTodoThread,
  type ChatMessage,
  type Project,
  type Ticket,
} from './queries'

const WIDTH = 360

/**
 * Every thread query, gated so exactly one runs.
 *
 * All four are called on every render because that is the rule for hooks, and `enabled`
 * is what keeps three of them from fetching. The id passed to a disabled one is never
 * used, so 0 is not a sentinel anyone reads.
 */
function useThread(target: AgentChatTarget) {
  const project = useProjectThread(
    target.kind === 'project' ? target.project.id : 0,
    target.kind === 'project',
  )
  const ticket = useTicketThread(
    target.kind === 'ticket' ? target.ticket.id : 0,
    target.kind === 'ticket',
  )
  const pr = usePrThread(
    target.kind === 'pullRequest' ? target.pr.id : 0,
    target.kind === 'pullRequest',
  )
  const todo = useTodoThread(target.kind === 'todo' ? target.todo.id : 0, target.kind === 'todo')

  switch (target.kind) {
    case 'project':
      return { messages: project.data ?? [], error: project.error }
    // `messages` is optional on the record: a ticket or pull request with no thread yet
    // comes back without the field rather than with an empty array.
    case 'ticket':
      return { messages: ticket.data?.messages ?? [], error: ticket.error }
    case 'pullRequest':
      return { messages: pr.data?.messages ?? [], error: pr.error }
    case 'todo':
      return { messages: todo.data ?? [], error: todo.error }
  }
}

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
        style={{
          fontSize: 'var(--wb-fs-tag)',
          letterSpacing: 0.8,
          color: 'var(--wb-n600)',
        }}
      >
        {authorLabel(message.role as ChatRole)}
      </span>
      <span
        style={{
          maxWidth: 280,
          padding: 'var(--wb-s3) var(--wb-s4)',
          fontSize: 'var(--wb-fs-secondary)',
          lineHeight: 'calc(var(--wb-fs-secondary) + 3px)',
          // Preserves the agent's own line breaks, which SwiftUI's Text does for free.
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

function Chip({ text, onClick }: { text: string; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false)
  return (
    <button
      data-quick-prompt={text}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: '3px var(--wb-s3)',
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-label)',
        color: isHovered ? 'var(--wb-a200)' : 'var(--wb-n400)',
        background: 'transparent',
        borderRadius: 'var(--wb-radius-sm)',
        border: `1px solid ${isHovered ? 'var(--wb-accent)' : 'var(--wb-n800)'}`,
        cursor: 'pointer',
      }}
    >
      {text}
    </button>
  )
}

export function AgentChatPanel({
  target,
  project,
  linkedTicket,
  onClose,
  onBackToProject,
}: {
  target: AgentChatTarget
  project: Project | undefined
  linkedTicket: Ticket | undefined
  onClose: () => void
  onBackToProject: (project: Project) => void
}) {
  const [draft, setDraft] = useState('')
  const [alert, setAlert] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  const subject = chatSubject(target, project, linkedTicket)
  const thread = useThread(target)

  const sendProject = useSendProjectMessage(target.kind === 'project' ? target.project.id : 0)
  const sendTicket = useSendTicketMessage(target.kind === 'ticket' ? target.ticket.id : 0)
  const sendPr = useSendPrMessage(target.kind === 'pullRequest' ? target.pr.id : 0)
  const sendTodo = useSendTodoMessage(target.kind === 'todo' ? target.todo.id : 0)
  const merge = useMergePr(target.kind === 'pullRequest' ? target.pr.id : 0)

  /*
   * The diff, only for a pull request that is not merged. `loadDiff` in the ViewModel
   * skips a merged one outright, because there is nothing to fetch: the route answers 409.
   */
  const diff = usePrDiff(
    target.kind === 'pullRequest' ? target.pr.id : 0,
    target.kind === 'pullRequest' && target.pr.status !== 'merged',
  )

  const isSending =
    sendProject.isPending ||
    sendTicket.isPending ||
    sendPr.isPending ||
    sendTodo.isPending ||
    merge.isPending

  // `.defaultScrollAnchor(.bottom)`: a thread opens at its newest message, not its oldest.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [thread.messages.length, target])

  useEffect(() => {
    if (thread.error) setAlert(String(thread.error))
  }, [thread.error])

  /** The draft survives a failed send, so the user can retry instead of retyping. */
  function send(text: string, clearDraft: boolean) {
    if (isSending || text.trim() === '') return
    const done = {
      onSuccess: () => {
        if (clearDraft) setDraft('')
      },
      onError: (error: Error) => setAlert(String(error)),
    }
    switch (target.kind) {
      case 'project':
        sendProject.mutate({ text }, done)
        return
      case 'ticket':
        sendTicket.mutate({ text }, done)
        return
      case 'pullRequest':
        sendPr.mutate({ text }, done)
        return
      case 'todo':
        sendTodo.mutate({ text }, done)
        return
    }
  }

  return (
    <aside
      id="agent-panel"
      style={{
        width: WIDTH,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--wb-panel-background)',
        borderLeft: '1px solid var(--wb-n800)',
        boxShadow: '0 16px 20px rgb(0 0 0 / 0.65)',
        boxSizing: 'border-box',
        // The handoff's wbSlide: translateX 24 to 0 with a fade, 160ms ease-out.
        animation: 'wb-slide 160ms ease-out',
      }}
    >
      {/* header */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s1)',
          padding: 'var(--wb-s6)',
          borderBottom: '1px solid var(--wb-n900)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--wb-s3)' }}>
          <span style={{ marginTop: 1, color: 'var(--wb-accent)' }}>
            <Icon name={targetSymbol(target)} size={13} />
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--wb-s1)' }}>
            <span
              style={{
                fontSize: 'var(--wb-fs-label)',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                color: 'var(--wb-n600)',
              }}
            >
              {subject.kicker}
            </span>
            <span
              id="agent-title"
              style={{
                fontSize: 'var(--wb-fs-secondary)',
                fontWeight: 'var(--wb-weight-heading)',
                color: 'var(--wb-text)',
              }}
            >
              {subject.title}
            </span>
          </div>
          <button
            id="agent-close"
            aria-label="Close the agent panel"
            title="Close the agent panel"
            onClick={onClose}
            style={{
              display: 'flex',
              padding: 'var(--wb-s2)',
              color: 'var(--wb-n600)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon name="xmark" size={12} />
          </button>
        </div>
        {subject.backToProjectName !== null && project !== undefined && (
          <button
            id="agent-back-to-project"
            onClick={() => onBackToProject(project)}
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--wb-s2)',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-label)',
              color: 'var(--wb-n500)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon name="arrow-left" size={9} />
            Back to {subject.backToProjectName}
          </button>
        )}
      </div>

      {subject.note !== null && (
        <p
          id="agent-note"
          style={{
            flex: 'none',
            margin: 0,
            padding: 'var(--wb-s3) var(--wb-s6)',
            fontSize: 'var(--wb-fs-table-meta)',
            color: 'var(--wb-n600)',
            background: 'var(--wb-surface)',
            borderBottom: '1px solid var(--wb-n900)',
            boxSizing: 'border-box',
          }}
        >
          {subject.note}
        </p>
      )}

      {/* messages */}
      <div
        id="agent-messages"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s6)',
          padding: 'var(--wb-s6)',
          boxSizing: 'border-box',
        }}
      >
        {diff.data !== undefined && <DiffView diffText={diff.data.diff} maxHeight={200} />}
        {thread.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottom} />
      </div>

      {/* composer */}
      <div
        id="agent-composer"
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s3)',
          padding: 'var(--wb-s6)',
          boxSizing: 'border-box',
        }}
      >
        {canMerge(target) && (
          <button
            id="agent-merge"
            disabled={isSending}
            onClick={() => {
              if (isSending) return
              merge.mutate(undefined, {
                onSuccess: (result) => {
                  // A refusal comes back as 200 with an action, so it is read off the
                  // result rather than caught.
                  if (result.action === 'refused') setAlert(result.reply)
                },
                onError: (error) => setAlert(String(error)),
              })
            }}
            style={{
              alignSelf: 'flex-start',
              padding: '3px var(--wb-s3)',
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-label)',
              color: 'var(--wb-status-approved)',
              background: 'transparent',
              borderRadius: 'var(--wb-radius-sm)',
              border: '1px solid var(--wb-status-approved)',
              opacity: isSending ? 0.5 : 1,
              cursor: isSending ? 'default' : 'pointer',
            }}
          >
            Merge
          </button>
        )}

        {/* FlowRow: the three prompts do not fit on one 360px row. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--wb-s2)' }}>
          {subject.quickPrompts.map((prompt) => (
            // A chip must not eat a draft the user has already typed.
            <Chip key={prompt} text={prompt} onClick={() => send(prompt, false)} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s2)' }}>
          <input
            id="agent-draft"
            value={draft}
            disabled={isSending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') send(draft, true)
            }}
            placeholder={subject.placeholder}
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
            id="agent-send"
            aria-label="Send"
            disabled={isSending}
            onClick={() => send(draft, true)}
            style={{
              display: 'flex',
              padding: 'var(--wb-s2)',
              color: 'var(--wb-accent)',
              background: 'transparent',
              borderRadius: 'var(--wb-radius-md)',
              border: '1px solid var(--wb-accent)',
              opacity: isSending ? 0.5 : 1,
              cursor: isSending ? 'default' : 'pointer',
            }}
          >
            <Icon name="arrow-up" size={12} />
          </button>
        </div>
      </div>

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </aside>
  )
}
