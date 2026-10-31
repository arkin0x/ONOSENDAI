/**
 * schema.test.ts - the database opens with every store and index the design
 * names, and an upgrade only ever adds: what a build going back a version
 * knows is still there.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../idb'
import { closeEventDb, withEventDb } from '../connection'
import { EVENT_DB, EVENT_DB_STORES, EVENT_DB_VERSION, OTHERS_BUDGET_BYTES } from '../schema'
import { budget } from '../store'

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('onosendai:events', () => {
  it('has every store and index the design names, with the keys it reads by', async () => {
    const names = await withEventDb(async (db) => [...db.objectStoreNames].sort())
    expect(names).toEqual(['chains', 'cursors', 'deletions', 'events', 'found', 'held', 'marks', 'meta', 'mine', 'opened', 'outbox', 'parted'])
    const indexes = await withEventDb(async (db) => [...db.transaction('events').objectStore('events').indexNames].sort())
    expect(indexes).toEqual(['byAddr', 'byAuthorKind', 'byChain', 'byKind', 'byTag', 'byUse'])
    const byAddr = await withEventDb(async (db) => db.transaction('events').objectStore('events').index('byAddr').unique)
    expect(byAddr).toBe(true)
    const byTag = await withEventDb(async (db) => db.transaction('events').objectStore('events').index('byTag').multiEntry)
    expect(byTag).toBe(true)
  })

  it('a later version adds, and keeps every row and store of this one', async () => {
    await withEventDb((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cursors', 'readwrite')
      tx.objectStore('cursors').put({ name: 'x', at: 1 })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
    closeEventDb()
    await new Promise((r) => setTimeout(r, 0))
    const later = await openDatabase(EVENT_DB, EVENT_DB_VERSION + 1, [...EVENT_DB_STORES, ['added', 'key']])
    expect([...later.objectStoreNames]).toContain('added')
    const row = await new Promise((resolve) => {
      const req = later.transaction('cursors').objectStore('cursors').get('x')
      req.onsuccess = () => resolve(req.result)
    })
    expect(row).toEqual({ name: 'x', at: 1 })
    later.close()
  })

  it('a connection a newer build asks to upgrade steps aside instead of blocking it', async () => {
    await withEventDb(async () => {})
    const later = await openDatabase(EVENT_DB, EVENT_DB_VERSION + 1, EVENT_DB_STORES)
    expect(later.version).toBe(EVENT_DB_VERSION + 1)
    later.close()
  })

  it('a tab left open through an upgrade keeps working: it opens the database at the version it now has', async () => {
    await withEventDb(budget)
    const later = await openDatabase(EVENT_DB, EVENT_DB_VERSION + 1, [...EVENT_DB_STORES, ['added', 'key']])
    later.close()
    await expect(withEventDb(budget)).resolves.toBeDefined()
    expect(await withEventDb(async (db) => db.version)).toBe(EVENT_DB_VERSION + 1)
  })

  it('a build taken back a version keeps working, and leaves the newer stores alone', async () => {
    const later = await openDatabase(EVENT_DB, EVENT_DB_VERSION + 1, [...EVENT_DB_STORES, ['added', 'key']])
    later.close()
    closeEventDb()
    await expect(withEventDb(budget)).resolves.toBeDefined()
    expect(await withEventDb(async (db) => [...db.objectStoreNames])).toContain('added')
  })

  it('a database gone between the VersionError and the reopen is not left empty: the next try opens it whole', async () => {
    const later = await openDatabase(EVENT_DB, EVENT_DB_VERSION + 1, EVENT_DB_STORES)
    later.close()
    closeEventDb()
    const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB
    const realOpen = factory.open.bind(factory)
    const open = vi.spyOn(factory, 'open').mockImplementation((name: string, version?: number) => {
      // The other tab deletes it just as this tab reopens with no version.
      if (version === undefined) factory.deleteDatabase(name)
      return realOpen(name, version)
    })
    try {
      await expect(withEventDb(budget)).resolves.toBeDefined()
    } finally { open.mockRestore() }
    expect(await withEventDb(async (db) => db.objectStoreNames.contains('events'))).toBe(true)
    await expect(withEventDb(budget)).resolves.toBeDefined()
  })

  it('an open that fails any other way does not reopen with no version: it fails', async () => {
    const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB
    const open = vi.spyOn(factory, 'open').mockImplementation(() => { throw new DOMException('A mutation operation was attempted', 'InvalidStateError') })
    try {
      await expect(withEventDb(budget)).rejects.toMatchObject({ name: 'InvalidStateError' })
      expect(open.mock.calls.every((c) => c[1] !== undefined)).toBe(true)
    } finally { open.mockRestore() }
  })

  it('a connection the browser closes is forgotten: the next call opens a fresh one', async () => {
    const first = await withEventDb(async (db) => db)
    first.onclose?.(new Event('close'))
    const second = await withEventDb(async (db) => db)
    expect(second).not.toBe(first)
  })

  it('two branches set aside in one millisecond are two branches', async () => {
    await withEventDb((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('parted', 'readwrite')
      tx.objectStore('parted').put({ pubkey: 'p', at: 5, headId: 'one' })
      tx.objectStore('parted').put({ pubkey: 'p', at: 5, headId: 'two' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
    const n = await withEventDb((db) => new Promise<number>((resolve) => { const r = db.transaction('parted').objectStore('parted').count(); r.onsuccess = () => resolve(r.result) }))
    expect(n).toBe(2)
  })

  it('a dead connection is replaced: the call that met it runs once more on a fresh one', async () => {
    const seen: IDBDatabase[] = []
    const value = await withEventDb(async (db) => {
      seen.push(db)
      if (seen.length === 1) throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
      return 'answered'
    })
    expect(value).toBe('answered')
    expect(seen).toHaveLength(2)
    expect(seen[1]).not.toBe(seen[0])
  })

  it('a full disk is not tried again: it would only be full again', async () => {
    let runs = 0
    await expect(withEventDb(async () => { runs++; throw new DOMException('full', 'QuotaExceededError') })).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(runs).toBe(1)
  })

  it('the budget for other people\'s events is the ruled 100 MB', () => {
    expect(OTHERS_BUDGET_BYTES).toBe(100 * 1024 * 1024)
  })
})
