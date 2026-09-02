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

const MENU_WIDTH = 168
/** s2 top and bottom, plus one row per item at s2 vertical padding on a 13px line. */
const ITEM_HEIGHT = 24.6
const EDGE_MARGIN = 8

/**
 * Keeps the menu inside the window, flipping it up or left when the pointer is near an
 * edge, which is what SwiftUI's `.contextMenu` does on its own. Without it a right-click
 * on the last row put "Delete task" below the bottom of the window.
 *
 * The viewport is a parameter rather than read from `window`, so the rule can be tested
 * without one. A right-click cannot be driven from the browser CLI this project verifies
 * with, so a unit test is the only proof this gets.
 */
export function menuPosition(
  x: number,
  y: number,
  itemCount: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const height = itemCount * ITEM_HEIGHT + 5.6
  const overflowsBottom = y + height + EDGE_MARGIN > viewport.height
  const overflowsRight = x + MENU_WIDTH + EDGE_MARGIN > viewport.width
  return {
    // Clamped as well as flipped: a menu taller than the window has to start at the top
    // rather than at a negative offset.
    left: Math.max(EDGE_MARGIN, overflowsRight ? x - MENU_WIDTH : x),
    top: Math.max(EDGE_MARGIN, overflowsBottom ? y - height : y),
  }
}

export function useContextMenu(items: MenuItem[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (at === null) return
    const dismiss = () => setAt(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAt(null)
    }
    /*
     * On `window`, in the bubble phase, and an item's own `onMouseDown` still wins:
     * React attaches its handlers to the root container, which sits below `window`, so
     * the item runs first and this only closes what it left open.
     */
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
          ...menuPosition(at.x, at.y, items.length, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
          zIndex: 40,
          width: MENU_WIDTH,
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
