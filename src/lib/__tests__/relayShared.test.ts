/**
 * relayShared.test.ts: one question to several relays parses and checks each
 * event once. The same bags came from all 8 of the owner's relays on every
 * region scan, each copy parsed and checked (phone diag of 2026-11-22). A
 * copy another relay of the question already sent, and that passed, is taken
 * as it is: each relay's answer still lists it.
 *
 * relay.ts and nostr-tools' pool over fake sockets: nothing leaves the process.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('../relay')

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) }, clear: () => { m.clear() },
  }
  const state = { events: [] as unknown[], bad: null as null | string, checks: 0 }
  class FakeSocket {
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
      this.url = String(url)
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 2)
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      if (msg[0] !== 'REQ') return
      // Each relay answers in turn, a little after the one before, as real ones do.
      const delay = 5 + Number(/r(\d)/.exec(this.url)?.[1] ?? 0) * 5
      setTimeout(() => {
        for (const ev of state.events) {
          // `bad`: this relay sends a forged copy of every event.
          const sent = state.bad && this.url.includes(state.bad) ? { ...(ev as object), sig: '00'.repeat(64) } : ev
          this.onmessage?.({ data: JSON.stringify(['EVENT', msg[1], sent]) })
        }
        this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) })
      }, delay)
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return state
})

vi.mock('../verifiedSigs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../verifiedSigs')>()
  return { ...actual, verifyUnlessDeferred: (e: Parameters<typeof actual.verifyUnlessDeferred>[0]) => { net.checks++; return actual.verifyUnlessDeferred(e) } }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { queryEachAt } from '../relay'

const sk = generateSecretKey()
const bags = Array.from({ length: 3 }, (_, i) => finalizeEvent({ kind: 33330, created_at: 1_790_000_000 + i, tags: [['d', 'region']], content: 'x'.repeat(1000) }, sk))
const relays = ['wss://r1.example/', 'wss://r2.example/', 'wss://r3.example/', 'wss://r4.example/']

describe('one question to several relays', () => {
  it('checks each event once, and every relay\'s answer lists all of them', async () => {
    net.events = bags
    net.bad = null
    net.checks = 0
    const answers = await queryEachAt(relays, { kinds: [33330], '#d': ['region'] })
    expect(answers.map((a) => a.outcome)).toEqual(['answered', 'answered', 'answered', 'answered'])
    for (const a of answers) expect(a.events.map((e) => e.id).sort()).toEqual(bags.map((b) => b.id).sort())
    expect(net.checks).toBe(3)
  }, 30_000)

  it('a relay sending a forged copy after the good one has come counts as holding it, unless the read asks for each relay\'s own copies (perRelay)', async () => {
    net.events = bags
    net.bad = 'r4'
    net.checks = 0
    const shared = await queryEachAt(relays, { kinds: [33330], '#d': ['region'] })
    expect(shared.find((a) => a.url.includes('r4'))!.events).toHaveLength(3)
    const own = await queryEachAt(relays, { kinds: [33330], '#d': ['region'] }, undefined, { perRelay: true })
    expect(own.find((a) => a.url.includes('r4'))!.events).toHaveLength(0)
    expect(own.find((a) => a.url.includes('r1'))!.events).toHaveLength(3)
  }, 30_000)

  it('a relay that sends a forged copy first does not stop the good copy from being checked and kept', async () => {
    net.events = bags.map((b) => ({ ...b, created_at: b.created_at }))
    net.bad = 'r1'
    net.checks = 0
    const answers = await queryEachAt(relays, { kinds: [33330], '#d': ['region'] })
    const r1 = answers.find((a) => a.url.includes('r1'))!
    const r2 = answers.find((a) => a.url.includes('r2'))!
    expect(r1.events).toHaveLength(0)
    expect(r2.events.map((e) => e.id).sort()).toEqual(bags.map((b) => b.id).sort())
    for (const e of r2.events) expect(e.sig).not.toBe('00'.repeat(64))
  }, 30_000)
})
