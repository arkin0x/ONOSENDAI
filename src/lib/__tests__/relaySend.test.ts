/**
 * relaySend.test.ts - closing a relay with subscriptions open throws nothing
 * where nobody catches it (the real-bunker run, 2026-11-04).
 *
 * nostr-tools sends each frame once the connection promise settles, on
 * whatever socket is there by then. A relay closed with subscriptions on it
 * (a bunker's relays dropped mid-sign) queues their CLOSE frames first and
 * closes the socket after, so each one was written to a closing socket: a
 * WebSocket that throws there (as the page's did under the real-bunker
 * harness) left "WebSocket is already in CLOSING or CLOSED state" uncaught.
 */

import { afterAll, describe, expect, it, vi } from 'vitest'

// relay.ts itself, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const sent = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  const frames: string[] = []
  /** A socket that throws on a write once it is closing, as a strict WebSocket does. */
  class StrictSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: (() => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
    }
    send(raw: string): void {
      if (this.readyState !== 1) throw new Error('WebSocket is already in CLOSING or CLOSED state.')
      frames.push(raw)
    }
    close(): void {
      this.readyState = 2
      setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }, 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = StrictSocket
  return { frames }
})

vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: { getState: () => ({ identity: { pubkey: '' }, signEvent: async () => { throw new Error('not here') } }) },
}))

import { getPool } from '../relay'

const RELAY = 'wss://bunker.example/'

const uncaught: unknown[] = []
const onUnhandled = (reason: unknown): void => { uncaught.push(reason) }
process.on('unhandledRejection', onUnhandled)
afterAll(() => { process.off('unhandledRejection', onUnhandled) })

describe('a relay closed with subscriptions open', () => {
  it('throws nothing uncaught (6)', async () => {
    const pool = getPool()
    const relay = await pool.ensureRelay(RELAY)
    relay.subscribe([{ kinds: [24133] }], { onevent: () => {} })
    relay.subscribe([{ kinds: [24133], limit: 0 }], { onevent: () => {} })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent.frames.filter((f) => f.startsWith('["REQ"'))).toHaveLength(2)
    pool.close([RELAY])
    await new Promise((r) => setTimeout(r, 50))
    expect(uncaught.map(String)).toEqual([])
  })

  it('an AUTH signed after its socket closed throws nothing uncaught (review of #603)', async () => {
    const pool = getPool()
    const relay = await pool.ensureRelay(RELAY)
    ;(relay as unknown as { challenge: string }).challenge = 'c'
    let sign: (ev: unknown) => void = () => {}
    void relay.auth(() => new Promise((r) => { sign = r as never }))
    await new Promise((r) => setTimeout(r, 10))
    pool.close([RELAY])
    await new Promise((r) => setTimeout(r, 10))
    sign({ id: 'a'.repeat(64), kind: 22242, pubkey: 'b'.repeat(64), created_at: 1, tags: [], content: '', sig: 'c'.repeat(128) })
    await new Promise((r) => setTimeout(r, 50))
    expect(uncaught.map(String)).toEqual([])
  })
})
