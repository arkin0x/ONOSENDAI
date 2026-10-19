/**
 * tvWatching.test.ts: while the set is on it listens for pings and sends its
 * own, under a key made for it and never the viewer's, only while the tab is
 * in front; off, it stops both and forgets the count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from 'nostr-tools'

const published: NostrEvent[] = []
/** Each subscription's handler, oldest first. */
const handlers: Array<(ev: NostrEvent) => void> = []
const filters: unknown[] = []
const closed = vi.fn()
/** A publish held until released, for the races. */
let holdPublish: Promise<void> | null = null
vi.mock('../../lib/relay', () => ({
  publishLight: vi.fn(async (ev: NostrEvent) => { if (holdPublish) await holdPublish; published.push(ev); return true }),
  // The heavy path a ping must never take.
  publish: vi.fn(async () => { throw new Error('a ping went through publish()') }),
  subscribe: vi.fn((f: unknown, cb: (ev: NostrEvent) => void) => { filters.push(f); handlers.push(cb); return closed }),
}))
// The viewer's identity: its signer must never be asked for a ping.
const identitySign = vi.fn()
const IDENTITY = 'f'.repeat(64)
vi.mock('../useCyberspace', () => ({
  useCyberspace: { getState: () => ({ pubkey: IDENTITY, signEvent: identitySign }) },
}))

import { startWatching, stopWatching, useTvWatching } from '../useTvWatching'
import { PING_EVERY_MS, WATCHING_KIND } from '../../lib/tv/watching'
import { verifyEvent } from 'nostr-tools/pure'

let hidden = false
const ping = (pubkey: string): NostrEvent => ({ kind: WATCHING_KIND, pubkey, created_at: Math.floor(Date.now() / 1000), tags: [['t', 'cyberspace-tv']] } as NostrEvent)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  published.length = 0
  handlers.length = 0
  filters.length = 0
  closed.mockClear()
  identitySign.mockClear()
  holdPublish = null
  hidden = false
  // No DOM here: a document that is only an event target with a visibility.
  const doc = new EventTarget()
  Object.defineProperty(doc, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') })
  vi.stubGlobal('document', doc)
})
afterEach(() => {
  stopWatching()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the watching count', () => {
  it('pings at once and every PING_EVERY_MS, signed, under a key of its own and never the viewer\'s', async () => {
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(1)
    const first = published[0]
    expect(first.kind).toBe(WATCHING_KIND)
    expect(verifyEvent(first)).toBe(true)
    expect(first.pubkey).not.toBe(IDENTITY)
    expect(useTvWatching.getState().count).toBe(1)
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS)
    expect(published).toHaveLength(2)
    expect(published[1].pubkey).toBe(first.pubkey)
    expect(identitySign).not.toHaveBeenCalled()
  })

  it('listens for the TV\'s pings only, by kind and tag', () => {
    startWatching()
    expect(filters[0]).toMatchObject({ kinds: [WATCHING_KIND], '#t': ['cyberspace-tv'] })
  })

  it('makes a new key each time the set comes on', async () => {
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    stopWatching()
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(2)
    expect(published[0].pubkey).not.toBe(published[1].pubkey)
  })

  it('counts the others it hears', async () => {
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    handlers[0](ping('b'.repeat(64)))
    expect(useTvWatching.getState().count).toBe(2)
  })

  it('does not ping from a tab behind others, pings as it comes back, and not again on a quick alt-tab', async () => {
    hidden = true
    startWatching()
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS * 3)
    expect(published).toHaveLength(0)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(1)
    // Away and back within a few seconds: no second ping.
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(3_000)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(1)
  })

  it('off: stops listening and pinging, and the count is gone', async () => {
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    stopWatching()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(useTvWatching.getState().count).toBe(0)
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS * 3)
    expect(published).toHaveLength(1)
  })

  it('a ping still on its way when the set goes off and on again does not count for the new one', async () => {
    let release!: () => void
    holdPublish = new Promise((go) => { release = go })
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    stopWatching()
    holdPublish = null
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(1)
    const mine = published[0].pubkey
    release()
    await vi.advanceTimersByTimeAsync(10)
    // The old set's ping lands late, from the old subscription: nothing counts it.
    const late = published.find((e) => e.pubkey !== mine)
    expect(late).toBeDefined()
    handlers[0](late!)
    expect(useTvWatching.getState().count).toBe(1)
    // The new subscription hearing it counts it as someone else, which it is.
    handlers[1](late!)
    expect(useTvWatching.getState().count).toBe(2)
  })
})
