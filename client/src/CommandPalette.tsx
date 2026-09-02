/*
 * Port of app/Workbench/Views/CommandPalette.swift.
 *
 * Hover moves the selection rather than highlighting on its own, which the Swift is
 * explicit about: otherwise the mouse would point at one row while Enter ran another.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  movePaletteSelection,
  paletteResults,
  type PaletteAction,
  type PaletteRow,
} from './commandPaletteLogic'
import type { Project } from './queries'

function Row({
  row,
  isSelected,
  onRun,
  onHover,
}: {
  row: PaletteRow
  isSelected: boolean
  onRun: () => void
  onHover: () => void
}) {
  return (
    <button
      data-palette-row={row.id}
      data-selected={isSelected ? '' : undefined}
      onClick={onRun}
      onMouseEnter={onHover}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--wb-s3)',
        padding: 'var(--wb-s3)',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: isSelected ? 'var(--wb-n900)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--wb-radius-md)',
        cursor: 'pointer',
      }}
    >
      <span style={{ width: 16, display: 'flex', color: 'var(--wb-a400)' }}>
        <Icon name={row.symbol} size={13} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--wb-fs-secondary)',
          color: 'var(--wb-text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {row.label}
      </span>
      <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>{row.hint}</span>
    </button>
  )
}

export function CommandPalette({
  projects,
  onRun,
  onClose,
}: {
  projects: Project[]
  onRun: (action: PaletteAction) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(0)
  const field = useRef<HTMLInputElement | null>(null)

  const rows = paletteResults(query, projects)

  // The field takes focus on open, matching `.onAppear { isFieldFocused = true }`, and it
  // is also what makes Escape and the arrows reach this component at all.
  useEffect(() => {
    field.current?.focus()
  }, [])

  /*
   * A shrinking result list can leave the selection past the end, and Enter would then run
   * nothing. `movePaletteSelection` clamps, so a delta of 0 is the whole fix.
   */
  useEffect(() => {
    setSelection((current) => movePaletteSelection(current, 0, rows.length))
  }, [rows.length])

  function run(row: PaletteRow) {
    onRun(row.action)
    onClose()
  }

  return (
    <div
      id="palette-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        // The handoff's 12vh at its 900pt design height. One number does not justify
        // measuring the window.
        paddingTop: 108,
        background: 'var(--wb-palette-backdrop)',
      }}
    >
      <div
        id="palette"
        // The backdrop closes on click; the dialog must not close when clicked through.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            // Or the caret jumps to the end of the field instead of moving the selection.
            event.preventDefault()
            setSelection((current) =>
              movePaletteSelection(current, event.key === 'ArrowDown' ? 1 : -1, rows.length),
            )
            return
          }
          if (event.key === 'Enter') {
            const row = rows[selection]
            if (row) run(row)
          }
        }}
        style={{
          width: 560,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--wb-palette-surface)',
          borderRadius: 'var(--wb-radius-lg)',
          border: '1px solid var(--wb-n700)',
          boxShadow: '0 16px 20px rgb(0 0 0 / 0.65)',
          boxSizing: 'border-box',
          // The handoff's wbIn: translateY 6 to 0 with a fade, 130ms ease-out.
          animation: 'wb-in 130ms ease-out',
        }}
      >
        <div
          id="palette-input"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--wb-s3)',
            padding: 'var(--wb-s4)',
            borderBottom: '1px solid var(--wb-n900)',
            boxSizing: 'border-box',
          }}
        >
          <Icon name="magnifyingglass" size={14} color="var(--wb-n600)" />
          <input
            ref={field}
            id="palette-field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, or type a task to add it"
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'inherit',
              fontSize: 15,
              color: 'var(--wb-text)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>esc</span>
        </div>

        <div
          id="palette-results"
          style={{
            maxHeight: 340,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 'var(--wb-s2)',
            boxSizing: 'border-box',
          }}
        >
          {rows.map((row, index) => (
            <Row
              key={row.id}
              row={row}
              isSelected={index === selection}
              onRun={() => run(row)}
              onHover={() => setSelection(index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
