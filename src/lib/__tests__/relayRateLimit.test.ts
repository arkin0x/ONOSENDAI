/**
 * relayRateLimit.test.ts - a relay that says "too fast" is not a dead
 * socket, and a backlog never makes it say so.
 *
 * relay.onosendai.tech (grain) takes 8 kind 3333 events a second on one
 * connection, and refuses the rest with OK false "Rate limit exceeded for
 * category: regular" (or "Global event rate limit exceeded"). Neither is
 * NIP-01's "rate-limited:" prefix, so publishMany took the refusal for a
 * dead socket: it dropped the shared canonical socket (every feed on it
 * reconnecting, its AUTH gone) and sent again over a fresh one, whose fresh
 * allowance dodged the limit, toward the 30 connections a minute the relay
 * allows from one address.
 *
 * relay.ts and the nostr-tools pool are real; only the WebSocket is fake,
 * and no socket leaves the process.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// relay.ts itself, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  const CANON = 'wss://relay.onosendai.tech/'
  const OTHER = 'wss://other.example/'
  const state = {
    CANON,
    OTHER,
    /** Sockets opened, per relay. */
    sockets: new Map<string, number>(),
    /** EVENTs each relay was sent, and how each was answered. */
    sent: [] as { url: string; id: string; at: number; ok: boolean; reason: string }[],
    /** The least time between two EVENTs on one connection the canonical relay takes; closer than that is refused. */
    minGapMs: 125,
    /** The canonical relay refuses every EVENT for its rate, with these words. */
    limitAll: null as string | null,
    /** The other relay refuses every connection. */
    otherDown: false,
    reset(): void {
      state.sockets = new Map(); state.sent = []; state.minGapMs = 125; state.limitAll = null; state.otherDown = false
    },
  }
  class LimitingSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    lastEventAt = -Infinity
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: ((e: unknown) => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      if (this.url !== CANON && this.url !== OTHER) throw new Error(`no relay at ${this.url}`)
      state.sockets.set(this.url, (state.sockets.get(this.url) ?? 0) + 1)
      if (this.url === OTHER && state.otherDown) {
        setTimeout(() => { this.readyState = 3; this.onerror?.(new Error('connection refused')); this.onclose?.({ code: 1006, reason: '' }) }, 2)
        return
      }
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 2)
    }
    private deliver(msg: unknown[]): void {
      if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) })
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      setTimeout(() => {
        if (this.readyState !== 1) return
        if (msg[0] === 'REQ') { this.deliver(['EOSE', msg[1]]); return }
        if (msg[0] !== 'EVENT') return
        const id = (msg[1] as { id: string }).id
        const now = Date.now()
        let reason = ''
        if (this.url === CANON && state.limitAll) reason = state.limitAll
        else if (this.url === CANON && now - this.lastEventAt < state.minGapMs) reason = 'Rate limit exceeded for category: regular'
        const ok = reason === ''
        if (ok) this.lastEventAt = now
        state.sent.push({ url: this.url, id, at: now, ok, reason })
        this.deliver(['OK', id, ok, reason])
      }, 1)
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = LimitingSocket
  return state
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../events'
import { SEND_GAP_MS, dropRelays, isRateLimited, publishMany } from '../relay'

const sk = generateSecretKey()
let n = 0
const anEvent = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_790_000_000 + n++, tags: [['A', 'hop']], content: '' }, sk) as unknown as NostrEvent

beforeEach(() => {
  dropRelays([net.CANON, net.OTHER])
  net.reset()
})

describe('a relay that says "too fast"', () => {
  it('is recognized in the words relays use, and nothing else is', () => {
    expect(isRateLimited('Rate limit exceeded for category: regular')).toBe(true)
    expect(isRateLimited('Global event rate limit exceeded')).toBe(true)
    expect(isRateLimited('rate-limited: slow down')).toBe(true)
    expect(isRateLimited('ratelimit: too many')).toBe(true)
    expect(isRateLimited('invalid: bad signature')).toBe(false)
    expect(isRateLimited('error: database is locked')).toBe(false)
    expect(isRateLimited('connection failure: refused')).toBe(false)
  })

  it('keeps the socket: the refusal is reported, the event is not sent again over a fresh connection', async () => {
    net.limitAll = 'Rate limit exceeded for category: regular'
    const result = await publishMany([net.CANON], anEvent())
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toMatch(/rate limit exceeded/i)
    expect(net.sockets.get(net.CANON)).toBe(1)
    expect(net.sent.filter((s) => s.url === net.CANON)).toHaveLength(1)
  }, 30_000)

  it('the global wording too', async () => {
    net.limitAll = 'Global event rate limit exceeded'
    const result = await publishMany([net.CANON], anEvent())
    expect(result.ok).toBe(false)
    expect(net.sockets.get(net.CANON)).toBe(1)
    expect(net.sent).toHaveLength(1)
  }, 30_000)

  it('beside a relay whose socket failed: only that one is dialled again, the rate-limited socket is kept', async () => {
    net.limitAll = 'Rate limit exceeded for category: regular'
    net.otherDown = true
    const result = await publishMany([net.OTHER, net.CANON], anEvent())
    expect(result.ok).toBe(false)
    expect(net.sockets.get(net.CANON)).toBe(1)
    // Dialled again (a refused connection costs the pool two tries a send), while the canonical socket stayed.
    expect(net.sockets.get(net.OTHER)).toBeGreaterThanOrEqual(2)
    expect(net.sent.filter((s) => s.url === net.CANON)).toHaveLength(1)
  }, 30_000)
})

describe('a backlog sent as fast as the caller can', () => {
  it('one after another: paced under the relay\'s limit, so nothing is refused, over one socket', async () => {
    const backlog = Array.from({ length: 20 }, anEvent)
    for (const e of backlog) {
      const result = await publishMany([net.CANON], e)
      expect(result.ok).toBe(true)
    }
    expect(net.sent.filter((s) => !s.ok)).toEqual([])
    expect(net.sent).toHaveLength(20)
    expect(net.sockets.get(net.CANON)).toBe(1)
    for (let i = 1; i < net.sent.length; i++) expect(net.sent[i].at - net.sent[i - 1].at).toBeGreaterThanOrEqual(SEND_GAP_MS - 10)
  }, 30_000)

  it('all at once: the sends queue up behind each other rather than going together', async () => {
    const backlog = Array.from({ length: 12 }, anEvent)
    const results = await Promise.all(backlog.map((e) => publishMany([net.CANON], e)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(net.sent.filter((s) => !s.ok)).toEqual([])
    expect(net.sockets.get(net.CANON)).toBe(1)
  }, 30_000)
})
