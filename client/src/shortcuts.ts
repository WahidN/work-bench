/*
 * Port of app/Workbench/AppCommands.swift.
 *
 * In the app these are a `CommandMenu("Go")` whose buttons carry keyboard shortcuts, so
 * AppKit routes them and the menu is the visible record of what exists. A webview has no
 * menu bar, so this is a window key handler instead, and the Tauri menu is built from the
 * same table in `src-tauri` rather than typed out twice.
 */

import type { SidebarSection } from './logic'

export type Shortcut =
  | { kind: 'palette' }
  | { kind: 'navigate'; section: SidebarSection }
  | { kind: 'askAgent' }

/**
 * The Go menu, in its order.
 *
 * `key` is the character the shortcut is written with, and `id` is what the native menu
 * item emits. Both live in one table so the menu and the key handler cannot disagree about
 * what ⌘3 does; the ids match `ITEMS` in src-tauri/src/menu.rs.
 */
export const SHORTCUTS: { id: string; key: string; label: string; action: Shortcut }[] = [
  { id: 'palette', key: 'k', label: 'Command palette', action: { kind: 'palette' } },
  { id: 'today', key: '1', label: 'Today', action: { kind: 'navigate', section: 'Today' } },
  { id: 'projects', key: '2', label: 'Projects', action: { kind: 'navigate', section: 'Projects' } },
  { id: 'prs', key: '3', label: 'Pull requests', action: { kind: 'navigate', section: 'Pull requests' } },
  { id: 'jira', key: '4', label: 'Jira', action: { kind: 'navigate', section: 'Jira' } },
  { id: 'agent', key: 'j', label: 'Ask the agent', action: { kind: 'askAgent' } },
]

/** The action a native menu item stands for. Null for an id this build does not know. */
export function shortcutForMenuId(id: string): Shortcut | null {
  return SHORTCUTS.find((entry) => entry.id === id)?.action ?? null
}

/**
 * Whether a keystroke is one of ours, given where the caret is.
 *
 * The typing check is the whole reason this is a function rather than a lookup. AppKit
 * gives a focused NSTextField first refusal on a key event, so in the app ⌘1 while typing
 * goes to the field; a `window` listener in a webview has no such courtesy and would
 * navigate away mid-sentence.
 *
 * Cmd is required, so the digits stay typable: the app's shortcuts are all ⌘-something,
 * and a bare "1" is a character someone is writing.
 */
export function matchShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  isTyping: boolean,
): Shortcut | null {
  if (!event.metaKey || event.ctrlKey || event.altKey) return null
  if (isTyping) return null
  const match = SHORTCUTS.find((entry) => entry.key === event.key.toLowerCase())
  return match?.action ?? null
}

/**
 * Whether the caret is somewhere text is being written.
 *
 * `isContentEditable` is in here because a rich text area is not an input element and
 * would otherwise look like nowhere at all.
 */
export function isTypingIn(element: Element | null): boolean {
  if (element === null) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element instanceof HTMLElement && element.isContentEditable
}
