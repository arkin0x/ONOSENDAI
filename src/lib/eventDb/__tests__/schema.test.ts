/**
 * schema.test.ts - the database opens with every store and index the design
 * names, and an upgrade only ever adds: what a build going back a version
 * knows is still there.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../idb'
import { closeEventDb, withEventDb } from '../connection'
import { EVENT_DB, EVENT_DB_STORES, EVENT_DB_VERSION, OTHERS_BUDGET_BYTES } from '../schema'

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('onosendai:events', () => {
  it('has every store and index the design names', async () => {
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

  it('the budget for other people\'s events is the ruled 100 MB', () => {
    expect(OTHERS_BUDGET_BYTES).toBe(100 * 1024 * 1024)
  })
})
