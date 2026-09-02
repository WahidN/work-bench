/*
 * Port of TodayScreen.swift, TodayLogic.swift and TaskRow.swift.
 *
 * Read-only, so the checkbox, the quick-add field, the priority label, the delete
 * button and the rail's pin and agent buttons all render and measure as they do in the
 * app and do nothing. The delete button keeps its reserved space on every row, which
 * TaskRow.swift is explicit about: returning nothing for a non-deletable row made the
 * title column narrower on some rows than others and titles wrapped in different places.
 */

import type { Pr, Project, Ticket, TodayView } from './queries'
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

function Checkbox({ isDone }: { isDone: boolean }) {
  return (
    <span
      data-checkbox=""
      style={{
        width: 17,
        height: 17,
        flex: 'none',
        marginTop: 2,
        borderRadius: 5,
        background: isDone ? 'var(--wb-a700)' : 'transparent',
        border: `1px solid ${isDone ? 'var(--wb-accent)' : 'var(--wb-n700)'}`,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--wb-a100)',
      }}
    >
      {isDone && <Icon name="checkmark" size={10} />}
    </span>
  )
}

function TaskRow({ row }: { row: TaskRowModel }) {
  return (
    <div
      data-task-row={row.id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3) var(--wb-s4)',
        background: row.isDone ? 'transparent' : 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: '1px solid transparent',
        opacity: row.isDone ? 0.42 : 1,
        boxSizing: 'border-box',
      }}
    >
      <Checkbox isDone={row.isDone} />

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
        <span
          style={{
            marginTop: 3,
            fontSize: 'var(--wb-fs-label)',
            letterSpacing: 0.44,
            color: priorityColor(row.priority),
          }}
        >
          {priorityLabel(row.priority)}
        </span>
      )}

      {/* Space reserved whether or not the row is deletable, per TaskRow.swift. */}
      <span style={{ marginTop: 2, opacity: 0, color: 'var(--wb-n500)' }}>
        <Icon name="trash" size={11} />
      </span>
    </div>
  )
}

function RailCard({ item }: { item: RailItem }) {
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
        <Icon
          name={item.isPinned ? 'pin-fill' : 'pin'}
          size={14}
          color={item.isPinned ? 'var(--wb-accent)' : 'var(--wb-n700)'}
        />
        <Icon name="sparkles" size={14} color="var(--wb-n600)" />
      </div>
    </div>
  )
}

function RailSection({ title, items }: { title: string; items: RailItem[] }) {
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
        <RailCard key={item.id} item={item} />
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
  const sections = taskSections({
    todos: today.todos,
    tickets,
    prs,
    projects,
    today: dayString(new Date()),
  })

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
            <span style={{ flex: 1, fontSize: 'var(--wb-fs-body)', color: 'var(--wb-n600)' }}>
              Add a task, press Enter
            </span>
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
              {section.rows.map((row) => (
                <TaskRow key={row.id} row={row} />
              ))}
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
          />
          <RailSection title="Issues" items={issueRail(tickets)} />
        </aside>
      </div>
    </div>
  )
}
