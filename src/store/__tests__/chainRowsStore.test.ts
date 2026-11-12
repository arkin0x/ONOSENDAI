/**
 * chainRowsStore.test.ts - the chain in `onosendai:events`, through the store:
 * the guarantees of #528, #531 and #536 on rows, and what the move to rows must
 * never do. Two tabs are two imports of the store over one localStorage and
 * one IndexedDB (fake-indexeddb); a reload is a fresh import. The relays know
 * nothing here, and nothing touches a network.
 */

import { provedHop } from '../fixtures/provedHop'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const version = vi.hoisted(() => ({ v: 2 as 1 | 2 }))
const posted = vi.hoisted(() => [] as unknown[])
const sent = vi.hoisted(() => [] as Array<{ id: string }>)
const quota = vi.hoisted(() => ({ chainChars: Infinity }))
/** What the deploy's /version.json answers: a value, or nothing at all (offline). */
const deploy = vi.hoisted(() => ({ answer: null as unknown }))
/** What the relays answer a head confirmation: the events, or null when nobody counted. */
const relays = vi.hoisted(() => ({ confirm: [] as unknown, asked: 0 }))
vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => {
      if (k.startsWith('onosendai:chain:') && String(v).length > quota.chainChars) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      m.set(k, String(v))
    },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
})
vi.mock('../../lib/chainStoreVersion', () => ({ get CHAIN_STORE_VERSION() { return version.v }, CHAIN_ROWS_ON_WEBKIT: false }))
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn((m: unknown) => { posted.push(m) }), cancelProof: vi.fn() }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => { relays.asked++; return relays.confirm }) }
})
/** What the relays were sent, by id: every publish is taken. */
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publish: (e: { id: string }) => { sent.push({ id: e.id }); return Promise.resolve({ ok: true as const }) },
  publishMany: (urls: string[]) => Promise.resolve({ ok: true as const, accepted: urls }),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (k: number): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + BigInt(k), y: home.y, z: home.z })
const LOCAL_KEY = `onosendai:chain:${pk}`

function chainOf(n: number): NostrEvent[] {
  const out: NostrEvent[] = [finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent]
  for (let k = 1; k < n; k++) {
    out.push(finalizeEvent(hopTemplate({
      createdAt: 1_000 + k, genesisId: out[0].id, previousId: out[k - 1].id,
      prevCoordHex: k === 1 ? pk : positionHex(at(k - 1), home.plane), to: at(k), plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk) as NostrEvent)
  }
  return out
}

interface Tab {
  store: typeof import('../useCyberspace')
  rows: typeof import('../../lib/chainStore')
  S: () => ReturnType<typeof import('../useCyberspace')['useCyberspace']['getState']>
}

/** The tabs a test opened: their background work (a rows check, its flags) is let finish before the next test's database. */
const opened: Tab[] = []

async function openTab(): Promise<Tab> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const rows = await import('../../lib/chainStore')
  await store.savedChainLoaded()
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  const tab = { store, rows, S: store.useCyberspace.getState }
  opened.push(tab)
  return tab
}

/** A proof landing in `tab`: signed from the head it holds, saved at once. */
async function signMove(tab: Tab, axis: 'x' | 'y' = 'x'): Promise<string> {
  const S = tab.S
  // Two tabs moving the same way in one second sign one event, with one id: no race at all. A race is two different moves.
  tab.store.useCyberspace.setState({ pendingTarget: { ...S().position, [axis]: S().position[axis] + 1n } })
  await S().applyProofMessage({ type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(S()), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: S().prevEventId })
  return S().prevEventId
}

async function press(tab: Tab): Promise<void> {
  const S = tab.S
  tab.store.useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 1n } })
  await S().commit()
}

/**
 * The look before signing can be beaten by a millisecond in a browser, and
 * never is here, where nothing runs in between. So a test blinds it: the record
 * read alone, which is the look and nothing else, answers "none", which proves
 * nothing and lets the move go on. The commit itself is untouched. Returns what puts it back.
 */
function blindTheLook(): () => void {
  const proto = IDBObjectStore.prototype as unknown as { get: (...x: unknown[]) => unknown }
  const real = proto.get
  proto.get = function (this: IDBObjectStore, ...x: unknown[]) {
    const alone = this.name === 'chains' && this.transaction.mode === 'readonly' && this.transaction.objectStoreNames.length === 1
    return real.apply(this, alone ? ['no such identity'] : x)
  }
  return () => { proto.get = real }
}

/** The rows, read directly, with no tab in between. */
async function rowsNow(): Promise<{ events: NostrEvent[]; published: string[]; generation: number } | null> {
  const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
  const { readChain } = await import('../../lib/eventDb/chainRows')
  const r = await withEventDb((db) => readChain(db, pk))
  closeEventDb()
  return r
}

async function seedOldStores(events: NostrEvent[], opts: { published?: string[]; localToo?: boolean; savedAt?: number } = {}): Promise<void> {
  const published = opts.published ?? []
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  db.writeStoredChain(pk, { events, published, stats: { hops: 3 }, held: false, savedAt: opts.savedAt ?? 1 }, false)
  await db.chainWritesSettled()
  db.closeChainDb()
  if (opts.localToo) localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events, published, stats: { hops: 3 }, savedAt: opts.savedAt ?? 1 }))
}

async function oldRecord(): Promise<unknown> {
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  const r = await db.readStoredChain(pk)
  db.closeChainDb()
  return r
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
/**
 * A wait for what another tab or the database does: polled, and bounded by the
 * test's own 5 s rather than waitFor's 1 s, which a loaded machine passed
 * while the work was still on its way (2026-11-12).
 */
const SOON = { timeout: 4_500, interval: 20 }

beforeEach(() => {
  posted.length = 0
  sent.length = 0
  relays.confirm = []
  version.v = 2
  deploy.answer = { build: 'deployed', minChainEpoch: 2, chainStore: 2 }
  vi.stubGlobal('fetch', async (url: unknown) => {
    if (!String(url).includes('version.json') || deploy.answer === null) throw new Error('no network')
    return { ok: true, json: async () => deploy.answer }
  })
  quota.chainChars = Infinity
  localStorage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  localStorage.setItem('onosendai:live', '0')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
/** What a test broke on purpose and must put back even when it fails part way. */
const putBack: Array<() => void> = []
afterEach(async () => {
  while (putBack.length > 0) putBack.pop()!()
  // A check a tab started (its signatures, its flags, what follows them) ends
  // in this test's database, not in the next test's fresh one. Bounded: a tab
  // a test left without relays or rows answers within its own patience.
  for (const t of opened.splice(0)) {
    await Promise.race([t.S().confirmHeadNow().catch(() => null).then(() => t.rows.chainRowsSettled()), tick(3_000)])
    // LOCAL again: a publisher a test started stops retrying, so nothing of it runs on into the next file.
    t.store.useCyberspace.setState({ live: false })
  }
  await tick(30)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('moving a chain to rows', () => {
  // The file's first test pays the first import of the store's module graph
  // (a cold transform, over 4 s alone, that later tabs do not pay), so under a
  // parallel suite it passed 5 s on the import alone, and the next test failed
  // on what it left running. A warm-up in beforeAll is not used: a store loaded
  // there keeps working (its probe, its version look) into the first test.
  it('copies the chain whole, and the load after it reads the rows', { timeout: 20_000 }, async () => {
    const chain = chainOf(30)
    await seedOldStores(chain, { published: chain.slice(0, 10).map((e) => e.id) })
    const a = await openTab()
    expect(a.S().events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
    expect(a.rows.inRows(pk)).toBe(true)
    const r = await rowsNow()
    expect(r!.events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
    expect(r!.published).toEqual(chain.slice(0, 10).map((e) => e.id))
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
    expect(b.S().prevEventId).toBe(chain[29].id)
    expect(b.S().published[chain[0].id]).toBe('ok')
    expect(b.S().published[chain[20].id]).toBe('queued')
  })

  it('takes the further copy of the two old ones (his device: localStorage stopped at an old stretch)', async () => {
    const chain = chainOf(30)
    await seedOldStores(chain, { savedAt: 2 })
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: chain.slice(0, 20), published: [], stats: {}, savedAt: 9_000 }))
    const a = await openTab()
    expect(a.S().events).toHaveLength(30)
    expect((await rowsNow())!.events).toHaveLength(30)
  })

  it('moves a chain only localStorage held', async () => {
    const chain = chainOf(12)
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: chain, published: [], stats: {}, savedAt: 5 }))
    await openTab()
    expect((await rowsNow())!.events).toHaveLength(12)
  })

  it('NO USER LOSES A CHAIN: the old copies are never written again, however many moves follow', async () => {
    const chain = chainOf(20)
    await seedOldStores(chain, { published: [chain[0].id], localToo: true })
    const frozenLocal = localStorage.getItem(LOCAL_KEY)
    const frozenRecord = await oldRecord()
    const a = await openTab()
    for (let i = 0; i < 5; i++) await signMove(a)
    a.S().setPublishStatus(a.S().prevEventId, 'ok')
    await a.rows.chainRowsSettled()
    expect(a.S().events).toHaveLength(25)
    expect((await rowsNow())!.events).toHaveLength(25)
    expect(localStorage.getItem(LOCAL_KEY)).toBe(frozenLocal)
    expect(await oldRecord()).toEqual(frozenRecord)
    // And after a reload.
    const b = await openTab()
    await signMove(b)
    await b.rows.chainRowsSettled()
    expect(localStorage.getItem(LOCAL_KEY)).toBe(frozenLocal)
    expect(await oldRecord()).toEqual(frozenRecord)
  })

  it('a move that does not verify switches nothing: the old stores stay in charge, and nothing is lost', async () => {
    const chain = chainOf(12)
    await seedOldStores(chain)
    vi.resetModules()
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      const row = x[0] as { id?: string; content?: string }
      if (this.name === 'events' && row.id === chain[5].id) return real.apply(this, [{ ...row, content: 'bit rot' }])
      return real.apply(this, x)
    }
    let a: Tab
    try {
      a = await openTab()
    } finally { proto.put = real }
    expect(a.rows.inRows(pk)).toBe(false)
    expect(a.S().events).toHaveLength(12)
    expect(await rowsNow()).toBeNull()
    // Still saving where it did.
    await signMove(a)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    expect(localStorage.getItem('onosendai:chain-rows:' + pk)).toBeNull()
  })

  it('a database wiped under the marker: the frozen copy is drawn, nothing is signed or moved until the relays answer, it says so, then it moves again', { timeout: 30_000 }, async () => {
    const chain = chainOf(15)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    relays.confirm = null
    const b = await openTab()
    expect(b.S().events).toHaveLength(15)
    // Not taken as a first move: the frozen copy is from before the switch, so it is not written as the chain.
    expect(b.rows.inRows(pk)).toBe(false)
    expect(await rowsNow()).toBeNull()
    expect((await import('../useToast')).useToast.getState().toast).toMatchObject({ label: 'SAVED CHAIN CLEARED', reload: true })
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.ROWS_WIPED_MESSAGE)
    const head = b.S().prevEventId
    await signMove(b).catch(() => {})
    expect(b.S().prevEventId).toBe(head)
    // The relays answer: the move goes on, and the chain is in rows again.
    relays.confirm = []
    b.store.useCyberspace.setState({ proof: { ...b.S().proof, status: 'idle', message: null } })
    const m = await signMove(b)
    await vi.waitFor(() => expect(b.rows.inRows(pk)).toBe(true), { timeout: 10_000, interval: 20 })
    await b.rows.chainRowsSettled()
    await vi.waitFor(async () => expect((await rowsNow())!.events.map((e) => e.id)).toEqual([...chain.map((e) => e.id), m]), { timeout: 10_000, interval: 50 })
  })

  it('wiped with moves made since the switch: the moves are said to be gone, and none is signed from the frozen copy unasked', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    await signMove(a)
    await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    relays.confirm = null
    const b = await openTab()
    // The frozen copy, six actions: the two moves no relay took are gone, and the person is told.
    expect(b.S().events).toHaveLength(6)
    expect((await import('../useToast')).useToast.getState().toast?.meta).toContain('Unsent moves may be gone')
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.ROWS_WIPED_MESSAGE)
    expect(await rowsNow()).toBeNull()
  })

  it('wiped, and no copy anywhere: once the relays have answered there is nothing to wait for, and a spawn may be signed', async () => {
    const chain = chainOf(4)
    await seedOldStores(chain)
    await openTab()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    const b = await openTab()
    expect(b.S().events).toHaveLength(0)
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.ROWS_WIPED_MESSAGE)
    relays.confirm = []
    await b.S().confirmHeadNow()
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).resolves.toBeTruthy()
  })

  it('a copy holding other actions is kept as a branch set aside', async () => {
    const chain = chainOf(10)
    const other = finalizeEvent(hopTemplate({
      createdAt: 5_000, genesisId: chain[0].id, previousId: chain[4].id, prevCoordHex: positionHex(at(4), home.plane), to: { ...at(5), y: at(5).y + 1n }, plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk) as NostrEvent
    await seedOldStores(chain, { savedAt: 9_000 })
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: [...chain.slice(0, 5), other], published: [], stats: {}, savedAt: 1 }))
    const a = await openTab()
    expect(a.S().events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
    const parted = await a.rows.rowsSetAside(pk)
    expect(parted).toHaveLength(1)
    expect(parted[0].events.map((e) => e.id)).toContain(other.id)
  })

  it('a chain set aside under the old store comes along', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    vi.resetModules()
    const db = await import('../../lib/chainDb')
    db.setAsideStoredChain(pk, { events: chain.slice(0, 3), published: [], stats: {}, held: false, savedAt: 1 })
    await db.chainWritesSettled()
    db.closeChainDb()
    const a = await openTab()
    expect((await a.rows.rowsSetAside(pk))).toHaveLength(1)
  })

  it('an identity with no chain is in rows from its first action, and is not marked as holding one until then', async () => {
    const a = await openTab()
    expect(a.S().events).toHaveLength(0)
    expect(a.rows.inRows(pk)).toBe(true)
    expect(await rowsNow()).toBeNull()
    // What a stored bunker or extension identity is reconnected by at boot.
    expect(a.rows.rowsMarked(pk)).toBe(false)
    const spawn = finalizeEvent(spawnTemplate(pk, 2_000), sk) as NostrEvent
    a.S().adoptChain([spawn])
    await a.rows.chainRowsSettled()
    expect(a.rows.rowsMarked(pk)).toBe(true)
    expect((await rowsNow())!.events.map((e) => e.id)).toEqual([spawn.id])
  })
})

describe('a move in rows', () => {
  it('writes one row, however long the chain is', async () => {
    const chain = chainOf(120)
    await seedOldStores(chain)
    const a = await openTab()
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    const writes: Record<string, number> = {}
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) { writes[this.name] = (writes[this.name] ?? 0) + 1; return real.apply(this, x) }
    try {
      await signMove(a)
      await a.rows.chainRowsSettled()
    } finally { proto.put = real }
    expect(writes.events).toBe(1)
  })

  it('a relay taking it writes the row, and keeps when the chain changed', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    const a = await openTab()
    const head = await signMove(a)
    await a.rows.chainRowsSettled()
    const before = await rowsNow()
    a.S().setPublishStatus(head, 'ok')
    await a.rows.chainRowsSettled()
    const after = await rowsNow()
    expect(after!.published).toContain(head)
    expect(after!.generation).toBe(before!.generation)
  })

  it('a respawn: the old chain is not read back as a second branch', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    const fresh = finalizeEvent(spawnTemplate(pk, 9_000), sk) as NostrEvent
    a.S().adoptChain([fresh])
    await a.rows.chainRowsSettled()
    expect(a.S().events.map((e) => e.id)).toEqual([fresh.id])
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toEqual([fresh.id])
    expect(b.S().genesisId).toBe(fresh.id)
  })

  it('keeps per identity: another identity\'s rows are not read', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    const a = await openTab()
    await signMove(a)
    await a.rows.chainRowsSettled()
    const other = generateSecretKey()
    const otherPk = getPublicKey(other)
    expect(await a.rows.readRows(otherPk)).toBeNull()
  })
})

describe('two tabs, one chain', () => {
  it('a press sees the other tab\'s move at once, with no pause and no mark to wait on', async () => {
    const chain = chainOf(12)
    await seedOldStores(chain)
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const moved = await signMove(a)
    await a.rows.chainRowsSettled()
    posted.length = 0
    await press(b)
    expect(posted).toHaveLength(0)
    expect(b.S().prevEventId).toBe(moved)
    await press(b)
    expect(posted).toHaveLength(1)
    expect((posted[0] as { prevEventId: string }).prevEventId).toBe(moved)
  })

  it('a tab with no chain record left to compare still moves: an identity\'s second tab, both before any action', async () => {
    const a = await openTab()
    const b = await openTab()
    expect(a.rows.inRows(pk)).toBe(true)
    expect(b.rows.inRows(pk)).toBe(true)
  })

  it('NEVER FORKS: both sign from one head; the second commit loses, its action is never sent, and it is taken back', async () => {
    const chain = chainOf(12)
    await seedOldStores(chain)
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const head = chain[11].id
    const moveA = await signMove(a)
    await a.rows.chainRowsSettled()
    // B's look comes to nothing, so it signs from the old head.
    expect(b.S().prevEventId).toBe(head)
    const see = blindTheLook()
    const moveB = await signMove(b, 'y')
    see()
    expect(moveB).not.toBe(moveA)
    expect(await b.rows.chainLanded(pk, moveB)).toBe(false)
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(moveA), SOON)
    const rows = await rowsNow()
    expect(rows!.events.map((e) => e.id)).toEqual([...chain.map((e) => e.id), moveA])
    // B's action is not in its chain, not owed to any relay, and is kept, signed, as a branch set aside.
    expect(b.S().events.map((e) => e.id)).not.toContain(moveB)
    expect(b.S().published[moveB]).toBeUndefined()
    expect(b.S().proof.message).toBe(b.store.OTHER_TAB_FIRST_MESSAGE)
    await vi.waitFor(async () => {
      const parted = await b.rows.rowsSetAside(pk)
      expect(parted.flatMap((p) => p.events.map((e) => e.id))).toContain(moveB)
    }, SOON)
    // And it moves on from the head that won.
    b.store.useCyberspace.setState({ proof: { ...b.S().proof, status: 'idle', message: null } })
    const next = await signMove(b)
    await b.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id)).toEqual([...chain.map((e) => e.id), moveA, next])
  })

  it('the winner\'s action lands, and is free to go out', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    const a = await openTab()
    const moved = await signMove(a)
    expect(await a.rows.chainLanded(pk, moved)).toBe(true)
    expect(a.rows.committedHead(pk).headId).toBe(moved)
  })

  it('in a race of many, exactly one chain: every action in the rows follows the one before it', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    await openTab()
    const tabs = [await openTab(), await openTab(), await openTab()]
    await Promise.all(tabs.map((t, i) => signMove(t, i === 1 ? 'y' : 'x')))
    await Promise.all(tabs.map((t) => t.rows.chainRowsSettled()))
    await vi.waitFor(async () => {
      const heads = tabs.map((t) => t.S().prevEventId)
      expect(new Set(heads).size).toBe(1)
    }, SOON)
    const rows = await rowsNow()
    expect(rows!.events).toHaveLength(6)
    const previous = (e: NostrEvent): string | undefined => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]
    expect(previous(rows!.events[5])).toBe(chain[4].id)
  })

  it('a tab of an older build, still open through the deploy: its move is folded in by its mark', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain)
    const a = await openTab()
    // What that tab does: the whole chain to the old record, and a mark with no `:r`.
    const further = chainOf(9)
    localStorage.setItem(`onosendai:chain-mark:${pk}`, `9:${further[8].id.slice(0, 16)}:zzzzzzzzabc`)
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: further, published: [], stats: {}, savedAt: Date.now() }))
    a.store.useCyberspace.setState({ cursor: { ...a.S().position, x: a.S().position.x + 1n } })
    await a.S().commit()
    expect(a.S().events.map((e) => e.id)).toContain(further[8].id)
    await a.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id)).toContain(further[8].id)
  })

  it('a tab of an older build is told by its own mark, in the shape it reads, and a rows tab does not take that for an older tab', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain)
    const a = await openTab()
    const head = await signMove(a)
    const mark = localStorage.getItem(`onosendai:chain-mark:${pk}`)
    expect(mark).toMatch(new RegExp(`^9:${head.slice(0, 16)}:[0-9a-z]+:r$`))
    const b = await openTab()
    await press(b)
    expect(b.S().events.map((e) => e.id)).toContain(head)
    expect(b.S().proof.message).not.toBe(b.store.OTHER_TAB_SAVING_MESSAGE)
  })
})

describe('when storage will not take it', () => {
  it('a full disk: the chain stays in hand, what has not landed is kept, the person is told once, and it lands when there is room', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    const toast = (await import('../useToast')).useToast
    a.rows.setRowsPatience({ retry: 60_000 })
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    let m1: string, m2: string
    try {
      m1 = await signMove(a)
      await a.rows.chainRowsSettled()
      // A refused write never holds an action back: the relays are the safer place for it.
      expect(await a.rows.chainLanded(pk, m1)).toBe(true)
      m2 = await signMove(a)
      await a.rows.chainRowsSettled()
    } finally { proto.put = real }
    expect(a.S().events.map((e) => e.id).slice(-2)).toEqual([m1, m2])
    expect(toast.getState().toast?.label).toBe('STORAGE FULL')
    const tail = JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)!) as NostrEvent[]
    expect(tail.map((e) => e.id)).toEqual([m1, m2])
    expect((await rowsNow())!.events).toHaveLength(6)
    // Room again: the next save carries everything that had not landed.
    const m3 = await signMove(a)
    await a.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id).slice(-3)).toEqual([m1, m2, m3])
    expect(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)).toBeNull()
  })

  it('a reload after a full disk brings back what never reached the rows, and writes it', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    let m1: string
    try {
      m1 = await signMove(a)
      await a.rows.chainRowsSettled()
    } finally { proto.put = real }
    const b = await openTab()
    expect(b.S().prevEventId).toBe(m1)
    await b.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id)).toContain(m1)
    expect(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)).toBeNull()
  })

  it('a page closed with a write on its way: what had not landed is kept before it goes', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    const m1 = await signMove(a)
    a.rows.flushRowsToTail()
    const tail = JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`) ?? '[]') as NostrEvent[]
    expect(tail.map((e) => e.id)).toEqual([m1])
    await a.rows.chainRowsSettled()
    // The write did land after all: the key was only ever a spare, and is gone.
    expect(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)).toBeNull()
  })

  it('tail actions that no longer reassemble are set aside, never in the chain, and the chain stands', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    await openTab()
    const stray = finalizeEvent(hopTemplate({
      createdAt: 7_000, genesisId: chain[0].id, previousId: 'a'.repeat(64), prevCoordHex: pk, to: at(9), plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk) as NostrEvent
    localStorage.setItem(`onosendai:chain-unsaved:${pk}`, JSON.stringify([stray]))
    const b = await openTab()
    expect(b.S().events).toHaveLength(6)
    await vi.waitFor(async () => expect((await b.rows.rowsSetAside(pk)).flatMap((p) => p.events.map((e) => e.id))).toContain(stray.id), SOON)
  })

  it('a tail holding a sibling of the head is set aside: a page closed mid-commit, whose commit then lost, shows no fork', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const won = await signMove(a)
    await a.rows.chainRowsSettled()
    // B signed from the old head and closed before it heard: its move is in the tail, and lost in the rows.
    const see = blindTheLook()
    const lost = await signMove(b, 'y')
    see()
    const lostEvent = b.S().events.find((e) => e.id === lost)!
    await b.rows.chainRowsSettled()
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(won), SOON)
    localStorage.setItem(`onosendai:chain-unsaved:${pk}`, JSON.stringify([lostEvent]))
    const c = await openTab()
    expect(c.S().prevEventId).toBe(won)
    expect(c.S().events.map((e) => e.id)).not.toContain(lost)
    expect(c.S().forkNotice).toBeNull()
    await vi.waitFor(async () => expect((await c.rows.rowsSetAside(pk)).flatMap((p) => p.events.map((e) => e.id))).toContain(lost), SOON)
    expect(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)).toBeNull()
  })

  it('rows that stay unreadable across reloads: unsent moves are kept, and come back in hand each time', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      tx.objectStore('events').delete(chain[3].id)
      tx.oncomplete = () => resolve()
    }))
    closeEventDb()
    const b = await openTab()
    const m1 = await signMove(b)
    expect(JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)!).map((e: NostrEvent) => e.id)).toContain(m1)
    const c = await openTab()
    expect(c.S().prevEventId).toBe(m1)
    const m2 = await signMove(c)
    expect(JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)!).map((e: NostrEvent) => e.id)).toEqual(expect.arrayContaining([m1, m2]))
  })

  it('private mode, no IndexedDB at all: localStorage as ever, the chain whole in hand', async () => {
    const chain = chainOf(6)
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: chain, published: [], stats: {}, savedAt: 5 }))
    const real = (globalThis as { indexedDB?: IDBFactory }).indexedDB
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    try {
      const a = await openTab()
      expect(a.S().events).toHaveLength(6)
      expect(a.rows.inRows(pk)).toBe(false)
      const m = await signMove(a)
      expect(a.S().prevEventId).toBe(m)
      expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
    } finally {
      ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = real
    }
  })

  it('private mode, IndexedDB refuses every open: the same, and moves are not held', async () => {
    const chain = chainOf(6)
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: chain, published: [], stats: {}, savedAt: 5 }))
    const real = (globalThis as { indexedDB?: IDBFactory }).indexedDB
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError') } }
    try {
      const a = await openTab()
      expect(a.S().events).toHaveLength(6)
      expect(a.rows.inRows(pk)).toBe(false)
      const m = await signMove(a)
      expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
      expect(await a.rows.chainLanded(pk, m)).toBe(true)
    } finally {
      ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = real
    }
  })

  it('rows that will not answer: the frozen copy stands in, nothing goes over it, and the late answer is taken', async () => {
    const chain = chainOf(10)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    const frozen = localStorage.getItem(LOCAL_KEY)
    const further = await (async () => {
      const a = await openTab()
      const m = await signMove(a)
      await a.rows.chainRowsSettled()
      return m
    })()
    // The next load cannot get an answer in time.
    vi.resetModules()
    const rows = await import('../../lib/chainStore')
    rows.setRowsPatience({ read: 0 })
    const store = await import('../useCyberspace')
    await store.savedChainLoaded()
    // The frozen copy, or the late answer already: never less, and never a write over the copy.
    expect(store.useCyberspace.getState().events.length).toBeGreaterThanOrEqual(10)
    expect(localStorage.getItem(LOCAL_KEY)).toBe(frozen)
    await vi.waitFor(() => expect(store.useCyberspace.getState().prevEventId).toBe(further), SOON)
    expect(rows.inRows(pk)).toBe(true)
  })

  it('rows that disagree with their record are not read as a chain', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      tx.objectStore('events').delete(chain[3].id)
      tx.oncomplete = () => resolve()
    }))
    closeEventDb()
    const b = await openTab()
    expect(b.S().events).toHaveLength(6)
    expect(b.rows.inRows(pk)).toBe(false)
  })
})

describe('reversible by version', () => {
  it('back to version 1: every move made in rows is taken, and the old stores are written from it', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m1 = await signMove(a)
    const m2 = await signMove(a)
    await a.rows.chainRowsSettled()
    version.v = 1
    const b = await openTab()
    expect(b.S().events.map((e) => e.id).slice(-2)).toEqual([m1, m2])
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m2)
    const kept = await db.readStoredChain(pk)
    expect(kept !== null && typeof kept === 'object' && kept.events.map((e) => e.id)).toContain(m2)
    db.closeChainDb()
  })

  it('and forward again: what version 1 saved meanwhile is folded into the rows, and nothing is lost either way', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m1 = await signMove(a)
    await a.rows.chainRowsSettled()
    version.v = 1
    const b = await openTab()
    const m2 = await signMove(b)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    db.closeChainDb()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    version.v = 2
    const c = await openTab()
    await vi.waitFor(() => expect(c.S().prevEventId).toBe(m2), SOON)
    await c.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id).slice(-2)).toEqual([m1, m2])
  })

  it('a build on version 1 with no rows at all is the old build, to the letter', async () => {
    version.v = 1
    const chain = chainOf(8)
    await seedOldStores(chain)
    const a = await openTab()
    expect(a.S().events).toHaveLength(8)
    expect(a.rows.inRows(pk)).toBe(false)
    expect(await rowsNow()).toBeNull()
  })
})

describe('the first draw', () => {
  it('a chain in rows is ready once its read has landed; an old copy in hand waits for nothing', async () => {
    const chain = chainOf(6)
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 2, events: chain, published: [], stats: {}, savedAt: 5 }))
    vi.resetModules()
    const first = await import('../useCyberspace')
    expect(first.useCyberspace.getState().events).toHaveLength(6)
    await first.savedChainLoaded()
    vi.resetModules()
    const second = await import('../useCyberspace')
    // Read from the rows: nothing in hand yet, and the frozen copy is not parsed for a draw.
    expect(second.useCyberspace.getState().events).toHaveLength(0)
    await second.chainReadyToDraw()
    expect(second.useCyberspace.getState().events).toHaveLength(6)
  })

  it('a move pressed before the read lands waits for it, and signs from the real head', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    await openTab()
    vi.resetModules()
    const store = await import('../useCyberspace')
    posted.length = 0
    const S = store.useCyberspace.getState
    store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' }, cursor: { ...S().position, x: S().position.x + 1n } })
    await S().commit()
    expect(S().events).toHaveLength(6)
    expect(posted.every((m) => (m as { prevEventId?: string }).prevEventId !== '')).toBe(true)
  })
})

describe('the kill switch, from the deploy\'s version file', () => {
  const OFF = 'onosendai:chain-store-off'
  const look = async (): Promise<void> => { await (await import('../../lib/versionGate')).checkVersion() }

  it('a deploy that says no: nobody\'s chain is moved, and it goes on in the old stores', async () => {
    deploy.answer = { build: 'deployed', minChainEpoch: 2, chainStore: 1 }
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    expect(a.rows.inRows(pk)).toBe(false)
    expect(a.S().events).toHaveLength(6)
    const m = await signMove(a)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    expect((await db.readStoredChain(pk) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
    db.closeChainDb()
    expect(await rowsNow()).toBeNull()
  })

  it('a version file without the field is a deploy from before the rows, and also says no', async () => {
    deploy.answer = { build: 'deployed', minChainEpoch: 2 }
    await seedOldStores(chainOf(4))
    const a = await openTab()
    expect(a.rows.inRows(pk)).toBe(false)
    expect(localStorage.getItem(OFF)).toBe('absent')
  })

  it('no answer at all: not on this load, and nothing remembered against the next', async () => {
    deploy.answer = null
    await seedOldStores(chainOf(4))
    const a = await openTab()
    expect(a.rows.inRows(pk)).toBe(false)
    expect(await rowsNow()).toBeNull()
    expect(localStorage.getItem(OFF)).toBeNull()
    deploy.answer = { build: 'deployed', minChainEpoch: 2, chainStore: 2 }
    const b = await openTab()
    expect(b.rows.inRows(pk)).toBe(true)
    expect((await rowsNow())!.events).toHaveLength(4)
  })

  it('off while a tab is in rows: its next save goes whole to the old stores, moves in rows included', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const inRows = await signMove(a)
    await a.rows.chainRowsSettled()
    deploy.answer = { build: 'fix', minChainEpoch: 2, chainStore: 1 }
    await look()
    expect(a.rows.rowsWanted()).toBe(false)
    const after = await signMove(a)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    const kept = await db.readStoredChain(pk) as { events: NostrEvent[] }
    db.closeChainDb()
    expect(kept.events.map((e) => e.id)).toEqual(expect.arrayContaining([inRows, after]))
    // And the rows stay as they were, whole.
    expect((await rowsNow())!.events.map((e) => e.id)).toContain(inRows)
  })

  it('off, across a reload, offline: it holds, and the chain comes from the rows and goes to the old stores', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m = await signMove(a)
    await a.rows.chainRowsSettled()
    deploy.answer = { build: 'fix', minChainEpoch: 2, chainStore: 1 }
    await look()
    deploy.answer = null
    const b = await openTab()
    expect(b.rows.rowsWanted()).toBe(false)
    expect(b.S().prevEventId).toBe(m)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    expect((await db.readStoredChain(pk) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
    db.closeChainDb()
  })

  it('on again: the next load folds in what the old stores took meanwhile, and nothing is lost', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m1 = await signMove(a)
    await a.rows.chainRowsSettled()
    deploy.answer = { build: 'fix', minChainEpoch: 2, chainStore: 1 }
    await look()
    const m2 = await signMove(a)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    db.closeChainDb()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    deploy.answer = { build: 'fixed', minChainEpoch: 2, chainStore: 2 }
    await look()
    // On takes effect at a load, never under a running tab.
    expect(a.rows.rowsWanted()).toBe(false)
    expect(localStorage.getItem(OFF)).toBeNull()
    const b = await openTab()
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(m2), SOON)
    await b.rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id).slice(-2)).toEqual([m1, m2])
  })
})

describe('the store probe, at open', () => {
  const bendIndex = (): (() => void) => {
    const proto = IDBObjectStore.prototype as unknown as { createIndex: (...a: unknown[]) => unknown }
    const real = proto.createIndex
    proto.createIndex = function (this: unknown, name: unknown, key: unknown, opts: unknown) { return real.call(this, name, key, name === 'byTag' ? { ...(opts as object), multiEntry: false } : opts) }
    return () => { proto.createIndex = real }
  }

  it('a browser that fails it: nobody\'s chain is moved, and the real database is never made', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const restore = bendIndex()
    let a: Tab
    try {
      a = await openTab()
      expect(a.rows.inRows(pk)).toBe(false)
      expect(a.rows.rowsWanted()).toBe(false)
      expect(a.S().events).toHaveLength(6)
      const m = await signMove(a)
      const db = await import('../../lib/chainDb')
      await db.chainWritesSettled()
      expect((await db.readStoredChain(pk) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
      db.closeChainDb()
      expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('onosendai:events')
    } finally { restore() }
  })

  it('a failure is not remembered: once the browser passes, the chain moves', async () => {
    await seedOldStores(chainOf(4))
    const restore = bendIndex()
    try { await openTab() } finally { restore() }
    expect(localStorage.getItem('onosendai:chain-store-probe')).toBeNull()
    const b = await openTab()
    expect(b.rows.inRows(pk)).toBe(true)
  })

  it('a pass is remembered for this browser version, so a load does not pay for it, and a new version asks again', async () => {
    await seedOldStores(chainOf(4))
    await openTab()
    expect(localStorage.getItem('onosendai:chain-store-probe')).toContain(navigator.userAgent)
    const proto = (globalThis as { indexedDB: IDBFactory }).indexedDB
    const open = vi.spyOn(proto, 'open')
    await openTab()
    expect(open.mock.calls.map((c) => c[0])).not.toContain('onosendai:events-probe')
    open.mockClear()
    localStorage.setItem('onosendai:chain-store-probe', '1.1:an older browser')
    await openTab()
    expect(open.mock.calls.map((c) => c[0])).toContain('onosendai:events-probe')
  })

  it('a browser that stops passing after an update: the moves in rows are taken back to the old stores', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m = await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    localStorage.setItem('onosendai:chain-store-probe', '1.1:the browser before the update')
    const restore = bendIndex()
    try {
      const b = await openTab()
      expect(b.rows.rowsWanted()).toBe(false)
      expect(b.S().prevEventId).toBe(m)
      const db = await import('../../lib/chainDb')
      await db.chainWritesSettled()
      expect((await db.readStoredChain(pk) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
      db.closeChainDb()
    } finally { restore() }
  })
})

describe('a switched device whose rows fail', () => {
  /** Damage the rows, so a read answers `unreadable`, as a sick database does. */
  async function breakRows(id: string): Promise<void> {
    const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      tx.objectStore('events').delete(id)
      tx.oncomplete = () => resolve()
    }))
    closeEventDb()
  }
  const recordNow = async (): Promise<unknown> => {
    const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
    const r = await withEventDb((db) => new Promise((resolve) => { const g = db.transaction('chains').objectStore('chains').get(pk); g.onsuccess = () => resolve(g.result) }))
    closeEventDb()
    return r
  }

  it('unreadable is not "no chain": no second move, no record written, the frozen copies untouched', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    const frozenLocal = localStorage.getItem(LOCAL_KEY)
    const frozenRecord = await oldRecord()
    await breakRows(chain[3].id)
    const record = await recordNow()
    const b = await openTab()
    expect(b.S().events).toHaveLength(8)
    expect(b.rows.inRows(pk)).toBe(false)
    expect(await recordNow()).toEqual(record)
    expect(localStorage.getItem(LOCAL_KEY)).toBe(frozenLocal)
    expect(await oldRecord()).toEqual(frozenRecord)
  })

  it('a failed read blocks signing until the relays confirm the head', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    await breakRows(chain[3].id)
    relays.confirm = null
    const b = await openTab()
    const head = b.S().prevEventId
    await press(b)
    await signMove(b).catch(() => {})
    expect(b.S().prevEventId).toBe(head)
    expect(b.S().events).toHaveLength(8)
    // The relays answer, and the move goes on from what they confirmed.
    relays.confirm = []
    b.store.useCyberspace.setState({ proof: { ...b.S().proof, status: 'idle', message: null } })
    const m = await signMove(b)
    expect(m).not.toBe(head)
    // It went nowhere over the frozen copy, and is kept until the rows are back.
    expect(JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`)!).map((e: NostrEvent) => e.id)).toContain(m)
  })

  it('no frozen copy and no relays: no new spawn over a chain nobody can see', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    await openTab()
    await breakRows(chain[2].id)
    relays.confirm = null
    // A device that only ever had the chain in rows: no old copy to draw from.
    ;(globalThis as { indexedDB: IDBFactory }).indexedDB.deleteDatabase('onosendai:chains')
    localStorage.removeItem(LOCAL_KEY)
    const b = await openTab()
    expect(b.S().events).toHaveLength(0)
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.ROWS_DOWN_MESSAGE)
    // Even once the relays have answered: they may simply never have held it.
    relays.confirm = []
    await b.S().confirmHeadNow()
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.ROWS_DOWN_MESSAGE)
  })

  it('a kill switch while the rows are unreadable writes nothing over the frozen copy either', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    await breakRows(chain[2].id)
    deploy.answer = { build: 'fix', minChainEpoch: 2, chainStore: 1 }
    const frozen = localStorage.getItem(LOCAL_KEY)
    await (await import('../../lib/versionGate')).checkVersion()
    const b = await openTab()
    await signMove(b)
    expect(localStorage.getItem(LOCAL_KEY)).toBe(frozen)
  })

  it('the late answer ends it: the rows are taken, and writing to them goes on', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    vi.resetModules()
    const rows = await import('../../lib/chainStore')
    rows.setRowsPatience({ read: 0 })
    const store = await import('../useCyberspace')
    await store.savedChainLoaded()
    await vi.waitFor(() => expect(rows.inRows(pk)).toBe(true), SOON)
    rows.setRowsPatience({ read: 3_000 })
    const tab: Tab = { store, rows, S: store.useCyberspace.getState }
    store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
    const m = await signMove(tab)
    await rows.chainRowsSettled()
    expect((await rowsNow())!.events.map((e) => e.id)).toContain(m)
  })
})

describe('WebKit', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const CHROME_ON_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'
  const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  const CHROME_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  const be = (ua: string): void => { vi.stubGlobal('navigator', { userAgent: ua }) }

  it.each([[IPHONE, true], [CHROME_ON_IPHONE, true], [SAFARI_MAC, true], [CHROME_DESKTOP, false]])('%s: WebKit is %s', async (ua, webkit) => {
    be(ua)
    const rows = await import('../../lib/chainStore')
    expect(rows.onWebKit()).toBe(webkit)
  })

  it('an iPhone stays on the old stores: no probe, no marker, no record, the old store written whole', async () => {
    be(IPHONE)
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    expect(a.rows.rowsWanted()).toBe(false)
    expect(a.rows.inRows(pk)).toBe(false)
    const m = await signMove(a)
    expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('onosendai:events')
    expect(localStorage.getItem(`onosendai:chain-rows:${pk}`)).toBeNull()
  })

  it('on the trial: it moves, every action stays in the spare key until a relay has it, and it says what it did', async () => {
    be(IPHONE)
    localStorage.setItem('onosendai:chain-store-trial', '1')
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    expect(a.rows.inRows(pk)).toBe(true)
    expect((await import('../useToast')).useToast.getState().toast?.label).toBe('STORE ROWS')
    const m1 = await signMove(a)
    const m2 = await signMove(a)
    await a.rows.chainRowsSettled()
    // Committed, and still in the key, because no relay has them.
    expect((await rowsNow())!.events.map((e) => e.id)).toContain(m2)
    const tail = (): string[] => (JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`) ?? '[]') as NostrEvent[]).map((e) => e.id)
    expect(tail()).toEqual(expect.arrayContaining([m1, m2]))
    // A relay takes the first: only the second stays.
    a.S().setPublishStatus(m1, 'ok')
    await a.rows.chainRowsSettled()
    expect(tail()).not.toContain(m1)
    expect(tail()).toContain(m2)
  })

  it('on the trial, Safari clears the database: the spare key and the old copies bring back every unsent move', async () => {
    be(IPHONE)
    localStorage.setItem('onosendai:chain-store-trial', '1')
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m = await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(await import('../../lib/chainDb')).closeChainDb()
    const indexed = new IDBFactory()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = indexed
    const b = await openTab()
    expect(b.S().prevEventId).toBe(m)
  })
})

describe('the probe decides before anything is written', () => {
  it('a put that throws in the probe: no marker, no record, no real database, and the old store written', async () => {
    const chain = chainOf(5)
    await seedOldStores(chain)
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.transaction.db.name === 'onosendai:events-probe') throw new DOMException('no', 'DataError')
      return real.apply(this, x)
    }
    try {
      const a = await openTab()
      expect(a.rows.rowsWanted()).toBe(false)
      const m = await signMove(a)
      const db = await import('../../lib/chainDb')
      await db.chainWritesSettled()
      expect((await db.readStoredChain(pk) as { events: NostrEvent[] }).events.map((e) => e.id)).toContain(m)
      db.closeChainDb()
    } finally { proto.put = real }
    expect(localStorage.getItem(`onosendai:chain-rows:${pk}`)).toBeNull()
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('onosendai:events')
  })

  it('a chain is only moved on a probe run now, never on a memo', async () => {
    await seedOldStores(chainOf(4))
    // A real pass, remembered from another identity on this browser.
    await openTab()
    const memo = localStorage.getItem('onosendai:chain-store-probe')!
    expect(memo).toContain(navigator.userAgent)
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(await import('../../lib/chainDb')).closeChainDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    localStorage.removeItem(`onosendai:chain-rows:${pk}`)
    await seedOldStores(chainOf(4))
    expect(localStorage.getItem('onosendai:chain-store-probe')).toBe(memo)
    const open = vi.spyOn((globalThis as { indexedDB: IDBFactory }).indexedDB, 'open')
    await openTab()
    expect(open.mock.calls.map((c) => c[0])).toContain('onosendai:events-probe')
  })
})

/**
 * Another connection holds a write on the rows for `ms`: every commit waits
 * behind it, as behind a database that is slow to answer; the look before a
 * move, which reads only the chain record, does not. Resolves once the hold is
 * on, with what resolves when it lets go.
 */
async function holdTheDatabase(ms: number): Promise<{ released: Promise<void> }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('onosendai:events')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return new Promise((on) => {
    const tx = db.transaction(['events'], 'readwrite')
    const os = tx.objectStore('events')
    const until = Date.now() + ms
    const released = new Promise<void>((done) => { tx.oncomplete = () => { db.close(); done() } })
    let first = true
    const spin = (): void => {
      os.get('nobody').onsuccess = () => {
        if (first) { first = false; on({ released }) }
        if (Date.now() < until) spin()
      }
    }
    spin()
  })
}

describe('after a lost commit (review of 2026-11-04, F1, F1b, F4)', () => {
  /** Two tabs on one head; A moves first, and B's look is blinded so it signs from the old head too. */
  /** Reads of the rows fail, as a sick database's do; the look and the commit are untouched. Returns what puts it back. */
  function breakReads(): () => void {
    const proto = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const real = proto.getAll
    proto.getAll = function (this: IDBIndex, ...x: unknown[]) {
      if (this.objectStore.transaction.db.name === 'onosendai:events') throw new DOMException('broken', 'UnknownError')
      return real.apply(this, x)
    }
    const mend = (): void => { proto.getAll = real }
    putBack.push(mend)
    return mend
  }

  async function race(opts: { live?: boolean; reads?: 'broken'; land?: number; busy?: number } = {}): Promise<{ a: Tab; b: Tab; moveA: string; moveB: string; chain: NostrEvent[]; mend: () => void }> {
    const chain = chainOf(12)
    // On the relays already when LIVE, so B's publisher has only B's move to send.
    await seedOldStores(chain, opts.live ? { published: chain.map((e) => e.id) } : {})
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const moveA = await signMove(a)
    await a.rows.chainRowsSettled()
    if (opts.live) {
      ;(await import('../../lib/publisher')).startPublisher()
      b.store.useCyberspace.setState({ live: true })
    }
    const mend = opts.reads === 'broken' ? breakReads() : () => {}
    if (opts.land !== undefined) b.rows.setRowsPatience({ land: opts.land })
    const see = blindTheLook()
    const busy = opts.busy ? (await holdTheDatabase(opts.busy)).released : Promise.resolve()
    let moveB: string
    try { moveB = await signMove(b, 'y') } finally { see() }
    await busy
    return { a, b, moveA, moveB, chain, mend }
  }

  it('the moment the answer comes, the move that lost cannot be sent, before anything is read', async () => {
    const { b, moveB } = await race()
    let sendable = 0
    for (let i = 0; i < 400; i++) {
      if (!b.S().events.some((e) => e.id === moveB)) break
      const r = await Promise.race([b.rows.chainLanded(pk, moveB), tick(0).then(() => 'pending' as const)])
      if (r === true && b.S().events.some((e) => e.id === moveB)) sendable++
      await tick(0)
    }
    expect(sendable).toBe(0)
  })

  it('a take-back whose read fails: the move that lost stays unsendable, nothing is signed, the person is told, and the read is tried until it lands', async () => {
    const { b, moveA, moveB, mend } = await race({ reads: 'broken' })
    await b.rows.chainRowsSettled()
    await tick(300)
    expect(b.S().events.some((e) => e.id === moveB)).toBe(true)
    expect(await b.rows.chainLanded(pk, moveB)).toBe(false)
    expect(b.rows.takingBack(pk)).toBe(true)
    expect((await import('../useToast')).useToast.getState().toast).toMatchObject({ label: 'CHAIN HELD', reload: true })
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.TAKING_BACK_MESSAGE)
    // The database answers again: the next try lands, and B goes on from the head that won.
    mend()
    await vi.waitFor(() => expect(b.S().events.map((e) => e.id)).not.toContain(moveB), { timeout: 10_000, interval: 50 })
    expect(b.rows.takingBack(pk)).toBe(false)
    expect(b.S().prevEventId).toBe(moveA)
    expect(await b.rows.chainLanded(pk, moveB)).toBe(false)
    expect(sent.map((s) => s.id)).not.toContain(moveB)
  }, 30_000)

  it('end to end, LIVE: PUBLISH NOW never sends the move that lost, while its take-back cannot land', async () => {
    const { b, moveB, mend } = await race({ live: true, reads: 'broken' })
    await b.rows.chainRowsSettled()
    await tick(300)
    b.S().publishNow()
    await tick(500)
    expect(b.S().events.some((e) => e.id === moveB)).toBe(true)
    expect(sent.map((s) => s.id)).not.toContain(moveB)
    mend()
  })

  it('a retry armed by a refused write is cleared by a lost commit, and never writes what lost over what won', { timeout: 30_000 }, async () => {
    const chain = chainOf(12)
    await seedOldStores(chain)
    await openTab()
    const a = await openTab()
    const b = await openTab()
    b.rows.setRowsPatience({ retry: 200 })
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    let x: string
    try {
      x = await signMove(b)
      await b.rows.chainRowsSettled()
    } finally { proto.put = real }
    const moveA = await signMove(a, 'y')
    await a.rows.chainRowsSettled()
    // Who won is what the rows took first. On a loaded machine B's retry can land
    // its refused move before A's; then A's move is the one that lost, which is no fork either.
    let ids: string[] = []
    await vi.waitFor(async () => { ids = (await rowsNow())!.events.map((e) => e.id); expect(ids.includes(moveA) || ids.includes(x)).toBe(true) }, { timeout: 10_000, interval: 50 })
    const aWon = ids.includes(moveA)
    const see = blindTheLook()
    let y: string
    try { y = await signMove(b) } finally { see() }
    await b.rows.chainRowsSettled()
    if (!aWon) {
      await vi.waitFor(async () => expect((await rowsNow())!.events.map((e) => e.id)).not.toContain(moveA), { timeout: 10_000, interval: 50 })
      expect((await rowsNow())!.events.map((e) => e.id)).toContain(x)
      return
    }
    // B ends on A's move, or, when its retry lost and was taken back before it
    // signed again, on its next move made from A's: either way never on x.
    await vi.waitFor(() => {
      expect(b.rows.takingBack(pk)).toBe(false)
      expect(b.S().events.map((e) => e.id)).toContain(moveA)
      expect(b.S().events.map((e) => e.id)).not.toContain(x)
    }, { timeout: 10_000, interval: 20 })
    expect([moveA, y]).toContain(b.S().prevEventId)
    // Past the retry: the rows still say A won, and nothing of B's line through x is in them.
    await tick(600)
    await b.rows.chainRowsSettled()
    const rows = (await rowsNow())!.events.map((e) => e.id)
    expect(rows).not.toContain(x)
    expect(rows.slice(0, chain.length + 1)).toEqual([...chain.map((e) => e.id), moveA])
    expect(rows.length === chain.length + 1 || (rows.length === chain.length + 2 && rows[chain.length + 1] === y)).toBe(true)
  })

  it('a commit slower than the land patience: the move goes out, and when it then loses, the chain is held and the person told', async () => {
    const { b, moveB } = await race({ live: true, land: 20, busy: 400 })
    await vi.waitFor(() => expect(sent.map((s) => s.id)).toContain(moveB), { timeout: 5_000, interval: 20 })
    await b.rows.chainRowsSettled()
    await vi.waitFor(() => expect(b.rows.chainHeld(pk)).toBe(true), { timeout: 5_000, interval: 20 })
    expect((await import('../useToast')).useToast.getState().toast).toMatchObject({ label: 'CHAIN MAY HAVE FORKED', reload: true })
    expect(b.S().proof.message).toBe(b.store.CHAIN_HELD_MESSAGE)
    await expect(b.S().signEvent(spawnTemplate(pk, 5_000))).rejects.toThrow(b.store.CHAIN_HELD_MESSAGE)
    // Nothing more goes out from this tab, whatever asks.
    const before = sent.length
    b.S().publishNow()
    await tick(300)
    expect(sent.length).toBe(before)
  })

  it('a slow commit that lands is no fork: nothing is held', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain)
    const a = await openTab()
    ;(await import('../../lib/publisher')).startPublisher()
    a.store.useCyberspace.setState({ live: true })
    a.rows.setRowsPatience({ land: 20 })
    const { released } = await holdTheDatabase(300)
    const m = await signMove(a)
    await vi.waitFor(() => expect(sent.map((s) => s.id)).toContain(m), { timeout: 5_000, interval: 20 })
    await released
    await a.rows.chainRowsSettled()
    expect(a.rows.chainHeld(pk)).toBe(false)
    expect((await rowsNow())!.events.at(-1)?.id).toBe(m)
  })
})

describe('the trial is asked for, never set by a link (F2)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const at = (search: string): void => { vi.stubGlobal('location', { search, href: `https://onosendai.test/${search}`, pathname: '/', hash: '', origin: 'https://onosendai.test', host: 'onosendai.test', hostname: 'onosendai.test', protocol: 'https:' }) }

  it('a link alone never puts an iPhone on the trial, across loads; only the yes on screen does, and ?chainstore=off ends it', async () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE })
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    at('?chainstore=trial')
    const a = await openTab()
    expect(a.rows.trialAskedByLink()).toBe(true)
    expect(a.rows.storeTrial()).toBe(false)
    expect(a.rows.inRows(pk)).toBe(false)
    expect(localStorage.getItem('onosendai:chain-store-trial')).toBeNull()
    // A plain open after the link: still the old stores.
    at('')
    const b = await openTab()
    expect(b.rows.trialAskedByLink()).toBe(false)
    expect(b.rows.inRows(pk)).toBe(false)
    // The yes: the next load is on the trial, and moves the chain.
    at('?chainstore=trial')
    const c = await openTab()
    c.rows.startTrial()
    expect(c.rows.trialAskedByLink()).toBe(false)
    at('')
    const d = await openTab()
    expect(d.rows.storeTrial()).toBe(true)
    expect(d.rows.inRows(pk)).toBe(true)
    // A device already on it is not asked again.
    at('?chainstore=trial')
    expect((await openTab()).rows.trialAskedByLink()).toBe(false)
    at('?chainstore=off')
    expect((await openTab()).rows.storeTrial()).toBe(false)
  })

  it('a desktop browser is never asked: its chain is in rows already', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' })
    await seedOldStores(chainOf(4), { localToo: true })
    at('?chainstore=trial')
    const a = await openTab()
    expect(a.rows.trialAskedByLink()).toBe(false)
    expect(a.rows.inRows(pk)).toBe(true)
  })

  it('no means nothing is kept', async () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE })
    at('?chainstore=trial')
    const a = await openTab()
    a.rows.declineTrial()
    expect(a.rows.trialAskedByLink()).toBe(false)
    expect(localStorage.getItem('onosendai:chain-store-trial')).toBeNull()
  })
})

describe('a paid cloud job and the head it is held against (J1 to J3)', () => {
  const jobAt = (prevEventId: string): import('../../lib/cloud').PendingCloudJob => ({
    version: 1, jobId: 'paid-job', pollToken: 't', action: 'hop', pubkey: pk,
    from: { x: '0', y: '0', z: '0' }, to: { x: '4104', y: '0', z: '0' }, plane: 0, prevEventId,
    costMsats: 1000, createdAt: Date.now(), stage: 'computing', deposit: null,
  })

  it('a switch away and back: the job is compared with the head read from the rows, and kept', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const moved = await signMove(a)
    await a.rows.chainRowsSettled()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(moved))
    await a.S().useNsec(nip19.nsecEncode(generateSecretKey()))
    await a.S().useNsec(nip19.nsecEncode(sk))
    await tick(50)
    await a.store.savedChainLoaded()
    expect(a.S().prevEventId).toBe(moved)
    expect(a.S().cloud.message ?? '').not.toContain('dropped')
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(moved)
  })

  it('the kill switch on a load: the frozen copy in hand first does not drop the job', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const moved = await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    localStorage.setItem('onosendai:chain-store-off', '1')
    vi.resetModules()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(moved))
    const store = await import('../useCyberspace')
    // What App does on mount, before the rows have been read. Kept, the job is
    // then followed at HOSAKA, which tests cannot reach: only the compare is awaited.
    void store.useCyberspace.getState().resumeCloudJob()
    await store.savedChainLoaded()
    await tick(50)
    expect(store.useCyberspace.getState().prevEventId).toBe(moved)
    expect(store.useCyberspace.getState().cloud.message ?? '').not.toContain('dropped')
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(moved)
  })

  it('rows that cannot be read: a head nobody can vouch for drops nothing, and the job waits', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const moved = await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    const proto = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const real = proto.getAll
    proto.getAll = function () { throw new DOMException('broken', 'UnknownError') }
    try {
      vi.resetModules()
      const cloud = await import('../../lib/cloud')
      cloud.saveCloudJob(jobAt(moved))
      const store = await import('../useCyberspace')
      await store.savedChainLoaded()
      await store.useCyberspace.getState().resumeCloudJob()
      expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(moved)
      expect(store.useCyberspace.getState().cloud.message).toContain('your saved chain did not load')
    } finally { proto.getAll = real }
  })

  it('rows cleared under the marker: the frozen copy\'s head drops nothing', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const moved = await signMove(a)
    await a.rows.chainRowsSettled()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    relays.confirm = null
    vi.resetModules()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(moved))
    const store = await import('../useCyberspace')
    await store.savedChainLoaded()
    expect(store.useCyberspace.getState().prevEventId).toBe(chain[5].id)
    await store.useCyberspace.getState().resumeCloudJob()
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(moved)
    expect(store.useCyberspace.getState().cloud.message).toContain('was kept')
  })

  it('a job whose head really moved is still dropped, once the rows are read', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(chain[5].id))
    await signMove(a)
    await a.rows.chainRowsSettled()
    await a.S().resumeCloudJob()
    expect(a.S().cloud.message).toMatch(/chain head moved/)
    expect(cloud.loadCloudJob(pk)).toBeNull()
  })
})

describe('what another tab saved is not taken as on the relays (A1, A2)', () => {
  it('a tab folding another tab\'s unsent move writes no acknowledgement for it, and a reload still owes it to the relays', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const m = await signMove(a)
    await a.rows.chainRowsSettled()
    expect(a.S().published[m]).not.toBe('ok')
    await press(b)
    await b.rows.chainRowsSettled()
    expect(b.S().events.map((e) => e.id)).toContain(m)
    expect(b.S().published[m]).not.toBe('ok')
    expect((await rowsNow())!.published).not.toContain(m)
    const c = await openTab()
    expect(c.S().published[m]).not.toBe('ok')
  })

  it('what a relay did take, folded the same way, stays acknowledged', async () => {
    const chain = chainOf(8)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    await openTab()
    const a = await openTab()
    const b = await openTab()
    const m = await signMove(a)
    a.S().setPublishStatus(m, 'ok')
    await a.rows.chainRowsSettled()
    await press(b)
    await b.rows.chainRowsSettled()
    expect(b.S().published[m]).toBe('ok')
    expect((await rowsNow())!.published).toContain(m)
  })
})

describe('what an older build or the old stores saved, folded in before anything trusts the head (review round 2, N1 to N3)', () => {
  const jobAt = (prevEventId: string): import('../../lib/cloud').PendingCloudJob => ({
    version: 1, jobId: 'paid-job', pollToken: 't', action: 'hop', pubkey: pk,
    from: { x: '0', y: '0', z: '0' }, to: { x: '4104', y: '0', z: '0' }, plane: 0, prevEventId,
    costMsats: 1000, createdAt: Date.now(), stage: 'computing', deposit: null,
  })
  const look = async (): Promise<void> => { await (await import('../../lib/versionGate')).checkVersion() }

  /** Kill switch, a move made on the old stores, then on again. Returns the move only the old stores hold. */
  async function offMoveOn(opts: { smallLocal?: boolean } = {}): Promise<{ m1: string; m2: string }> {
    const chain = chainOf(5)
    await seedOldStores(chain, { localToo: true })
    const a = await openTab()
    const m1 = await signMove(a)
    await a.rows.chainRowsSettled()
    deploy.answer = { build: 'fix', minChainEpoch: 2, chainStore: 1 }
    await look()
    if (opts.smallLocal) quota.chainChars = 50
    const m2 = await signMove(a)
    const db = await import('../../lib/chainDb')
    await db.chainWritesSettled()
    db.closeChainDb()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    deploy.answer = { build: 'fixed', minChainEpoch: 2, chainStore: 2 }
    await look()
    return { m1, m2 }
  }

  it('kill switch, a move on the old stores, a paid job on it, on again: the job is compared with the folded head, and kept', async () => {
    const { m2 } = await offMoveOn()
    vi.resetModules()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(m2))
    const store = await import('../useCyberspace')
    // As App mounts it, before the read.
    void store.useCyberspace.getState().resumeCloudJob()
    await store.savedChainLoaded()
    expect(store.useCyberspace.getState().prevEventId).toBe(m2)
    await tick(50)
    expect(store.useCyberspace.getState().cloud.message ?? '').not.toContain('dropped')
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(m2)
  })

  it('a tab of a build from before the rows moved and bound a paid job: the reload into rows keeps the job', async () => {
    const chain = chainOf(7)
    await seedOldStores(chain.slice(0, 6), { localToo: true })
    const a = await openTab()
    await a.rows.chainRowsSettled()
    expect((await rowsNow())!.events).toHaveLength(6)
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    // The old build saves whole, and writes its own mark.
    await seedOldStores(chain, { localToo: true, savedAt: 9 })
    localStorage.setItem(`onosendai:chain-mark:${pk}`, `7:${chain[6].id.slice(0, 16)}:oldbuild`)
    vi.resetModules()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(chain[6].id))
    const store = await import('../useCyberspace')
    void store.useCyberspace.getState().resumeCloudJob()
    await store.savedChainLoaded()
    expect(store.useCyberspace.getState().prevEventId).toBe(chain[6].id)
    await tick(50)
    expect(store.useCyberspace.getState().cloud.message ?? '').not.toContain('dropped')
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(chain[6].id)
  })

  it('a press right after that load signs from the head the old stores took, not the stale rows head', async () => {
    const { m2 } = await offMoveOn()
    vi.resetModules()
    const store = await import('../useCyberspace')
    const S = store.useCyberspace.getState
    await store.savedChainLoaded()
    store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
    posted.length = 0
    store.useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 1n } })
    await S().commit()
    const prevs = posted.map((m) => (m as { prevEventId?: string }).prevEventId).filter(Boolean)
    expect(prevs.length).toBeGreaterThan(0)
    expect(prevs.every((p) => p === m2)).toBe(true)
  })

  /** The old store's reads fail until put back. */
  function breakOldStore(): () => void {
    const proto = IDBObjectStore.prototype as unknown as { get: (...x: unknown[]) => unknown }
    const real = proto.get
    proto.get = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.transaction.db.name === 'onosendai:chains') throw new DOMException('broken', 'UnknownError')
      return real.apply(this, x)
    }
    const mend = (): void => { proto.get = real }
    putBack.push(mend)
    return mend
  }

  it('an older save the old stores cannot be read for is said, once, and kept apart from the mark', async () => {
    await offMoveOn({ smallLocal: true })
    breakOldStore()
    const b = await openTab()
    await tick(100)
    const toast = (await import('../useToast')).useToast
    expect(toast.getState().toast).toMatchObject({ label: 'OLDER SAVE COULD NOT BE READ', meta: 'Moves go on from here. It keeps trying.' })
    expect(localStorage.getItem(`onosendai:chain-unread-save:${pk}`)).not.toBeNull()
    // A press tries the read again, and says nothing more.
    toast.getState().dismiss()
    await b.S().confirmHeadNow().catch(() => null)
    expect(toast.getState().toast).toBeNull()
  })

  it('moves made past an older save that could not be read: once it can be, it is set aside as a branch, not lost', { timeout: 30_000 }, async () => {
    const { m2 } = await offMoveOn({ smallLocal: true })
    const mend = breakOldStore()
    const b = await openTab()
    // The owner's call: moves go on from the chain in hand. This one's mark replaces the older build's.
    const x = await signMove(b, 'y')
    await b.rows.chainRowsSettled()
    expect(localStorage.getItem(`onosendai:chain-mark:${pk}`)?.endsWith(':r')).toBe(true)
    mend()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(await import('../../lib/chainDb')).closeChainDb()
    const c = await openTab()
    expect(c.S().prevEventId).toBe(x)
    await vi.waitFor(async () => {
      const parted = await c.rows.rowsSetAside(pk)
      expect(parted.flatMap((p) => p.events.map((e) => e.id))).toContain(m2)
    }, { timeout: 10_000, interval: 50 })
    expect(localStorage.getItem(`onosendai:chain-unread-save:${pk}`)).toBeNull()
  })

  /** Hold one database busy with a write until let go; resolves once the hold is on. */
  async function holdDb(dbName: string, store: string): Promise<{ letGo: () => Promise<void> }> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((on) => {
      const tx = db.transaction([store], 'readwrite')
      const os = tx.objectStore(store)
      let holding = true
      const released = new Promise<void>((done) => { tx.oncomplete = () => { db.close(); done() } })
      let first = true
      const spin = (): void => { os.get('nobody').onsuccess = () => { if (first) { first = false; on({ letGo: () => { holding = false; return released } }) } if (holding) spin() } }
      spin()
    })
  }

  it('a fold that ends with nothing of this identity in hand (switched away and back) is not taken as done', { timeout: 30_000 }, async () => {
    const { m2 } = await offMoveOn({ smallLocal: true })
    const oldMark = localStorage.getItem(`onosendai:chain-mark:${pk}`)
    expect(oldMark?.endsWith(':r')).toBe(false)
    const { META_STORE } = await import('../../lib/idb')
    // The fold's read of the old stores waits behind this.
    const chainsHeld = await holdDb('onosendai:chains', META_STORE)
    vi.resetModules()
    const store = await import('../useCyberspace')
    const S = store.useCyberspace.getState
    await vi.waitFor(() => expect(S().events.length).toBeGreaterThan(0), { timeout: 10_000 })
    await S().useNsec(nip19.nsecEncode(generateSecretKey()))
    // Back to A, its rows not read yet when the fold ends.
    const eventsHeld = await holdDb('onosendai:events', 'events')
    void S().useNsec(nip19.nsecEncode(sk))
    await vi.waitFor(() => expect(S().identity.pubkey).toBe(pk), SOON)
    await chainsHeld.letGo()
    await tick(100)
    expect(S().identity.pubkey).toBe(pk)
    expect(S().events).toHaveLength(0)
    // Nothing was folded, so the older build's save is not marked as seen.
    expect(localStorage.getItem(`onosendai:chain-rows:${pk}`)).not.toBe(oldMark)
    await eventsHeld.letGo()
    await store.savedChainLoaded()
    await S().confirmHeadNow().catch(() => null)
    expect(S().events.some((e) => e.id === m2)).toBe(true)
  })

  it('a fold whose read fails is not taken as done: the next load folds it in, and until then a paid job is kept', async () => {
    const { m2 } = await offMoveOn({ smallLocal: true })
    // The old store's reads fail on this load only.
    const proto = IDBObjectStore.prototype as unknown as { get: (...x: unknown[]) => unknown }
    const real = proto.get
    proto.get = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.transaction.db.name === 'onosendai:chains') throw new DOMException('broken', 'UnknownError')
      return real.apply(this, x)
    }
    putBack.push(() => { proto.get = real })
    vi.resetModules()
    const cloud = await import('../../lib/cloud')
    cloud.saveCloudJob(jobAt(m2))
    const store = await import('../useCyberspace')
    await store.savedChainLoaded()
    expect(store.useCyberspace.getState().events.some((e) => e.id === m2)).toBe(false)
    await store.useCyberspace.getState().resumeCloudJob()
    expect(cloud.loadCloudJob(pk)?.prevEventId).toBe(m2)
    expect(store.useCyberspace.getState().cloud.message ?? '').not.toContain('dropped')
    // It says why: the chain was read; an older save of it was not.
    expect(store.useCyberspace.getState().cloud.message).toContain('an older save of your chain could not be read')
    proto.get = real
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(await import('../../lib/chainDb')).closeChainDb()
    const c = await openTab()
    expect(c.S().events.some((e) => e.id === m2)).toBe(true)
  })
})

describe('what went out and what lost, noted where it matters (review round 2, N4)', () => {
  /** A's move first; B's first move refused by a full disk, so it never commits. */
  async function refusedThenRace(beforeRefusal?: (b: Tab, m: string) => void): Promise<{ a: Tab; b: Tab; m: string; moveA: string }> {
    const chain = chainOf(12)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    await openTab()
    const a = await openTab()
    const b = await openTab()
    b.rows.setRowsPatience({ retry: 60_000 })
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    putBack.push(() => { proto.put = real })
    let m: string
    try {
      m = await signMove(b)
      beforeRefusal?.(b, m)
      await b.rows.chainRowsSettled()
    } finally { proto.put = real }
    const moveA = await signMove(a, 'y')
    await a.rows.chainRowsSettled()
    return { a, b, m, moveA }
  }

  /** B moves on from its refused move (its look blinded), so that commit loses to A's. */
  async function bLoses(b: Tab): Promise<void> {
    const see = blindTheLook()
    try { await signMove(b) } finally { see() }
    await b.rows.chainRowsSettled()
  }

  // These three open three tabs each (every one a fresh load of the store) and then wait up to 10 s for the hold, which
  // their 5 s limit undercut: about 0.8 s alone, one passed 5 s under load (2026-11-12).
  it('an action let go with no write running, whose line then loses, holds the chain', { timeout: 20_000 }, async () => {
    const { b, m } = await refusedThenRace()
    // Nothing is running now; the publisher asks, and it may go out.
    expect(await b.rows.chainLanded(pk, m)).toBe(true)
    await bLoses(b)
    await vi.waitFor(() => expect(b.rows.chainHeld(pk)).toBe(true), { timeout: 10_000, interval: 20 })
  })

  it('an action let go when its write was refused, whose line then loses, holds the chain', { timeout: 20_000 }, async () => {
    let asked: Promise<boolean> | null = null
    const { b } = await refusedThenRace((tab, m) => { asked = tab.rows.chainLanded(pk, m) })
    expect(await asked).toBe(true)
    await bLoses(b)
    await vi.waitFor(() => expect(b.rows.chainHeld(pk)).toBe(true), { timeout: 10_000, interval: 20 })
  })

  it('a held chain sends nothing, though an action is queued and committed', { timeout: 20_000 }, async () => {
    const { b, m, moveA } = await refusedThenRace()
    await b.rows.chainLanded(pk, m)
    await bLoses(b)
    await vi.waitFor(() => expect(b.rows.chainHeld(pk)).toBe(true), { timeout: 10_000, interval: 20 })
    // A's move is in B's hand, committed, and owed to the relays.
    expect(b.S().events.map((e) => e.id)).toContain(moveA)
    expect(b.S().published[moveA]).not.toBe('ok')
    expect(await b.rows.chainLanded(pk, moveA)).toBe(false)
    ;(await import('../../lib/publisher')).startPublisher()
    b.store.useCyberspace.setState({ live: true })
    b.S().publishNow()
    await tick(400)
    expect(sent.map((x) => x.id)).not.toContain(moveA)
  })

  it('an action that lost is never kept in the spare key', async () => {
    const chain = chainOf(12)
    await seedOldStores(chain)
    await openTab()
    const a = await openTab()
    const b = await openTab()
    await signMove(a)
    await a.rows.chainRowsSettled()
    // B's reads fail, so its move that lost stays in hand.
    const proto = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const real = proto.getAll
    proto.getAll = function (this: IDBIndex, ...x: unknown[]) {
      if (this.objectStore.transaction.db.name === 'onosendai:events') throw new DOMException('broken', 'UnknownError')
      return real.apply(this, x)
    }
    putBack.push(() => { proto.getAll = real })
    const see = blindTheLook()
    let moveB: string
    try { moveB = await signMove(b, 'y') } finally { see() }
    await b.rows.chainRowsSettled()
    expect(b.rows.chainLost(pk, moveB)).toBe(true)
    expect(b.S().events.map((e) => e.id)).toContain(moveB)
    // A page hidden now writes what has not landed to the spare key.
    b.rows.writeTail(pk, b.S().events.slice(-2))
    expect(b.rows.readTail(pk).map((e) => e.id)).not.toContain(moveB)
    expect(b.rows.readTail(pk)).toHaveLength(1)
  })
})

describe('follow-ups of #574', () => {
  /** Hold one store of a database busy with a write until let go; resolves once the hold is on. */
  async function holdStore(dbName: string, store: string): Promise<{ letGo: () => Promise<void> }> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((on) => {
      const tx = db.transaction([store], 'readwrite')
      const os = tx.objectStore(store)
      let holding = true
      const released = new Promise<void>((done) => { tx.oncomplete = () => { db.close(); done() } })
      let first = true
      const spin = (): void => { os.get('nobody').onsuccess = () => { if (first) { first = false; on({ letGo: () => { holding = false; return released } }) } if (holding) spin() } }
      spin()
    })
  }

  it('a move signed after a look that ran out of time goes out only once its commit has answered, and stays queued till then', { timeout: 30_000 }, async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    const a = await openTab()
    ;(await import('../../lib/publisher')).startPublisher()
    a.store.useCyberspace.setState({ live: true })
    a.rows.setRowsPatience({ read: 100, land: 20 })
    // The chain records are busy: the look before the move runs out, and the commit waits.
    const held = await holdStore('onosendai:events', 'chains')
    const m = await signMove(a)
    await tick(500)
    expect(a.S().events.map((e) => e.id)).toContain(m)
    expect(a.S().published[m]).not.toBe('ok')
    expect(sent.map((x) => x.id)).not.toContain(m)
    await held.letGo()
    await vi.waitFor(() => expect(sent.map((x) => x.id)).toContain(m), { timeout: 10_000, interval: 20 })
  })

  it('a move held for a store that stopped answering is said, with RELOAD, and the word goes when the commit answers', { timeout: 30_000 }, async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    const a = await openTab()
    ;(await import('../../lib/publisher')).startPublisher()
    a.store.useCyberspace.setState({ live: true })
    a.rows.setRowsPatience({ read: 100, land: 20, stuck: 300 })
    const toast = (await import('../useToast')).useToast
    toast.getState().dismiss()
    const held = await holdStore('onosendai:events', 'chains')
    putBack.push(() => { void held.letGo() })
    const m = await signMove(a)
    await vi.waitFor(() => expect(toast.getState().toast).toMatchObject({ label: 'CHAIN HELD', meta: 'This device\'s store stopped answering. Moves wait here, unsent.', sticky: true, reload: true }), { timeout: 5_000, interval: 20 })
    expect(sent.map((x) => x.id)).not.toContain(m)
    await held.letGo()
    await vi.waitFor(() => expect(sent.map((x) => x.id)).toContain(m), { timeout: 10_000, interval: 20 })
    expect(toast.getState().toast).toBeNull()
  })

  it('a move the spare key brings back while the rows cannot be read waits for the relays before it goes out', { timeout: 30_000 }, async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id), localToo: true })
    const a = await openTab()
    // A full disk: the move is signed and kept in the spare key, and no row has it.
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const realPut = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realPut.apply(this, x)
    }
    putBack.push(() => { proto.put = realPut })
    let m: string
    try {
      m = await signMove(a)
      await a.rows.chainRowsSettled()
    } finally { proto.put = realPut }
    expect(readTailIds()).toContain(m)
    // The next load cannot read the rows; the relays are silent.
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    const index = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const realGetAll = index.getAll
    index.getAll = function (this: IDBIndex, ...x: unknown[]) {
      if (this.objectStore.transaction.db.name === 'onosendai:events') throw new DOMException('broken', 'UnknownError')
      return realGetAll.apply(this, x)
    }
    putBack.push(() => { index.getAll = realGetAll })
    relays.confirm = null
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toContain(m)
    ;(await import('../../lib/publisher')).startPublisher()
    b.store.useCyberspace.setState({ live: true })
    b.S().publishNow()
    await tick(400)
    expect(sent.map((x) => x.id)).not.toContain(m)
    // The relays answer for the head: it goes.
    relays.confirm = []
    await b.S().confirmHeadNow()
    await vi.waitFor(() => expect(sent.map((x) => x.id)).toContain(m), { timeout: 10_000, interval: 20 })
  })
})

function readTailIds(): string[] {
  return (JSON.parse(localStorage.getItem(`onosendai:chain-unsaved:${pk}`) ?? '[]') as NostrEvent[]).map((e) => e.id)
}

describe('follow-ups of #576', () => {
  /** Hold one store of a database busy with a write until let go; resolves once the hold is on. */
  async function holdStore(dbName: string, store: string): Promise<{ letGo: () => Promise<void> }> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((on) => {
      const tx = db.transaction([store], 'readwrite')
      const os = tx.objectStore(store)
      let holding = true
      const released = new Promise<void>((done) => { tx.oncomplete = () => { db.close(); done() } })
      let first = true
      const spin = (): void => { os.get('nobody').onsuccess = () => { if (first) { first = false; on({ letGo: () => { holding = false; return released } }) } if (holding) spin() } }
      spin()
    })
  }

  /** A move signed on a full disk: in the spare key, in no row. */
  async function moveOnlyInSpareKey(): Promise<{ chain: NostrEvent[]; m: string }> {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id), localToo: true })
    const a = await openTab()
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const realPut = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realPut.apply(this, x)
    }
    putBack.push(() => { proto.put = realPut })
    let m: string
    try {
      m = await signMove(a)
      await a.rows.chainRowsSettled()
    } finally { proto.put = realPut }
    expect(readTailIds()).toContain(m)
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    return { chain, m }
  }

  /** The next loads cannot read the rows. */
  function breakRowReads(): void {
    const index = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const realGetAll = index.getAll
    index.getAll = function (this: IDBIndex, ...x: unknown[]) {
      if (this.objectStore.transaction.db.name === 'onosendai:events') throw new DOMException('broken', 'UnknownError')
      return realGetAll.apply(this, x)
    }
    putBack.push(() => { index.getAll = realGetAll })
  }

  it('held moves are free once the rows answer again, with the relays silent', { timeout: 30_000 }, async () => {
    const { m } = await moveOnlyInSpareKey()
    relays.confirm = null
    // This load cannot read the rows: the move the spare key brings back is held.
    const index = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const realGetAll = index.getAll
    index.getAll = function (this: IDBIndex, ...x: unknown[]) {
      if (this.objectStore.transaction.db.name === 'onosendai:events') throw new DOMException('broken', 'UnknownError')
      return realGetAll.apply(this, x)
    }
    putBack.push(() => { index.getAll = realGetAll })
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toContain(m)
    expect(b.rows.unvouchedAction(pk, m)).toBe(true)
    ;(await import('../../lib/publisher')).startPublisher()
    b.store.useCyberspace.setState({ live: true })
    b.S().publishNow()
    await tick(300)
    expect(sent.map((x) => x.id)).not.toContain(m)
    // The rows answer again: away and back, this identity's chain is read from them, the move committed like any save.
    index.getAll = realGetAll
    await b.S().useNsec(nip19.nsecEncode(generateSecretKey()))
    await b.S().useNsec(nip19.nsecEncode(sk))
    await b.store.savedChainLoaded()
    expect(b.rows.unvouchedAction(pk, m)).toBe(false)
    b.S().publishNow()
    await vi.waitFor(() => expect(sent.map((x) => x.id)).toContain(m), { timeout: 10_000, interval: 20 })
  })

  it('LIVE, a load that brings back held moves asks the relays once by itself: they are free with no press, and PUBLISH NOW sends them', { timeout: 30_000 }, async () => {
    const { m } = await moveOnlyInSpareKey()
    breakRowReads()
    relays.confirm = []
    localStorage.setItem('onosendai:live', '1')
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toContain(m)
    await vi.waitFor(() => expect(b.rows.unvouchedAction(pk, m)).toBe(false), { timeout: 5_000, interval: 20 })
    ;(await import('../../lib/publisher')).startPublisher()
    b.S().publishNow()
    await vi.waitFor(() => expect(sent.map((x) => x.id)).toContain(m), { timeout: 5_000, interval: 20 })
  })

  it('a LIVE load with nothing held asks the relays nothing by itself', async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id), localToo: true })
    await openTab()
    localStorage.setItem('onosendai:live', '1')
    relays.asked = 0
    const b = await openTab()
    await tick(500)
    expect(b.S().live).toBe(true)
    expect(relays.asked).toBe(0)
  })

  it('the relays answer with a sibling of a held move: nothing goes out, and the person is asked to choose', { timeout: 30_000 }, async () => {
    const { chain, m } = await moveOnlyInSpareKey()
    breakRowReads()
    // Another device's move from the same head, already on the relays.
    const sibling = finalizeEvent(hopTemplate({
      createdAt: 1_000 + 60, genesisId: chain[0].id, previousId: chain[5].id,
      prevCoordHex: positionHex(at(5), home.plane), to: { ...at(5), y: home.y + 1n }, plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk) as NostrEvent
    relays.confirm = [sibling]
    localStorage.setItem('onosendai:live', '1')
    const b = await openTab()
    expect(b.S().events.map((e) => e.id)).toContain(m)
    ;(await import('../../lib/publisher')).startPublisher()
    // The relays' answer on load (or a press) brings the sibling in: a fork against the held move.
    await vi.waitFor(() => expect(b.S().chainConflict).toMatchObject({ kind: 'branch', forkId: chain[5].id }), { timeout: 5_000, interval: 20 })
    b.S().publishNow()
    await tick(400)
    expect(sent.map((x) => x.id)).not.toContain(m)
  })

  it('CHAIN HELD for a store that stopped answering goes with its identity, and comes back with it', { timeout: 30_000 }, async () => {
    const chain = chainOf(6)
    await seedOldStores(chain, { published: chain.map((e) => e.id) })
    const a = await openTab()
    ;(await import('../../lib/publisher')).startPublisher()
    a.store.useCyberspace.setState({ live: true })
    a.rows.setRowsPatience({ read: 100, land: 20, stuck: 300 })
    const toast = (await import('../useToast')).useToast
    toast.getState().dismiss()
    const held = await holdStore('onosendai:events', 'chains')
    putBack.push(() => { void held.letGo() })
    await signMove(a)
    const said = { label: 'CHAIN HELD', meta: 'This device\'s store stopped answering. Moves wait here, unsent.' }
    await vi.waitFor(() => expect(toast.getState().toast).toMatchObject(said), { timeout: 5_000, interval: 20 })
    await a.S().useNsec(nip19.nsecEncode(generateSecretKey()))
    expect(toast.getState().toast?.meta).not.toBe(said.meta)
    await a.S().useNsec(nip19.nsecEncode(sk))
    expect(toast.getState().toast).toMatchObject(said)
  })
})
