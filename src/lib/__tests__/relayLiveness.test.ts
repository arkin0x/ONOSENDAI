/**
 * relayLiveness.test.ts: what the head check knows of each relay's socket
 * (owner's ruling of 2026-11-22): when it last sent anything, and how long it
 * has owed an answer. A socket that silently stalls (no frames at all) stops
 * counting as current (lib/ownWatch.ts).
 *
 * relay.ts and nostr-tools' pool over a fake socket: nothing leaves the process.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('../relay')

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) }, clear: () => { m.clear() },
  }
  const state = { stalled: false, sockets: [] as unknown[] }
  class FakeSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: ((e: unknown) => void) | null
    constructor(url: string | URL) {
      super()
      this.url = String(url)
      state.sockets.push(this)
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 2)
    }
    private deliver(msg: unknown[]): void {
      const e = new MessageEvent('message', { data: JSON.stringify(msg) })
      this.dispatchEvent(e)
      this.onmessage?.(e)
    }
    send(raw: string): void {
      if (state.stalled) return
      const msg = JSON.parse(raw) as unknown[]
      if (msg[0] === 'REQ') setTimeout(() => this.deliver(['EOSE', msg[1]]), 1)
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      setTimeout(() => { this.dispatchEvent(new Event('close')); this.onclose?.({ code: 1000, reason: '' }) }, 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return state
})

import { frameAge, subscribeOne, unansweredFor } from '../relay'

const URL_ = 'wss://stall.example/'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('a relay socket\'s liveness', () => {
  it('a socket that answers is fresh and owes nothing; one that stalls owes its answer, and the debt grows', async () => {
    expect(frameAge(URL_)).toBe(Infinity)
    let eosed = 0
    const sub = subscribeOne(URL_, { kinds: [3333], limit: 1 }, { onevent: () => {}, oneose: () => { eosed++ }, onclose: () => {} })
    for (let i = 0; i < 100 && eosed === 0; i++) await sleep(5)
    expect(eosed).toBe(1)
    expect(frameAge(URL_)).toBeLessThan(200)
    expect(unansweredFor(URL_)).toBe(0)
    net.stalled = true
    const probe = subscribeOne(URL_, { ids: ['0'.repeat(64)] }, { onevent: () => {}, oneose: () => {}, onclose: () => {} })
    await sleep(120)
    expect(unansweredFor(URL_)).toBeGreaterThanOrEqual(100)
    expect(frameAge(URL_)).toBeGreaterThanOrEqual(100)
    probe.close()
    sub.close()
  })
})
