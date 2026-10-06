import { unlink } from 'node:fs/promises'
import { connect, createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Order = { url: string; review: boolean }

export const SOCKET = join(tmpdir(), 'workbench.sock')

export function readOrder(args: string[]): Order | null {
  const url = args[args.indexOf('--pr') + 1]
  if (!args.includes('--pr') || !url || url.startsWith('--')) return null
  return { url, review: args.includes('--review') }
}

// True when a running Workbench took the order. A launch without one still brings that window forward.
export function sendOrder(order: Order | null, socket = SOCKET): Promise<boolean> {
  return new Promise((resolve) => {
    const client = connect(socket)
    client.on('connect', () => client.end(`${JSON.stringify(order ?? {})}\n`, () => resolve(true)))
    client.on('error', () => resolve(false))
  })
}

export async function listenForOrders(onOrder: (order: Order | null) => void, socket = SOCKET): Promise<Server> {
  // Nobody answered on it, so the file is left from a Workbench that crashed.
  await unlink(socket).catch(() => {})
  const server = createServer((client) => {
    let text = ''
    client.on('data', (chunk) => (text += chunk))
    client.on('end', () => {
      try {
        const { url, review } = JSON.parse(text)
        onOrder(typeof url === 'string' ? { url, review: review === true } : null)
      } catch {
        // A line that is not an order is ignored.
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket, resolve)
  })
  return server
}

export type OrderFeed = {
  push: (order: Order | null) => void
  subscribe: (onOrder: (order: Order | null) => void) => () => void
}

// Keeps orders that arrive before the window listens, like the one from the command line.
export function orderFeed(first: Order | null = null): OrderFeed {
  let listener: ((order: Order | null) => void) | null = null
  const waiting: (Order | null)[] = first ? [first] : []
  return {
    push: (order) => (listener ? listener(order) : waiting.push(order)),
    subscribe: (onOrder) => {
      listener = onOrder
      waiting.splice(0).forEach(onOrder)
      return () => {
        if (listener === onOrder) listener = null
      }
    },
  }
}
