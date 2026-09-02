// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskRow } from './TaskRow'
import type { TaskRow as TaskRowModel } from './logic'
import type { Todo } from './queries'

/*
 * The behaviour that lives in the component rather than in `logic.ts`, which is where the
 * Swift keeps it too: `TaskRow.swift` decides what the checkbox means and whether the
 * delete control is reachable, and `TodayLogic` only builds the row.
 *
 * The pure tests already cover which rows exist and what they say. These cover the two
 * things a wrong row would do silently: complete a task that should have been unpinned, and
 * offer to delete something that cannot be deleted.
 */

/*
 * Explicit rather than automatic: vitest only installs RTL's cleanup hook when `globals` is
 * on, and it is not here. Without this every render stacks up in one document and
 * `getByText` finds the same label three times.
 */
afterEach(cleanup)

function row(over: Partial<TaskRowModel> = {}): TaskRowModel {
  return {
    id: 'todo-1',
    source: 'todo',
    title: 'Cut the release branch',
    isDone: false,
    projectName: 'Atlas',
    projectDot: 'var(--wb-dot-0)',
    ref: null,
    refSymbol: 'list-bullet-rectangle',
    tag: null,
    priority: 'med',
    deletable: true,
    ...over,
  }
}

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    source: 'manual',
    sourceId: null,
    text: 'Cut the release branch',
    body: '',
    url: null,
    projectId: 1,
    canPromote: false,
    done: false,
    promotedTicketId: null,
    priority: 'med',
    dueAt: null,
    doneAt: null,
    pinned: false,
    statusName: null,
    statusCategory: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Todo
}

function setup(model: TaskRowModel, behind: Todo | undefined = todo()) {
  const handlers = {
    onToggle: vi.fn(),
    onCyclePriority: vi.fn(),
    onDelete: vi.fn(),
    onPromote: vi.fn(),
    onChat: vi.fn(),
  }
  render(<TaskRow row={model} todo={behind} {...handlers} />)
  return handlers
}

describe('the checkbox', () => {
  it('says Toggle task on a task row', () => {
    setup(row({ source: 'todo' }))
    expect(screen.getByLabelText('Toggle task')).toBeTruthy()
  })

  it('says Unpin on every pinned row', () => {
    // A pinned row's checkbox unpins rather than completing, and the label has to say so:
    // the two do genuinely different things to the same-looking control.
    for (const source of ['pinnedTodo', 'pinnedTicket', 'pinnedPullRequest'] as const) {
      const { unmount } = render(
        <TaskRow
          row={row({ source })}
          todo={undefined}
          onToggle={vi.fn()}
          onCyclePriority={vi.fn()}
          onDelete={vi.fn()}
          onPromote={vi.fn()}
          onChat={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Unpin')).toBeTruthy()
      unmount()
    }
  })
})

describe('the delete button', () => {
  it('keeps its space on every row, deletable or not', () => {
    // TaskRow.swift is explicit: returning nothing for a non-deletable row contributed no
    // width and no spacing, so titles wrapped at different points across one section.
    setup(row({ deletable: false }), undefined)
    expect(screen.getByLabelText('Delete task')).toBeTruthy()
  })

  it('is unreachable until the row is hovered', () => {
    const handlers = setup(row({ deletable: true }))
    const button = screen.getByLabelText('Delete task')
    expect(button.style.pointerEvents).toBe('none')
    expect(button.style.opacity).toBe('0')

    fireEvent.mouseEnter(button.closest('[data-task-row]') as Element)
    expect(button.style.pointerEvents).toBe('auto')
    fireEvent.click(button)
    expect(handlers.onDelete).toHaveBeenCalledOnce()
  })

  it('stays unreachable on a row that cannot be deleted, even hovered', () => {
    setup(row({ deletable: false }), undefined)
    const button = screen.getByLabelText('Delete task')
    fireEvent.mouseEnter(button.closest('[data-task-row]') as Element)
    expect(button.style.pointerEvents).toBe('none')
  })
})

describe('the context menu', () => {
  it('offers the agent only on a mirrored Jira issue', () => {
    const handlers = setup(
      row({ source: 'todo' }),
      todo({ source: 'jira', sourceId: 'JIRA-ATL-1' }),
    )
    fireEvent.contextMenu(screen.getByText('Cut the release branch'))
    fireEvent.mouseDown(screen.getByText('Chat with the agent'))
    expect(handlers.onChat).toHaveBeenCalledOnce()
  })

  it('offers no agent on a manual task, which has no issue to discuss', () => {
    setup(row({ source: 'todo' }), todo({ source: 'manual' }))
    fireEvent.contextMenu(screen.getByText('Cut the release branch'))
    expect(screen.queryByText('Chat with the agent')).toBeNull()
    expect(screen.getByText('Delete task')).toBeTruthy()
  })

  it('offers promote only when the engine says the issue can be promoted', () => {
    setup(row({ source: 'todo' }), todo({ canPromote: true }))
    fireEvent.contextMenu(screen.getByText('Cut the release branch'))
    expect(screen.getByText('Start fixing this')).toBeTruthy()
  })

  it('does not open at all on a row with nothing to offer', () => {
    // A pinned ticket has no todo behind it and cannot be deleted, so the browser's own
    // menu is left alone rather than replaced with an empty one.
    setup(row({ source: 'pinnedTicket', deletable: false }), undefined)
    fireEvent.contextMenu(screen.getByText('Cut the release branch'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('the priority label', () => {
  it('cycles on click, and is absent on a done row', () => {
    const handlers = setup(row({ priority: 'med' }))
    fireEvent.click(screen.getByText('MED'))
    expect(handlers.onCyclePriority).toHaveBeenCalledOnce()

    const { container } = render(
      <TaskRow
        row={row({ priority: null, isDone: true })}
        todo={todo({ done: true })}
        onToggle={vi.fn()}
        onCyclePriority={vi.fn()}
        onDelete={vi.fn()}
        onPromote={vi.fn()}
        onChat={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-priority]')).toBeNull()
  })
})
