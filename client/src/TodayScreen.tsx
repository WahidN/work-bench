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
import type { Pr, Project, Ticket, TodayView, Todo, TodoPriority } from './queries'
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
import { useContextMenu } from './ContextMenu'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import {
  dayString,
  issueRail,
  priorityColor,
  priorityLabel,
  pullRequestRail,
  taskSections,
  type RailItem,
  type TaskRow as TaskRowModel,
} from './logic'

/** TodayLogic.nextPriority: high, med, low, and back to high. */
function nextPriority(priority: TodoPriority): TodoPriority {
  return priority === 'high' ? 'med' : priority === 'med' ? 'low' : 'high'
}

function Checkbox({ isDone, label, onClick }: { isDone: boolean; label: string; onClick: () => void }) {
  return (
    <button
      data-checkbox=""
      aria-label={label}
      onClick={onClick}
      style={{
        width: 17,
        height: 17,
        flex: 'none',
        marginTop: 2,
        padding: 0,
        borderRadius: 5,
        background: isDone ? 'var(--wb-a700)' : 'transparent',
        border: `1px solid ${isDone ? 'var(--wb-accent)' : 'var(--wb-n700)'}`,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--wb-a100)',
        cursor: 'pointer',
      }}
    >
      {isDone && <Icon name="checkmark" size={10} />}
    </button>
  )
}

function TaskRow({
  row,
  todo,
  onToggle,
  onCyclePriority,
  onDelete,
  onPromote,
}: {
  row: TaskRowModel
  /** The todo behind the row, or undefined for a pinned ticket or pull request. */
  todo: Todo | undefined
  onToggle: () => void
  onCyclePriority: () => void
  onDelete: () => void
  onPromote: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  /*
   * A task row's checkbox completes a task; a pinned row's checkbox unpins it. The label
   * follows, because the two do genuinely different things to the same-looking control.
   */
  const checkboxLabel = row.source === 'todo' ? 'Toggle task' : 'Unpin'

  /*
   * The same items TaskRow.swift offers, minus "Chat with the agent", which needs the
   * panel from task group 5. Promote is only ever a menu item: the app gives it no
   * button, and inventing one here would be a redesign rather than a port.
   */
  const { onContextMenu, menu } = useContextMenu([
    ...(todo?.canPromote ? [{ label: 'Start fixing this', run: onPromote }] : []),
    ...(row.deletable ? [{ label: 'Delete task', run: onDelete }] : []),
  ])

  return (
    <div
      data-task-row={row.id}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3) var(--wb-s4)',
        background: row.isDone ? 'transparent' : 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: `1px solid ${isHovered && !row.isDone ? 'var(--wb-n800)' : 'transparent'}`,
        opacity: row.isDone ? 0.42 : 1,
        boxSizing: 'border-box',
      }}
    >
      <Checkbox isDone={row.isDone} label={checkboxLabel} onClick={onToggle} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: 'var(--wb-fs-body)',
            lineHeight: 'calc(var(--wb-fs-body) + 2px)',
            textDecoration: row.isDone ? 'line-through' : 'none',
            color: row.isDone ? 'var(--wb-n500)' : 'var(--wb-text)',
          }}
        >
          {row.title}
        </span>

        {/* meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 'var(--wb-fs-label)',
              color: 'var(--wb-n500)',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                flex: 'none',
                borderRadius: '50%',
                background: row.projectDot,
              }}
            />
            {row.projectName}
          </span>

          {row.ref && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--wb-fs-label)',
                color: 'var(--wb-a400)',
              }}
            >
              <Icon name={row.refSymbol} size={11} />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{row.ref}</span>
            </span>
          )}

          {row.tag && (
            <span
              style={{
                fontSize: 'var(--wb-fs-tag)',
                color: 'var(--wb-n400)',
                padding: '1px 7px',
                border: '1px solid var(--wb-n800)',
                borderRadius: 'var(--wb-radius-sm)',
              }}
            >
              {row.tag}
            </span>
          )}
        </div>
      </div>

      {row.priority && (
        <button
          data-priority=""
          title="Change priority"
          onClick={onCyclePriority}
          style={{
            marginTop: 3,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 'var(--wb-fs-label)',
            letterSpacing: 0.44,
            color: priorityColor(row.priority),
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {priorityLabel(row.priority)}
        </button>
      )}

      {/*
        Space reserved whether or not the row is deletable, per TaskRow.swift, and hidden
        by opacity rather than removed so revealing it never shifts the title sideways
        under the cursor. Hit testing follows the opacity, or an invisible button would
        still swallow clicks.
      */}
      <button
        data-delete=""
        aria-label="Delete task"
        aria-hidden={!row.deletable}
        title="Delete task"
        onClick={onDelete}
        disabled={!row.deletable}
        style={{
          marginTop: 2,
          padding: 0,
          display: 'flex',
          opacity: row.deletable && isHovered ? 1 : 0,
          pointerEvents: row.deletable && isHovered ? 'auto' : 'none',
          color: 'var(--wb-n500)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <Icon name="trash" size={11} />
      </button>

      {menu}
    </div>
  )
}

function RailCard({ item, onTogglePin }: { item: RailItem; onTogglePin: () => void }) {
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
        {/* The agent panel is task group 5, so this renders and measures and does nothing. */}
        <Icon name="sparkles" size={14} color="var(--wb-n600)" />
      </div>
    </div>
  )
}

function RailSection({
  title,
  items,
  onTogglePin,
}: {
  title: string
  items: RailItem[]
  onTogglePin: (item: RailItem) => void
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
        <RailCard key={item.id} item={item} onTogglePin={() => onTogglePin(item)} />
      ))}
    </section>
  )
}

export function TodayScreen({
  today,
  prs,
  projects,
  tickets,
}: {
  today: TodayView
  prs: Pr[]
  projects: Project[]
  tickets: Ticket[]
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
          />
          <RailSection
            title="Issues"
            items={issueRail(tickets)}
            onTogglePin={togglePinFromRail}
          />
        </aside>
      </div>

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </div>
  )
}
