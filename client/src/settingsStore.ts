/*
 * The two bits of Settings that are neither the engine's nor Rust's.
 *
 * `truncateHead` and the stored engine folder end up in the same file because both are
 * things `SettingsSheet.swift` gets for free from AppKit, and both are worth testing
 * rather than trusting.
 */

const DIRECTORY_KEY = 'workbench.engineDirectory'

/**
 * The chosen engine folder, across sheet opens and app restarts.
 *
 * `EngineViewModel` persists this in UserDefaults and says why: "the app is built into
 * DerivedData and has no reliable path back to the checkout it came from." The same is
 * true of a packaged Tauri app, so localStorage stands in. Without it, opening Settings
 * read "No folder chosen" while the agent was installed and running from a folder nobody
 * could see.
 *
 * Wrapped because localStorage throws rather than returning null in a private window or
 * with site data blocked, and a Settings sheet that cannot open is a worse failure than a
 * folder it has forgotten.
 */
export function readSavedDirectory(): string {
  try {
    return localStorage.getItem(DIRECTORY_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDirectory(path: string): void {
  try {
    localStorage.setItem(DIRECTORY_KEY, path)
  } catch {
    // Nothing to do and nothing worth saying: the folder is still in state for this
    // session, which is the part the install needs.
  }
}

/** How much of a path is shown before the head is dropped. */
const MAX_PATH_LENGTH = 48

/**
 * Keeps the tail of a long path and marks what was dropped.
 *
 * `.truncationMode(.head)` in the Swift, because the tail is the part that identifies a
 * folder: every checkout under one directory shares its head.
 *
 * Done in code rather than with `direction: rtl` and `text-overflow`, which does truncate
 * at the head but also reorders the neutral characters at the string's edges, so a POSIX
 * path's leading slash can end up printed at the end.
 */
export function truncateHead(text: string, max: number = MAX_PATH_LENGTH): string {
  if (text.length <= max) return text
  // One character of the budget goes to the ellipsis, so the result is exactly `max` wide.
  return `…${text.slice(text.length - (max - 1))}`
}
