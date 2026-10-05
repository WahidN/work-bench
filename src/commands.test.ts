import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { listenForOrders, orderFeed, readOrder, sendOrder, type Order } from './commands'

const URL = 'https://github.com/acme/api/pull/2'

describe('readOrder', () => {
  it('reads the pull request and whether to review it', () => {
    expect(readOrder(['--pr', URL, '--review'])).toEqual({ url: URL, review: true })
    expect(readOrder(['--review', '--pr', URL])).toEqual({ url: URL, review: true })
    expect(readOrder(['--pr', URL])).toEqual({ url: URL, review: false })
  })

  it('has no order without a pull request', () => {
    expect(readOrder([])).toBeNull()
    expect(readOrder(['--review'])).toBeNull()
    expect(readOrder(['--pr', '--review'])).toBeNull()
  })
})

describe('the order socket', () => {
  const servers: Server[] = []
  afterEach(() => servers.splice(0).forEach((server) => server.close()))

  const socketPath = () => join(mkdtempSync(join(tmpdir(), 'wb-')), 'workbench.sock')
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 50 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  it('hands an order to the Workbench that listens', async () => {
    const socket = socketPath()
    const received: (Order | null)[] = []
    servers.push(await listenForOrders((order) => received.push(order), socket))

    expect(await sendOrder({ url: URL, review: true }, socket)).toBe(true)
    await until(() => received.length > 0)
    expect(received).toEqual([{ url: URL, review: true }])
  })

  it('passes on a launch without an order, so the window still comes forward', async () => {
    const socket = socketPath()
    const received: (Order | null)[] = []
    servers.push(await listenForOrders((order) => received.push(order), socket))

    expect(await sendOrder(null, socket)).toBe(true)
    await until(() => received.length > 0)
    expect(received).toEqual([null])
  })

  it('says nobody took the order when no Workbench listens', async () => {
    expect(await sendOrder({ url: URL, review: false }, socketPath())).toBe(false)
  })

  it('replaces a socket file left by a Workbench that crashed', async () => {
    const socket = socketPath()
    writeFileSync(socket, '')
    expect(await sendOrder({ url: URL, review: false }, socket)).toBe(false)

    const received: (Order | null)[] = []
    servers.push(await listenForOrders((order) => received.push(order), socket))
    expect(await sendOrder({ url: URL, review: false }, socket)).toBe(true)
  })
})

describe('orderFeed', () => {
  it('keeps the first order until the window listens, then passes orders on', () => {
    const feed = orderFeed({ url: URL, review: true })
    const received: (Order | null)[] = []

    const stop = feed.subscribe((order) => received.push(order))
    feed.push(null)
    stop()
    feed.push({ url: URL, review: false })

    expect(received).toEqual([{ url: URL, review: true }, null])
  })
})
