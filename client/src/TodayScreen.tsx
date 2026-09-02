/*
 * Port of TodayScreen.swift, TodayLogic.swift and TaskRow.swift.
 *
 * Live: the checkbox, the quick-add field, the priority label, delete with its context
 * menu, promote, and the rail's pin button. Each one refetches the way its ViewModel
 * does, which is stated per mutation in queries.ts rather than repeated here.
 *
 * The delete button keeps its reserved space on every row, which TaskRow.swift is
 * explicit about: returning nothing for a non-deletable row made the title column
 * narrower on some rows than others and titles wrapped in different places.
 */

import { useState } from 'react'
import type { Pr, Project, Ticket, TodayView, TodoPriority } from './queries'
import {
  useCreateTodo,
  useDeleteTodo,
  usePromoteTodo,
  useSetPrPinned,
  useSetTicketPinned,
  useSetTodoDone,
  useSetTodoPinned,
  useSetTodoPriority,
} from './queries'
import { chatTargetForTodo, type AgentChatTarget } from './agentChatLogic'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import { TaskRow } from './TaskRow'
import {
  dayString,
  issueRail,
  pullRequestRail,
  taskSections,
  type RailItem,
  type TaskRow as TaskRowModel,
} from './logic'

/** TodayLogic.nextPriority: high, med, low, and back to high. */
function nextPriority(priority: TodoPriority): TodoPriority {
  return priority === 'high' ? 'med' : priority === 'med' ? 'low' : 'high'
}


function RailCard({
  item,
  onTogglePin,
  onChat,
}: {
  item: RailItem
  onTogglePin: () => void
  onChat: () => void
}) {
  return (
    <div
      data-rail-card={item.id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3)',
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: '1px solid var(--wb-n900)',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ marginTop: 2, color: item.symbolColor }}>
        <Icon name={item.symbol} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-text)' }}>
          {item.title}
        </span>
        <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>{item.meta}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}>
        <button
          data-rail-pin=""
          aria-label={item.isPinned ? 'Pinned' : 'Pin to today'}
          title={item.isPinned ? 'Pinned' : 'Pin to today'}
          onClick={onTogglePin}
          style={{
            display: 'flex',
            padding: 0,
            color: item.isPinned ? 'var(--wb-accent)' : 'var(--wb-n700)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Icon name={item.isPinned ? 'pin-fill' : 'pin'} size={14} />
        </button>
        <button
          data-rail-chat=""
          aria-label="Chat with the agent"
          title="Chat with the agent"
          onClick={onChat}
          style={{
            display: 'flex',
            padding: 0,
            color: 'var(--wb-n600)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Icon name="sparkles" size={14} />
        </button>
      </div>
    </div>
  )
}

function RailSection({
  title,
  items,
  onTogglePin,
  onChat,
}: {
  title: string
  items: RailItem[]
  onTogglePin: (item: RailItem) => void
  onChat: (item: RailItem) => void
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span
          style={{
            fontSize: 'var(--wb-fs-label)',
            letterSpacing: 0.88,
            textTransform: 'uppercase',
            color: 'var(--wb-n500)',
          }}
        >
          {title}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>
          All
        </span>
      </div>
      {items.map((item) => (
        <RailCard
          key={item.id}
          item={item}
          onTogglePin={() => onTogglePin(item)}
          onChat={() => onChat(item)}
        />
      ))}
    </section>
  )
}

export function TodayScreen({
  today,
  prs,
  projects,
  tickets,
  onOpenAgent,
}: {
  today: TodayView
  prs: Pr[]
  projects: Project[]
  tickets: Ticket[]
  onOpenAgent: (target: AgentChatTarget) => void
}) {
  const [draft, setDraft] = useState('')
  const [alert, setAlert] = useState<string | null>(null)

  const createTodo = useCreateTodo()
  const setDone = useSetTodoDone()
  const setPriority = useSetTodoPriority()
  const setTodoPinned = useSetTodoPinned()
  const deleteTodo = useDeleteTodo()
  const promoteTodo = usePromoteTodo()
  const setTicketPinned = useSetTicketPinned()
  const setPrPinned = useSetPrPinned()

  const onError = (error: Error) => setAlert(String(error))

  const sections = taskSections({
    todos: today.todos,
    tickets,
    prs,
    projects,
    today: dayString(new Date()),
  })

  /** The row ids carry the source, so the entity behind a row is found rather than passed. */
  const todoOf = (row: TaskRowModel) =>
    today.todos.find((todo) => `todo-${todo.id}` === row.id)

  /* A task row's checkbox completes a task; a pinned row's checkbox unpins it. */
  function toggle(row: TaskRowModel) {
    const id = Number(row.id.split('-')[1])
    switch (row.source) {
      case 'todo': {
        const todo = todoOf(row)
        if (todo) setDone.mutate({ id: todo.id, done: !todo.done }, { onError })
        return
      }
      case 'pinnedTodo':
        setTodoPinned.mutate({ id, pinned: false }, { onError })
        return
      case 'pinnedTicket':
        setTicketPinned.mutate({ id, pinned: false }, { onError })
        return
      case 'pinnedPullRequest':
        setPrPinned.mutate({ id, pinned: false }, { onError })
        return
    }
  }

  function togglePinFromRail(item: RailItem) {
    const [kind, rawId] = item.id.split('-')
    const id = Number(rawId)
    if (kind === 'ticket') setTicketPinned.mutate({ id, pinned: !item.isPinned }, { onError })
    else setPrPinned.mutate({ id, pinned: !item.isPinned }, { onError })
  }

  /** `RailCard.chatTarget`: the rail's two kinds map straight onto two chat targets. */
  function chatFromRail(item: RailItem) {
    const [kind, rawId] = item.id.split('-')
    const id = Number(rawId)
    if (kind === 'ticket') {
      const ticket = tickets.find((candidate) => candidate.id === id)
      if (ticket) onOpenAgent({ kind: 'ticket', ticket })
      return
    }
    const pr = prs.find((candidate) => candidate.id === id)
    if (pr) onOpenAgent({ kind: 'pullRequest', pr })
  }

  function addTask() {
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    createTodo.mutate({ text }, { onError })
  }

  return (
    <div
      id="today-screen"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s8)',
        maxWidth: 1180,
        background: 'var(--wb-bg)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s6)',
            padding: 'var(--wb-s8)',
          }}
        >
          {/* quickAdd */}
          <div
            id="quick-add"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--wb-s3)',
              padding: 'var(--wb-s3) var(--wb-s4)',
              background: 'var(--wb-surface)',
              borderRadius: 'var(--wb-radius-md)',
              border: '1px solid var(--wb-n800)',
              boxSizing: 'border-box',
            }}
          >
            <Icon name="plus" size={15} color="var(--wb-accent)" />
            <input
              id="quick-add-field"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTask()
              }}
              placeholder="Add a task, press Enter"
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'inherit',
                fontSize: 'var(--wb-fs-body)',
                color: 'var(--wb-text)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>Today</span>
          </div>

          {sections.map((section) => (
            <section key={section.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--wb-s3)',
                  padding: '0 var(--wb-s1) var(--wb-s2)',
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--wb-fs-secondary)',
                    letterSpacing: 1.04,
                    textTransform: 'uppercase',
                    color: section.color,
                  }}
                >
                  {section.label}
                </span>
                <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
                  {section.rows.length}
                </span>
              </div>
              {section.rows.map((row) => {
                const todo = todoOf(row)
                return (
                  <TaskRow
                    key={row.id}
                    row={row}
                    todo={todo}
                    onToggle={() => toggle(row)}
                    onCyclePriority={() => {
                      if (todo) {
                        setPriority.mutate(
                          { id: todo.id, priority: nextPriority(todo.priority) },
                          { onError },
                        )
                      }
                    }}
                    onDelete={() => {
                      if (todo) deleteTodo.mutate({ id: todo.id }, { onError })
                    }}
                    onPromote={() => {
                      if (todo) promoteTodo.mutate({ id: todo.id }, { onError })
                    }}
                    // A promoted issue's thread lives on the ticket it became.
                    onChat={(jira) => onOpenAgent(chatTargetForTodo(jira, tickets))}
                  />
                )
              })}
            </section>
          ))}
        </div>
      </div>

      {/*
        Two elements, matching the SwiftUI tree: TodayScreen applies
        .frame(width: 320) to the rail and then wraps it in .padding(.vertical, s8)
        and .padding(.trailing, s8), so the 320 is the rail itself and the padding sits
        outside it. Collapsing both onto one div would make "the rail" 342.4 wide.
      */}
      <div
        style={{
          flex: 'none',
          padding: 'var(--wb-s8) var(--wb-s8) var(--wb-s8) 0',
        }}
      >
        <aside
          id="today-rail"
          style={{
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s8)',
          }}
        >
          <RailSection
            title="Pull requests"
            items={pullRequestRail(prs, tickets, projects)}
            onTogglePin={togglePinFromRail}
            onChat={chatFromRail}
          />
          <RailSection
            title="Issues"
            items={issueRail(tickets)}
            onTogglePin={togglePinFromRail}
            onChat={chatFromRail}
          />
        </aside>
      </div>

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </div>
  )
}
