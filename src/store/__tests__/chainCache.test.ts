/**
 * chainCache.test.ts - a chain longer than localStorage can hold is kept
 * whole on this device, and the actions this device signed are never
 * reported as another device's (arkinox, 2026-10-30).
 *
 * What went wrong: the chain lived only in localStorage, written whole on
 * every save, and a write past the quota threw and was swallowed. The copy
 * there stopped at the last chain that fit (1,133 of 1,308 actions), so
 * every start drew that old head, the relays brought back the other 175,
 * and the chip said "175 FROM ANOTHER DEVICE", on the phone that had signed
 * them, on every start.
 *
 * Here localStorage refuses a chain key past a size, as a full browser does;
 * IndexedDB is fake-indexeddb and outlives each "page load" (a fresh import
 * of the store); the relays are a direct adoptChain with the whole chain,
 * which is what the self-check hands it (lib/selfSync.ts).
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The chain key's largest value, in characters, before setItem throws as a full browser does. */
const quota = vi.hoisted(() => ({ chainChars: Infinity, refused: 0 }))
/** Proofs the store asked a worker for: a move that got past its confirmation. */
const posted = vi.hoisted(() => [] as unknown[])
const { storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => {
      if (k.startsWith('onosendai:chain:') && String(v).length > quota.chainChars) {
        quota.refused++
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      m.set(k, String(v))
    },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return { storage }
})

// The old stores, as version 1 keeps them and as a browser with no IndexedDB does: the rows have their own tests (chainRowsStore.test.ts).
vi.mock('../../lib/chainStoreVersion', () => ({ CHAIN_STORE_VERSION: 1 }))
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn((m: unknown) => { posted.push(m) }), cancelProof: vi.fn() }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import { moveDirection } from '../../lib/moves'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (dx: bigint, dy: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y + dy, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent

/** Where each action of every chain built here stands. */
const placeOf = new Map<string, { x: bigint; y: bigint; z: bigint }>()

/** `base` and `n` more hops, the k-th to x + k on row `dy`, signed from `t0`. */
function extend(base: NostrEvent[], n: number, dy: bigint, t0: number): NostrEvent[] {
  const out = base.slice()
  for (let i = 0; i < n; i++) {
    const k = out.length
    const prev = out[k - 1]
    const to = at(BigInt(k), dy)
    const e = sign(hopTemplate({
      createdAt: t0 + k * 10,
      genesisId: out[0].id,
      previousId: prev.id,
      prevCoordHex: k === 1 ? pk : positionHex(placeOf.get(prev.id)!, home.plane),
      to,
      plane: home.plane,
      proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }))
    placeOf.set(e.id, to)
    out.push(e)
  }
  return out
}

/** A chain of `n` actions: a spawn and n - 1 hops. */
function chainOf(n: number): NostrEvent[] {
  return extend([sign(spawnTemplate(pk, 1_000))], n - 1, 0n, 1_000)
}

const FULL = 40
/** What localStorage kept before it filled up: the owner's 1,133 of 1,308, scaled down. */
const KEPT = 25
const chain = chainOf(FULL)
/** The branch the relays held from action 20 on, which the person kept over this device's (ChainConflict). */
const FORK = 20
const branch = extend(chain.slice(0, FORK), 20, 1n, 5_000)
/** A respawn: a new chain, its spawn newer than `chain`'s. */
const respawned = [sign(spawnTemplate(pk, 9_000))]
const ids = (events: NostrEvent[]): string[] => events.map((e) => e.id)

/** The stored chain of the first `n` actions, as saveChain writes it. */
const storedJson = (n: number): string => JSON.stringify({ version: 2, events: chain.slice(0, n), published: ids(chain.slice(0, n)), stats: {} })

/** A page load: the store imported afresh over the same localStorage and the same IndexedDB, reads waiting at most `patienceMs`. */
async function pageLoad(patienceMs = 3_000): Promise<typeof import('../useCyberspace')> {
  vi.resetModules()
  ;(await import('../../lib/chainDb')).setChainReadPatience(patienceMs)
  return import('../useCyberspace')
}

/** IndexedDB as another build or another tab left it: this record for `pk`, written now. */
async function keepInDb(events: NostrEvent[], published: NostrEvent[], savedAt: number): Promise<void> {
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  db.writeStoredChain(pk, { events, published: ids(published), stats: {}, held: false, savedAt })
  await db.chainWritesSettled()
  db.closeChainDb()
}

/** localStorage as a save left it: `events`, `published` of them acknowledged, stamped `savedAt` (absent, as an older build wrote it, when undefined). */
function keepInLocal(events: NostrEvent[], published: NostrEvent[], savedAt?: number): void {
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published: ids(published), stats: {}, ...(savedAt === undefined ? {} : { savedAt }) }))
}

/** An IndexedDB whose open answers `delayMs` late, or never (null). */
function slowDb(real: IDBFactory, delayMs: number | null): IDBFactory {
  return {
    open(name: string, version?: number) {
      const req = real.open(name, version)
      let handler: ((this: IDBOpenDBRequest, e: Event) => void) | null = null
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        get: () => handler,
        set: (fn: typeof handler) => {
          handler = fn ? function (this: IDBOpenDBRequest, e: Event) { if (delayMs !== null) setTimeout(() => fn.call(req, e), delayMs) } : fn
        },
      })
      return req
    },
    deleteDatabase: real.deleteDatabase.bind(real),
    cmp: real.cmp.bind(real),
    databases: real.databases.bind(real),
  } as unknown as IDBFactory
}

/** An IndexedDB that refuses every open. */
const deniedDb = { open: () => { throw new DOMException('denied', 'UnknownError') } } as unknown as IDBFactory

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const setDb = (f: IDBFactory | undefined): void => { (globalThis as { indexedDB?: IDBFactory }).indexedDB = f }

/** Every IndexedDB write queued so far has landed. */
async function writesLanded(): Promise<void> {
  const { chainWritesSettled } = await import('../../lib/chainDb')
  await chainWritesSettled()
}

beforeEach(() => {
  posted.length = 0
  storage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  // Room for the KEPT actions and no more, as on the owner's phone.
  quota.chainChars = storedJson(KEPT).length + 2_000
  quota.refused = 0
})

describe('a chain longer than localStorage holds (arkinox, 2026-10-30)', () => {
  it('the relays bring the missing actions once; every later start holds the whole chain and reports nothing', async () => {
    // Where the owner's phone was: localStorage stuck at the last chain that fit.
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    expect(() => storage.setItem(`onosendai:chain:${pk}`, storedJson(FULL))).toThrow()

    // First start on this build: nothing in IndexedDB yet, so the actions the
    // old build failed to save are honestly not on this device, and are
    // reported once.
    let m = await pageLoad()
    expect(m.useCyberspace.getState().events).toHaveLength(KEPT)
    await m.savedChainLoaded()
    m.useCyberspace.getState().adoptChain(chain)
    expect(m.useCyberspace.getState().events).toHaveLength(FULL)
    expect(m.useCyberspace.getState().forkNotice).toMatchObject({ adopted: FULL - KEPT, dropped: 0 })
    await writesLanded()
    // localStorage still could not take it: this is the case being fixed.
    expect(quota.refused).toBeGreaterThan(0)

    // Every start after that: the whole chain, and the relays' copy of it
    // reports nothing, even when it races the IndexedDB read.
    for (let start = 0; start < 2; start++) {
      m = await pageLoad()
      const S = m.useCyberspace.getState
      // Drawn from localStorage at once: the old stretch, until IndexedDB answers.
      expect(S().events).toHaveLength(KEPT)
      // The relays answer before IndexedDB does: held back, not counted.
      S().adoptChain(chain)
      await m.savedChainLoaded()
      expect(ids(S().events)).toEqual(ids(chain))
      expect(S().prevEventId).toBe(chain[FULL - 1].id)
      expect(S().forkNotice).toBeNull()
      // And again after, as the live subscription delivers.
      S().adoptChain(chain)
      expect(S().forkNotice).toBeNull()
      expect(S().published[chain[FULL - 1].id]).toBe('ok')
      await writesLanded()
    }
  }, 20_000)

  it('an action really from another device is still reported, and only that one', async () => {
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    let m = await pageLoad()
    await m.savedChainLoaded()
    m.useCyberspace.getState().adoptChain(chain.slice(0, FULL - 1))
    await writesLanded()

    m = await pageLoad()
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(FULL - 1)
    m.useCyberspace.getState().adoptChain(chain)
    expect(m.useCyberspace.getState().forkNotice).toMatchObject({ adopted: 1, dropped: 0 })
  })

  it('a chain signed here that localStorage never held at all comes back from IndexedDB', async () => {
    // localStorage cannot hold even one action for this identity.
    quota.chainChars = 0
    let m = await pageLoad()
    await m.savedChainLoaded()
    useCyberspaceSpawn(m)
    await m.useCyberspace.getState().respawn()
    const signed = m.useCyberspace.getState().events
    expect(signed).toHaveLength(1)
    await writesLanded()
    expect(storage.getItem(`onosendai:chain:${pk}`)).toBeNull()

    m = await pageLoad()
    // Nothing drawn at once (localStorage has nothing), the spawn once IndexedDB answers.
    expect(m.useCyberspace.getState().events).toHaveLength(0)
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(signed))
    m.useCyberspace.getState().adoptChain(signed)
    expect(m.useCyberspace.getState().forkNotice).toBeNull()
  })

  it('a save while IndexedDB is still being read never puts the old stretch over the whole chain', async () => {
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    let m = await pageLoad()
    await m.savedChainLoaded()
    m.useCyberspace.getState().adoptChain(chain)
    await writesLanded()

    m = await pageLoad()
    // A relay acknowledgement lands before IndexedDB answers: the store saves
    // the old stretch it holds. That save must wait for the read.
    m.useCyberspace.getState().setPublishStatus(chain[KEPT - 1].id, 'ok')
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(FULL)
    await writesLanded()

    m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(chain))
  })

  it('without IndexedDB the chain loads from localStorage exactly as before', async () => {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    const m = await pageLoad()
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(KEPT)
    m.useCyberspace.getState().adoptChain(chain)
    expect(m.useCyberspace.getState().forkNotice).toMatchObject({ adopted: FULL - KEPT })
  })
})

describe('review of #528: IndexedDB slow, failing, or holding a copy that parted ways', () => {
  // IndexedDB holds all 40, the last 10 never published (LOCAL); localStorage froze at 25.
  const seedLocalMoves = async (): Promise<void> => {
    await keepInDb(chain, chain.slice(0, 30), 2_000)
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, KEPT))
  }

  it('a read that runs out of time writes nothing over the whole chain, and its late answer is taken in, in silence', async () => {
    await seedLocalMoves()
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(slowDb(real, 600))
    let m = await pageLoad(150)
    const S = m.useCyberspace.getState
    await m.savedChainLoaded()
    // Out of time: the chain in hand is the old stretch, and moves are not held up.
    expect(S().events).toHaveLength(KEPT)
    // A save now (a relay acknowledgement) must not reach IndexedDB.
    S().setPublishStatus(chain[KEPT - 1].id, 'ok')
    // The late answer lands: the whole chain, said nothing about.
    await vi.waitFor(() => expect(S().events).toHaveLength(FULL), { timeout: 3_000 })
    expect(S().forkNotice).toBeNull()
    expect(S().published[chain[FULL - 1].id]).toBe('queued')
    await writesLanded()
    setDb(real)
    m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(chain))
    // The ten LOCAL actions are still this device's to publish.
    expect(m.useCyberspace.getState().published[chain[FULL - 1].id]).toBe('queued')
  })

  it('a read that never answers lets the load go on, and a save then writes nothing over the whole chain', async () => {
    await seedLocalMoves()
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(slowDb(real, null))
    let m = await pageLoad(150)
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(KEPT)
    m.useCyberspace.getState().setPublishStatus(chain[KEPT - 1].id, 'ok')
    await sleep(50)
    setDb(real)
    m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(chain))
  })

  it('a database that refuses to open is never taken for "nothing kept", and nothing is written over it', async () => {
    await seedLocalMoves()
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(deniedDb)
    let m = await pageLoad(150)
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(KEPT)
    m.useCyberspace.getState().setPublishStatus(chain[KEPT - 1].id, 'ok')
    setDb(real)
    m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(chain))
  })

  it('same spawn, parted ways: the branch kept last wins over the old stretch localStorage froze on', async () => {
    // This device moved past action 20 while LOCAL; localStorage froze at 25
    // of that branch (written by an older build, no time). The person then
    // kept the relays' branch, saved to IndexedDB.
    await keepInDb(branch, branch, 5_000)
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, FORK))
    const m = await pageLoad()
    const S = m.useCyberspace.getState
    await m.savedChainLoaded()
    expect(ids(S().events)).toEqual(ids(branch))
    // The relays hold the kept branch: nothing diverges, nothing is reported.
    S().adoptChain(branch)
    expect(S().chainConflict).toBeNull()
    expect(S().forkNotice).toBeNull()
  })

  it('same spawn, parted ways, the other way round: the copy saved last wins even when it is localStorage\'s', async () => {
    await keepInDb(chain, chain, 2_000)
    keepInLocal(branch.slice(0, FORK + 2), branch.slice(0, FORK + 2), 6_000)
    const m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(branch.slice(0, FORK + 2)))
  })

  it('a respawn in localStorage is not replaced by the older, longer chain IndexedDB still holds', async () => {
    await keepInDb(chain, chain, 2_000)
    keepInLocal(respawned, respawned, 9_000)
    let m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(respawned))
    // And the reverse: the respawn kept only in IndexedDB beats the old stretch in localStorage.
    storage.clear()
    storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
    setDb(new IDBFactory())
    await keepInDb(respawned, respawned, 9_000)
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, KEPT))
    m = await pageLoad()
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(respawned))
  })

  it('a hold the self-check already lifted is not put back by the record', async () => {
    vi.resetModules()
    const db = await import('../../lib/chainDb')
    db.writeStoredChain(pk, { events: chain, published: [], stats: {}, held: true, savedAt: 2_000 })
    await db.chainWritesSettled()
    keepInLocal(chain.slice(0, KEPT), [])
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(slowDb(real, 300))
    const m = await pageLoad()
    // The relays answered before IndexedDB did: no other chain, the hold is lifted.
    m.useCyberspace.getState().applySelfCheck(pk, { status: 'none' })
    expect(m.useCyberspace.getState().held).toBe(false)
    await m.savedChainLoaded()
    expect(m.useCyberspace.getState().events).toHaveLength(FULL)
    expect(m.useCyberspace.getState().held).toBe(false)
  })

  it('an identity switch while the read is out: the old identity\'s answer never lands on the new one', async () => {
    await keepInDb(chain, chain, 2_000)
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, KEPT))
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(slowDb(real, 300))
    const m = await pageLoad()
    const S = m.useCyberspace.getState
    const other = generateSecretKey()
    await S().useNsec(nip19.nsecEncode(other))
    expect(S().identity.pubkey).toBe(getPublicKey(other))
    await sleep(500)
    await m.savedChainLoaded()
    expect(S().events).toHaveLength(0)
    // Back to the first identity: its whole chain, from IndexedDB.
    await S().useNsec(nip19.nsecEncode(sk))
    await m.savedChainLoaded()
    expect(ids(S().events)).toEqual(ids(chain))
  })

  it('a move with another tab\'s save to read and IndexedDB never answering is not held up for good', async () => {
    keepInLocal(chain.slice(0, 5), chain.slice(0, 5))
    const real = (globalThis as { indexedDB: IDBFactory }).indexedDB
    setDb(slowDb(real, null))
    const m = await pageLoad(150)
    const S = m.useCyberspace.getState
    await m.savedChainLoaded()
    await vi.waitFor(() => expect(performance.getEntriesByName('onosendai:chain-verified').length).toBeGreaterThan(0))
    // Another tab saved: its mark changed, so the move reads both stores first.
    storage.setItem(`onosendai:chain-mark:${pk}`, 'another-tab')
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toHaveLength(1)
  })
})

describe('review of #528, follow-ups: a late answer that parted ways, and holds', () => {
  // IndexedDB holds all 40, the 15 after action 25 never published (LOCAL); localStorage froze at 25.
  const seed = async (): Promise<IDBFactory> => {
    await keepInDb(chain, chain.slice(0, KEPT), 2_000)
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, KEPT))
    return (globalThis as { indexedDB: IDBFactory }).indexedDB
  }
  /** Another device's move from action 25, published: what the relays bring while the read is out. */
  const theirs = extend(chain.slice(0, KEPT), 1, 2n, 9_000)

  it('the relays bring a move that parts from this device\'s LOCAL branch while the read is out: asked, on this load and the next, never settled', async () => {
    const real = await seed()
    setDb(slowDb(real, 600))
    let m = await pageLoad(150)
    let S = m.useCyberspace.getState
    await m.savedChainLoaded()
    S().adoptChain(theirs)
    expect(S().prevEventId).toBe(theirs[KEPT].id)
    // The late answer: this device's branch comes back, and the parting is put to the person.
    await vi.waitFor(() => expect(S().chainConflict?.kind).toBe('branch'), { timeout: 3_000 })
    expect(ids(S().events)).toEqual(ids(chain))
    expect(S().published[chain[FULL - 1].id]).toBe('queued')
    await writesLanded()

    // The next load, IndexedDB answering at once: this device's branch, and the same question.
    setDb(real)
    m = await pageLoad()
    S = m.useCyberspace.getState
    await m.savedChainLoaded()
    expect(ids(S().events)).toEqual(ids(chain))
    expect(S().published[chain[FULL - 1].id]).toBe('queued')
    S().adoptChain(theirs)
    expect(S().chainConflict?.kind).toBe('branch')
  }, 20_000)

  it('unpublished moves on both sides of a late parting: the chain in hand stays, and the other branch is kept aside, whole', async () => {
    const real = await seed()
    setDb(slowDb(real, 600))
    const m = await pageLoad(150)
    const S = m.useCyberspace.getState
    await m.savedChainLoaded()
    // A LOCAL move made from action 25 while the read was out.
    const mine = extend(chain.slice(0, KEPT), 1, 3n, 9_000)
    m.useCyberspace.setState({ events: mine, prevEventId: mine[KEPT].id, published: { ...S().published, [mine[KEPT].id]: 'queued' } })
    S().setPublishStatus(chain[0].id, 'ok')
    await sleep(900)
    expect(S().prevEventId).toBe(mine[KEPT].id)
    expect(S().chainConflict).toBeNull()
    await writesLanded()
    setDb(real)
    const db = await import('../../lib/chainDb')
    const aside = await db.setAsideChains(pk)
    expect(aside).toHaveLength(1)
    expect(ids(aside[0].events)).toEqual(ids(chain))
    const kept = await db.readStoredChain(pk)
    expect(kept && typeof kept === 'object' ? ids(kept.events) : kept).toEqual(ids(mine))
  }, 20_000)

  it('a held respawn only IndexedDB has keeps its hold over the older chain in hand', async () => {
    vi.resetModules()
    const db = await import('../../lib/chainDb')
    db.writeStoredChain(pk, { events: respawned, published: [], stats: {}, held: true, savedAt: 9_000 })
    await db.chainWritesSettled()
    keepInLocal(chain.slice(0, KEPT), chain.slice(0, KEPT), 1_000)
    const m = await pageLoad()
    expect(m.useCyberspace.getState().held).toBe(false)
    await m.savedChainLoaded()
    expect(ids(m.useCyberspace.getState().events)).toEqual(ids(respawned))
    expect(m.useCyberspace.getState().held).toBe(true)
  })
})

describe('chainDb writes in order', () => {
  it('a write that fails on a dead connection is not sent again after a newer one landed', async () => {
    vi.resetModules()
    const db = await import('../../lib/chainDb')
    const older = { events: chain.slice(0, 10), published: [], stats: {}, held: false, savedAt: 1 }
    const newer = { events: chain, published: [], stats: {}, held: false, savedAt: 2 }
    // The first transaction meets a dead connection (Safari's "Connection to
    // Indexed Database server lost"): that write is tried again on a fresh one.
    const proto = (globalThis as unknown as { IDBDatabase: { prototype: { transaction: (...a: unknown[]) => unknown } } }).IDBDatabase.prototype
    const transaction = proto.transaction
    let calls = 0
    proto.transaction = function (this: unknown, ...a: unknown[]) {
      if (a[1] === 'readwrite' && calls++ === 0) throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
      return transaction.apply(this, a)
    }
    try {
      db.writeStoredChain(pk, older)
      db.writeStoredChain(pk, newer)
      // The page is hidden: the waiting write goes at once, beside the one in flight.
      db.flushChainWrites()
      await db.chainWritesSettled()
      await sleep(100)
    } finally {
      proto.transaction = transaction
    }
    const kept = await db.readStoredChain(pk)
    expect(kept && typeof kept === 'object' ? kept.events.length : kept).toBe(FULL)
  })
})

/** The self-check answered "none", so the respawn below is an ordinary chain, not a held one. */
function useCyberspaceSpawn(m: typeof import('../useCyberspace')): void {
  m.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
}
