/*
 * Port of PrFileSectionView in app/Workbench/Views/PrDiffView.swift.
 *
 * One file's diff with both line-number gutters, and whatever the caller wants to appear
 * under a line that carries review threads. The thread content is injected rather than
 * built here, exactly as the Swift takes it as a `@ViewBuilder`: this file knows where a
 * comment goes, not what a comment looks like.
 */

import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { DIFF_ADDITION, DIFF_CONTEXT, DIFF_DELETION, tint } from './diffTheme'
import { threadId, type DiffLine, type PrFileSection as Section } from './prDetailLogic'
import type { PrReviewThread } from './prDetailLogic'

function prefix(line: DiffLine): string {
  switch (line.kind) {
    case 'addition':
      return '+ '
    case 'deletion':
      return '- '
    case 'context':
      return '  '
    case 'hunkHeader':
      return ''
  }
}

function foreground(line: DiffLine): string {
  switch (line.kind) {
    case 'addition':
      return DIFF_ADDITION
    case 'deletion':
      return DIFF_DELETION
    case 'hunkHeader':
      return 'var(--wb-n600)'
    case 'context':
      return DIFF_CONTEXT
  }
}

function background(line: DiffLine): string {
  switch (line.kind) {
    case 'addition':
      return tint(DIFF_ADDITION, 10)
    case 'deletion':
      return tint(DIFF_DELETION, 10)
    case 'hunkHeader':
      return tint('var(--wb-n900)', 60)
    case 'context':
      return 'transparent'
  }
}

/**
 * One line number, or a blank where the line exists on only one side.
 *
 * The gap is a margin rather than padding because the Swift is `.frame(width: 44)`
 * followed by `.padding(.trailing, s2)`, so the 44 is the box the number is aligned
 * inside and the 5.6 sits outside it. Folding both into one padded box would make the
 * gutter 49.6 wide, which is a number the app does not have anywhere.
 */
function Gutter({ number }: { number: number | null }) {
  return (
    <span
      data-gutter=""
      style={{
        width: 44,
        flex: 'none',
        marginRight: 'var(--wb-s2)',
        textAlign: 'right',
        fontSize: 'var(--wb-fs-label)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--wb-n700)',
      }}
    >
      {number === null ? '' : number}
    </span>
  )
}

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div
      data-diff-line={line.kind}
      style={{ display: 'flex', alignItems: 'flex-start', background: background(line) }}
    >
      <Gutter number={line.oldNumber} />
      <Gutter number={line.newNumber} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: '0 var(--wb-s3)',
          fontSize: 'var(--wb-fs-table-meta)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          // `pre-wrap`, not `pre`: the SwiftUI Text wraps inside its frame rather than
          // scrolling sideways, so a long line pushes the row taller here as it does
          // there. Leading whitespace still has to survive, which is what rules out
          // `normal`.
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          color: foreground(line),
        }}
      >
        {prefix(line) + line.text}
      </span>
    </div>
  )
}

export function PrFileSection({
  section,
  isExpanded,
  onToggle,
  threadContent,
}: {
  section: Section
  isExpanded: boolean
  onToggle: () => void
  threadContent: (thread: PrReviewThread) => ReactNode
}) {
  const thread = (item: PrReviewThread) => (
    <div
      key={threadId(item)}
      style={{ padding: 'var(--wb-s2) 0 var(--wb-s2) var(--wb-s8)' }}
    >
      {threadContent(item)}
    </div>
  )

  return (
    <section
      data-file-section={section.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: tint('var(--wb-surface)', 40),
        borderRadius: 'var(--wb-radius-md)',
        border: '1px solid var(--wb-n900)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <button
        data-file-header=""
        onClick={onToggle}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s3)',
          padding: 'var(--wb-s3) var(--wb-s4)',
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={11} color="var(--wb-n600)" />
        <span
          style={{
            fontSize: 'var(--wb-fs-secondary)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--wb-text)',
          }}
        >
          {section.file.path}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--wb-fs-table-meta)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--wb-n500)',
          }}
        >
          {section.churn}
        </span>
      </button>

      {isExpanded && (
        <>
          {section.missingPatchNote !== null ? (
            <p
              data-missing-patch=""
              style={{
                margin: 0,
                padding: 'var(--wb-s4)',
                fontSize: 'var(--wb-fs-table-meta)',
                color: 'var(--wb-n600)',
              }}
            >
              {section.missingPatchNote}
            </p>
          ) : (
            section.rows.map((row) => (
              <div key={row.id}>
                <DiffLineRow line={row.line} />
                {row.threads.map(thread)}
              </div>
            ))
          )}
          {/*
            Outside the branch above, matching the Swift. A file whose patch GitHub
            withheld can still carry threads, and dropping them would lose a reviewer's
            comment on the one file where there is nothing else to show.
          */}
          {section.trailingThreads.map(thread)}
        </>
      )}
    </section>
  )
}
