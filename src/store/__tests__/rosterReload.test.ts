/**
 * rosterReload.test.ts - the Avatars list survives a reload (arkinox,
 * 2026-10-08: "never caches results").
 *
 * The list and each relay's starting point are kept in IndexedDB
 * (lib/rosterCache.ts). After a reload the kept list is painted before any
 * relay answers, the next catch-up asks only for what is newer, and a kept
 * event never replaces a newer one that arrived first.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../../lib/events'

const FAST = 'wss://fast.test/'

const relay = vi.hoisted(() => ({
  ask: null as null | ((url: string, filter: Filter, onEvent: (ev: NostrEvent) => void) => Promise<unknown>),
  asked: [] as Array<{ url: string; filter: Filter }>,
}))

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  relaySet: () => ['wss://fast.test'],
  askRelay: vi.fn((url: string, filter: Filter, onEvent: (ev: NostrEvent) => void) => {
    relay.asked.push({ url, filter })
    return relay.ask!(url, filter, onEvent)
  }),
  subscribe: vi.fn(() => () => {}),
  onResume: vi.fn(() => () => {}),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { hopTemplate, positionHex } from '../../lib/events'
import { closeRosterDb, readRoster } from '../../lib/rosterCache'
import { catchUp, flushIngest, hydrateRoster, ingest, saveNow, startRoster, stopRoster, useRoster } from '../useRoster'

const here = { x: 5n << 30n, y: 9n << 30n, z: 3n << 30n }

function hop(createdAt: number, sk: Uint8Array = generateSecretKey(), dx = 0n): NostrEvent {
  return finalizeEvent(hopTemplate({ createdAt, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(here, 0), to: { ...here, x: here.x + dx }, plane: 0, proofHash: 'c'.repeat(64) }), sk) as NostrEvent
}

/** The relay sends these and answers. */
function sends(events: NostrEvent[]): (url: string, f: Filter, onEvent: (ev: NostrEvent) => void) => Promise<unknown> {
  return async (url, _f, onEvent) => {
    for (const e of events) onEvent(e)
    return { url, outcome: 'answered', events }
  }
}

/** What a reload does to this module: everything in memory is gone, the database connection with it. */
function reload(): void {
  stopRoster()
  closeRosterDb()
}

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  closeRosterDb()
  stopRoster()
  relay.asked = []
})

afterEach(() => { reload() })

describe('after a reload', () => {
  it('paints the kept list before any relay is asked, with each relay\'s starting point', async () => {
    const sk = generateSecretKey()
    const rows = [hop(1_000, sk), hop(1_100), hop(1_234)]
    relay.ask = sends(rows)
    startRoster()
    await catchUp()
    expect(await saveNow()).toBe(true)

    reload()
    expect(useRoster.getState().list).toEqual([])
    relay.asked = []

    await hydrateRoster()
    expect(relay.asked).toEqual([])
    expect(useRoster.getState().list.map((a) => a.createdAt)).toEqual([1_234, 1_100, 1_000])
    expect(useRoster.getState().list[2].pubkey).toBe(getPublicKey(sk))
    expect(useRoster.getState().cursors[FAST]).toBe(1_234)
  })

  it('catches up from where the kept list left off, not with a full reload', async () => {
    relay.ask = sends([hop(1_500), hop(1_777)])
    startRoster()
    await catchUp()
    await saveNow()

    reload()
    relay.asked = []
    relay.ask = sends([hop(1_900)])
    startRoster()
    await catchUp()
    expect(relay.asked).toHaveLength(1)
    expect(relay.asked[0].filter.since).toBe(1_777)
    expect(useRoster.getState().list.map((a) => a.createdAt)).toEqual([1_900, 1_777, 1_500])
  })

  it('never lets a kept event replace a newer one that arrived before the read finished', async () => {
    const sk = generateSecretKey()
    relay.ask = sends([hop(1_000, sk, 1n)])
    startRoster()
    await catchUp()
    await saveNow()

    reload()
    const newer = hop(2_000, sk, 2n)
    ingest(newer)
    flushIngest()
    await hydrateRoster()
    const list = useRoster.getState().list
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(newer.id)
  })

  it('does not write over the kept list before it has been read', async () => {
    relay.ask = sends([hop(1_000), hop(1_001)])
    startRoster()
    await catchUp()
    await saveNow()

    reload()
    // A live event lands before the read: writing now would keep one row
    // in place of two.
    ingest(hop(3_000))
    flushIngest()
    expect(await saveNow()).toBe(false)
    expect((await readRoster())!.events).toHaveLength(2)
  })
})
