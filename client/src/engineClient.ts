/*
 * The transport. One function per HTTP verb, mirroring the Rust commands.
 *
 * In the app, requests go through Rust: the webview cannot reach the engine directly
 * because it sends no CORS headers, and routing through Rust keeps the bearer token out
 * of the webview entirely. In a browser there is no `invoke`, so requests go through the
 * Vite dev proxy, which injects the same header on the node side. See vite.config.ts.
 *
 * Nothing outside `queries.ts` should import this. Screens use the hooks.
 */

const IN_TAURI = '__TAURI_INTERNALS__' in window

export class EngineError extends Error {}

type Verb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

const COMMANDS: Record<Verb, string> = {
  GET: 'engine_get',
  POST: 'engine_post',
  PATCH: 'engine_patch',
  PUT: 'engine_put',
  DELETE: 'engine_delete',
}

/**
 * `DELETE /todos/:id` answers 204 with no body, and so may others, so an empty response
 * is a success rather than something to hand to `JSON.parse`.
 */
function parse<T>(text: string): T {
  if (text.trim() === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new EngineError(`engine returned a body that is not JSON: ${text.slice(0, 200)}`)
  }
}

async function send<T>(verb: Verb, path: string, body?: unknown): Promise<T> {
  if (IN_TAURI) {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      // The command name carries the verb, so the frontend cannot turn a read into a
      // write by passing a method string.
      const text = await invoke<string>(COMMANDS[verb], {
        path,
        ...(body === undefined ? {} : { body }),
      })
      return parse<T>(text)
    } catch (error) {
      // `parse` throws an EngineError of its own, and this catch is around it, so
      // re-wrapping would put the class name inside the message.
      if (error instanceof EngineError) throw error
      throw new EngineError(String(error))
    }
  }

  const response = await fetch(`/engine${path}`, {
    method: verb,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) {
    // A 401 has to surface as an error rather than an empty list. An engine with no token
    // behind it looks exactly like an engine with no data in it, and that ambiguity is
    // what EngineDownBanner.swift exists to remove.
    throw new EngineError(`${verb} ${path} returned ${response.status}: ${text}`)
  }
  return parse<T>(text)
}

export const engine = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
  delete: <T>(path: string) => send<T>('DELETE', path),
}
