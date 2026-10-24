/**
 * workshopIdbStorage.test.ts: the workshop's shards in IndexedDB
 * (store/workshopStorage.ts, lib/workshopDb.ts), through the store.
 *
 * A page load is a fresh copy of the store's modules over the same
 * (fake) IndexedDB and the same localStorage; a second tab is a second copy
 * open at the same time. localStorage here has a 5 MB cap, as browsers do,
 * so a kit-sized library really does not fit in it.
 *
 * What these prove: a localStorage list over 5 MB moves, verifies shard by
 * shard, and the localStorage copy is left byte for byte as it was, and never
 * written again; a move that fails or does not verify leaves the workshop on
 * localStorage as it was, saying nothing; add, replace and delete come back
 * after a reload; 200 kit-sized shards import; an import never publishes a
 * shard storage refused; two tabs keep each other's changes; a corrupt record
 * is one shard skipped, never the library; a shard an older build wrote to
 * localStorage after the move is carried in, and a deleted one is not
 * brought back.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { newShard, vertexAt, type ShardModel } from 'sno-core/shards'

const LOCAL_KEY = 'onosendai:shards'
const MOVED_KEY = 'onosendai:shards:moved'
const CAP = 5 * 1024 * 1024

/** localStorage with a browser's cap: a write that would take it past CAP characters throws QuotaExceededError. */
const mem = new Map<string, string>()
let capOn = true
const used = (): number => [...mem].reduce((n, [k, v]) => n + k.length + v.length, 0)
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    const next = used() - (mem.has(k) ? k.length + mem.get(k)!.length : 0) + k.length + String(v).length
    if (capOn && next > CAP) throw new DOMException('full', 'QuotaExceededError')
    mem.set(k, String(v))
  },
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

/** Every tab a test opened, closed after it so none writes into the next test's database. */
const openTabs: Tab[] = []
/** A tab: the modules fresh, not yet loaded. */
async function openTab(): Promise<Tab> {
  vi.resetModules()
  const ws = await import('../useWorkshop')
  const st = await import('../workshopStorage')
  const t = { ws, st }
  openTabs.push(t)
  return t
}
let lastTab: Tab | null = null
/** A page load: the page before it gone (a reload closes it), the modules fresh, then the read before the app draws. */
async function boot(): Promise<Tab> {
  lastTab?.st.closeForTests()
  const t = await openTab()
  await t.ws.hydrateWorkshop()
  lastTab = t
  return t
}

/** A shard about `kb` KB as the workshop stores it. */
function bigShard(name: string, kb: number, seed = 0): ShardModel {
  const s = newShard(name)
  const vertices = []
  // Each stored vertex is about 40 characters of JSON.
  const n = Math.ceil((kb * 1024) / 40)
  for (let i = 0; i < n; i++) vertices.push(vertexAt([((i + seed) % 17) - 8, (Math.floor(i / 17) % 17) - 8, (Math.floor(i / 289) % 17) - 8], [((i * 7) % 256) / 255, 0.5, ((i * 13) % 256) / 255]))
  return { ...s, vertices, updatedAt: 1_700_000_000_000 + seed }
}

/** Put a list in localStorage as an earlier build left it, past any cap. */
function seedLocal(list: unknown[]): string {
  const raw = JSON.stringify(list)
  capOn = false
  mem.set(LOCAL_KEY, raw)
  capOn = true
  return raw
}

async function records(): Promise<Array<{ id: string; json: string; seq: number }>> {
  const { openWorkshopDb, readAll } = await import('../../lib/workshopDb')
  const d = await openWorkshopDb()
  try { return (await readAll(d)).records } finally { d.close() }
}

async function rawPut(rows: unknown[]): Promise<void> {
  const { openWorkshopDb, SHARDS_STORE } = await import('../../lib/workshopDb')
  const d = await openWorkshopDb()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(SHARDS_STORE, 'readwrite')
    for (const r of rows) tx.objectStore(SHARDS_STORE).put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  d.close()
}

beforeEach(() => {
  for (const t of openTabs.splice(0)) t.st.closeForTests()
  lastTab = null
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  mem.clear()
  capOn = true
})

afterEach(() => {
  vi.doUnmock('../../lib/workshopDb')
  vi.restoreAllMocks()
})

describe('the move from localStorage', () => {
  it('moves a list over 5 MB, verifies every shard, and leaves the localStorage copy exactly as it was', async () => {
    const list = Array.from({ length: 70 }, (_, i) => bigShard(`piece ${i}`, 90, i))
    const raw = seedLocal(list)
    expect(raw.length).toBeGreaterThan(CAP)
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('indexeddb')
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual(list.map((s) => s.id))
    // Every record is the JSON localStorage held for that shard, in its order.
    const rows = await records()
    expect(rows.map((r) => r.id)).toEqual(list.map((s) => s.id))
    rows.forEach((r, i) => expect(r.json).toBe(JSON.stringify(list[i])))
    expect(mem.get(LOCAL_KEY)).toBe(raw)
    // A full localStorage has no room even for the small flag: the database's own mark is the record.
    expect(mem.has(MOVED_KEY)).toBe(false)

    // After the move nothing writes the localStorage copy again.
    const t = ws.useWorkshop.getState()
    t.addShard(newShard('new one'), 'new one')
    t.rename(list[0].id, 'renamed')
    t.remove(list[1].id)
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    expect(mem.get(LOCAL_KEY)).toBe(raw)

    const again = await boot()
    const names = again.ws.useWorkshop.getState().shards.map((s) => s.name)
    expect(names).toContain('new one')
    expect(names).toContain('renamed')
    expect(again.ws.useWorkshop.getState().shards.some((s) => s.id === list[1].id)).toBe(false)
    expect(again.st.storageMode()).toBe('indexeddb')
    expect(again.ws.useWorkshop.getState().shards).toHaveLength(70)
    expect(mem.get(LOCAL_KEY)).toBe(raw)
  }, 60_000)

  it('sets the moved flag when there is room, and the next load does not read the backup as the library', async () => {
    const list = [bigShard('a', 4, 1)]
    const raw = seedLocal(list)
    await boot()
    expect(mem.get(MOVED_KEY)).toBeTruthy()
    const { ws: ws } = await openTab()
    expect(ws.useWorkshop.getState().shards).toEqual([])
    await ws.hydrateWorkshop()
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id])
    expect(mem.get(LOCAL_KEY)).toBe(raw)
  })

  it('a list that does not verify stays on localStorage, as before, and says nothing', async () => {
    const list = [bigShard('a', 4, 1), bigShard('b', 4, 2)]
    const raw = seedLocal(list)
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      verifyAndMark: async () => ({ result: 'mismatch', bad: [list[0].id] }),
    }))
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('local')
    expect(ws.useWorkshop.getState().storageError).toBeNull()
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual(list.map((s) => s.id))
    expect(mem.get(LOCAL_KEY)).toBe(raw)
    expect(mem.has(MOVED_KEY)).toBe(false)
    // And it saves as it always did.
    ws.useWorkshop.getState().rename(list[0].id, 'still local')
    expect(JSON.parse(mem.get(LOCAL_KEY)!)[0].name).toBe('still local')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)

    // The next load, with the move working, carries the edit too.
    vi.doUnmock('../../lib/workshopDb')
    const next = await boot()
    expect(next.st.storageMode()).toBe('indexeddb')
    expect(next.ws.useWorkshop.getState().shards[0].name).toBe('still local')
  })

  it('an IndexedDB that will not open stays on localStorage, as before', async () => {
    const list = [bigShard('a', 4, 1)]
    const raw = seedLocal(list)
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('no', 'InvalidStateError') })
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('local')
    expect(ws.useWorkshop.getState().storageError).toBeNull()
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id])
    // Nothing changed, so nothing was written.
    expect(mem.get(LOCAL_KEY)).toBe(raw)
  })

  it('after the move, an IndexedDB that will not open saves nothing and says so, and the backup is left alone', async () => {
    const list = [bigShard('a', 4, 1)]
    const raw = seedLocal(list)
    await boot()
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('no', 'InvalidStateError') })
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('unavailable')
    expect(ws.useWorkshop.getState().storageError).toMatch(/could not be opened/)
    // The copy from before the move is shown rather than an empty workshop.
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id])
    ws.useWorkshop.getState().rename(list[0].id, 'x')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(mem.get(LOCAL_KEY)).toBe(raw)
  })

  it('a localStorage list that does not parse is left exactly as it is, and never written over', async () => {
    capOn = false
    mem.set(LOCAL_KEY, '[{"id":"x", broken')
    capOn = true
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('indexeddb')
    ws.useWorkshop.getState().create('fresh')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    expect(mem.get(LOCAL_KEY)).toBe('[{"id":"x", broken')
  })

  it('two tabs moving at once both end on the database, with every shard', async () => {
    const list = [bigShard('a', 4, 1), bigShard('b', 4, 2)]
    seedLocal(list)
    const { ws: a, st: sa } = await openTab()
    const { ws: b, st: sb } = await openTab()
    await Promise.all([a.hydrateWorkshop(), b.hydrateWorkshop()])
    expect(sa.storageMode()).toBe('indexeddb')
    expect(sb.storageMode()).toBe('indexeddb')
    expect((await records()).map((r) => r.id).sort()).toEqual(list.map((s) => s.id).sort())
  })

  it('a change made before the load answered is kept', async () => {
    const list = [bigShard('a', 4, 1)]
    seedLocal(list)
    await boot()
    // The next load starts from nothing (the backup is not the library) until the database answers.
    const { ws: ws, st: st } = await openTab()
    expect(st.storageMode()).toBe('pending')
    const early = ws.useWorkshop.getState().create('early')
    await ws.hydrateWorkshop()
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id, early])
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['a', 'early'])
  })
})

describe('review fixes: never back onto localStorage after the move', () => {
  it('a moved flag that did not fit, then a database that will not open: saves nothing, and the backup is left alone', async () => {
    const list = Array.from({ length: 70 }, (_, i) => bigShard(`piece ${i}`, 90, i))
    const raw = seedLocal(list)
    const first = await boot()
    expect(mem.has(MOVED_KEY)).toBe(false)
    first.ws.useWorkshop.getState().rename(list[0].id, 'after the move')
    expect(await first.ws.useWorkshop.getState().saveNow()).toBe(true)
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('no', 'InvalidStateError') })
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('unavailable')
    ws.useWorkshop.getState().remove(list[1].id)
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(mem.get(LOCAL_KEY)).toBe(raw)
    vi.restoreAllMocks()
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.find((s) => s.id === list[0].id)!.name).toBe('after the move')
    expect(again.ws.useWorkshop.getState().shards).toHaveLength(70)
  }, 60_000)

  it('the cookie says it moved when localStorage had no room and the browser cannot list its databases', async () => {
    let jar = ''
    ;(globalThis as { document?: unknown }).document = { get cookie() { return jar }, set cookie(v: string) { jar = v.split(';')[0] } }
    try {
      const raw = seedLocal(Array.from({ length: 70 }, (_, i) => bigShard(`piece ${i}`, 90, i)))
      await boot()
      expect(mem.has(MOVED_KEY)).toBe(false)
      expect(jar).toBe('onosendai_shards_moved=1')
      vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('no', 'InvalidStateError') })
      vi.spyOn(indexedDB, 'databases').mockImplementation(() => Promise.reject(new Error('no')))
      const { ws, st } = await boot()
      expect(st.storageMode()).toBe('unavailable')
      ws.useWorkshop.getState().create('x')
      expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
      expect(mem.get(LOCAL_KEY)).toBe(raw)
    } finally { delete (globalThis as { document?: unknown }).document }
  }, 60_000)

  it('a database cleared under an open tab gets every shard in that tab written back, not the backup', async () => {
    const list = [bigShard('a', 4, 1), bigShard('b', 4, 2)]
    const raw = seedLocal(list)
    const { ws } = await boot()
    const w = () => ws.useWorkshop.getState()
    const c = w().create('made after the move')
    w().rename(list[0].id, 'a edited')
    expect(await w().saveNow()).toBe(true)
    // The browser clears the site's IndexedDB (storage pressure, or a person clearing it).
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('onosendai:workshop'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) })
    w().rename(list[1].id, 'b edited')
    expect(await w().saveNow()).toBe(true)
    const again = await boot()
    expect(again.st.storageMode()).toBe('indexeddb')
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name).sort()).toEqual(['a edited', 'b edited', 'made after the move'])
    expect(again.ws.useWorkshop.getState().shards.some((s) => s.id === c)).toBe(true)
    expect(mem.get(LOCAL_KEY)).toBe(raw)
  })

  it('a full disk while putting a cleared database back writes no mark, so the next load still restores the backup and says so', async () => {
    const list = [bigShard('a', 4, 1)]
    seedLocal(list)
    let full = false
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, restoreInto: (...a: Parameters<typeof real.restoreInto>) => (full ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : real.restoreInto(...a)) }
    })
    const { ws } = await boot()
    full = true
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('onosendai:workshop'); r.onsuccess = () => resolve() })
    ws.useWorkshop.getState().rename(list[0].id, 'edited')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(ws.useWorkshop.getState().storageError).toMatch(/full/)
    vi.doUnmock('../../lib/workshopDb')
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id])
    expect(again.ws.useWorkshop.getState().notice).toMatch(/cleared/)
  })

  it('a tab whose database was cleared and marked again by another tab puts its newer work back', async () => {
    const a = bigShard('a', 4, 1)
    const b = bigShard('b', 4, 2)
    seedLocal([a, b])
    const { ws: one } = await openTab()
    await one.hydrateWorkshop()
    const c = one.useWorkshop.getState().create('c, made after the move')
    one.useWorkshop.getState().rename(a.id, 'a edited')
    expect(await one.useWorkshop.getState().saveNow()).toBe(true)
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('onosendai:workshop'); r.onsuccess = () => resolve() })
    // A second tab loads. Tab one puts its shards back as soon as the
    // database is deleted; whichever lands first, nothing of tab one's is lost.
    const { ws: two } = await openTab()
    await two.hydrateWorkshop()
    // The first tab saves next, with nothing new in hand: it is not "saved" until its work is back.
    expect(await one.useWorkshop.getState().saveNow()).toBe(true)
    const again = await boot()
    const names = again.ws.useWorkshop.getState().shards.map((s) => s.name).sort()
    expect(names).toEqual(['a edited', 'b', 'c, made after the move'])
    expect(again.ws.useWorkshop.getState().shards.some((s) => s.id === c)).toBe(true)
  })

  it('two tabs that read the same database both put their work back after it is cleared, even when one never heard the other', async () => {
    const a = bigShard('a', 4, 1)
    const b = bigShard('b', 4, 2)
    seedLocal([a, b])
    const realBC = globalThis.BroadcastChannel
    const { ws: one } = await openTab()
    await one.hydrateWorkshop()
    // Tab three hears nothing from anyone: a missed broadcast.
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined
    const { ws: three } = await openTab()
    await three.hydrateWorkshop()
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = realBC
    const c = one.useWorkshop.getState().create('made in tab 1')
    expect(await one.useWorkshop.getState().saveNow()).toBe(true)
    expect(three.useWorkshop.getState().shards.some((s) => s.id === c)).toBe(false)
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('onosendai:workshop'); r.onsuccess = () => resolve() })
    three.useWorkshop.getState().rename(a.id, 'a from tab 3')
    expect(await three.useWorkshop.getState().saveNow()).toBe(true)
    one.useWorkshop.getState().rename(b.id, 'b from tab 1')
    expect(await one.useWorkshop.getState().saveNow()).toBe(true)
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name).sort()).toEqual(['a from tab 3', 'b from tab 1', 'made in tab 1'])
  })

  it('a database cleared while no tab was open brings the backup back, and says so', async () => {
    const list = [bigShard('a', 4, 1)]
    seedLocal(list)
    // Closed, not just loaded: boot() only closes a tab when the next one
    // loads, so a tab left open here would hear the delete (onversionchange)
    // and put its own shards back, with a fresh mark, racing this reload's
    // decide(). Whichever lands first is a matter of scheduling, and when the
    // open tab wins there is no cleared database left to notice. That race is
    // covered by 'a database cleared under an open tab...' above.
    const first = await boot()
    first.st.closeForTests()
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('onosendai:workshop'); r.onsuccess = () => resolve() })
    const { ws, st } = await boot()
    expect(st.storageMode()).toBe('indexeddb')
    expect(ws.useWorkshop.getState().shards.map((s) => s.id)).toEqual([list[0].id])
    expect(ws.useWorkshop.getState().notice).toMatch(/cleared/)
  })

  it('a second tab carrying the old list after the first marked the move does not undo its delete', async () => {
    const list = [bigShard('a', 4, 1), bigShard('b', 4, 2)]
    const raw = seedLocal(list)
    const first = await boot()
    first.ws.useWorkshop.getState().remove(list[1].id)
    expect(await first.ws.useWorkshop.getState().saveNow()).toBe(true)
    // What the second tab does, having read "no mark" just before the first tab marked it.
    const db = await import('../../lib/workshopDb')
    const d = await db.openWorkshopDb()
    await db.mergeLocal(d, db.localEntries(raw)!, false)
    d.close()
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['a'])
  })

  it('a tab left on localStorage stops writing it the moment another tab marks the move', async () => {
    const list = [bigShard('a', 4, 1)]
    seedLocal(list)
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      verifyAndMark: async () => ({ result: 'mismatch', bad: [list[0].id] }),
    }))
    const local = await boot()
    expect(local.st.storageMode()).toBe('local')
    vi.doUnmock('../../lib/workshopDb')
    // A second tab, opened beside it (not a reload of it).
    const movedTab = await openTab()
    const movedStorage = movedTab.st
    await movedTab.ws.hydrateWorkshop()
    expect(movedStorage.storageMode()).toBe('indexeddb')
    await vi.waitFor(() => expect(local.st.storageMode()).toBe('unavailable'))
    const before = mem.get(LOCAL_KEY)
    local.ws.useWorkshop.getState().rename(list[0].id, 'from the old tab')
    expect(mem.get(LOCAL_KEY)).toBe(before)
    expect(local.ws.useWorkshop.getState().storageError).toMatch(/another tab/)
  })

  it('a write that fails on a closed connection is tried once more, at once, and never again by itself', async () => {
    let fails = 1
    const calls = vi.fn()
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, commit: (...a: Parameters<typeof real.commit>) => { calls(); return fails-- > 0 ? Promise.reject(new DOMException('closing', 'InvalidStateError')) : real.commit(...a) } }
    })
    const { ws } = await boot()
    ws.useWorkshop.getState().create('one')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    expect(calls).toHaveBeenCalledTimes(2)
    calls.mockClear()
    fails = 99
    ws.useWorkshop.getState().create('two')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(calls).toHaveBeenCalledTimes(2)
    // Nothing more, on any clock.
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('a commit another tab makes while this one loads is read in', async () => {
    const list = [bigShard('a', 4, 1)]
    seedLocal(list)
    await boot()
    const { ws: a } = await openTab()
    await a.hydrateWorkshop()
    const { ws: b } = await openTab()
    const loading = b.hydrateWorkshop()
    a.useWorkshop.getState().rename(list[0].id, 'renamed while B loads')
    expect(await a.useWorkshop.getState().saveNow()).toBe(true)
    await loading
    await vi.waitFor(() => expect(b.useWorkshop.getState().shards[0].name).toBe('renamed while B loads'))
  })
})

describe('after the move', () => {
  it('add, replace and delete come back after a reload, and only changed shards are written', async () => {
    const { ws } = await boot()
    const w = () => ws.useWorkshop.getState()
    const added = w().addShard(bigShard('kept', 20, 3), 'kept')!
    expect(await added.saved).toBe(true)
    const gone = w().addShard(newShard('gone'), 'gone')!
    expect(await gone.saved).toBe(true)
    expect(await w().replaceShard(added.id, bigShard('other', 5, 9))).toBe('saved')
    w().remove(gone.id)
    expect(await w().saveNow()).toBe(true)

    const again = await boot()
    const s = again.ws.useWorkshop.getState().shards
    expect(s.map((x) => x.name)).toEqual(['kept'])
    expect(s[0].vertices).toHaveLength(bigShard('other', 5, 9).vertices.length)
    expect((await records()).map((r) => r.id)).toEqual([added.id])
  })

  it('writes only the shard that changed', async () => {
    const list = Array.from({ length: 10 }, (_, i) => bigShard(`p${i}`, 4, i))
    seedLocal(list)
    const spy = vi.fn()
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, commit: (d: IDBDatabase, puts: Array<{ id: string }>, dels: string[]) => { spy(puts.map((p) => p.id), dels); return real.commit(d, puts as never, dels) } }
    })
    const { ws } = await boot()
    ws.useWorkshop.getState().rename(list[4].id, 'changed')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith([list[4].id], [])
  })

  it('a full disk is said, keeps the change in hand, and the next save that fits lands it', async () => {
    let full = false
    vi.doMock('../../lib/workshopDb', async (orig) => {
      const real = await orig<typeof import('../../lib/workshopDb')>()
      return { ...real, commit: (...a: Parameters<typeof real.commit>) => (full ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : real.commit(...a)) }
    })
    const { ws } = await boot()
    const w = () => ws.useWorkshop.getState()
    const id = w().create('first')
    expect(await w().saveNow()).toBe(true)
    full = true
    w().rename(id, 'second')
    expect(await w().saveNow()).toBe(false)
    expect(w().storageError).toMatch(/full/)
    expect(w().shards[0].name).toBe('second')
    // Nothing retries by itself: the change waits for the next save.
    full = false
    expect(await w().saveNow()).toBe(true)
    expect(w().storageError).toBeNull()
    vi.doUnmock('../../lib/workshopDb')
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards[0].name).toBe('second')
  })

  it('a corrupt record is one shard skipped, left in the database as it is, never the library', async () => {
    const list = [bigShard('a', 4, 1), bigShard('b', 4, 2)]
    seedLocal(list)
    await boot()
    await rawPut([
      { id: 'bad-json', seq: 50, updatedAt: 0, json: '{"id":"bad-json", nope' },
      { id: 'not-a-shard', seq: 51, updatedAt: 0, json: JSON.stringify({ id: 'not-a-shard', hello: 1 }) },
      { id: 'wrong-id', seq: 52, updatedAt: 0, json: JSON.stringify({ ...list[0], id: 'someone-else' }) },
      { id: 'no-json', seq: 53 },
    ])
    const { ws, st } = await boot()
    expect(ws.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['a', 'b'])
    expect(st.skippedRecords()).toBe(4)
    ws.useWorkshop.getState().rename(list[0].id, 'edited')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    // Nothing deleted them: they are there for whoever wants to look.
    const { openWorkshopDb, SHARDS_STORE } = await import('../../lib/workshopDb')
    const d = await openWorkshopDb()
    const keys = await new Promise<IDBValidKey[]>((resolve) => { const r = d.transaction(SHARDS_STORE).objectStore(SHARDS_STORE).getAllKeys(); r.onsuccess = () => resolve(r.result) })
    d.close()
    expect(keys).toEqual(expect.arrayContaining(['bad-json', 'not-a-shard', 'wrong-id', 'no-json']))
  })

  it('carries in what an older build wrote to localStorage after the move, and does not bring back a deleted shard', async () => {
    const a = bigShard('a', 4, 1)
    const b = bigShard('b', 4, 2)
    const c = bigShard('c', 4, 3)
    seedLocal([a, b, c])
    const first = await boot()
    first.ws.useWorkshop.getState().remove(c.id)
    first.ws.useWorkshop.getState().rename(b.id, 'b here')
    expect(await first.ws.useWorkshop.getState().saveNow()).toBe(true)
    // An older build, still open in another tab, writes its whole list: a newer
    // `a`, a new `d`, the old `b` and the `c` it never saw deleted.
    const d = bigShard('d', 4, 4)
    const newerA = { ...a, name: 'a from the old tab', updatedAt: Date.now() + 1000 }
    seedLocal([newerA, b, c, d])
    const { ws } = await boot()
    const names = ws.useWorkshop.getState().shards.map((s) => s.name)
    expect(names).toEqual(['a from the old tab', 'b here', 'd'])
  })

  it('asks once for persistent storage, and a refusal changes nothing', async () => {
    const persist = vi.fn(async () => false)
    const persisted = vi.fn(async () => false)
    Object.defineProperty(globalThis.navigator, 'storage', { value: { persist, persisted }, configurable: true })
    try {
      const { ws, st } = await boot()
      ws.useWorkshop.getState().create('one')
      expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
      ws.useWorkshop.getState().create('two')
      expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
      expect(st.storageMode()).toBe('indexeddb')
      expect(ws.useWorkshop.getState().storageError).toBeNull()
    } finally {
      Object.defineProperty(globalThis.navigator, 'storage', { value: undefined, configurable: true })
    }
  })
})

describe('two tabs', () => {
  it('keep each other\'s changes, and each sees the other\'s', async () => {
    const list = [bigShard('x', 4, 1), bigShard('y', 4, 2)]
    seedLocal(list)
    await boot()
    const { ws: a } = await openTab()
    await a.hydrateWorkshop()
    const { ws: b } = await openTab()
    await b.hydrateWorkshop()
    a.useWorkshop.getState().rename(list[0].id, 'x from A')
    b.useWorkshop.getState().rename(list[1].id, 'y from B')
    const z = a.useWorkshop.getState().create('z from A')
    expect(await a.useWorkshop.getState().saveNow()).toBe(true)
    expect(await b.useWorkshop.getState().saveNow()).toBe(true)
    // B hears of A's shards without a reload, and A of B's.
    await vi.waitFor(() => expect(b.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['x from A', 'y from B', 'z from A']))
    await vi.waitFor(() => expect(a.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['x from A', 'y from B', 'z from A']))
    // A later save from B, which knows of z now, does not take it away.
    b.useWorkshop.getState().rename(list[1].id, 'y again')
    expect(await b.useWorkshop.getState().saveNow()).toBe(true)
    const c = await boot()
    expect(c.ws.useWorkshop.getState().shards.map((s) => s.name)).toEqual(['x from A', 'y again', 'z from A'])
    expect(c.ws.useWorkshop.getState().shards.some((s) => s.id === z)).toBe(true)
  })
})

describe('bulk import over IndexedDB', () => {
  const payload = (name: string, n: number, seed: number): string => {
    const vertices: number[][] = []
    for (let i = 0; i < n; i++) vertices.push([((i + seed) % 17) - 8, (Math.floor(i / 17) % 17) - 8, (Math.floor(i / 289) % 17) - 8])
    return JSON.stringify({ v: 2, name, unit: 0, mode: 'points', vertices, colors: vertices.map((_, i) => i % 256), faces: [] })
  }
  const kit = (count: number, n: number): File => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < count; i++) files[`kit/piece-${String(i).padStart(3, '0')}.json`] = strToU8(payload(`piece ${i}`, n, i))
    return new File([zipSync(files)], 'kit.zip', { type: 'application/zip' })
  }

  it('imports 200 kit-sized shards, all of them there after a reload, where localStorage could never hold them', async () => {
    const { ws } = await boot()
    const { useShardImport } = await import('../useShardImport')
    const imp = () => useShardImport.getState()
    imp().setPublish(false)
    // About 7000 vertices: about 90 KB on the wire, several times that as the workshop keeps it.
    await imp().openZip(kit(200, 7000))
    expect(imp().rows.filter((r) => r.read === 'ok')).toHaveLength(200)
    await imp().start()
    expect(imp().rows.filter((r) => r.run === 'done')).toHaveLength(200)
    expect(imp().stall).toBeNull()
    expect(JSON.stringify(ws.useWorkshop.getState().shards).length).toBeGreaterThan(CAP)
    expect(mem.has(LOCAL_KEY)).toBe(false)
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards).toHaveLength(200)
  }, 180_000)

  it('never publishes a shard storage refused', async () => {
    const { publishMany } = await import('../../lib/relay')
    vi.mocked(publishMany).mockClear()
    vi.doMock('../../lib/workshopDb', async (orig) => ({
      ...(await orig<typeof import('../../lib/workshopDb')>()),
      commit: async () => { throw new DOMException('full', 'QuotaExceededError') },
    }))
    const { ws } = await boot()
    const { useShardImport } = await import('../useShardImport')
    const imp = () => useShardImport.getState()
    imp().setPublish(true)
    await imp().openZip(kit(3, 10))
    await imp().start()
    const first = imp().rows[0]
    expect(first.run).toBe('failed')
    expect(first.failure).toBe('Workshop storage is full')
    expect(imp().stall).toMatch(/storage is full/)
    expect(imp().rows[1].run).toBe('idle')
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
    expect(ws.useWorkshop.getState().storageError).toMatch(/full/)
    // RETRY, still refused, still sends nothing.
    await imp().retry()
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
  })
})
