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

// The `typeof` guard is what lets this module be imported by a unit test, which runs in
// node and has no window. It is false there, which is also the right answer.
const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * A failed engine call, carrying the HTTP status when there was one.
 *
 * The status is a field rather than something callers read out of the message. The Swift
 * has `APIError.conflict` for exactly one caller, JiraViewModel, which turns a 409 into
 * "An analysis is already running for this issue." Matching that by searching the message
 * for "409" reads the path as well as the status, so promoting todo 409 reported a
 * conflict for any failure at all.
 */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

/**
 * The status out of a message both transports write the same way.
 *
 * The browser path has the number in hand, so this is only for the Rust one: `request` in
 * engine.rs formats `{method} {path} returned {status}: {text}`, where a reqwest
 * `StatusCode` prints as "409 Conflict". Anchoring on " returned " is what keeps a number
 * in the path out of it.
 */
export function statusFromMessage(message: string): number | null {
  const match = / returned (\d{3})/.exec(message)
  return match === null ? null : Number.parseInt(match[1], 10)
}

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
      const message = String(error)
      throw new EngineError(message, statusFromMessage(message))
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
    throw new EngineError(
      `${verb} ${path} returned ${response.status}: ${text}`,
      response.status,
    )
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
