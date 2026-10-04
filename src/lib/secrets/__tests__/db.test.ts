/**
 * db.test.ts: the one-time copy of the localStorage keys into IndexedDB.
 *
 * What has to hold (arkinox, 2026-10-03): every key in localStorage arrives
 * in the database; the localStorage entry is left exactly as it was, since a
 * later release removes it and nothing here deletes; and the copy happens
 * once, marked in a meta record, so a key forgotten later is not copied back.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAllPaged, getMeta } from '../../idb'
import { KEYS_STORE, LEGACY_KEY, MIGRATED_META, migrateFromLocalStorage, openSecretsDb, parseLegacy } from '../db'
import type { HeldKey } from '../../../store/useSecrets'

const key = (id: string, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: id.repeat(32),
  keyHex: 'bb'.repeat(32),
  height: 8,
  base: { x: '256', y: '512', z: '768' },
  plane: 0,
  source: 'scan',
  at: 1_800_000_000,
  ...over,
})

/** A localStorage that records every write, so "untouched" can be checked, not assumed. */
function storage(initial: Record<string, string>): Storage & { writes: string[] } {
  const mem = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    writes,
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); mem.set(k, String(v)) },
    removeItem: (k: string) => { writes.push(k); mem.delete(k) },
    clear: () => { writes.push('*'); mem.clear() },
  }
}

async function rows(db: IDBDatabase): Promise<HeldKey[]> {
  const out: HeldKey[] = []
  await getAllPaged<HeldKey>(db, KEYS_STORE, 100, (r) => r.lookupId, (r) => { out.push(...r) })
  return out
}

beforeEach(() => {
  // A fresh browser profile for every test: no databases at all.
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

describe('copying the localStorage keys into IndexedDB', () => {
  it('copies every key and leaves the localStorage entry exactly as it was', async () => {
    const legacy = { ['aa'.repeat(32)]: key('aa'), ['cc'.repeat(32)]: key('cc', { source: 'cloud', height: 20 }) }
    const raw = JSON.stringify(legacy)
    const ls = storage({ [LEGACY_KEY]: raw })
    const db = await openSecretsDb()

    expect(await migrateFromLocalStorage(db, ls)).toBe(2)

    const copied = await rows(db)
    expect(copied.map((k) => k.lookupId).sort()).toEqual(Object.keys(legacy).sort())
    expect(copied.find((k) => k.source === 'cloud')?.height).toBe(20)
    // Untouched: the same string, and not one write or delete against storage.
    expect(ls.getItem(LEGACY_KEY)).toBe(raw)
    expect(ls.writes).toEqual([])
  })

  it('runs once: the second load reads nothing and copies nothing', async () => {
    const ls = storage({ [LEGACY_KEY]: JSON.stringify({ ['aa'.repeat(32)]: key('aa') }) })
    const db = await openSecretsDb()
    expect(await migrateFromLocalStorage(db, ls)).toBe(1)
    expect(await getMeta(db, MIGRATED_META)).toMatchObject({ copied: 1 })

    // A key that turns up in localStorage afterwards is not copied: the copy
    // is done, and a key forgotten in IndexedDB must not come back from here.
    ls.setItem(LEGACY_KEY, JSON.stringify({ ['aa'.repeat(32)]: key('aa'), ['dd'.repeat(32)]: key('dd') }))
    expect(await migrateFromLocalStorage(db, ls)).toBeNull()
    expect((await rows(db)).map((k) => k.lookupId)).toEqual(['aa'.repeat(32)])
  })

  it('keeps a key IndexedDB already holds rather than overwriting it', async () => {
    const db = await openSecretsDb()
    const tx = db.transaction(KEYS_STORE, 'readwrite')
    tx.objectStore(KEYS_STORE).put(key('aa', { at: 1_700_000_000 }))
    await new Promise((r) => { tx.oncomplete = r })

    await migrateFromLocalStorage(db, storage({ [LEGACY_KEY]: JSON.stringify({ ['aa'.repeat(32)]: key('aa', { at: 1_800_000_000 }) }) }))
    expect((await rows(db))[0].at).toBe(1_700_000_000)
  })

  it('marks the copy done when there was nothing to copy, and survives storage that throws', async () => {
    const db = await openSecretsDb()
    const throwing = { getItem: () => { throw new Error('SecurityError') } }
    expect(await migrateFromLocalStorage(db, throwing)).toBe(0)
    expect(await migrateFromLocalStorage(db, null)).toBeNull()
  })
})

describe('reading the legacy string', () => {
  it('skips rows that are not keys and keeps the rest', () => {
    const raw = JSON.stringify({ ['aa'.repeat(32)]: key('aa'), bad: { keyHex: 1 }, nul: null })
    expect(Object.keys(parseLegacy(raw))).toEqual(['aa'.repeat(32)])
  })

  it('takes the map key as the lookup id for a row that lacks one', () => {
    const { lookupId: _, ...rest } = key('ee')
    expect(parseLegacy(JSON.stringify({ ['ee'.repeat(32)]: rest }))['ee'.repeat(32)].lookupId).toBe('ee'.repeat(32))
  })

  it('is empty for nothing and for garbage', () => {
    expect(parseLegacy(null)).toEqual({})
    expect(parseLegacy('{not json')).toEqual({})
  })
})
