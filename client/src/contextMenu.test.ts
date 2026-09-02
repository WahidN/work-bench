import { describe, expect, it } from 'vitest'
import { menuPosition } from './ContextMenu'

/*
 * SwiftUI's `.contextMenu` keeps itself on screen and this one has to be told to. A
 * right-click cannot be driven from the browser CLI this project verifies with, so these
 * are the only proof the flipping works.
 *
 * A two-item menu is 54.8 tall: 24.6 per row plus 5.6 of padding.
 */

const VIEWPORT = { width: 1440, height: 900 }

describe('menuPosition', () => {
  it('opens at the pointer when there is room', () => {
    expect(menuPosition(400, 300, 2, VIEWPORT)).toEqual({ left: 400, top: 300 })
  })

  it('flips up when the menu would run past the bottom', () => {
    // A right-click on the last row of Today. Left alone, "Delete task" sat below the
    // window and could not be reached at all.
    const { top } = menuPosition(400, 880, 2, VIEWPORT)
    expect(top).toBe(880 - 54.8)
    expect(top + 54.8).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('flips left when the menu would run past the right edge', () => {
    const { left } = menuPosition(1400, 300, 2, VIEWPORT)
    expect(left).toBe(1400 - 168)
    expect(left + 168).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('flips both at once in the bottom-right corner', () => {
    expect(menuPosition(1430, 890, 2, VIEWPORT)).toEqual({ left: 1262, top: 835.2 })
  })

  it('clamps rather than going negative when the menu is taller than the window', () => {
    // Flipping alone would put a tall menu at a negative offset, which is off screen in
    // the other direction and no better than where it started.
    const { top, left } = menuPosition(4, 20, 40, { width: 200, height: 300 })
    expect(top).toBe(8)
    expect(left).toBe(8)
  })
})
