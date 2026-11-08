/**
 * closedDoorsStorage.test.ts: doors closed with CLOSE, kept in the hidden store's
 * IndexedDB (`onosendai:hidden`) beside the door secrets (review of #616: S2, S3, N1).
 *
 * A "page" is the modules fresh, as a reload leaves them, over one localStorage and
 * one database; two tabs are two pages side by side. A close is one record, so two
 * tabs never overwrite each other; another tab hears of it, and reads the database
 * again before deciding to open anything. A close the device could not keep says so.
 * Nothing caps the records: a dropped close would open a door nobody tapped.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each page loads the modules fresh: slow on a busy machine, so a page may take longer than the default.
vi.setConfig({ testTimeout: 20_000 })

const h = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { full: false, failCommit: false, failProbe: false }
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.full) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e }
      mem.set(k, String(v))
    },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
  return { mem, state }
})

vi.mock('../../lib/hiddenDb', async (orig) => {
  const real = await orig<typeof import('../../lib/hiddenDb')>()
  return {
    ...real,
    commit: (...a: Parameters<typeof real.commit>) => (h.state.failCommit ? Promise.reject(new Error('quota')) : real.commit(...a)),
    probe: (...a: Parameters<typeof real.probe>) => (h.state.failProbe ? Promise.reject(new Error('private mode')) : real.probe(...a)),
  }
})

const X = 'a1'.repeat(32)
const LOCK = 'c3'.repeat(32)
const ROOM = `${'d4'.repeat(32)}:1:3:0:0:0`
const CLOSED = 'onosendai:doors-closed'
const door = (n: number): string => n.toString(16).padStart(64, '0')
const closeRec = (id: string, over: Record<string, unknown> = {}) => ({ owner: X, doorId: id, lock: LOCK, room: ROOM, shut: true as const, below: true as const, ...over })

let last: { st: { resetHiddenForTests: () => void } } | null = null

/** A page load: the last page gone (unless a second tab), the modules fresh, the store read. */
async function page(opts: { keepLast?: boolean } = {}) {
  if (!opts.keepLast) last?.st.resetHiddenForTests()
  vi.resetModules()
  const st = await import('../hiddenStorage')
  const cd = await import('../closedDoors')
  const { useToast } = await import('../useToast')
  await st.hydrateHidden()
  const p = { st, cd, toast: (): string | undefined => useToast.getState().toast?.label }
  last = p
  return p
}

async function dbClosed(): Promise<Array<{ owner: string; doorId: string; shut?: true; below?: true }>> {
  const { openHiddenDb, readEverything } = await import('../../lib/hiddenDb')
  const d = await openHiddenDb()
  try { return (await readEverything(d)).closed } finally { d.close() }
}

beforeEach(() => {
  last?.st.resetHiddenForTests()
  last = null
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
  h.mem.clear()
  Object.assign(h.state, { full: false, failCommit: false, failProbe: false })
})

describe('kept in IndexedDB beside the door secrets (S2)', () => {
  it('a close is on disk, one record, and still closed after a reload with localStorage gone', async () => {
    const a = await page()
    expect(a.st.storageMode()).toBe('indexeddb')
    expect(await a.cd.writeClosed([closeRec(door(1))])).toBe(true)
    expect(await dbClosed()).toEqual([expect.objectContaining({ owner: X, doorId: door(1), shut: true, below: true })])
    expect(a.toast()).toBeUndefined()
    h.mem.clear()
    const b = await page()
    expect(b.cd.closedByMe(X, door(1), LOCK)).toBe(true)
    expect(b.cd.roomShut(X, ROOM)).toBe(true)
  })

  it('a close neither copy could keep says so, and holds for the session', async () => {
    const a = await page()
    h.state.failCommit = true
    h.state.full = true
    expect(await a.cd.writeClosed([closeRec(door(1))])).toBe(false)
    expect(a.toast()).toBe('CLOSE NOT SAVED')
    expect(a.cd.closedByMe(X, door(1), LOCK)).toBe(true)
  })

  it('a close the database missed but the localStorage copy kept is not lost: it joins the database at the next load', async () => {
    const a = await page()
    h.state.failCommit = true
    expect(await a.cd.writeClosed([closeRec(door(1))])).toBe(true)
    expect(a.toast()).toBeUndefined()
    h.state.failCommit = false
    const b = await page()
    expect(b.cd.closedByMe(X, door(1), LOCK)).toBe(true)
    expect(await dbClosed()).toEqual([expect.objectContaining({ doorId: door(1), shut: true })])
  })

  it('moves what the first build kept in localStorage (`door:lock`) into the database on load', async () => {
    h.mem.set(CLOSED, JSON.stringify({ [X]: [`${door(7)}:${LOCK}`] }))
    const a = await page()
    expect(a.cd.closedByMe(X, door(7), LOCK)).toBe(true)
    expect(await dbClosed()).toEqual([expect.objectContaining({ owner: X, doorId: door(7), shut: true, below: true })])
  })

  it('OPEN keeps what is still to close below, through a reload; a record with neither goes', async () => {
    const a = await page()
    await a.cd.writeClosed([closeRec(door(1)), closeRec(door(2))])
    await a.cd.writeClosed([closeRec(door(1), { shut: undefined }), { owner: X, doorId: door(2), lock: LOCK, room: ROOM }])
    const b = await page()
    expect(b.cd.closedByMe(X, door(1))).toBe(false)
    expect(b.cd.belowPending(X, ROOM)).toBe(true)
    expect(b.cd.closedRecord(X, door(2))).toBeUndefined()
    expect((await dbClosed()).map((r) => r.doorId)).toEqual([door(1)])
  })

  it('with no database (local mode) a close is kept in localStorage, and one that cannot be says so', async () => {
    h.state.failProbe = true
    const a = await page()
    expect(a.st.storageMode()).toBe('local')
    expect(await a.cd.writeClosed([closeRec(door(1))])).toBe(true)
    const b = await page()
    expect(b.cd.closedByMe(X, door(1), LOCK)).toBe(true)
    h.state.full = true
    expect(await b.cd.writeClosed([closeRec(door(2))])).toBe(false)
    expect(b.toast()).toBe('CLOSE NOT SAVED')
  })
})

describe('two tabs (S3)', () => {
  it('each tab’s close is its own record: neither overwrites the other, and each hears the other’s', async () => {
    const a = await page()
    const b = await page({ keepLast: true })
    await Promise.all([a.cd.writeClosed([closeRec(door(1))]), b.cd.writeClosed([closeRec(door(2))])])
    expect((await dbClosed()).map((r) => r.doorId).sort()).toEqual([door(1), door(2)])
    await vi.waitFor(() => expect(b.cd.closedByMe(X, door(1), LOCK)).toBe(true))
    await vi.waitFor(() => expect(a.cd.closedByMe(X, door(2), LOCK)).toBe(true))
    // The localStorage copy is merged before each write: both are in it too.
    expect(Object.keys(JSON.parse(h.mem.get(CLOSED)!)[X]).sort()).toEqual([door(1), door(2)])
    a.st.resetHiddenForTests()
  })

  it('reads the database again before a decision, a close no message announced included', async () => {
    const a = await page()
    expect(a.cd.closedByMe(X, door(3))).toBe(false)
    // Written by another tab whose message never came.
    const { openHiddenDb, commit } = await import('../../lib/hiddenDb')
    const d = await openHiddenDb()
    await commit(d, [{ closed: closeRec(door(3)) }])
    d.close()
    expect(a.cd.closedByMe(X, door(3))).toBe(false)
    await a.cd.refreshClosedDoors(X)
    expect(a.cd.closedByMe(X, door(3), LOCK)).toBe(true)
  })
})

describe('no cap (N1)', () => {
  it('2,100 closes are all kept, in the database and through a reload', async () => {
    const a = await page()
    const ids = Array.from({ length: 2100 }, (_, i) => door(i + 1))
    expect(await a.cd.writeClosed(ids.map((id) => closeRec(id)))).toBe(true)
    expect((await dbClosed()).length).toBe(2100)
    const b = await page()
    expect(ids.every((id) => b.cd.closedByMe(X, id, LOCK))).toBe(true)
  })

  it('and in local mode too', async () => {
    h.state.failProbe = true
    const a = await page()
    const ids = Array.from({ length: 2100 }, (_, i) => door(i + 1))
    expect(await a.cd.writeClosed(ids.map((id) => closeRec(id)))).toBe(true)
    const b = await page()
    expect(ids.every((id) => b.cd.closedByMe(X, id, LOCK))).toBe(true)
  })
})

describe('the database stays at version 1 (re-review of #616)', () => {
  /** The database as the deployed build made it: version 1, its four stores, a row and a door secret. */
  async function deployedDb(): Promise<void> {
    const req = indexedDB.open('onosendai:hidden', 1)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('rows', { keyPath: ['bucket', 'key'] })
      d.createObjectStore('tombstones', { keyPath: ['bucket', 'key'] })
      d.createObjectStore('secrets', { keyPath: ['owner', 'doorId'] })
      d.createObjectStore('meta', { keyPath: 'key' })
    }
    const d = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    const tx = d.transaction(['rows', 'secrets'], 'readwrite')
    tx.objectStore('rows').put({ bucket: X, key: 'row-1', seq: 1, json: JSON.stringify({ eventId: 'row-1' }) })
    tx.objectStore('secrets').put({ owner: X, doorId: door(9), secret: 'ab'.repeat(32) })
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
    d.close()
  }

  async function shape(): Promise<{ version: number; stores: string[] }> {
    const req = indexedDB.open('onosendai:hidden')
    const d = await new Promise<IDBDatabase>((resolve) => { req.onsuccess = () => resolve(req.result) })
    const out = { version: d.version, stores: [...d.objectStoreNames].sort() }
    d.close()
    return out
  }

  it('an existing version 1 database with rows and door secrets works unchanged, and gains close records with no version change', async () => {
    await deployedDb()
    const a = await page()
    expect(a.st.storageMode()).toBe('indexeddb')
    expect(a.st.secretRecord(X, door(9))?.secret).toBe('ab'.repeat(32))
    expect(a.st.entriesIn(X).map((e) => e.row?.eventId)).toEqual(['row-1'])
    expect(await a.cd.writeClosed([closeRec(door(1))])).toBe(true)
    a.st.resetHiddenForTests()
    expect(await shape()).toEqual({ version: 1, stores: ['meta', 'rows', 'secrets', 'tombstones'] })
    const b = await page()
    expect(b.cd.closedByMe(X, door(1), LOCK)).toBe(true)
    expect(b.st.secretRecord(X, door(9))?.secret).toBe('ab'.repeat(32))
    expect(b.st.entriesIn(X).map((e) => e.row?.eventId)).toEqual(['row-1'])
  })

  it('lets go at once when a later build asks for a newer version, so its open is never blocked', async () => {
    await page()
    const req = indexedDB.open('onosendai:hidden', 2)
    const outcome = await new Promise<string>((resolve) => {
      req.onblocked = () => resolve('blocked')
      req.onsuccess = () => { req.result.close(); resolve('opened') }
      req.onerror = () => resolve('error')
    })
    expect(outcome).toBe('opened')
  })
})
