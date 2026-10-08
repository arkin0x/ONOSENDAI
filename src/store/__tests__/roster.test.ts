/**
 * roster.test.ts - the Avatars list kept in a store (arkinox, 2026-10-08:
 * "takes a long time to load and never caches results. Closing the menu
 * should not empty it. It should keep and update as new events become
 * available").
 *
 * - The newest action per pubkey wins, and an older one never replaces it,
 *   whichever arrives first.
 * - A live event updates the list.
 * - A catch-up asks each relay from the newest created_at that relay sent,
 *   inclusive, and a relay that never answered for the newest CATCHUP_LIMIT.
 * - A slow relay does not hold back the rows a fast one sent.
 * - The list is capped at ROSTER_KEPT, the least recently active dropped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import type { RelayAnswer } from '../../lib/relayOutcome'
import type { NostrEvent } from '../../lib/events'

const FAST = 'wss://fast.test/'
const SLOW = 'wss://slow.test/'

/** What each test makes a relay do when it is asked. */
type Asker = (url: string, filter: Filter, onEvent: (ev: NostrEvent) => void) => Promise<RelayAnswer>
const relay = vi.hoisted(() => ({
  ask: null as null | ((url: string, filter: Filter, onEvent: (ev: NostrEvent) => void) => Promise<unknown>),
  asked: [] as Array<{ url: string; filter: Filter }>,
  live: [] as Array<{ filter: Filter; onEvent: (ev: NostrEvent) => void; closed: boolean }>,
  resume: [] as Array<() => void>,
}))

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  relaySet: () => ['wss://fast.test', 'wss://slow.test'],
  askRelay: vi.fn((url: string, filter: Filter, onEvent: (ev: NostrEvent) => void) => {
    relay.asked.push({ url, filter })
    return relay.ask!(url, filter, onEvent)
  }),
  subscribe: vi.fn((filter: Filter, onEvent: (ev: NostrEvent) => void) => {
    const rec = { filter, onEvent, closed: false }
    relay.live.push(rec)
    return () => { rec.closed = true }
  }),
  onResume: vi.fn((fn: () => void) => { relay.resume.push(fn); return () => {} }),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { hopTemplate, positionHex } from '../../lib/events'
import {
  CATCHUP_LIMIT, ROSTER_KEPT, catchUp, catchUpFilter, cursorFor, flushIngest, foldRoster, ingest, startRoster, stopRoster, useRoster,
} from '../useRoster'

const SECTOR = 1n << 30n
const here = { x: 5n * SECTOR + 7n, y: 9n * SECTOR + 1n, z: 3n * SECTOR + 2n }

/** A hop by `sk` at `createdAt`: the smallest placing action the parser accepts. */
function hop(createdAt: number, sk: Uint8Array = generateSecretKey(), dx = 0n): NostrEvent {
  return finalizeEvent(hopTemplate({ createdAt, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(here, 0), to: { ...here, x: here.x + dx }, plane: 0, proofHash: 'c'.repeat(64) }), sk) as NostrEvent
}

const answered = (url: string, events: NostrEvent[]): RelayAnswer => ({ url, outcome: 'answered', events })

/** A relay that sends `events` one at a time and then answers. */
function sends(events: NostrEvent[]): Asker {
  return async (url, _f, onEvent) => {
    for (const e of events) onEvent(e)
    return answered(url, events)
  }
}

beforeEach(() => {
  stopRoster()
  relay.asked = []
  relay.live = []
  relay.resume = []
  relay.ask = null
})

afterEach(() => { stopRoster() })

describe('which action a pubkey shows', () => {
  it('keeps the newest per pubkey, and an older one arriving later never replaces it', () => {
    const sk = generateSecretKey()
    const newer = hop(200, sk, 1n)
    const older = hop(100, sk, 2n)
    const first = foldRoster({}, [], [newer])!
    expect(foldRoster(first.events, first.list, [older])).toBeNull()
    const both = foldRoster({}, [], [older, newer])!
    expect(both.list).toHaveLength(1)
    expect(both.list[0].id).toBe(newer.id)
    expect(both.events[getPublicKey(sk)].id).toBe(newer.id)
  })

  it('breaks a same-second tie the way the panel always did (larger id), whatever the order of arrival', () => {
    // Actions are regular events, not replaceable ones, so NIP-01's lowest-id
    // rule does not apply to them; the panel's own order is kept.
    const sk = generateSecretKey()
    const a = hop(300, sk, 1n)
    const b = hop(300, sk, 2n)
    const larger = a.id > b.id ? a : b
    expect(foldRoster({}, [], [a, b])!.list[0].id).toBe(larger.id)
    expect(foldRoster({}, [], [b, a])!.list[0].id).toBe(larger.id)
  })

  it('lists newest first and drops what is not a placing action', () => {
    const late = hop(500)
    const early = hop(400)
    const junk = { ...hop(600), kind: 1 } as NostrEvent
    const out = foldRoster({}, [], [early, junk, late])!
    expect(out.list.map((a) => a.id)).toEqual([late.id, early.id])
  })

  it('keeps at most ROSTER_KEPT pubkeys, letting the least recently active go', () => {
    const events = Array.from({ length: ROSTER_KEPT + 3 }, (_, i) => hop(1_000 + i))
    const out = foldRoster({}, [], events)!
    expect(out.list).toHaveLength(ROSTER_KEPT)
    expect(Object.keys(out.events)).toHaveLength(ROSTER_KEPT)
    expect(out.list.at(-1)!.createdAt).toBe(1_003)
    expect(out.list.some((a) => a.createdAt < 1_003)).toBe(false)
  })
})

describe('live updates', () => {
  it('a live event puts its pubkey at the top, and a newer move of someone listed replaces their row', async () => {
    const sk = generateSecretKey()
    relay.ask = sends([hop(100, sk), hop(150)])
    startRoster()
    await catchUp()
    expect(useRoster.getState().list[0].createdAt).toBe(150)

    const feed = relay.live.find((l) => l.filter.kinds?.includes(3333))!
    expect(feed.filter['#A']).toBeDefined()
    feed.onEvent(hop(900, sk, 5n))
    flushIngest()
    const list = useRoster.getState().list
    expect(list[0].pubkey).toBe(getPublicKey(sk))
    expect(list[0].createdAt).toBe(900)
    expect(list).toHaveLength(2)
  })

  it('keeps the live feed open: nothing the panel does closes it', async () => {
    relay.ask = sends([])
    startRoster()
    startRoster()
    await catchUp()
    const feeds = relay.live.filter((l) => l.filter.kinds?.includes(3333))
    expect(feeds).toHaveLength(1)
    expect(feeds[0].closed).toBe(false)
  })
})

describe('catching up', () => {
  it('asks a relay that never answered for the newest CATCHUP_LIMIT, then from the newest created_at it sent, inclusive', async () => {
    relay.ask = async (url, _f, onEvent) => {
      const events = url === FAST ? [hop(1_000), hop(1_234)] : [hop(1_100)]
      for (const e of events) onEvent(e)
      return answered(url, events)
    }
    startRoster()
    await catchUp()
    expect(relay.asked.map((a) => a.filter.since)).toEqual([undefined, undefined])
    expect(relay.asked[0].filter.limit).toBe(CATCHUP_LIMIT)

    relay.asked = []
    relay.ask = sends([])
    await catchUp()
    const since = Object.fromEntries(relay.asked.map((a) => [a.url, a.filter.since]))
    // Inclusive: the same second is asked again, so an event of that second
    // a relay had not yet stored is not lost; the fold drops the repeat.
    expect(since).toEqual({ [FAST]: 1_234, [SLOW]: 1_100 })
  })

  it('does not move a relay\'s starting point on an answer cut off part way', async () => {
    relay.ask = async (url, _f, onEvent) => {
      if (url !== FAST) return answered(url, [])
      const e = hop(2_000)
      onEvent(e)
      return { url, outcome: 'unreachable', reason: 'no answer in time', events: [e] }
    }
    startRoster()
    await catchUp()
    expect(useRoster.getState().cursors[FAST]).toBeUndefined()
    // The events it did send still show.
    expect(useRoster.getState().list).toHaveLength(1)
  })

  it('never starts from a created_at dated beyond this clock', () => {
    const now = 1_800_000_000
    expect(cursorFor([hop(now - 10), hop(now + 3_600)] as NostrEvent[], now)).toBe(now - 10)
    expect(cursorFor([], now)).toBeUndefined()
  })

  it('catches up again after a reconnect that came while a catch-up was running', async () => {
    let release: (a: RelayAnswer) => void = () => {}
    relay.ask = (url) => (url === SLOW ? new Promise((r) => { release = r }) : Promise.resolve(answered(url, [])))
    startRoster()
    const first = catchUp()
    await new Promise((r) => setTimeout(r, 0))
    relay.resume.forEach((fn) => fn())
    relay.ask = sends([])
    release(answered(SLOW, []))
    await first
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    // Two relays asked by the first catch-up, and both again by the one the
    // reconnect asked for, which runs on its own once the first has ended.
    expect(relay.asked).toHaveLength(4)
  })

  it('sends one tag filter, within the relay\'s limit of three', () => {
    for (const f of [catchUpFilter(undefined), catchUpFilter(5)]) {
      expect(Object.keys(f).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('a slow relay', () => {
  it('does not hold back the rows a fast relay sent, and the list says it is still updating', async () => {
    let releaseSlow: (a: RelayAnswer) => void = () => {}
    const fastRows = [hop(3_000), hop(3_100), hop(3_200)]
    relay.ask = (url, _f, onEvent) => {
      if (url === SLOW) return new Promise((r) => { releaseSlow = r })
      return sends(fastRows)(url, _f, onEvent)
    }
    startRoster()
    const done = catchUp()
    // Let the fast relay's answer land; the slow one is still out.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(useRoster.getState().list.map((a) => a.createdAt)).toEqual([3_200, 3_100, 3_000])
    expect(useRoster.getState().asking).toBe(1)
    releaseSlow(answered(SLOW, []))
    await done
    expect(useRoster.getState().asking).toBe(0)
  })

  it('rows a relay sends land before that relay finishes answering', () => {
    const e = hop(4_000)
    ingest(e)
    flushIngest()
    expect(useRoster.getState().list[0].id).toBe(e.id)
  })
})
