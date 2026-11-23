/**
 * saveGate.test.ts: a tab whose build is older than the deploy's
 * `minWorkshopSchema` saves no shard (lib/versionGate.ts savesBlocked,
 * store/workshopStorage.ts), and loses no edit.
 *
 * What would go wrong silently: the #555 kind of release again, where a tab
 * of the old bundle read a large model wrongly and saved it shrunk; or the
 * opposite, a gate that freezes saving on a network error, or drops the edit
 * it refused when the player does as told and reloads.
 *
 * A page load is a fresh copy of the store's modules over the same (fake)
 * IndexedDB, the same localStorage and the same sessionStorage, which a
 * reload keeps in a real tab too. fetch is a stub: nothing reaches the
 * network.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newShard, vertexAt, type ShardModel } from 'sno-core/shards'
import { versionFileOf } from '../../lib/chainRulesEpoch'
import { WORKSHOP_SCHEMA } from '../../lib/workshopSchema'
import { CHAIN_STORE_VERSION } from '../../lib/chainStoreVersion'
import { CHAIN_RULES_EPOCH } from '../../lib/chainRulesEpoch'

const HELD_KEY = 'onosendai:workshop:held'

/** A browser storage, as a plain map. */
function storage(): Storage & { mem: Map<string, string> } {
  const mem = new Map<string, string>()
  return {
    mem,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  }
}
const local = storage()
const session = storage()
;(globalThis as { localStorage?: unknown }).localStorage = local
;(globalThis as { sessionStorage?: unknown }).sessionStorage = session

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

/** What the deploy's /version.json answers next. */
type Answer = () => Promise<Response>
let answer: Answer
const json = (body: unknown): Answer => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
const sameSchema = json(versionFileOf('newer-build'))
const newerSchema = json(versionFileOf('newer-build', CHAIN_RULES_EPOCH, CHAIN_STORE_VERSION, WORKSHOP_SCHEMA + 1))
const offline: Answer = () => Promise.reject(new TypeError('fetch failed'))
const notAFile: Answer = () => Promise.resolve(new Response('<!doctype html>', { status: 200 }))
const fetchStub = vi.fn((_url: string, _init?: RequestInit) => answer())

interface Tab {
  ws: typeof import('../useWorkshop')
  st: typeof import('../workshopStorage')
  vg: typeof import('../../lib/versionGate')
}
const openTabs: Tab[] = []
let lastTab: Tab | null = null

/** A page load: the page before it gone, the modules fresh, the gate started as App starts it, then the library read. */
async function boot(): Promise<Tab> {
  lastTab?.st.closeForTests()
  vi.resetModules()
  const ws = await import('../useWorkshop')
  const st = await import('../workshopStorage')
  const vg = await import('../../lib/versionGate')
  vg.resetVersionGateForTests(true)
  const t = { ws, st, vg }
  openTabs.push(t)
  await ws.hydrateWorkshop()
  // What a save gate held before the reload is put back once the library is in.
  await st.restoreHeld()
  lastTab = t
  return t
}

async function records(): Promise<Map<string, ShardModel>> {
  const { openWorkshopDb, readAll } = await import('../../lib/workshopDb')
  const d = await openWorkshopDb()
  try { return new Map((await readAll(d)).records.map((r) => [r.id, JSON.parse(r.json) as ShardModel])) } finally { d.close() }
}

/** A shard past 64 units, the kind #555 made possible and an older bundle shrank. */
function wideShard(name: string): ShardModel {
  const s = newShard(name)
  return { ...s, vertices: [vertexAt([0, 0, 0], [1, 0, 0]), vertexAt([1000, 0, 0], [0, 1, 0])], updatedAt: 1_700_000_000_000 }
}

/** The library with one shard in it, saved, by a tab of this build. */
async function seeded(): Promise<{ id: string }> {
  answer = sameSchema
  const { ws } = await boot()
  const { id } = ws.useWorkshop.getState().addShard(wideShard('ship'), 'ship')!
  expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
  return { id }
}

beforeEach(() => {
  for (const t of openTabs.splice(0)) t.st.closeForTests()
  lastTab = null
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  local.mem.clear()
  session.mem.clear()
  fetchStub.mockClear()
  answer = sameSchema
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A cold transform of the store's modules can take seconds on a loaded machine.
describe('the save gate in the workshop', { timeout: 60_000 }, () => {
  it('a build at the deploy\'s schema saves as always', async () => {
    const { id } = await seeded()
    const { ws, vg } = await boot()
    await vg.checkVersion()
    expect(vg.savingBlocked()).toBe(false)
    ws.useWorkshop.getState().rename(id, 'renamed')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
    expect((await records()).get(id)?.name).toBe('renamed')
    expect(session.mem.has(HELD_KEY)).toBe(false)
  })

  it('an older build saves nothing once the deploy raises the minimum, and keeps the edit in hand', async () => {
    const { id } = await seeded()
    const before = (await records()).get(id)
    const { ws, st, vg } = await boot()
    answer = newerSchema
    await vg.checkVersion()
    expect(vg.savingBlocked()).toBe(true)

    ws.useWorkshop.getState().rename(id, 'renamed while stale')
    const added = ws.useWorkshop.getState().addShard(newShard('new while stale'), 'new while stale')!
    expect(await added.saved).toBe(false)
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)

    // Nothing reached the library: the stored shard is byte for byte what it was.
    const rows = await records()
    expect(rows.get(id)).toEqual(before)
    expect(rows.has(added.id)).toBe(false)
    // The edit is still on screen, and the workshop says why it is not saved.
    const names = ws.useWorkshop.getState().shards.map((s) => s.name)
    expect(names).toContain('renamed while stale')
    expect(names).toContain('new while stale')
    expect(ws.useWorkshop.getState().storageError).toBe(vg.SAVE_BLOCKED_MESSAGE)
    // And it is held where a reload keeps it.
    const held = JSON.parse(session.mem.get(HELD_KEY)!) as { shards: ShardModel[] }
    expect(held.shards.map((s) => s.name).sort()).toEqual(['new while stale', 'renamed while stale'])
    expect(st.storageMode()).toBe('indexeddb')
  })

  it('the unsaved edit survives the reload: a new shard under its own id, a changed one as a copy beside the stored one', async () => {
    const { id } = await seeded()
    const stored = (await records()).get(id)!
    const stale = await boot()
    answer = newerSchema
    await stale.vg.checkVersion()
    stale.ws.useWorkshop.getState().rename(id, 'renamed while stale')
    const added = stale.ws.useWorkshop.getState().addShard(newShard('new while stale'), 'new while stale')!

    // The player reloads, as the bar says, onto the build the deploy asked for.
    answer = sameSchema
    const { ws } = await boot()
    const list = ws.useWorkshop.getState().shards
    expect(list.find((s) => s.id === id)?.name).toBe('ship')
    expect(list.find((s) => s.id === added.id)?.name).toBe('new while stale')
    const copy = list.find((s) => s.name === 'renamed while stale (unsaved edit)')
    expect(copy).toBeDefined()
    expect(copy!.id).not.toBe(id)
    // The copy keeps the geometry the stale tab had, the wide vertex too.
    expect(copy!.vertices.map((v) => v.p)).toEqual(list.find((s) => s.id === id)!.vertices.map((v) => v.p))
    // All of it saved, the stored shard untouched, and nothing held any more.
    const rows = await records()
    expect(rows.get(id)).toEqual(stored)
    expect(rows.has(added.id)).toBe(true)
    expect(rows.has(copy!.id)).toBe(true)
    expect(session.mem.has(HELD_KEY)).toBe(false)
    expect(ws.useWorkshop.getState().notice).toContain('Your unsaved changes from before the reload are back')

    // A second reload brings nothing back twice.
    const again = await boot()
    expect(again.ws.useWorkshop.getState().shards.filter((s) => s.name.endsWith('(unsaved edit)'))).toHaveLength(1)
  })

  it('a reload that is still refused shows what is held, writes nothing, and a second edit builds on the first', async () => {
    const { id } = await seeded()
    const stale = await boot()
    answer = newerSchema
    await stale.vg.checkVersion()
    stale.ws.useWorkshop.getState().rename(id, 'renamed while stale')

    // The reload comes back to the same older build: still refused.
    const again = await boot()
    expect(again.vg.savingBlocked()).toBe(true)
    expect(again.ws.useWorkshop.getState().shards.find((s) => s.id === id)?.name).toBe('renamed while stale')
    expect((await records()).get(id)?.name).toBe('ship')
    // A second edit, on the held shard: three vertices now, under the held name.
    const held = again.ws.useWorkshop.getState().shards.find((s) => s.id === id)!
    expect(await again.ws.useWorkshop.getState().replaceShard(id, { ...held, vertices: [...held.vertices, vertexAt([2, 0, 0], [0, 0, 1])] })).not.toBe('missing')
    expect((await records()).get(id)?.name).toBe('ship')

    // Then the right build: both edits come back, as one copy.
    answer = sameSchema
    const { ws } = await boot()
    const copy = ws.useWorkshop.getState().shards.find((s) => s.name === 'renamed while stale (unsaved edit)')
    expect(copy?.vertices).toHaveLength(3)
    expect((await records()).get(id)?.name).toBe('ship')
    expect(session.mem.has(HELD_KEY)).toBe(false)
  })

  it('an edit while the last answer is old: the write waits for the deploy and is refused, never written first', async () => {
    const { id } = await seeded()
    const { ws, vg } = await boot()
    // Nothing asked yet on this load: the first write has to ask.
    answer = newerSchema
    ws.useWorkshop.getState().rename(id, 'edited before the answer')
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect(vg.savingBlocked()).toBe(true)
    expect((await records()).get(id)?.name).toBe('ship')
    expect(JSON.parse(session.mem.get(HELD_KEY)!).shards[0].name).toBe('edited before the answer')
  })

  it('a hold that does not fit says so: the edit stays on screen, and the line says to copy it out', async () => {
    const { id } = await seeded()
    const { ws, vg } = await boot()
    answer = newerSchema
    await vg.checkVersion()
    const setItem = session.setItem
    session.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    try {
      ws.useWorkshop.getState().rename(id, 'too big to hold')
      expect(ws.useWorkshop.getState().storageError).toContain('too big to hold across a reload')
      expect(ws.useWorkshop.getState().shards.find((s) => s.id === id)?.name).toBe('too big to hold')
    } finally {
      session.setItem = setItem
    }
  })

  it('in localStorage (no IndexedDB) too: nothing written while refused, and the edit comes back after the reload', async () => {
    const idb = (globalThis as { indexedDB?: unknown }).indexedDB
    ;(globalThis as { indexedDB?: unknown }).indexedDB = undefined
    try {
      answer = sameSchema
      const first = await boot()
      expect(first.st.storageMode()).toBe('local')
      first.ws.useWorkshop.getState().addShard(newShard('kept'), 'kept')
      // The gate is started and has not answered yet: the write waits for its look.
      expect(await first.ws.useWorkshop.getState().saveNow()).toBe(true)
      const savedRaw = local.mem.get('onosendai:shards')
      expect(savedRaw).toContain('kept')

      const stale = await boot()
      answer = newerSchema
      await stale.vg.checkVersion()
      stale.ws.useWorkshop.getState().addShard(newShard('made while stale'), 'made while stale')
      expect(await stale.ws.useWorkshop.getState().saveNow()).toBe(false)

      // And an edit while the last answer is old: the write's own look learns the block, and the edit is held.
      const late = await boot()
      answer = newerSchema
      late.ws.useWorkshop.getState().addShard(newShard('made before the answer'), 'made before the answer')
      await vi.waitFor(() => expect(late.vg.savingBlocked()).toBe(true))
      await vi.waitFor(() => expect(session.mem.get(HELD_KEY) ?? '').toContain('made before the answer'))
      expect(local.mem.get('onosendai:shards')).toBe(savedRaw)
      expect(local.mem.get('onosendai:shards')).toBe(savedRaw)

      answer = sameSchema
      const { ws } = await boot()
      expect(ws.useWorkshop.getState().shards.map((s) => s.name)).toContain('made while stale')
      expect(ws.useWorkshop.getState().shards.map((s) => s.name)).toContain('made before the answer')
      expect(local.mem.get('onosendai:shards')).toContain('made while stale')
      expect(local.mem.get('onosendai:shards')).toContain('made before the answer')
      expect(session.mem.has(HELD_KEY)).toBe(false)
    } finally {
      ;(globalThis as { indexedDB?: unknown }).indexedDB = idb
    }
  })

  it('offline, or a file that is not a version file: saving goes on', async () => {
    const { id } = await seeded()
    for (const a of [offline, notAFile]) {
      const { ws, vg } = await boot()
      answer = a
      await vg.checkVersion()
      expect(vg.savingBlocked()).toBe(false)
      ws.useWorkshop.getState().rename(id, `saved through ${a === offline ? 'offline' : 'a bad file'}`)
      expect(await ws.useWorkshop.getState().saveNow()).toBe(true)
      expect((await records()).get(id)?.name).toBe(`saved through ${a === offline ? 'offline' : 'a bad file'}`)
    }
  })

  it('a block learned stays when the network goes; a revert from the deploy saves what was held', async () => {
    const { id } = await seeded()
    const { ws, vg } = await boot()
    answer = newerSchema
    await vg.checkVersion()
    ws.useWorkshop.getState().rename(id, 'edited')
    answer = offline
    await vg.checkVersion()
    expect(vg.savingBlocked()).toBe(true)
    expect(await ws.useWorkshop.getState().saveNow()).toBe(false)
    expect((await records()).get(id)?.name).toBe('ship')

    answer = sameSchema
    await vg.checkVersion()
    expect(vg.savingBlocked()).toBe(false)
    await vi.waitFor(async () => expect((await records()).get(id)?.name).toBe('edited'))
    await vi.waitFor(() => expect(session.mem.has(HELD_KEY)).toBe(false))
    expect(ws.useWorkshop.getState().storageError).toBeNull()
    // The same shard, not a copy: this build made the edit and saves it as its own.
    expect(ws.useWorkshop.getState().shards.filter((s) => s.name.includes('unsaved edit'))).toHaveLength(0)
  })

  it('no import starts while saving is refused', { timeout: 60_000 }, async () => {
    await seeded()
    const { vg } = await boot()
    answer = newerSchema
    await vg.checkVersion()
    const { notLoaded } = await import('../useShardImport')
    expect(notLoaded()).toBe(vg.SAVE_BLOCKED_MESSAGE)
    answer = sameSchema
    await vg.checkVersion()
    expect(notLoaded()).toBeNull()
  })
})

describe('the events signEvent refuses while saving is refused', { timeout: 60_000 }, () => {
  it('a template carries a shard: the shard kinds, and any chest or door wearing a look (every look is a shard payload)', async () => {
    const { carriesShard } = await import('../useCyberspace')
    const { builtInLookTags } = await import('../../lib/looks')
    expect(carriesShard({ kind: 33331, tags: [] })).toBe(true)
    expect(carriesShard({ kind: 3341, tags: [['look', '{"v":1}']] })).toBe(true)
    expect(carriesShard({ kind: 3341, tags: builtInLookTags('treasure', { unit: 0, turn: [0, 0, 0], constrain: 'all' }) })).toBe(true)
    expect(carriesShard({ kind: 3341, tags: [] })).toBe(false)
    expect(carriesShard({ kind: 1, tags: [] })).toBe(false)
  })

  it('signEvent itself refuses an object while saving is refused, and other events still go through', async () => {
    const { generateSecretKey } = await import('nostr-tools/pure')
    const { nsecEncode } = await import('nostr-tools/nip19')
    const { useCyberspace } = await import('../useCyberspace')
    const vg = await import('../../lib/versionGate')
    await useCyberspace.getState().useNsec(nsecEncode(generateSecretKey()))
    vg.useVersionGate.setState({ savesBlocked: true })
    try {
      const at = Math.floor(Date.now() / 1000)
      await expect(useCyberspace.getState().signEvent({ kind: 33331, created_at: at, content: '{}', tags: [['d', 'x']] })).rejects.toThrow(vg.SAVE_BLOCKED_MESSAGE)
      await expect(useCyberspace.getState().signEvent({ kind: 3341, created_at: at, content: '', tags: [['look', '{"v":1}']] })).rejects.toThrow(vg.SAVE_BLOCKED_MESSAGE)
      const note = await useCyberspace.getState().signEvent({ kind: 1, created_at: at, content: 'hi', tags: [] })
      expect(note.sig).toHaveLength(128)
    } finally {
      vg.useVersionGate.setState({ savesBlocked: false })
    }
  })

  it('are the kinds whose content is a shard: a shard in a bag, an object, an avatar', { timeout: 60_000 }, async () => {
    const { SHARD_PAYLOAD_KINDS } = await import('../useCyberspace')
    const { SHARD_KIND, OBJECT_KIND } = await import('../../lib/hidden')
    const { AVATAR_KIND } = await import('../../lib/avatar')
    expect([...SHARD_PAYLOAD_KINDS].sort()).toEqual([SHARD_KIND, OBJECT_KIND, AVATAR_KIND].sort())
  })
})
