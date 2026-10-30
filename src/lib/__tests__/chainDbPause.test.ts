/**
 * chainDbPause.test.ts - the two saves of every action are one IndexedDB
 * write (lib/chainDb.ts writePauseMs; arkinox, 2026-10-30: each write
 * copies the whole chain on the main thread, about 55 ms at 1,300 actions,
 * and every action wrote twice, once signed and once acknowledged).
 *
 * The pause never costs a write: the page being hidden or left, a read, and
 * a test waiting for the writes each end it at once.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredChain } from '../chainDb'
import type { NostrEvent } from '../events'

const PK = 'aa'.repeat(32)
const ev = (i: number): NostrEvent => ({ id: i.toString(16).padStart(64, '0'), pubkey: PK, created_at: i, kind: 3333, tags: [], content: '', sig: '0'.repeat(128) })
const chainOf = (n: number, savedAt: number): StoredChain => ({ events: Array.from({ length: n }, (_, i) => ev(i + 1)), published: [], stats: {}, held: false, savedAt })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Every put of PK's record: the number of events it carried. */
let puts: number[] = []
let restore: () => void = () => {}

beforeEach(() => {
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  vi.resetModules()
  puts = []
  const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (v: unknown, k?: unknown) => unknown } } }).IDBObjectStore.prototype
  const put = proto.put
  proto.put = function (this: unknown, v: unknown, k?: unknown) {
    const rec = v as { key?: string; value?: { events?: unknown[] } }
    if (rec?.key === PK) puts.push(rec.value?.events?.length ?? -1)
    return put.call(this, v, k)
  }
  restore = () => { proto.put = put }
})
afterEach(() => restore())

async function chainDb(pauseMs: number): Promise<typeof import('../chainDb')> {
  const db = await import('../chainDb')
  db.setChainWritePause(pauseMs)
  return db
}

describe('the write pause', () => {
  it('two saves inside the pause are one write, of the newer chain', async () => {
    const db = await chainDb(150)
    db.writeStoredChain(PK, chainOf(10, 1))
    db.writeStoredChain(PK, chainOf(11, 2))
    await sleep(50)
    expect(puts).toEqual([])
    await sleep(300)
    expect(puts).toEqual([11])
  })

  it('the page being hidden or left ends the pause at once', async () => {
    const db = await chainDb(60_000)
    db.writeStoredChain(PK, chainOf(10, 1))
    db.flushChainWrites()
    await sleep(50)
    expect(puts).toEqual([10])
  })

  it('a read ends the pause and sees the save it was waiting on', async () => {
    const db = await chainDb(60_000)
    db.writeStoredChain(PK, chainOf(12, 5))
    const kept = await db.readStoredChain(PK)
    expect(kept && typeof kept === 'object' ? kept.events.length : kept).toBe(12)
    expect(puts).toEqual([12])
  })

  it('a save after the pause ended waits behind the write in flight, latest wins, and lands', async () => {
    const db = await chainDb(20)
    db.writeStoredChain(PK, chainOf(10, 1))
    await sleep(60)
    db.writeStoredChain(PK, chainOf(11, 2))
    db.writeStoredChain(PK, chainOf(12, 3))
    await db.chainWritesSettled()
    expect(puts.at(-1)).toBe(12)
    expect(puts).not.toContain(11)
    const kept = await db.readStoredChain(PK)
    expect(kept && typeof kept === 'object' ? kept.savedAt : kept).toBe(3)
  })

  it('a branch set aside a moment ago is listed, though its write was still in the pause', async () => {
    const db = await chainDb(60_000)
    db.setAsideStoredChain(PK, chainOf(7, 4))
    const aside = await db.setAsideChains(PK)
    expect(aside.map((c) => c.events.length)).toEqual([7])
  })
})
