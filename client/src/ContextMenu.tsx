/*
 * Stands in for SwiftUI's `.contextMenu { }`.
 *
 * Kept as a component rather than left to the browser's own menu because the app puts
 * real actions there. TaskRow.swift is explicit about why the menu exists alongside the
 * hover-revealed delete button: "this is the only route that does not need a pointer, and
 * the button is hover-gated so it has none."
 *
 * A menu with no items is not shown at all, and the browser's default menu is left alone
 * in that case, which is what `.contextMenu` with an empty builder does.
 */

import { useEffect, useState, type ReactNode } from 'react'

export type MenuItem = { label: string; run: () => void }

export function useContextMenu(items: MenuItem[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (at === null) return
    const dismiss = () => setAt(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAt(null)
    }
    // Capture, so a click that also lands on a menu item still closes the menu.
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [at])

  const onContextMenu = (event: React.MouseEvent) => {
    if (items.length === 0) return
    event.preventDefault()
    setAt({ x: event.clientX, y: event.clientY })
  }

  const menu: ReactNode =
    at === null ? null : (
      <div
        data-context-menu=""
        role="menu"
        style={{
          position: 'fixed',
          left: at.x,
          top: at.y,
          zIndex: 40,
          minWidth: 168,
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--wb-s1)',
          background: 'var(--wb-palette-surface)',
          borderRadius: 'var(--wb-radius-md)',
          border: '1px solid var(--wb-n800)',
          boxSizing: 'border-box',
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            // `onMouseDown` fires before the window listener that dismisses the menu, so
            // this is what makes the item clickable at all.
            onMouseDown={(event) => {
              event.preventDefault()
              item.run()
              setAt(null)
            }}
            style={{
              padding: 'var(--wb-s2) var(--wb-s3)',
              textAlign: 'left',
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: 'var(--wb-text)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--wb-radius-sm)',
              cursor: 'pointer',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    )

  return { onContextMenu, menu }
}
