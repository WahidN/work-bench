/*
 * The launchd agent and the engine token, from the frontend's side.
 *
 * Everything here goes through Rust, because everything here is something a webview cannot
 * do: write to LaunchAgents, run launchctl, read the keychain, open a folder picker. In
 * Chrome none of it is reachable, which is a real limit on what can be verified there and
 * is why the rules themselves live in `src-tauri/src/launchd.rs` with tests of their own.
 */

const IN_TAURI = '__TAURI_INTERNALS__' in window

export type AgentState = {
  isInstalled: boolean
  isLoaded: boolean
  plistPath: string
  logPath: string
}

export type TokenState = { hasToken: boolean; length: number }

/** What Settings shows before Rust has answered, and what it shows in a browser. */
export const UNKNOWN_AGENT: AgentState = {
  isInstalled: false,
  isLoaded: false,
  plistPath: '',
  logPath: '',
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!IN_TAURI) {
    throw new Error('This needs the app. In a browser there is no way to reach launchd.')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export const agentState = () => call<AgentState>('engine_agent_state')
export const agentInstall = (directory: string) =>
  call<AgentState>('engine_agent_install', { directory })
export const agentStart = () => call<AgentState>('engine_agent_start')
export const agentRemove = () => call<AgentState>('engine_agent_remove')

export const tokenState = () => call<TokenState>('engine_token_state')
export const tokenWrite = (token: string) => call<TokenState>('engine_token_write', { token })
export const tokenDelete = () => call<TokenState>('engine_token_delete')

/**
 * The engine folder picker.
 *
 * `SettingsSheet.swift` opens an NSOpenPanel with `canChooseDirectories`. A webview has no
 * equivalent worth using: `<input type="file" webkitdirectory>` gives back file handles
 * rather than a path, and the plist needs a real path for `WorkingDirectory`. So this is
 * the Tauri dialog plugin, which is the same native panel.
 *
 * Null when the user cancels, which is not an error.
 */
export async function chooseEngineDirectory(current: string): Promise<string | null> {
  if (!IN_TAURI) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const chosen = await open({
    directory: true,
    multiple: false,
    // Opens where the current folder is, matching the panel's `directoryURL`.
    defaultPath: current === '' ? undefined : current,
    title: 'Choose the engine folder',
  })
  return typeof chosen === 'string' ? chosen : null
}

/** Whether the launchd side can be reached at all. Settings says so rather than pretending. */
export const canManageAgent = IN_TAURI
