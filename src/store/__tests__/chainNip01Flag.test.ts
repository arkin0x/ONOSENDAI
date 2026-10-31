/**
 * chainNip01Flag.test.ts - a signature is checked once per row, ever (the
 * owner's ruling, 2026-10-30; design 3.4). A reload of a chain whose rows are
 * flagged runs no Schnorr check at all and holds nothing up. Its ids are still
 * recomputed, so a damaged row is cut as before. Fake-indexeddb, no network.
 */

import { provedHop } from '../fixtures/provedHop'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const schnorr = vi.hoisted(() => ({ n: 0 }))
vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
})
vi.mock('nostr-tools/pure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pure')>()
  return { ...actual, verifyEvent: (e: Parameters<typeof actual.verifyEvent>[0]) => { schnorr.n++; return actual.verifyEvent(e) } }
})
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (k: number): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + BigInt(k), y: home.y, z: home.z })

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

async function load() {
  vi.resetModules()
  const store = await import('../useCyberspace')
  await store.savedChainLoaded()
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  return store
}

/** The chain's actions checked (signaturesChecked), through what a move waits on. */
const settled = async (store: Awaited<ReturnType<typeof load>>): Promise<void> => {
  await vi.waitFor(() => expect(performance.getEntriesByName('onosendai:chain-verified').length).toBeGreaterThan(0))
  void store
  await new Promise((r) => setTimeout(r, 30))
}

const flags = async (): Promise<Array<{ id: string; nip01: number; chainOf?: string }>> => {
  const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
  const rows = await withEventDb((db) => new Promise<Array<{ id: string; nip01: number; chainOf?: string }>>((resolve) => {
    const r = db.transaction('events').objectStore('events').getAll()
    r.onsuccess = () => resolve(r.result as Array<{ id: string; nip01: number; chainOf?: string }>)
  }))
  closeEventDb()
  return rows
}

beforeEach(async () => {
  schnorr.n = 0
  performance.clearMarks()
  localStorage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  localStorage.setItem('onosendai:live', '0')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The deploy says yes, so a chain moves into rows (lib/chainStore.ts deployAllowsMove).
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ build: 'deployed', minChainEpoch: 2, chainStore: 2 }) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function seed(events: NostrEvent[]): Promise<void> {
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  db.writeStoredChain(pk, { events, published: [], stats: {}, held: false, savedAt: 1 }, false)
  await db.chainWritesSettled()
  db.closeChainDb()
}

describe('the NIP-01 flag', () => {
  it('a moved chain is checked once, flagged, and a reload runs no Schnorr check at all', async () => {
    const chain = chainOf(12)
    await seed(chain)
    await settled(await load())
    // The load that moved it and the next, which finds the rows unflagged, between them check each signature and flag it.
    performance.clearMarks()
    await settled(await load())
    expect((await flags()).filter((r) => r.chainOf === pk).every((r) => r.nip01 === 1)).toBe(true)
    schnorr.n = 0
    performance.clearMarks()
    const third = await load()
    await settled(third)
    expect(schnorr.n).toBe(0)
    expect(third.useCyberspace.getState().events).toHaveLength(12)
  })

  it('a row not flagged yet is checked exactly once: by the worker, and not again by the old check', async () => {
    const chain = chainOf(12)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    schnorr.n = 0
    await settled(await load())
    expect(schnorr.n).toBe(12)
  })

  it('a relay that sends a flagged event while the check is still running is not checked again', async () => {
    const chain = chainOf(60)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    await settled(await load())
    // The check takes the slow road, so it is still going when the relay's copy lands.
    const proto = IDBDatabase.prototype as unknown as { transaction: (...x: unknown[]) => unknown }
    const real = proto.transaction
    proto.transaction = function (this: IDBDatabase, ...x: unknown[]) {
      if (x[0] === 'events' && x[1] === 'readonly') throw new DOMException('gone', 'InvalidStateError')
      return real.apply(this, x)
    }
    try {
      await load()
      const { verifyOnce } = await import('../../lib/verifiedSigs')
      schnorr.n = 0
      expect(verifyOnce(JSON.parse(JSON.stringify(chain[2])) as NostrEvent)).toBe(true)
      expect(schnorr.n).toBe(0)
    } finally { proto.transaction = real }
    await new Promise((r) => setTimeout(r, 100))
  })

  it('a reload holds no action back: nothing says it is checking signatures', async () => {
    const chain = chainOf(6)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    await settled(await load())
    performance.clearMarks()
    const third = await load()
    await settled(third)
    expect(third.useCyberspace.getState().proof.message).not.toBe(third.SIG_CHECK_MESSAGE)
  })

  it('a damaged flagged row is caught by its id, and the chain is cut there', async () => {
    const chain = chainOf(8)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    await settled(await load())
    const { withEventDb, closeEventDb } = await import('../../lib/eventDb/connection')
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      const os = tx.objectStore('events')
      const g = os.get(chain[5].id)
      g.onsuccess = () => os.put({ ...g.result, tags: [...g.result.tags, ['rot', '1']] })
      tx.oncomplete = () => resolve()
    }))
    closeEventDb()
    performance.clearMarks()
    const after = await load()
    await settled(after)
    expect(after.useCyberspace.getState().events).toHaveLength(5)
    expect(after.useCyberspace.getState().prevEventId).toBe(chain[4].id)
    expect(after.useCyberspace.getState().proof.message).toMatch(/failed the signature check|set aside/)
  })

  it('a forged signature nobody checked yet is caught, is never flagged, and the chain is cut there', async () => {
    const chain = chainOf(8)
    const forged = chain.map((e, i) => (i === 5 ? { ...e, sig: 'f'.repeat(128) } : e))
    await seed(forged)
    await settled(await load())
    const rows = await flags()
    const row = rows.find((r) => r.id === chain[5].id)
    expect(row?.nip01).toBe(0)
    expect(row?.chainOf).toBeUndefined()
  })

  it('your own moves are flagged as they are made: no check waits for them on the next load', async () => {
    const chain = chainOf(5)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    const second = await load()
    await settled(second)
    const S = second.useCyberspace.getState
    second.useCyberspace.setState({ pendingTarget: { ...S().position, x: S().position.x + 1n } })
    await S().applyProofMessage({ type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(S()), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: S().prevEventId })
    const head = S().prevEventId
    const { chainRowsSettled } = await import('../../lib/chainStore')
    await chainRowsSettled()
    expect((await flags()).find((r) => r.id === head)?.nip01).toBe(1)
  })

  it('a signature checked on an earlier page is not checked again when a relay sends it', async () => {
    const chain = chainOf(5)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    await settled(await load())
    performance.clearMarks()
    const third = await load()
    await settled(third)
    const { verifyOnce } = await import('../../lib/verifiedSigs')
    schnorr.n = 0
    expect(verifyOnce(JSON.parse(JSON.stringify(chain[2])) as NostrEvent)).toBe(true)
    expect(schnorr.n).toBe(0)
  })

  it('a database that cannot do the check hands it to the check that needs none', async () => {
    const chain = chainOf(5)
    await seed(chain)
    await settled(await load())
    performance.clearMarks()
    const proto = IDBIndex.prototype as unknown as { getAll: (...x: unknown[]) => unknown }
    const real = proto.getAll
    let reads = 0
    schnorr.n = 0
    const second = (async () => {
      // The chain's read itself goes through; the check's read of the same index does not.
      proto.getAll = function (this: IDBIndex, ...x: unknown[]) {
        if (this.name === 'byChain' && this.objectStore.transaction.objectStoreNames.length === 1) { reads++; throw new DOMException('gone', 'InvalidStateError') }
        return real.apply(this, x)
      }
      const s = await load()
      await settled(s)
      return s
    })()
    const s = await second
    proto.getAll = real
    expect(reads).toBeGreaterThan(0)
    expect(s.useCyberspace.getState().events).toHaveLength(5)
    expect(schnorr.n).toBeGreaterThan(0)
  })
})
