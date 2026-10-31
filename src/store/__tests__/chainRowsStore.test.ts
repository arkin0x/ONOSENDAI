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
const relays = vi.hoisted(() => ({ confirm: [] as unknown }))
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
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => relays.confirm) }
})

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

async function openTab(): Promise<Tab> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const rows = await import('../../lib/chainStore')
  await store.savedChainLoaded()
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  return { store, rows, S: store.useCyberspace.getState }
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('moving a chain to rows', () => {
  it('copies the chain whole, and the load after it reads the rows', async () => {
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

  it('a database wiped under the marker: the frozen copy brings the chain back, and it moves again', async () => {
    const chain = chainOf(15)
    await seedOldStores(chain, { localToo: true })
    await openTab()
    ;(await import('../../lib/eventDb/connection')).closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    const b = await openTab()
    expect(b.S().events).toHaveLength(15)
    expect(b.rows.inRows(pk)).toBe(true)
    expect((await rowsNow())!.events).toHaveLength(15)
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
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(moveA))
    const rows = await rowsNow()
    expect(rows!.events.map((e) => e.id)).toEqual([...chain.map((e) => e.id), moveA])
    // B's action is not in its chain, not owed to any relay, and is kept, signed, as a branch set aside.
    expect(b.S().events.map((e) => e.id)).not.toContain(moveB)
    expect(b.S().published[moveB]).toBeUndefined()
    expect(b.S().proof.message).toBe(b.store.OTHER_TAB_FIRST_MESSAGE)
    await vi.waitFor(async () => {
      const parted = await b.rows.rowsSetAside(pk)
      expect(parted.flatMap((p) => p.events.map((e) => e.id))).toContain(moveB)
    })
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
    })
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
    await vi.waitFor(async () => expect((await b.rows.rowsSetAside(pk)).flatMap((p) => p.events.map((e) => e.id))).toContain(stray.id))
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
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(won))
    localStorage.setItem(`onosendai:chain-unsaved:${pk}`, JSON.stringify([lostEvent]))
    const c = await openTab()
    expect(c.S().prevEventId).toBe(won)
    expect(c.S().events.map((e) => e.id)).not.toContain(lost)
    expect(c.S().forkNotice).toBeNull()
    await vi.waitFor(async () => expect((await c.rows.rowsSetAside(pk)).flatMap((p) => p.events.map((e) => e.id))).toContain(lost))
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
    await vi.waitFor(() => expect(store.useCyberspace.getState().prevEventId).toBe(further))
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
    await vi.waitFor(() => expect(c.S().prevEventId).toBe(m2))
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
    await vi.waitFor(() => expect(b.S().prevEventId).toBe(m2))
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
    await vi.waitFor(() => expect(rows.inRows(pk)).toBe(true))
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
    localStorage.setItem('onosendai:chain-store-probe', 'a memo that would have passed')
    const open = vi.spyOn((globalThis as { indexedDB: IDBFactory }).indexedDB, 'open')
    await openTab()
    expect(open.mock.calls.map((c) => c[0])).toContain('onosendai:events-probe')
  })
})
