/*
 * Port of PRsScreen.swift, PRsLogic.swift and WorkItemLabels.swift.
 *
 * The filter pills are live, since filtering is pure client-side logic and needs no
 * engine call. Every action in a row (Review, Pin to today, Agent) renders and measures
 * but does nothing: they are all mutations, and the spike is read-only.
 */

import { useState } from 'react'
import type { Pr, Project } from './queries'
import { Icon } from './Icon'
import { PR_EMPTY_STATE, PR_FILTERS, prFilterLabel, prRows, type PrFilter } from './logic'

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
}: {
  label: string
  symbol: string
  color: string
  boxed?: boolean
}) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 'var(--wb-fs-table-meta)',
        color,
        padding: boxed ? 'var(--wb-s1) var(--wb-s3)' : undefined,
        border: boxed ? '1px solid var(--wb-n800)' : undefined,
        borderRadius: boxed ? 'var(--wb-radius-sm)' : undefined,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name={symbol} size={12} />
      {label}
    </span>
  )
}

export function PRsScreen({ prs, projects }: { prs: Pr[]; projects: Project[] }) {
  const [filter, setFilter] = useState<PrFilter>('assignedToMe')
  const rows = prRows(prs, projects, filter, new Date())

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
              fontSize: 'var(--wb-fs-secondary)',
              color: option === filter ? 'var(--wb-text)' : 'var(--wb-n500)',
              background: option === filter ? 'var(--wb-surface)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--wb-radius-sm)',
              font: 'inherit',
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--wb-s3)',
                padding: 'var(--wb-s3) var(--wb-s4)',
                borderBottom: '1px solid var(--wb-n900)',
                boxSizing: 'border-box',
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
                <RowAction label="Review" symbol="checklist" color="var(--wb-n400)" />
                <RowAction
                  label="Pin to today"
                  symbol={row.pinned ? 'pin-fill' : 'pin'}
                  color={row.pinned ? 'var(--wb-accent)' : 'var(--wb-n600)'}
                />
                <RowAction
                  label={row.messageCount > 0 ? `Chat · ${row.messageCount}` : 'Agent'}
                  symbol={row.messageCount > 0 ? 'bubble-left-fill' : 'sparkles'}
                  color={row.messageCount > 0 ? 'var(--wb-text)' : 'var(--wb-n400)'}
                  boxed
                />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
