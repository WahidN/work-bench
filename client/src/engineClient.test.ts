import { describe, expect, it } from 'vitest'
import { statusFromMessage } from './engineClient'

/*
 * The Rust transport hands back a formatted string rather than a status, so the status has
 * to be read out of it. The case worth guarding is the one that made this necessary: the
 * path is in the same message, so a three-digit todo id must not be read as the status.
 */

describe('statusFromMessage', () => {
  it('reads the status the browser transport writes', () => {
    expect(
      statusFromMessage('POST /todos/1/promote returned 409: {"error":"already working on this"}'),
    ).toBe(409)
  })

  it('reads the status the Rust transport writes, which spells the reason out', () => {
    // A reqwest StatusCode prints as "409 Conflict".
    expect(statusFromMessage('POST /todos/1/promote returned 409 Conflict: {}')).toBe(409)
  })

  it('is not fooled by a three-digit id in the path', () => {
    // The bug. Searching the message for "409" called every failure on todo 409 a
    // conflict, and told the user an analysis was running when none was.
    expect(statusFromMessage('POST /todos/409/promote returned 500: {"error":"boom"}')).toBe(500)
    expect(statusFromMessage('POST /todos/1409/promote returned 502: {}')).toBe(502)
  })

  it('is not fooled by a status-like number in the body', () => {
    expect(statusFromMessage('GET /prs/1 returned 500: {"error":"upstream said 409"}')).toBe(500)
  })

  it('is null for a failure that never reached the engine', () => {
    expect(statusFromMessage('engine unreachable: connection refused')).toBeNull()
  })
})
