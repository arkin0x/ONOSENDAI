/**
 * relayHang.test.ts - a relay that accepts and then hangs costs a bounded wait,
 * and never hides a newer move. This is relay.ts and chains.ts over the real
 * nostr-tools pool, on a fake clock, with fake sockets.
 *
 * What would go wrong silently: nostr-tools sets no timer on a connect without
 * a timeout, and every caller on a socket shares the first caller's connect, so
 * one untimed connect took the time limit from all of them. And the cure can be
 * worse than that: a relay left alone after one missed OK misses every event
 * while the publish reports ok, and a head confirmed without a relay that came
 * back holding another device's newer move signs a fork.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const sockets: { url: string; closes: number }[] = []
  const events: { url: string; id: string }[] = []
  const rules = {
    /** The handshake never finishes. */
    neverOpen: new Set<string>(),
    /** How long the handshake takes. */
    connectMs: new Map<string, number>(),
    /** Takes EVENTs and REQs and answers neither. */
    silent: new Set<string>(),
    /** Takes EVENTs and answers no OK; reads are fine. */
    noOk: new Set<string>(),
    /** Sends a challenge, and answers its AUTH. The canonical relay gates reads, so it always does. */
    challenge: new Set<string>(['wss://cyberspace.nostr1.com/']),
    hold: new Map<string, { kind: number; pubkey: string; id: string; created_at: number; tags: string[][] }[]>(),
  }
  const match = (f: Record<string, unknown>, e: { kind: number; pubkey: string; id: string; created_at: number; tags: string[][] }): boolean => {
    if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
    if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
    if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false
    if (typeof f.since === 'number' && e.created_at < f.since) return false
    for (const [k, v] of Object.entries(f)) if (k.startsWith('#') && !e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]))) return false
    return true
  }
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    record: { url: string; closes: number }
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      this.record = { url: this.url, closes: 0 }
      sockets.push(this.record)
      if (rules.neverOpen.has(this.url)) return
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.()
        if (rules.challenge.has(this.url)) this.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) })
      }, rules.connectMs.get(this.url) ?? 0)
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      if (msg[0] === 'EVENT') events.push({ url: this.url, id: (msg[1] as { id: string }).id })
      if (rules.silent.has(this.url)) return
      setTimeout(() => {
        if (msg[0] === 'REQ') {
          for (const f of msg.slice(2) as Record<string, unknown>[]) {
            for (const e of rules.hold.get(this.url) ?? []) if (match(f, e)) this.onmessage?.({ data: JSON.stringify(['EVENT', msg[1], e]) })
          }
          this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) })
        }
        if (msg[0] === 'AUTH') this.onmessage?.({ data: JSON.stringify(['OK', (msg[1] as { id: string }).id, true, '']) })
        if (msg[0] === 'EVENT' && !rules.noOk.has(this.url)) this.onmessage?.({ data: JSON.stringify(['OK', (msg[1] as { id: string }).id, true, '']) })
      }, 0)
    }
    close(): void { this.record.closes++; this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return { sockets, events, rules }
})
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: { getState: () => ({ signEvent: async (t: Record<string, unknown>) => ({ ...t, id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }) }) },
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { useRelays } from '../../store/useRelays'
import { confirmChainEvents, fetchChainEvents, HEAD_CONFIRM_MS } from '../chains'
import { noteChainHolders } from '../chainHolders'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../events'
import { connectRelay, CYBERSPACE_RELAY, dropRelays, publishMany, queryAny, queryEachAt, subscribeOne, watchConnectivity } from '../relay'

const CANON = `${CYBERSPACE_RELAY}/`
const MINE = 'wss://mine.example/'
const FILTER = { kinds: [0], limit: 1 }
/** The 5 s connect limit, and room for what follows it on a fake clock. */
const CONNECT = 5500
/** A publish's first try at a hung relay: AUTH's connect (5 s), then the publish's own (7 s). */
const FIRST_PUBLISH = 12_500
/** A read's first try: AUTH's connect (5 s), then the read's own (8 s). */
const FIRST_READ = 13_500
/** An OK that never comes: nostr-tools gives up on a publish at 4.4 s, after up to 0.4 s waiting for a challenge. */
const NO_OK = 5000
const AT_ONCE = 200
const anEvent = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_000, tags: [], content: '' }, generateSecretKey()) as unknown as NostrEvent
const dials = (url: string): number => net.sockets.filter((s) => s.url === url).length
const sent = (url: string): number => net.events.filter((e) => e.url === url).length

/** Run the clock for `ms`, and say what `p` settled to in that time. */
async function within<T>(ms: number, p: Promise<T>): Promise<{ settled: boolean; value?: T }> {
  const seen: { settled: boolean; value?: T } = { settled: false }
  void p.then((value) => { seen.settled = true; seen.value = value })
  await vi.advanceTimersByTimeAsync(ms)
  return seen
}

/** A spawn and two hops, the second being the newer move another device made. */
function aChain(): { pubkey: string; spawn: NostrEvent; hop1: NostrEvent; hop2: NostrEvent } {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent
  const spawn = sign(spawnTemplate(pubkey, 1_000))
  const hop = (n: number, previous: NostrEvent): NostrEvent => sign(hopTemplate({ createdAt: 1_000 + n * 10, genesisId: spawn.id, previousId: previous.id, prevCoordHex: pubkey, to: { x: BigInt(n), y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00' } as never))
  const hop1 = hop(1, spawn)
  return { pubkey, spawn, hop1, hop2: hop(2, hop1) }
}

/** Two missed OKs in a row: the relay is left alone by publishing now. */
async function hangPublishes(url: string): Promise<void> {
  net.rules.noOk.add(url)
  for (let i = 0; i < 2; i++) await within(NO_OK, publishMany([CANON, url], anEvent()))
  net.rules.noOk.delete(url)
  const before = sent(url)
  await within(AT_ONCE, publishMany([CANON, url], anEvent()))
  expect(sent(url)).toBe(before)
}

beforeEach(() => {
  vi.useFakeTimers()
  net.sockets.length = 0
  net.events.length = 0
  net.rules.hold.clear()
  useRelays.getState().reset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('head confirmation and a relay that hung', () => {
  it('finds another device\'s newer move on a holder that hung and came back, so the move is refused, not forked', async () => {
    const mine = 'wss://mine.fork.example/'
    const c = aChain()
    useRelays.getState().add(mine)
    noteChainHolders(c.pubkey, [mine])
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.rules.hold.set(mine, [c.spawn, c.hop1, c.hop2])
    await hangPublishes(mine)
    const got = await within(HEAD_CONFIRM_MS, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }))
    expect(got.settled).toBe(true)
    expect(got.value?.map((e) => e.id)).toContain(c.hop2.id)
    // It answered, so publishing goes back to it too.
    const before = sent(mine)
    await within(AT_ONCE, publishMany([CANON, mine], anEvent()))
    expect(sent(mine)).toBe(before + 1)
  })

  it('a chain fetch asks a relay that hung, too', async () => {
    const mine = 'wss://mine.fetch.example/'
    const c = aChain()
    useRelays.getState().add(mine)
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.rules.hold.set(mine, [c.spawn, c.hop1, c.hop2])
    await hangPublishes(mine)
    const got = await within(AT_ONCE, fetchChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1]))
    expect(got.value?.map((e) => e.id)).toContain(c.hop2.id)
  })

  it('a holder that stays hung costs a move at most the 2.5 s of the owner\'s ruling, every move', async () => {
    const hung = 'wss://accepts.holder.example/'
    const c = aChain()
    net.rules.neverOpen.add(hung)
    useRelays.getState().add(hung)
    noteChainHolders(c.pubkey, [hung])
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    for (let move = 0; move < 3; move++) {
      const got = await within(HEAD_CONFIRM_MS + 50, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }))
      expect(got.settled, `move ${move}`).toBe(true)
      expect(got.value).not.toBeNull()
    }
  })
})

describe('a relay that accepts and never finishes the handshake', () => {
  it('costs a publish one bounded wait, then nothing, and the other relays still count', async () => {
    const hung = 'wss://accepts.publish.example/'
    net.rules.neverOpen.add(hung)
    const first = await within(FIRST_PUBLISH, publishMany([MINE, hung], anEvent()))
    expect(first.settled).toBe(true)
    expect(first.value).toEqual({ ok: true, accepted: [MINE] })
    const dialed = dials(hung)
    const next = await within(AT_ONCE, publishMany([MINE, hung], anEvent()))
    expect(next.value).toEqual({ ok: true, accepted: [MINE] })
    expect(dials(hung)).toBe(dialed)
  })

  it('costs a read one bounded wait, then nothing, and the other relays still answer', async () => {
    const hung = 'wss://accepts.read.example/'
    net.rules.neverOpen.add(hung)
    const first = await within(FIRST_READ, queryEachAt([MINE, hung], FILTER))
    expect(first.settled).toBe(true)
    expect(first.value?.find((a) => a.url === MINE)?.outcome).toBe('answered')
    expect(first.value?.find((a) => a.url === hung)?.outcome).toBe('unreachable')
    expect((await within(AT_ONCE, queryEachAt([MINE, hung], FILTER))).settled).toBe(true)
  })

  it('does not stall the other ways in: queryAny, connectRelay, subscribeOne', async () => {
    for (const url of ['wss://accepts.any.example/', 'wss://accepts.connect.example/', 'wss://accepts.sub.example/']) net.rules.neverOpen.add(url)
    expect((await within(CONNECT, queryAny(['wss://accepts.any.example/'], FILTER))).value).toEqual([])
    expect((await within(CONNECT, connectRelay('wss://accepts.connect.example/'))).value).toBe(false)
    const closed = new Promise<string | undefined>((resolve) => {
      subscribeOne('wss://accepts.sub.example/', FILTER, { onevent: () => {}, oneose: () => {}, onclose: resolve })
    })
    expect((await within(CONNECT, closed)).value).toBe('unreachable')
  })

  it('has its socket closed when the connect times out: nostr-tools only detaches from it', async () => {
    const hung = 'wss://accepts.leak.example/'
    net.rules.neverOpen.add(hung)
    expect((await within(CONNECT, connectRelay(hung))).value).toBe(false)
    expect(net.sockets.filter((s) => s.url === hung).map((s) => s.closes)).toEqual([1])
  })

  it('is asked again once its time away is over', async () => {
    const hung = 'wss://accepts.again.example/'
    net.rules.neverOpen.add(hung)
    await within(FIRST_PUBLISH, publishMany([MINE, hung], anEvent()))
    const dialed = dials(hung)
    await within(AT_ONCE, publishMany([MINE, hung], anEvent()))
    expect(dials(hung)).toBe(dialed)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await within(FIRST_PUBLISH, publishMany([MINE, hung], anEvent()))
    expect(dials(hung)).toBeGreaterThan(dialed)
  })

  it('is asked again when the device comes back online: what timed out may have been the device', async () => {
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('window', { addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn) }, removeEventListener: () => {} })
    const stop = watchConnectivity()
    const hung = 'wss://accepts.online.example/'
    net.rules.neverOpen.add(hung)
    await within(FIRST_PUBLISH, publishMany([MINE, hung], anEvent()))
    const dialed = dials(hung)
    listeners.get('online')?.()
    await within(FIRST_PUBLISH, publishMany([MINE, hung], anEvent()))
    expect(dials(hung)).toBeGreaterThan(dialed)
    stop()
  })
})

describe('the canonical relay', () => {
  afterEach(() => { net.rules.neverOpen.delete(CANON); net.rules.connectMs.delete(CANON); dropRelays([CANON]) })

  it('is never left alone: a publish there is bounded, and the next one still dials it', async () => {
    dropRelays([CANON])
    net.rules.neverOpen.add(CANON)
    const first = await within(40_000, publishMany([CANON], anEvent()))
    expect(first.settled).toBe(true)
    expect(first.value?.ok).toBe(false)
    const dialed = dials(CANON)
    expect(dialed).toBeGreaterThan(0)
    await within(40_000, publishMany([CANON], anEvent()))
    expect(dials(CANON)).toBeGreaterThan(dialed)
  })

  it('may take 6 s to connect: a publish lands, and head confirmation passes rather than refusing', async () => {
    dropRelays([CANON])
    net.rules.connectMs.set(CANON, 6000)
    expect((await within(6500, publishMany([CANON], anEvent()))).value).toEqual({ ok: true, accepted: [CANON] })
    dropRelays([CANON])
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    const got = await within(6500, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }))
    expect(got.settled).toBe(true)
    expect(got.value).not.toBeNull()
  })
})

describe('a slow relay is not a hung one', () => {
  it('one missed OK leaves it in: the next publish is still sent to it', async () => {
    const slow = 'wss://slow.ok.example/'
    net.rules.noOk.add(slow)
    await within(NO_OK, publishMany([CANON, slow], anEvent()))
    net.rules.noOk.delete(slow)
    const before = sent(slow)
    const next = await within(AT_ONCE, publishMany([CANON, slow], anEvent()))
    expect(sent(slow)).toBe(before + 1)
    expect(next.value).toEqual({ ok: true, accepted: [CANON, slow] })
  })

  it('an OK between two missed ones starts the count again', async () => {
    const slow = 'wss://slow.between.example/'
    net.rules.noOk.add(slow)
    await within(NO_OK, publishMany([CANON, slow], anEvent()))
    net.rules.noOk.delete(slow)
    await within(AT_ONCE, publishMany([CANON, slow], anEvent()))
    net.rules.noOk.add(slow)
    await within(NO_OK, publishMany([CANON, slow], anEvent()))
    net.rules.noOk.delete(slow)
    const before = sent(slow)
    await within(AT_ONCE, publishMany([CANON, slow], anEvent()))
    expect(sent(slow)).toBe(before + 1)
  })

  it('that connects in 6 s still takes the publish and is not left alone', async () => {
    const slow = 'wss://slow.connect.example/'
    net.rules.connectMs.set(slow, 6000)
    const first = await within(FIRST_PUBLISH, publishMany([slow], anEvent()))
    expect(first.value).toEqual({ ok: true, accepted: [slow] })
    // AT_ONCE would do, but for this socket's first wait for a challenge (0.4 s).
    expect((await within(1000, publishMany([slow], anEvent()))).value).toEqual({ ok: true, accepted: [slow] })
  })
})

describe('a relay that opens and then says nothing', () => {
  it('costs two publishes their timeouts, and the next publish nothing', async () => {
    const silent = 'wss://silent.publish.example/'
    net.rules.silent.add(silent)
    for (let i = 0; i < 2; i++) expect((await within(NO_OK, publishMany([MINE, silent], anEvent()))).value).toEqual({ ok: true, accepted: [MINE] })
    expect((await within(AT_ONCE, publishMany([MINE, silent], anEvent()))).settled).toBe(true)
  })

  it('costs two full-length reads their deadlines, and the next read nothing', async () => {
    const silent = 'wss://silent.read.example/'
    net.rules.silent.add(silent)
    for (let i = 0; i < 2; i++) expect((await within(9000, queryEachAt([MINE, silent], FILTER))).settled).toBe(true)
    expect((await within(AT_ONCE, queryEachAt([MINE, silent], FILTER))).settled).toBe(true)
  })

  it('is not held against it after short questions: they say nothing about the relay', async () => {
    const silent = 'wss://silent.short.example/'
    net.rules.silent.add(silent)
    for (let i = 0; i < 3; i++) {
      const again = await within(1000, queryEachAt([silent], FILTER, 500))
      expect(again.value?.[0]).toMatchObject({ outcome: 'unreachable', reason: 'no answer in time' })
    }
  })
})
