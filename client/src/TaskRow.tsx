/*
 * Port of app/Workbench/Views/TaskRow.swift.
 *
 * Shared by Today and a project's Tasks tab, which is what the Swift does too. The two
 * screens build their rows differently, TodayLogic on one side and ProjectDetailLogic on
 * the other, and then hand them to this one row.
 *
 * The delete button keeps its reserved space on every row, and TaskRow.swift is explicit
 * about why: returning nothing for a non-deletable row contributed no width and no HStack
 * spacing, so on Today, where manual tasks and pinned Jira rows share a section, the title
 * column was narrower on some rows than others and titles wrapped at different points.
 */

import { useState } from 'react'
import { useContextMenu } from './ContextMenu'
import { Icon } from './Icon'
import { priorityColor, priorityLabel, type TaskRow as TaskRowModel } from './logic'
import type { Todo } from './queries'

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

export function TaskRow({
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
