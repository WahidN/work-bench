/*
 * Port of app/Workbench/Views/ProjectDetailScreen.swift.
 *
 * The notes tab is the interesting half. Its save rules live in `projectNotesSaver.ts`
 * rather than here, because they are a state machine about writes racing each other and a
 * component is the wrong shape for one. This file owns only the three moments the Swift
 * screen owns: start on the open project, flush on a tab switch, and flush on the way out.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { TaskRow } from './TaskRow'
import { ProjectNotesSaver } from './projectNotesSaver'
import { dayString, type TaskRow as TaskRowModel } from './logic'
import {
  NO_OPEN_WORK_TEXT,
  NO_TASKS_TEXT,
  NOTES_PLACEHOLDER,
  openWork,
  projectFacts,
  projectTaskRows,
  type OpenWorkItem,
} from './projectsLogic'
import { updateProjectNotes, type Pr, type Project, type Ticket, type Todo } from './queries'

type Tab = 'Tasks' | 'Notes'

const TABS: Tab[] = ['Tasks', 'Notes']

/**
 * Holds one saver for the life of the screen and re-renders when it changes.
 *
 * The saver is mutable and long-lived, which is what a ref is for. `version` exists only
 * to turn its `onChange` into a render; reading `saver.draft` straight out of the ref is
 * what keeps the textarea showing the text the saver actually holds.
 */
function useNotesSaver(project: Project) {
  const [, setVersion] = useState(0)
  const saver = useRef<ProjectNotesSaver | null>(null)
  if (saver.current === null) {
    saver.current = new ProjectNotesSaver({ updateProjectNotes }, () =>
      setVersion((n) => n + 1),
    )
  }
  const current = saver.current

  /*
   * Runs on the open project and on a change to its notes, which is the pair the Swift
   * needs two modifiers for: `.task(id: project.id)` fires only on a project switch, and
   * `.onChange(of: project.notes)` catches a save made elsewhere in the same visit, such
   * as the departing write from a fast project switch, or a late refresh landing after this
   * instance already started from a stale copy.
   */
  useEffect(() => {
    current.start(project)
  }, [current, project, project.id, project.notes])

  // Closing the screen a keystroke after typing must not lose the text.
  useEffect(() => {
    return () => {
      void current.flush()
    }
  }, [current])

  return current
}

function OpenWorkRow({
  item,
  onOpen,
  onChat,
}: {
  item: OpenWorkItem
  onOpen: () => void
  onChat: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      data-open-work={item.id}
      onClick={onOpen}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3) var(--wb-s4)',
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: `1px solid ${isHovered ? 'var(--wb-a700)' : 'var(--wb-n900)'}`,
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--wb-s2)',
          flex: 1,
          minWidth: 0,
          color: 'var(--wb-a400)',
        }}
      >
        <Icon name={item.symbol} size={11} style={{ marginTop: 2 }} />
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-text)' }}>
          {item.ref} — {item.title}
        </span>
      </span>
      <button
        data-open-work-chat=""
        title="Ask the agent about this"
        aria-label="Ask the agent about this"
        onClick={(event) => {
          event.stopPropagation()
          onChat()
        }}
        style={{
          display: 'flex',
          padding: 'var(--wb-s2) var(--wb-s4)',
          color: 'var(--wb-n500)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <Icon name="sparkles" size={11} />
      </button>
    </div>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', fontSize: 'var(--wb-fs-table-meta)' }}>
      <span style={{ color: 'var(--wb-n500)' }}>{label}</span>
      <span style={{ marginLeft: 'auto', color: 'var(--wb-text)' }}>{value}</span>
    </div>
  )
}

export function ProjectDetailScreen({
  project,
  projects,
  todos,
  tickets,
  prs,
  onBack,
  onEdit,
  onAddTask,
  onToggleTask,
  onDeleteTodo,
  onOpenWork,
  onChatTodo,
  onChatWork,
}: {
  project: Project
  projects: Project[]
  todos: Todo[]
  tickets: Ticket[]
  prs: Pr[]
  onBack: () => void
  onEdit: () => void
  onAddTask: (text: string) => void
  onToggleTask: (row: TaskRowModel) => void
  onDeleteTodo: (todo: Todo) => void
  onOpenWork: (item: OpenWorkItem) => void
  onChatTodo: (todo: Todo) => void
  onChatWork: (item: OpenWorkItem) => void
}) {
  const [tab, setTab] = useState<Tab>('Tasks')
  const [draft, setDraft] = useState('')
  const notes = useNotesSaver(project)

  const rows = projectTaskRows({ todos, project, projects, today: dayString(new Date()) })
  const facts = projectFacts({ project, todos, tickets, prs, now: new Date() })
  const items = openWork(project, tickets, prs)

  function addTask() {
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    onAddTask(text)
  }

  return (
    <div
      id="project-detail-screen"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s8)',
        padding: 'var(--wb-s8)',
        background: 'var(--wb-bg)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s4)',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <button
            id="project-back"
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-table-meta)',
              color: 'var(--wb-n500)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon name="chevron-left" size={12} />
            All projects
          </button>
          <button
            id="project-edit"
            onClick={onEdit}
            style={{
              marginLeft: 'auto',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-table-meta)',
              color: 'var(--wb-a400)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        </div>

        {/* tabs. `.fixedSize()` in the Swift, so the pill hugs its content. */}
        <div
          id="project-tabs"
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            padding: 3,
            borderRadius: 'var(--wb-radius-md)',
            border: '1px solid var(--wb-n900)',
            boxSizing: 'border-box',
          }}
        >
          {TABS.map((option) => (
            <button
              key={option}
              data-project-tab={option}
              onClick={() => {
                // A tab switch flushes, so leaving Notes a keystroke after typing saves.
                if (option !== tab) void notes.flush()
                setTab(option)
              }}
              style={{
                padding: 'var(--wb-s2) var(--wb-s6)',
                fontFamily: 'inherit',
                fontSize: 13,
                color: option === tab ? 'var(--wb-a200)' : 'var(--wb-n500)',
                background: option === tab ? 'var(--wb-a900)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {option}
            </button>
          ))}
        </div>

        {notes.saveError !== null && (
          <span
            id="notes-error"
            style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-a400)' }}
          >
            {notes.saveError}
          </span>
        )}

        {tab === 'Tasks' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
            {/* quickAdd */}
            <div
              id="project-quick-add"
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
              <Icon name="plus" size={12} color="var(--wb-accent)" />
              <input
                id="project-quick-add-field"
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
              <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n500)' }}>
                {project.name}
              </span>
            </div>

            {rows.length === 0 ? (
              <p
                id="project-no-tasks"
                style={{
                  margin: 0,
                  padding: 'var(--wb-s4) 0',
                  fontSize: 'var(--wb-fs-secondary)',
                  color: 'var(--wb-n600)',
                }}
              >
                {NO_TASKS_TEXT}
              </p>
            ) : (
              rows.map((row) => {
                const todo = todos.find((candidate) => `todo-${candidate.id}` === row.id)
                return (
                  <TaskRow
                    key={row.id}
                    row={row}
                    todo={todo}
                    onToggle={() => onToggleTask(row)}
                    /*
                     * No-ops, matching the Swift's `onCyclePriority: { _ in }` and
                     * `onPromote: { _ in }`. This tab renders no priority at all, so the
                     * first is unreachable; promote is a Today and Jira action.
                     */
                    onCyclePriority={() => {}}
                    onPromote={() => {}}
                    onDelete={() => {
                      if (todo) onDeleteTodo(todo)
                    }}
                    onChat={onChatTodo}
                  />
                )
              })
            )}
          </div>
        ) : (
          <div style={{ position: 'relative', display: 'flex' }}>
            <textarea
              id="project-notes"
              value={notes.draft}
              onChange={(event) => notes.edited(event.target.value)}
              placeholder={NOTES_PLACEHOLDER}
              style={{
                flex: 1,
                minHeight: 420,
                padding: 'var(--wb-s6)',
                fontFamily: 'inherit',
                fontSize: 'var(--wb-fs-body)',
                lineHeight: 'calc(var(--wb-fs-body) + 7px)',
                color: 'var(--wb-text)',
                background: 'var(--wb-surface)',
                borderRadius: 'var(--wb-radius-md)',
                border: '1px solid var(--wb-n900)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* rightColumn */}
      <aside
        id="project-facts"
        style={{
          width: 300,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s3)',
            padding: 'var(--wb-s6)',
            background: 'var(--wb-surface)',
            borderRadius: 'var(--wb-radius-md)',
            border: '1px solid var(--wb-n900)',
            boxSizing: 'border-box',
          }}
        >
          <FactRow label="Status" value={facts.status} />
          <FactRow label="Open tasks" value={String(facts.openTasks)} />
          <FactRow label="Open PRs" value={String(facts.openPrs)} />
          <FactRow label="Last activity" value={facts.lastActivity} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
          <span
            style={{
              fontSize: 'var(--wb-fs-label)',
              letterSpacing: 0.88,
              color: 'var(--wb-n600)',
            }}
          >
            OPEN WORK
          </span>
          {items.length === 0 ? (
            <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
              {NO_OPEN_WORK_TEXT}
            </span>
          ) : (
            items.map((item) => (
              <OpenWorkRow
                key={item.id}
                item={item}
                onOpen={() => onOpenWork(item)}
                onChat={() => onChatWork(item)}
              />
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
