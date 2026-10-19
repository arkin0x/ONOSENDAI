/**
 * tvWatching.test.ts: while the set is on it listens for pings and sends its
 * own, under a key made for it and never the viewer's, only while the tab is
 * in front; off, it stops both and forgets the count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from 'nostr-tools'

const published: NostrEvent[] = []
let onEvent: ((ev: NostrEvent) => void) | null = null
const closed = vi.fn()
vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async (ev: NostrEvent) => { published.push(ev); return { ok: true } }),
  subscribe: vi.fn((_f: unknown, cb: (ev: NostrEvent) => void) => { onEvent = cb; return closed }),
}))

import { startWatching, stopWatching, useTvWatching } from '../useTvWatching'
import { PING_EVERY_MS, WATCHING_KIND } from '../../lib/tv/watching'
import { verifyEvent } from 'nostr-tools/pure'

let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  published.length = 0
  onEvent = null
  closed.mockClear()
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
  it('pings at once and every PING_EVERY_MS, signed, under a key of its own', async () => {
    startWatching()
    await vi.advanceTimersByTimeAsync(10)
    expect(published).toHaveLength(1)
    const first = published[0]
    expect(first.kind).toBe(WATCHING_KIND)
    expect(verifyEvent(first)).toBe(true)
    expect(useTvWatching.getState().count).toBe(1)
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS)
    expect(published).toHaveLength(2)
    expect(published[1].pubkey).toBe(first.pubkey)
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
    onEvent!({ kind: WATCHING_KIND, pubkey: 'b'.repeat(64), created_at: Math.floor(Date.now() / 1000) } as NostrEvent)
    expect(useTvWatching.getState().count).toBe(2)
  })

  it('does not ping from a tab behind others, and pings as it comes back', async () => {
    hidden = true
    startWatching()
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS * 3)
    expect(published).toHaveLength(0)
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
})
