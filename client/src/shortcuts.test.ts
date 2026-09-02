import { describe, expect, it } from 'vitest'
import { SHORTCUTS, matchShortcut, shortcutForMenuId } from './shortcuts'

/*
 * Task 6.3 is the reason these exist: the shortcuts must not fire while a text field has
 * focus. AppKit gives a focused NSTextField first refusal on a key event, and a `window`
 * listener in a webview does not, so the rule has to be written down and tested.
 */

const cmd = (key: string) => ({ key, metaKey: true, ctrlKey: false, altKey: false })

describe('SHORTCUTS', () => {
  it('is the Go menu, in its order', () => {
    expect(SHORTCUTS.map((entry) => entry.key)).toEqual(['k', '1', '2', '3', '4', 'j'])
  })

  it('carries the ids the native menu emits', () => {
    // These match ITEMS in src-tauri/src/menu.rs. A rename on one side without the other
    // makes a menu item that does nothing.
    expect(SHORTCUTS.map((entry) => entry.id)).toEqual([
      'palette',
      'today',
      'projects',
      'prs',
      'jira',
      'agent',
    ])
  })
})

describe('shortcutForMenuId', () => {
  it('maps every native menu id onto the same action as its key', () => {
    // One table serves the menu and the key handler, so the two cannot disagree about
    // what a shortcut does. This is the assertion that holds them together.
    for (const entry of SHORTCUTS) {
      expect(shortcutForMenuId(entry.id)).toEqual(matchShortcut(cmd(entry.key), false))
    }
  })

  it('is null for an id this build does not know', () => {
    expect(shortcutForMenuId('settings')).toBeNull()
  })
})

describe('matchShortcut', () => {
  it('recognises the palette and the four sections', () => {
    expect(matchShortcut(cmd('k'), false)).toEqual({ kind: 'palette' })
    expect(matchShortcut(cmd('1'), false)).toEqual({ kind: 'navigate', section: 'Today' })
    expect(matchShortcut(cmd('4'), false)).toEqual({ kind: 'navigate', section: 'Jira' })
    expect(matchShortcut(cmd('j'), false)).toEqual({ kind: 'askAgent' })
  })

  it('fires nothing while a text field has focus', () => {
    // The whole point. Without this, ⌘1 typed into the quick-add field navigates away
    // mid-sentence instead of reaching the field.
    for (const entry of SHORTCUTS) {
      expect(matchShortcut(cmd(entry.key), true)).toBeNull()
    }
  })

  it('needs Cmd, so the digits stay typable', () => {
    expect(matchShortcut({ key: '1', metaKey: false, ctrlKey: false, altKey: false }, false)).toBeNull()
  })

  it('ignores a chord with another modifier on it', () => {
    // Cmd-Alt-1 and Cmd-Ctrl-1 are somebody else's shortcut, not ours.
    expect(matchShortcut({ key: '1', metaKey: true, ctrlKey: false, altKey: true }, false)).toBeNull()
    expect(matchShortcut({ key: '1', metaKey: true, ctrlKey: true, altKey: false }, false)).toBeNull()
  })

  it('takes the shifted spelling of a letter', () => {
    expect(matchShortcut(cmd('K'), false)).toEqual({ kind: 'palette' })
  })

  it('is null for a key that is not ours', () => {
    expect(matchShortcut(cmd('5'), false)).toBeNull()
    expect(matchShortcut(cmd('a'), false)).toBeNull()
  })
})
