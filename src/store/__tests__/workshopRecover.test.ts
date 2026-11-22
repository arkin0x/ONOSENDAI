/**
 * workshopRecover.test.ts: the workshop never shows an unfinished read as an
 * empty library, RECOVER SHARDS puts back every copy the library lacks, and
 * a tab killed in the middle of a write leaves each shard whole
 * (store/workshopStorage.ts, lib/workshopDb.ts, lib/kvStore.ts).
 *
 * arkinox, 2026-11-22: "i force closed the app while the import was stuck
 * and it corrupted my whole workshop. no shards show anymore."
 *
 * A page load is a fresh copy of the store's modules over the same (fake)
 * IndexedDB and the same localStorage, as in workshopIdbStorage.test.ts.
 * Shard names here are synthetic.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newShard, vertexAt, type ShardModel } from 'sno-core/shards'

const LOCAL_KEY = 'onosendai:shards'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  relaySet: () => ['wss://relay.test'],
  connectRelay: vi.fn(async () => true),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn(() => ({ close: () => {} })),
}))

vi.mock('../../lib/importFolders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/importFolders')>()),
  folderApi: vi.fn(() => null),
}))

type WorkshopMod = typeof import('../useWorkshop')
type StorageMod = typeof import('../workshopStorage')
interface Tab { ws: WorkshopMod; st: StorageMod }

const openTabs: Tab[] = []
let lastTab: Tab | null = null
async function openTab(): Promise<Tab> {
  vi.resetModules()
  const ws = await import('../useWorkshop')
  const st = await import('../workshopStorage')
  st.loadTiming.slowMs = 20
  st.loadTiming.giveUpMs = 150
  const t = { ws, st }
  openTabs.push(t)
  return t
}
/** A page load: the page before it gone, the modules fresh, then the read before the app draws. */
async function boot(): Promise<Tab> {
  lastTab?.st.closeForTests()
  const t = await openTab()
  await t.ws.hydrateWorkshop()
  lastTab = t
  return t
}

function shard(name: string, seed: number, at = 1_700_000_000_000 + seed): ShardModel {
  const s = newShard(name)
  const vertices = Array.from({ length: 12 }, (_, i) => vertexAt([((i + seed) % 9) - 4, (i % 5) - 2, seed % 7 - 3], [0.5, 0.5, 0.5]))
  return { ...s, id: `test-kit/${name}`, vertices, updatedAt: at }
}

async function records(): Promise<Array<{ id: string; json: string }>> {
  const { openWorkshopDb, readAll } = await vi.importActual<typeof import('../../lib/workshopDb')>('../../lib/workshopDb')
  const d = await openWorkshopDb()
  try { return (await readAll(d)).records } finally { d.close() }
}

/** A library in the database, as a load leaves it: moved and marked. */
async function library(list: ShardModel[]): Promise<Tab> {
  mem.set(LOCAL_KEY, JSON.stringify(list))
  const t = await boot()
  expect(t.st.storageMode()).toBe('indexeddb')
  // The backup stays as it was; these tests put their own in its place.
  mem.delete(LOCAL_KEY)
  return t
}

beforeEach(() => {
  for (const t of openTabs.splice(0)) t.st.closeForTests()
  lastTab = null
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  mem.clear()
})

afterEach(() => {
  vi.doUnmock('../../lib/workshopDb')
  vi.restoreAllMocks()
})

describe('a load that does not finish', () => {
  it('is never shown as an empty library: it says so, saves nothing, and the next load has every shard', async () => {
    const list = Array.from({ length: 6 }, (_, i) => shard(`piece-${i}`, i))
    await library(list)
    // The database opens, but its read never answers (a lock held elsewhere).
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      readAll: () => new Promise(() => {}),
    }))
    const t = await openTab()
    const seen: Array<string | null> = []
    t.ws.useWorkshop.subscribe((s) => seen.push(s.storageError))
    const mode = await t.ws.hydrateWorkshop()
    expect(mode).toBe('unavailable')
    // Said while it waited, and said when it gave up.
    expect(seen.some((m) => /still loading/.test(m ?? ''))).toBe(true)
    expect(t.ws.useWorkshop.getState().storageError).toMatch(/did not load.*not gone/)
    // Nothing is written over the library from this session.
    t.ws.useWorkshop.getState().addShard(newShard('made meanwhile'), 'made meanwhile')
    expect(await t.ws.useWorkshop.getState().saveNow()).toBe(false)
    // Import refuses to start against a list that is not the library.
    const { useShardImport } = await import('../useShardImport')
    await useShardImport.getState().openZip(new File([new Uint8Array([1, 2, 3])], 'kit.zip'))
    expect(useShardImport.getState().error).toMatch(/not loaded/)
    t.st.closeForTests()
    vi.doUnmock('../../lib/workshopDb')
    expect((await records()).map((r) => r.id).sort()).toEqual(list.map((s) => s.id).sort())
    const again = await boot()
    expect(again.st.storageMode()).toBe('indexeddb')
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.id).sort()).toEqual(list.map((s) => s.id).sort())
    expect(again.ws.useWorkshop.getState().storageError).toBeNull()
  }, 30_000)

  it('a read that lands after the give-up installs nothing and saves nothing: it says to reload', async () => {
    const list = [shard('piece-a', 1), shard('piece-b', 2)]
    await library(list)
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, readAll: async (d: IDBDatabase) => { await new Promise((r) => setTimeout(r, 400)); return real.readAll(d) } }
    })
    const t = await openTab()
    // A change before the give-up, and one after it.
    t.ws.useWorkshop.getState().addShard(newShard('made while loading'), 'made while loading')
    expect(await t.ws.hydrateWorkshop()).toBe('unavailable')
    t.ws.useWorkshop.getState().addShard(newShard('made after'), 'made after')
    await vi.waitFor(() => expect(t.ws.useWorkshop.getState().storageError).toMatch(/can be read now.*Reload/), { timeout: 3000 })
    expect(t.st.storageMode()).toBe('unavailable')
    expect(await t.ws.useWorkshop.getState().saveNow()).toBe(false)
    t.st.closeForTests()
    vi.doUnmock('../../lib/workshopDb')
    expect((await records()).map((r) => r.id).sort()).toEqual(list.map((s) => s.id).sort())
  })

  it('RECOVER SHARDS waits for a load still reading', async () => {
    await library([shard('piece-a', 1)])
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, readAll: async (d: IDBDatabase) => { await new Promise((r) => setTimeout(r, 100)); return real.readAll(d) } }
    })
    const t = await openTab()
    const loading = t.ws.hydrateWorkshop()
    expect(await t.st.recoverShards()).toEqual({ ok: false, error: expect.stringMatching(/still loading/) })
    expect(await loading).toBe('indexeddb')
  })

  it('a load that is only slow clears its line once it lands', async () => {
    const list = [shard('piece-a', 1)]
    await library(list)
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, readAll: async (d: IDBDatabase) => { await new Promise((r) => setTimeout(r, 60)); return real.readAll(d) } }
    })
    const t = await openTab()
    expect(await t.ws.hydrateWorkshop()).toBe('indexeddb')
    expect(t.ws.useWorkshop.getState().storageError).toBeNull()
    expect(t.ws.useWorkshop.getState().shards).toHaveLength(1)
  })
})

describe('a list that cannot be read', () => {
  it('is never taken for an empty library and written over', async () => {
    const torn = '[{"id":"test-kit/piece-a","name":"piece-a","vertices":[{"p":[0,'
    mem.set(LOCAL_KEY, torn)
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      openWorkshopDb: () => Promise.reject(new Error('no database here')),
      databaseExists: async () => false,
    }))
    const t = await openTab()
    expect(await t.ws.hydrateWorkshop()).toBe('unavailable')
    expect(t.ws.useWorkshop.getState().storageError).toMatch(/could not be read/)
    t.ws.useWorkshop.getState().addShard(newShard('made meanwhile'), 'made meanwhile')
    expect(await t.ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(mem.get(LOCAL_KEY)).toBe(torn)
  })
})

describe('RECOVER SHARDS', () => {
  it('puts back what every kept copy has and the library lacks; never deletes, never makes a shard older, never brings back a deleted one', async () => {
    const a1 = shard('piece-a', 1, 1000)
    const b = shard('piece-b', 2, 1000)
    const gone = shard('piece-gone', 3, 1000)
    const t = await library([a1, b, gone])
    t.ws.useWorkshop.getState().rename(a1.id, 'piece-a edited')
    t.ws.useWorkshop.getState().remove(gone.id)
    expect(await t.ws.useWorkshop.getState().saveNow()).toBe(true)
    // Copies kept elsewhere: an older build's localStorage list, and the kv backup with a copy set aside beside it.
    // Work done since the move, kept only in an older copy; and a shard deleted long before it, which left no tombstone.
    const later = Date.now() + 60_000
    const extraLocal = shard('piece-only-in-local', 4, later)
    const longGone = shard('piece-deleted-before-the-move', 6, 1500)
    mem.set(LOCAL_KEY, JSON.stringify([a1, gone, extraLocal]))
    const extraKv = shard('piece-only-in-kv', 5, later)
    const { openDatabase } = await import('../../lib/idb')
    const kv = await openDatabase('onosendai:kv', 1, [['entries', 'key']], (tx) => {
      if (!tx.db.objectStoreNames.contains('superseded')) tx.db.createObjectStore('superseded', { autoIncrement: true })
    })
    await new Promise<void>((resolve, reject) => {
      const tx = kv.transaction(['entries', 'superseded'], 'readwrite')
      tx.objectStore('entries').put({ key: LOCAL_KEY, value: JSON.stringify([a1, b]), seen: 'x', at: 1 })
      tx.objectStore('superseded').add({ key: LOCAL_KEY, value: JSON.stringify([extraKv, longGone]), at: 2, why: 'test' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    kv.close()

    const r = await t.st.recoverShards()
    expect(r).toEqual({ ok: true, copies: 3, restored: 2, reload: false })
    const names = t.ws.useWorkshop.getState().shards.map((s) => s.name).sort()
    expect(names).toEqual(['piece-a edited', 'piece-b', 'piece-only-in-kv', 'piece-only-in-local'])
    // And it is the library, not only this tab's list.
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name).sort()).toEqual(names)
    // Every copy it read from is as it was.
    expect(mem.get(LOCAL_KEY)).toBe(JSON.stringify([a1, gone, extraLocal]))
    // A second run finds nothing more.
    expect(await again.st.recoverShards()).toEqual({ ok: true, copies: 3, restored: 0, reload: false })
  })

  it('in a tab whose load did not finish, merges into the database and asks for a reload', async () => {
    const list = [shard('piece-a', 1), shard('piece-b', 2)]
    await library(list)
    const extra = shard('piece-extra', 3, Date.now() + 60_000)
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      readAll: (() => {
        let first = true
        return async (d: IDBDatabase) => {
          if (first) { first = false; return new Promise(() => {}) }
          const real = await vi.importActual<typeof import('../../lib/workshopDb')>('../../lib/workshopDb')
          return real.readAll(d)
        }
      })(),
    }))
    const t = await openTab()
    expect(await t.ws.hydrateWorkshop()).toBe('unavailable')
    // A copy only an older build's localStorage list holds, written after this load read it.
    mem.set(LOCAL_KEY, JSON.stringify([extra]))
    const r = await t.st.recoverShards()
    expect(r).toEqual({ ok: true, copies: 1, restored: 1, reload: true })
    t.st.closeForTests()
    vi.doUnmock('../../lib/workshopDb')
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name).sort()).toEqual(['piece-a', 'piece-b', 'piece-extra'])
  })
})

describe('a hidden tab', () => {
  it('does not read the shards another tab wrote until it is shown, so a frozen read can never hold their store', async () => {
    const list = [shard('piece-a', 1), shard('piece-b', 2)]
    await library(list)
    const listeners: Array<() => void> = []
    const doc = { visibilityState: 'visible', cookie: '', addEventListener: (ev: string, f: () => void) => { if (ev === 'visibilitychange') listeners.push(f) } }
    ;(globalThis as { document?: unknown }).document = doc
    try {
      const a = await openTab()
      await a.ws.hydrateWorkshop()
      const b = await openTab()
      await b.ws.hydrateWorkshop()
      doc.visibilityState = 'hidden'
      a.ws.useWorkshop.getState().rename(list[0].id, 'renamed in tab one')
      expect(await a.ws.useWorkshop.getState().saveNow()).toBe(true)
      await new Promise((r) => setTimeout(r, 80))
      // Hidden: tab two has not read it.
      expect(b.ws.useWorkshop.getState().shards.find((s) => s.id === list[0].id)!.name).toBe('piece-a')
      doc.visibilityState = 'visible'
      for (const f of listeners) f()
      await vi.waitFor(() => expect(b.ws.useWorkshop.getState().shards.find((s) => s.id === list[0].id)!.name).toBe('renamed in tab one'))
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
  })
})

describe('a tab killed in the middle of a write', () => {
  it('leaves every shard whole, old or new, at every step of an import write', async () => {
    const N = 6
    const old = Array.from({ length: N }, (_, i) => shard(`piece-${i}`, i, 1000))
    const fresh = old.map((s, i) => ({ ...s, vertices: s.vertices.slice(0, 3 + i), updatedAt: 9000 }))
    for (let killAt = 0; killAt <= N; killAt++) {
      ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
      mem.clear()
      const t = await library(old)
      // The process dies at the killAt-th record of the commit: the transaction never completes.
      const realPut = IDBObjectStore.prototype.put
      let puts = 0
      const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        // From that record on, every write fails, the retry's too: the commit never lands.
        if (this.name === 'shards' && puts++ >= killAt) throw new DOMException('killed', 'UnknownError')
        return realPut.apply(this, args)
      })
      for (const s of fresh) void t.ws.useWorkshop.getState().replaceShard(s.id, s)
      const saved = await t.ws.useWorkshop.getState().saveNow()
      spy.mockRestore()
      t.st.closeForTests()
      const again = await boot()
      const shards = again.ws.useWorkshop.getState().shards
      expect(shards).toHaveLength(N)
      for (let i = 0; i < N; i++) {
        const got = shards.find((s) => s.id === old[i].id)!
        expect([old[i].vertices.length, fresh[i].vertices.length]).toContain(got.vertices.length)
      }
      // One transaction: every new version or none, and saveNow said which.
      expect(saved).toBe(killAt === N)
      for (let i = 0; i < N; i++) expect(shards.find((s) => s.id === old[i].id)!.vertices.length).toBe((saved ? fresh : old)[i].vertices.length)
    }
  })
})
