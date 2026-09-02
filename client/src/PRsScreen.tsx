/*
 * Port of PRsScreen.swift, PRsLogic.swift and WorkItemLabels.swift.
 *
 * Live: the filter pills, the pin toggle, Agent, and Review, which starts a background
 * review and opens nothing. There is nothing to open yet: the review takes minutes,
 * announces itself when it is done, and is read on the pull request's own page.
 */

import { useState } from 'react'
import type { Pr, Project } from './queries'
import { useSetPrPinned } from './queries'
import { ErrorAlert } from './ErrorAlert'
import { Icon } from './Icon'
import { PR_EMPTY_STATE, PR_FILTERS, prFilterLabel, prRows, type PrFilter } from './logic'
import { ReviewStarter } from './ReviewStarter'

const COLUMN_WIDTHS = { project: 150, status: 180, updated: 110, actions: 200 }

function ColumnTitle({ label, width }: { label: string; width?: number }) {
  return (
    <span
      style={{
        width,
        flex: width === undefined ? 1 : 'none',
        fontSize: 'var(--wb-fs-label)',
        letterSpacing: 0.8,
        color: 'var(--wb-n600)',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  )
}

function RowAction({
  label,
  symbol,
  color,
  boxed,
  background,
  borderColor,
  title,
  onClick,
}: {
  label: string
  symbol: string
  color: string
  boxed?: boolean
  background?: string
  borderColor?: string
  title?: string
  onClick?: (event: React.MouseEvent) => void
}) {
  const Element = onClick === undefined ? 'span' : 'button'
  return (
    <Element
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-table-meta)',
        color,
        padding: boxed ? 'var(--wb-s1) var(--wb-s3)' : 0,
        background: background ?? 'transparent',
        border: boxed ? `1px solid ${borderColor ?? 'var(--wb-n800)'}` : 'none',
        borderRadius: boxed ? 'var(--wb-radius-sm)' : undefined,
        whiteSpace: 'nowrap',
        cursor: onClick === undefined ? undefined : 'pointer',
      }}
    >
      <Icon name={symbol} size={12} />
      {label}
    </Element>
  )
}

export function PRsScreen({
  prs,
  projects,
  onSelectPr,
  onOpenAgent,
}: {
  prs: Pr[]
  projects: Project[]
  onSelectPr: (pr: Pr) => void
  onOpenAgent: (pr: Pr) => void
}) {
  const [filter, setFilter] = useState<PrFilter>('assignedToMe')
  const [alert, setAlert] = useState<string | null>(null)
  const setPinned = useSetPrPinned()
  const rows = prRows(prs, projects, filter, new Date())
  const onError = (error: Error) => setAlert(String(error))

  return (
    <div
      id="prs-screen"
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
      {/* pills */}
      <div
        id="pr-filters"
        style={{
          display: 'flex',
          alignSelf: 'flex-start',
          gap: 'var(--wb-s1)',
          padding: 'var(--wb-s1)',
          background: 'rgb(41 43 49 / 0.5)',
          borderRadius: 'var(--wb-radius-md)',
        }}
      >
        {PR_FILTERS.map((option) => (
          <button
            key={option}
            data-filter={option}
            onClick={() => setFilter(option)}
            style={{
              padding: 'var(--wb-s2) var(--wb-s4)',
              // `fontFamily`, not the `font` shorthand. `font: inherit` sitting after
              // `fontSize` rewrote the size back to the inherited 14px, so these pills
              // were rendering a point larger than PRsScreen.swift's `FontSize.secondary`.
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: option === filter ? 'var(--wb-text)' : 'var(--wb-n500)',
              background: option === filter ? 'var(--wb-surface)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--wb-radius-sm)',
              cursor: 'pointer',
            }}
          >
            {prFilterLabel(option)}
          </button>
        ))}
      </div>

      {/* table */}
      <div>
        <div
          id="pr-table-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--wb-s3)',
            padding: 'var(--wb-s2) var(--wb-s4)',
            borderBottom: '1px solid var(--wb-n900)',
          }}
        >
          <ColumnTitle label="Pull request" />
          <ColumnTitle label="Project" width={COLUMN_WIDTHS.project} />
          <ColumnTitle label="Status" width={COLUMN_WIDTHS.status} />
          <ColumnTitle label="Updated" width={COLUMN_WIDTHS.updated} />
          <span style={{ width: COLUMN_WIDTHS.actions, flex: 'none' }} />
        </div>

        {rows.length === 0 ? (
          <p
            id="pr-empty"
            style={{
              margin: 0,
              padding: 'var(--wb-s6) 0',
              fontSize: 'var(--wb-fs-secondary)',
              color: 'var(--wb-n600)',
            }}
          >
            {PR_EMPTY_STATE}
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              data-pr-row={row.id}
              onClick={() => {
                const pr = prs.find((candidate) => candidate.id === row.id)
                if (pr) onSelectPr(pr)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--wb-s3)',
                padding: 'var(--wb-s3) var(--wb-s4)',
                borderBottom: '1px solid var(--wb-n900)',
                boxSizing: 'border-box',
                cursor: 'pointer',
              }}
            >
              <Icon name="arrow-triangle-pull" size={13} color="var(--wb-n600)" />

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span
                  style={{
                    fontSize: 'var(--wb-fs-secondary)',
                    color: 'var(--wb-text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {row.title}
                </span>
                <span
                  style={{
                    fontSize: 'var(--wb-fs-label)',
                    color: 'var(--wb-n600)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {row.ref}
                </span>
              </div>

              <span
                style={{
                  width: COLUMN_WIDTHS.project,
                  flex: 'none',
                  fontSize: 'var(--wb-fs-table-meta)',
                  color: 'var(--wb-n400)',
                }}
              >
                {row.projectName}
              </span>

              <span style={{ width: COLUMN_WIDTHS.status, flex: 'none' }}>
                <span
                  style={{
                    fontSize: 'var(--wb-fs-tag)',
                    color: 'var(--wb-a400)',
                    padding: '2px 8px',
                    border: '1px solid var(--wb-a700)',
                    borderRadius: 'var(--wb-radius-sm)',
                  }}
                >
                  {row.statusLabel}
                </span>
              </span>

              <span
                style={{
                  width: COLUMN_WIDTHS.updated,
                  flex: 'none',
                  fontSize: 'var(--wb-fs-table-meta)',
                  color: 'var(--wb-n600)',
                }}
              >
                {row.updatedText}
              </span>

              <span
                style={{
                  width: COLUMN_WIDTHS.actions,
                  flex: 'none',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 'var(--wb-s3)',
                }}
              >
                <ReviewStarter prId={row.id} onError={onError} />
                <RowAction
                  label="Pin to today"
                  title="Show this pull request on Today"
                  symbol={row.pinned ? 'pin-fill' : 'pin'}
                  color={row.pinned ? 'var(--wb-accent)' : 'var(--wb-n600)'}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPinned.mutate({ id: row.id, pinned: !row.pinned }, { onError })
                  }}
                />
                {/* Opens the panel; it must not also navigate to the detail page. */}
                <RowAction
                  onClick={(event) => {
                    event.stopPropagation()
                    const pr = prs.find((candidate) => candidate.id === row.id)
                    if (pr) onOpenAgent(pr)
                  }}
                  label={row.messageCount > 0 ? `Chat · ${row.messageCount}` : 'Agent'}
                  symbol={row.messageCount > 0 ? 'bubble-left-fill' : 'sparkles'}
                  color={row.messageCount > 0 ? 'var(--wb-text)' : 'var(--wb-n400)'}
                  background={row.messageCount > 0 ? 'var(--wb-a900)' : undefined}
                  // A filled pill draws no outline in the Swift, so the border is only
                  // there to hold the shape of the empty one.
                  borderColor={row.messageCount > 0 ? 'transparent' : undefined}
                  boxed
                />
              </span>
            </div>
          ))
        )}
      </div>

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}
    </div>
  )
}
