/*
 * Port of app/Workbench/Views/JiraScreen.swift.
 *
 * A project picker on the left and that project's issues on the right, split into a group
 * per status name. The grouping rules are in jiraLogic.ts.
 *
 * `busyTodoId` is one id, not a set, exactly as in JiraViewModel: promoting and creating a
 * pull request both run a real analysis, and the screen only ever has one going.
 */

import { useState } from 'react'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import {
  JIRA_EMPTY_STATE,
  initialJiraSelection,
  jiraGroups,
  jiraRows,
  jiraStatusGroups,
  type JiraRow,
} from './jiraLogic'
import {
  EngineError,
  useCreatePr,
  usePromoteTodo,
  useSetTodoPinned,
  type Project,
  type Ticket,
  type Todo,
} from './queries'

function IconButton({
  symbol,
  color,
  label,
  onClick,
}: {
  symbol: string
  color: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'flex',
        padding: 0,
        color,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <Icon name={symbol} size={14} />
    </button>
  )
}

function TextAction({
  label,
  title,
  isBusy,
  onClick,
}: {
  label: string
  title: string
  isBusy: boolean
  onClick: () => void
}) {
  return (
    <button
      title={title}
      disabled={isBusy}
      onClick={onClick}
      style={{
        padding: 0,
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-table-meta)',
        color: isBusy ? 'var(--wb-n700)' : 'var(--wb-accent)',
        background: 'transparent',
        border: 'none',
        cursor: isBusy ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function IssueRow({
  row,
  isBusy,
  onPromote,
  onTogglePin,
  onCreatePr,
  onChat,
}: {
  row: JiraRow
  isBusy: boolean
  onPromote: () => void
  onTogglePin: () => void
  onCreatePr: () => void
  onChat: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      data-jira-row={row.id}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3) var(--wb-s4)',
        background: isHovered ? 'var(--wb-surface)' : 'transparent',
        borderTop: '1px solid var(--wb-n900)',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ marginTop: 2, color: row.stateColor ?? 'var(--wb-a400)' }}>
        <Icon name="list-bullet-rectangle" size={14} />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-text)' }}>
          {row.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <span
            style={{
              fontSize: 'var(--wb-fs-label)',
              color: 'var(--wb-a400)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {row.ref}
          </span>
          {row.stateLabel !== null && (
            <span
              style={{
                fontSize: 'var(--wb-fs-tag)',
                color: 'var(--wb-n400)',
                padding: '1px 7px',
                border: `1px solid ${row.stateColor ?? 'var(--wb-n800)'}`,
                borderRadius: 'var(--wb-radius-sm)',
              }}
            >
              {row.stateLabel}
            </span>
          )}
        </div>
      </div>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)', paddingTop: 1 }}
      >
        {row.showsPromote && (
          <TextAction
            label="Start fixing this"
            title="Analyse this issue and turn it into a ticket"
            isBusy={isBusy}
            onClick={onPromote}
          />
        )}
        {row.showsCreatePr && (
          <TextAction
            label="Create PR"
            title="Create a pull request for this issue's fix"
            isBusy={isBusy}
            onClick={onCreatePr}
          />
        )}
        {row.showsPin && (
          <IconButton
            symbol={row.isPinned ? 'pin-fill' : 'pin'}
            color={row.isPinned ? 'var(--wb-accent)' : 'var(--wb-n700)'}
            label={row.isPinned ? 'Pinned' : 'Pin to today'}
            onClick={onTogglePin}
          />
        )}
        {row.url !== null && (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            title="Open in Jira"
            aria-label="Open in Jira"
            style={{ display: 'flex', color: 'var(--wb-n600)' }}
          >
            <Icon name="arrow-up-right-square" size={14} />
          </a>
        )}
        <IconButton
          symbol="sparkles"
          color="var(--wb-n700)"
          label="Chat with the agent"
          onClick={onChat}
        />
      </div>
    </div>
  )
}

export function JiraScreen({
  todos,
  projects,
  tickets,
  onChat,
}: {
  /** Every mirrored issue, done ones included. See `useAllTodos`. */
  todos: Todo[]
  projects: Project[]
  tickets: Ticket[]
  onChat: (todo: Todo) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const [busyTodoId, setBusyTodoId] = useState<number | null>(null)

  const promote = usePromoteTodo()
  const setPinned = useSetTodoPinned()
  const createPr = useCreatePr()

  const onError = (error: Error) => setAlert(String(error))

  const groups = jiraGroups(todos, projects)
  // The picker starts on the busiest project, and stays wherever the user put it after
  // that, which is what `selectedKey == nil` guards in JiraViewModel.load.
  const key = selected ?? initialJiraSelection(todos)
  const rows = key === null ? [] : jiraRows(todos, key, tickets)

  /** Both of these run a real analysis, so the row is held until the engine answers. */
  function runBusy(id: number, run: () => Promise<unknown>) {
    setBusyTodoId(id)
    void run()
      .catch((error: Error) => {
        // The engine answers a second analysis with 409, and "already working on this" is
        // not the same thing as a failure. Read off the status, never out of the message:
        // the message carries the path, so searching it for "409" called every failure on
        // todo 409 a conflict.
        setAlert(
          error instanceof EngineError && error.status === 409
            ? 'An analysis is already running for this issue.'
            : String(error),
        )
      })
      .finally(() => setBusyTodoId(null))
  }

  return (
    <div
      id="jira-screen"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 'var(--wb-s8)',
        maxWidth: 1180,
        /*
         * The two columns scroll separately, because JiraScreen.swift is an HStack of two
         * ScrollViews rather than one around the pair. With 19 projects and 178 issues,
         * scrolling as one page carried the project picker out of view, and then there was
         * no way to change project without scrolling back up.
         */
        height: '100%',
        minHeight: 0,
        background: 'var(--wb-bg)',
      }}
    >
      {/* picker */}
      <div
        id="jira-picker"
        style={{
          width: 232,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: 'var(--wb-s8) 0 var(--wb-s8) var(--wb-s8)',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        {groups.map((group) => {
          const isSelected = group.key === key
          return (
            <button
              key={group.key}
              data-jira-project={group.key}
              onClick={() => setSelected(group.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--wb-s3)',
                // WBRowButtonStyle, with the picker's own selected background.
                padding: 'var(--wb-s2) var(--wb-s3)',
                borderRadius: 'var(--wb-radius-md)',
                border: 'none',
                background: isSelected ? 'var(--wb-n900)' : 'transparent',
                color: isSelected ? 'var(--wb-text)' : 'var(--wb-n500)',
                fontFamily: 'inherit',
                fontSize: 'var(--wb-fs-secondary)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  flex: 'none',
                  borderRadius: '50%',
                  background: group.dot,
                }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.displayName}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--wb-fs-label)',
                  color: 'var(--wb-n600)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {group.openCount}
              </span>
            </button>
          )
        })}
      </div>

      {/* issues */}
      <div
        id="jira-issues"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--wb-s8) var(--wb-s8) var(--wb-s8) 0',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        {rows.length === 0 ? (
          <p
            id="jira-empty"
            style={{
              margin: 0,
              padding: 'var(--wb-s6) 0',
              fontSize: 'var(--wb-fs-secondary)',
              color: 'var(--wb-n600)',
            }}
          >
            {JIRA_EMPTY_STATE}
          </p>
        ) : (
          jiraStatusGroups(rows).map((group) => (
            <section key={group.id}>
              <div
                data-status-header={group.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--wb-s3)',
                  padding: 'var(--wb-s6) var(--wb-s4) var(--wb-s2)',
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--wb-fs-label)',
                    letterSpacing: 1.04,
                    textTransform: 'uppercase',
                    color: 'var(--wb-n500)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--wb-fs-label)',
                    color: 'var(--wb-n700)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {group.count}
                </span>
              </div>
              {group.rows.map((row) => (
                <IssueRow
                  key={row.id}
                  row={row}
                  isBusy={busyTodoId === row.id}
                  onPromote={() => runBusy(row.id, () => promote.mutateAsync({ id: row.id }))}
                  onCreatePr={() => {
                    const ticketId = row.ticketId
                    if (ticketId === null) return
                    runBusy(row.id, () => createPr.mutateAsync({ ticketId }))
                  }}
                  onTogglePin={() =>
                    setPinned.mutate({ id: row.id, pinned: !row.isPinned }, { onError })
                  }
                  onChat={() => onChat(row.todo)}
                />
              ))}
            </section>
          ))
        )}
      </div>

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </div>
  )
}
