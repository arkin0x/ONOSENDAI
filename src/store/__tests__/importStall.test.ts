/**
 * importStall.test.ts: bulk import with PUBLISH off, in IndexedDB, as the
 * owner's tablet runs it (store/useShardImport.ts, store/workshopStorage.ts).
 *
 * arkinox, 2026-11-22: "It copied 4 instantly, then got stuck", "still
 * stopping". His diag: the main thread idle, no I/O, the run waiting on a
 * commit that never completed. Another tab of the app, frozen in the
 * background while it read what this one had just saved, held the shards'
 * store; every commit after that waited on it.
 *
 * What these prove: a tab that reads on every broadcast and never lets go
 * (a frozen one, of any build) cannot stall an import, because nothing is
 * broadcast until the import ends; STOP ends a run within its grace even
 * when storage never answers, and keeps what committed; storage that never
 * answers pauses the run with a line, never a silent hang; an interrupted
 * run leaves every committed shard whole; and a shard's save costs the same
 * one record whatever the size of the library. Synthetic shard names only.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { newShard, toPayload, vertexAt, type ShardModel } from 'sno-core/shards'

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
type ImportMod = typeof import('../useShardImport')
interface Tab { ws: WorkshopMod; st: StorageMod; imp: ImportMod }
const tabs: Tab[] = []
async function boot(): Promise<Tab> {
  for (const t of tabs.splice(0)) t.st.closeForTests()
  vi.resetModules()
  const ws = await import('../useWorkshop')
  const st = await import('../workshopStorage')
  const imp = await import('../useShardImport')
  imp.timing.gapMs = 0
  await ws.hydrateWorkshop()
  const t = { ws, st, imp }
  tabs.push(t)
  return t
}

const KIT = 'test-kit'
function piece(i: number, size = 12, at = 1_700_000_000_000 + i): ShardModel {
  const s = newShard(`piece-${i}`)
  const vertices = Array.from({ length: size }, (_, k) => vertexAt([((k + i) % 9) - 4, (k % 5) - 2, (i % 7) - 3], [0.5, 0.5, 0.5]))
  return { ...s, id: `${KIT}/piece-${i}`, name: `piece-${i}`, mode: 'points', vertices, updatedAt: at }
}
function filler(i: number): ShardModel {
  return { ...piece(10_000 + i), id: `filler-${i}`, name: `filler ${i}` }
}
function kitZip(n: number, size = 5): File {
  const files: Record<string, Uint8Array> = {}
  for (let i = 0; i < n; i++) files[`${KIT}/piece-${i}.json`] = strToU8(JSON.stringify(toPayload({ ...piece(i, size), id: 'x' })))
  return new File([zipSync(files)], `${KIT}.zip`, { type: 'application/zip' })
}

/** A library in the database, moved and marked, of these shards. */
async function library(list: ShardModel[]): Promise<Tab> {
  mem.set(LOCAL_KEY, JSON.stringify(list))
  const t = await boot()
  expect(t.st.storageMode()).toBe('indexeddb')
  return t
}

/**
 * Another tab, frozen by the browser: it hears each broadcast and starts a
 * read on the shards' store that it never finishes (each answer asks again),
 * until released. Any build that reads on a broadcast does this when frozen.
 */
function frozenTab(): { heard: () => number; release: () => void } {
  let heard = 0
  let released = false
  const bc = new BroadcastChannel('onosendai:shards')
  bc.onmessage = () => {
    heard++
    const r = indexedDB.open('onosendai:workshop')
    r.onsuccess = () => {
      const tx = r.result.transaction('shards', 'readonly')
      const st = tx.objectStore('shards')
      const again = (): void => { const g = st.count(); g.onsuccess = () => { if (!released) again() } }
      again()
      tx.oncomplete = () => r.result.close()
    }
  }
  return { heard: () => heard, release: () => { released = true; bc.close() } }
}

async function runImport(t: Tab, file: File, mode: 'update' | 'skip' | 'copy' = 'update'): Promise<void> {
  const s = t.imp.useShardImport.getState()
  await s.openZip(file)
  t.imp.useShardImport.getState().setDupMode(mode)
  t.imp.useShardImport.getState().setPublish(false)
  await t.imp.useShardImport.getState().start()
}

beforeEach(() => {
  for (const t of tabs.splice(0)) t.st.closeForTests()
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  mem.clear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('another tab frozen while it reads (the owner\'s "4 then stuck")', () => {
  it('cannot stall an import: nothing is broadcast until it ends, then once', async () => {
    const lib = [...Array.from({ length: 12 }, (_, i) => piece(i)), ...Array.from({ length: 40 }, (_, i) => filler(i))]
    const t = await library(lib)
    const frozen = frozenTab()
    try {
      await runImport(t, kitZip(12))
      const rows = t.imp.useShardImport.getState().rows
      expect(rows.filter((r) => r.run === 'done')).toHaveLength(12)
      expect(t.imp.useShardImport.getState().stall).toBeNull()
      // Told once, at the end.
      await vi.waitFor(() => expect(frozen.heard()).toBe(1))
    } finally { frozen.release() }
    // Every piece is the zip's now, in the library a reload reads.
    const again = await boot()
    for (let i = 0; i < 12; i++) expect(again.ws.useWorkshop.getState().shards.find((s) => s.id === `${KIT}/piece-${i}`)!.vertices).toHaveLength(5)
  }, 30_000)

  it('new shards (UPDATE off) come in past a frozen tab too', async () => {
    const t = await library([filler(0), filler(1)])
    const frozen = frozenTab()
    try {
      await runImport(t, kitZip(8), 'skip')
      expect(t.imp.useShardImport.getState().rows.filter((r) => r.run === 'done')).toHaveLength(8)
    } finally { frozen.release() }
  }, 30_000)
})

describe('storage that never answers', () => {
  it('pauses the run with a line, never a silent hang, and STOP ends it within its grace', async () => {
    const t = await library([piece(0), piece(1), piece(2), piece(3)])
    t.imp.timing.saveStallMs = 300
    t.imp.timing.stopGraceMs = 100
    // Every commit from here on waits forever (a lock held elsewhere).
    const realTx = IDBDatabase.prototype.transaction
    let hold = true
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (hold && args[1] === 'readwrite') {
        // A transaction that never completes: never handed a request, never committed.
        const tx = realTx.apply(this, args)
        const os = tx.objectStore(Array.isArray(args[0]) ? args[0][0] : args[0] as string)
        const again = (): void => { const g = os.count(); g.onsuccess = () => { if (hold) again() } }
        again()
        return tx
      }
      return realTx.apply(this, args)
    })
    const started = Date.now()
    await runImport(t, kitZip(4))
    expect(Date.now() - started).toBeLessThan(5000)
    const s = t.imp.useShardImport.getState()
    expect(s.phase).toBe('done')
    expect(s.stall).toMatch(/not answering/)
    expect(s.rows.every((r) => r.run !== 'done')).toBe(true)
    expect(s.rows.some((r) => r.failure === t.imp.NOT_SAVED)).toBe(true)

    // STOP during a hung save: the run ends within the grace.
    t.imp.timing.saveStallMs = 60_000
    t.imp.useShardImport.getState().close()
    const running = runImport(t, kitZip(4))
    await vi.waitFor(() => expect(t.imp.useShardImport.getState().rows.some((r) => r.run === 'working')).toBe(true))
    const stopAt = Date.now()
    t.imp.useShardImport.getState().stop()
    await running
    expect(Date.now() - stopAt).toBeLessThan(1500)
    expect(t.imp.useShardImport.getState().phase).toBe('done')
    hold = false
    // Broadcasts are not held after a run cut short: the next save is told at once.
    const heard: unknown[] = []
    const bc = new BroadcastChannel('onosendai:shards')
    bc.onmessage = (ev) => { heard.push(ev.data) }
    try {
      t.ws.useWorkshop.getState().rename(`${KIT}/piece-0`, 'renamed after')
      expect(await t.ws.useWorkshop.getState().saveNow()).toBe(true)
      await vi.waitFor(() => expect(heard.some((m) => ((m as { put?: string[] }).put ?? []).includes(`${KIT}/piece-0`))).toBe(true))
    } finally { bc.close() }
  }, 30_000)
})

describe('a tab closed in the middle of an import', () => {
  // All or nothing per commit (fake-indexeddb does not model durability: a closed tab keeps relaxed commits in a browser).
  it('keeps every shard whose save committed, each whole', async () => {
    const lib = Array.from({ length: 10 }, (_, i) => piece(i, 12, 1000))
    const t = await library(lib)
    // Commits land for the first few shards, then the tab is gone.
    const s = t.imp.useShardImport.getState()
    await s.openZip(kitZip(10))
    t.imp.useShardImport.getState().setDupMode('update')
    const running = t.imp.useShardImport.getState().start()
    await vi.waitFor(() => expect(t.imp.useShardImport.getState().rows.filter((r) => r.run === 'done').length).toBeGreaterThanOrEqual(3))
    const done = t.imp.useShardImport.getState().rows.filter((r) => r.run === 'done').map((r) => r.id)
    t.st.closeForTests()
    await running.catch(() => undefined)
    const again = await boot()
    const shards = again.ws.useWorkshop.getState().shards
    expect(shards).toHaveLength(10)
    for (const sh of shards) expect([5, 12]).toContain(sh.vertices.length)
    for (const id of done) expect(shards.find((x) => x.id === id)!.vertices).toHaveLength(5)
  }, 30_000)
})

describe('the cost of one shard', () => {
  it('is one record written, whatever the size of the library', async () => {
    const writes: number[] = []
    for (const size of [20, 400]) {
      ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
      mem.clear()
      const lib = [...Array.from({ length: 10 }, (_, i) => piece(i)), ...Array.from({ length: size }, (_, i) => filler(i))]
      const t = await library(lib)
      const realPut = IDBObjectStore.prototype.put
      let puts = 0
      const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'shards') puts++
        return realPut.apply(this, args)
      })
      await runImport(t, kitZip(10))
      spy.mockRestore()
      expect(t.imp.useShardImport.getState().rows.filter((r) => r.run === 'done')).toHaveLength(10)
      writes.push(puts)
    }
    // Ten shards, ten records, for a library of 30 and of 410: never the library.
    expect(writes).toEqual([10, 10])
  }, 60_000)
})

describe('durability', () => {
  it('relaxed only while no save gates a publish: PUBLISH on keeps every commit strict', async () => {
    const seen: Record<string, string[]> = { off: [], on: [] }
    for (const publish of [false, true]) {
      ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
      mem.clear()
      const t = await library(Array.from({ length: 4 }, (_, i) => piece(i)))
      const realTx = IDBDatabase.prototype.transaction
      const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        const stores = Array.isArray(args[0]) ? args[0] : [args[0]]
        if (args[1] === 'readwrite' && stores.includes('shards')) seen[publish ? 'on' : 'off'].push((args[2] as { durability?: string } | undefined)?.durability ?? 'default')
        return realTx.apply(this, args)
      })
      await t.imp.useShardImport.getState().openZip(kitZip(4))
      t.imp.useShardImport.getState().setDupMode('update')
      t.imp.useShardImport.getState().setPublish(publish)
      await t.imp.useShardImport.getState().start()
      spy.mockRestore()
      // After the run, an edit commits strict again.
      t.ws.useWorkshop.getState().rename(`${KIT}/piece-0`, 'after')
      const realTx2 = IDBDatabase.prototype.transaction
      const after: string[] = []
      const spy2 = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        if (args[1] === 'readwrite') after.push((args[2] as { durability?: string } | undefined)?.durability ?? 'default')
        return realTx2.apply(this, args)
      })
      expect(await t.ws.useWorkshop.getState().saveNow()).toBe(true)
      spy2.mockRestore()
      expect(after).toContain('strict')
    }
    expect(seen.off.length).toBeGreaterThan(0)
    expect(seen.off.every((d) => d === 'relaxed')).toBe(true)
    expect(seen.on.length).toBeGreaterThan(0)
    expect(seen.on.every((d) => d === 'strict')).toBe(true)
  }, 30_000)
})
