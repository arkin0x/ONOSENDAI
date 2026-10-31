/**
 * relayHang.test.ts - a relay that accepts and then hangs costs one bounded
 * wait, and does not stall a publish, a read or a move. This is relay.ts over
 * the real nostr-tools pool, on a fake clock, with a fake socket per URL.
 *
 * What would go wrong silently: nostr-tools sets no timer on a connect without
 * a timeout, and every caller on a socket shares the first caller's connect.
 * One untimed connect took the time limit from all of them, so a publish or a
 * read to a player's relay that accepted and never answered waited as long as
 * the socket did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// relay.ts itself, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const net = vi.hoisted(() => {
  const opened: string[] = []
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    onopen?: () => void
    onclose?: (e: { code: number; reason: string }) => void
    onmessage?: (e: { data: string }) => void
    constructor(url: string | URL) {
      this.url = String(url)
      opened.push(this.url)
      // accepts.*: the handshake never finishes. slow.*: it finishes after 4 s.
      if (this.url.includes('accepts')) return
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, this.url.includes('slow') ? 4000 : 0)
    }
    send(raw: string): void {
      // silent.*: the socket opened, and nothing ever comes back.
      if (this.url.includes('silent')) return
      const msg = JSON.parse(raw) as [string, { id?: string } | string]
      setTimeout(() => {
        if (msg[0] === 'REQ') this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) })
        if (msg[0] === 'EVENT') this.onmessage?.({ data: JSON.stringify(['OK', (msg[1] as { id: string }).id, true, '']) })
      }, 0)
    }
    close(): void { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return { opened }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { connectRelay, CYBERSPACE_RELAY, publishMany, queryAny, queryEachAt, subscribeOne, watchConnectivity } from '../relay'
import type { NostrEvent } from '../events'

const MINE = 'wss://mine.example'
const FILTER = { kinds: [0], limit: 1 }
/** The connect limit, and room for what follows it on a fake clock. */
const CONNECT = 5500
const AT_ONCE = 500
const event = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_000, tags: [], content: '' }, generateSecretKey()) as unknown as NostrEvent
const dials = (url: string): number => net.opened.filter((u) => u.startsWith(url)).length

/** Run the clock for `ms`, and say what `p` settled to in that time. */
async function within<T>(ms: number, p: Promise<T>): Promise<{ settled: boolean; value?: T }> {
  const seen: { settled: boolean; value?: T } = { settled: false }
  void p.then((value) => { seen.settled = true; seen.value = value })
  await vi.advanceTimersByTimeAsync(ms)
  return seen
}

describe('a relay that accepts and then hangs', () => {
  beforeEach(() => { vi.useFakeTimers(); net.opened.length = 0 })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('costs a publish one bounded wait, then nothing, and the other relays still count', async () => {
    const hung = 'wss://accepts.publish.example'
    const first = await within(CONNECT, publishMany([MINE, hung], event()))
    expect(first.settled).toBe(true)
    expect(first.value).toEqual({ ok: true, accepted: [`${MINE}/`] })
    const dialed = dials(hung)
    const next = await within(AT_ONCE, publishMany([MINE, hung], event()))
    expect(next.value).toEqual({ ok: true, accepted: [`${MINE}/`] })
    expect(dials(hung)).toBe(dialed)
  })

  it('costs a read one bounded wait, then nothing, and the other relays still answer', async () => {
    const hung = 'wss://accepts.read.example'
    const first = await within(CONNECT, queryEachAt([MINE, hung], FILTER))
    expect(first.settled).toBe(true)
    expect(first.value?.find((a) => a.url === `${MINE}/`)?.outcome).toBe('answered')
    expect(first.value?.find((a) => a.url === `${hung}/`)?.outcome).toBe('unreachable')
    expect((await within(AT_ONCE, queryEachAt([MINE, hung], FILTER))).settled).toBe(true)
  })

  it('does not stall the other ways in: queryAny, connectRelay, subscribeOne', async () => {
    expect((await within(CONNECT, queryAny(['wss://accepts.any.example'], FILTER))).value).toEqual([])
    expect((await within(CONNECT, connectRelay('wss://accepts.connect.example'))).value).toBe(false)
    const closed = new Promise<string | undefined>((resolve) => {
      subscribeOne('wss://accepts.sub.example', FILTER, { onevent: () => {}, oneose: () => {}, onclose: resolve })
    })
    expect((await within(CONNECT, closed)).value).toBe('unreachable')
  })

  it('is asked again once its time away is over', async () => {
    const hung = 'wss://accepts.again.example'
    await within(CONNECT, connectRelay(hung))
    const dialed = dials(hung)
    await within(AT_ONCE, connectRelay(hung))
    expect(dials(hung)).toBe(dialed)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await within(CONNECT, connectRelay(hung))
    expect(dials(hung)).toBe(dialed + 1)
  })

  it('is asked again when the device comes back online: what timed out may have been the device', async () => {
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('window', { addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn) }, removeEventListener: () => {} })
    const stop = watchConnectivity()
    const hung = 'wss://accepts.online.example'
    await within(CONNECT, connectRelay(hung))
    const dialed = dials(hung)
    listeners.get('online')?.()
    await within(CONNECT, connectRelay(hung))
    expect(dials(hung)).toBe(dialed + 1)
    stop()
  })

  it('never leaves the canonical relay alone: a publish there is bounded, and the next one still dials it', async () => {
    const Fake = globalThis.WebSocket as unknown as new (u: string) => object
    vi.stubGlobal('WebSocket', Object.assign(class extends Fake {
      constructor(url: string) { super(url.startsWith(CYBERSPACE_RELAY) ? `wss://accepts.canonical.example?${url}` : url) }
    }, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }))
    const first = await within(30_000, publishMany([CYBERSPACE_RELAY], event()))
    expect(first.settled).toBe(true)
    expect(first.value?.ok).toBe(false)
    const dialed = dials('wss://accepts.canonical.example')
    expect(dialed).toBeGreaterThan(0)
    await within(30_000, publishMany([CYBERSPACE_RELAY], event()))
    expect(dials('wss://accepts.canonical.example')).toBeGreaterThan(dialed)
  })
})

describe('a relay that opens and then says nothing', () => {
  beforeEach(() => { vi.useFakeTimers(); net.opened.length = 0 })
  afterEach(() => { vi.useRealTimers() })

  it('costs a publish its one timeout, and the next publish nothing', async () => {
    const silent = 'wss://silent.publish.example'
    const first = await within(5000, publishMany([MINE, silent], event()))
    expect(first.value).toEqual({ ok: true, accepted: [`${MINE}/`] })
    expect((await within(AT_ONCE, publishMany([MINE, silent], event()))).settled).toBe(true)
  })

  it('costs a full-length read its deadline, and the next read nothing', async () => {
    const silent = 'wss://silent.read.example'
    expect((await within(9000, queryEachAt([MINE, silent], FILTER))).settled).toBe(true)
    expect((await within(AT_ONCE, queryEachAt([MINE, silent], FILTER))).settled).toBe(true)
  })

  it('is not held against it after a short question: that says nothing about the relay', async () => {
    const silent = 'wss://silent.short.example'
    await within(1000, queryEachAt([silent], FILTER, 500))
    const dialed = dials(silent)
    expect(dialed).toBe(1)
    const again = await within(1000, queryEachAt([silent], FILTER, 500))
    expect(again.value?.[0]).toMatchObject({ outcome: 'unreachable', reason: 'no answer in time' })
  })
})

describe('a slow relay', () => {
  beforeEach(() => { vi.useFakeTimers(); net.opened.length = 0 })
  afterEach(() => { vi.useRealTimers() })

  it('that connects inside the limit takes the publish and is not left alone', async () => {
    const slow = 'wss://slow.example'
    const first = await within(CONNECT, publishMany([slow], event()))
    expect(first.value).toEqual({ ok: true, accepted: [`${slow}/`] })
    expect((await within(AT_ONCE, publishMany([slow], event()))).value).toEqual({ ok: true, accepted: [`${slow}/`] })
  })
})
