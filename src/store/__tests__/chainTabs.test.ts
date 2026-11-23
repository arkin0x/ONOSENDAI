/**
 * chainTabs.test.ts - a move in one tab is never signed past another tab's
 * move that is still on its way into storage (review of #536, F1).
 *
 * lib/chainDb.ts holds each IndexedDB write for a short pause, so that the
 * two saves of an action are one write. The mark beside the chain
 * (localStorage, written at once) then says "changed" before the chain it
 * describes is on disk. A second tab that read the old chain under the new
 * mark took the mark as seen and signed from the old head: a fork of its own
 * chain, and, LIVE, one the relays would end it for.
 *
 * Two tabs here are two imports of the store over one localStorage and one
 * IndexedDB (fake-indexeddb). The chain no longer fits localStorage, as on
 * the owner's device, so only IndexedDB carries it from one tab to the other.
 * The relays know nothing (LOCAL): what the other tab signed is only on disk.
 */

import { provedHop } from '../fixtures/provedHop'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Proofs asked of a worker, by any tab: a move that got past its confirmation. */
const posted = vi.hoisted(() => [] as unknown[])
vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => {
      if (k.startsWith('onosendai:chain:') && String(v).length > 2_000) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      m.set(k, String(v))
    },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
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

type Tab = { store: typeof import('../useCyberspace'); db: typeof import('../../lib/chainDb') }

/** A tab: the store and its chain cache, imported afresh, the saved chain read in. */
async function openTab(): Promise<Tab> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const db = await import('../../lib/chainDb')
  await store.savedChainLoaded()
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  return { store, db }
}

/** One move signed in `tab`, as a proof landing: saved at once, its IndexedDB write held for the pause. */
async function signMove(tab: Tab): Promise<string> {
  const S = tab.store.useCyberspace.getState
  tab.store.useCyberspace.setState({ pendingTarget: { ...S().position, x: S().position.x + 1n } })
  await S().applyProofMessage({ type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(S()), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: S().prevEventId })
  return S().prevEventId
}

/** COMMIT pressed in `tab`, toward one gibson on. */
async function press(tab: Tab): Promise<void> {
  const S = tab.store.useCyberspace.getState
  tab.store.useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 1n } })
  await S().commit()
}

beforeEach(async () => {
  posted.length = 0
  localStorage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  localStorage.setItem('onosendai:live', '0')
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  const chain = chainOf(20)
  db.writeStoredChain(pk, { events: chain, published: [], stats: {}, held: false, savedAt: 1 })
  await db.chainWritesSettled()
  db.closeChainDb()
})

describe('two tabs, one chain (review of #536, F1)', () => {
  it('a move pressed while the other tab\'s move is still being written waits for it, and never signs past it', async () => {
    const a = await openTab()
    const b = await openTab()
    const moved = await signMove(a)
    // A's mark is out at once; its chain is still in the pause.
    posted.length = 0
    await press(b)
    // B read again once the pause was over, found A's move, and took it in
    // instead of signing from the head before it.
    expect(b.store.useCyberspace.getState().prevEventId).toBe(moved)
    expect(posted).toHaveLength(0)
    expect(b.store.useCyberspace.getState().proof.message).toMatch(/Another device moved you/)
    // And the next press signs from A's move.
    await press(b)
    expect(posted).toHaveLength(1)
    expect((posted[0] as { prevEventId: string }).prevEventId).toBe(moved)
  }, 20_000)

  it('while the other tab\'s move is still not on disk, the move is refused, and the mark is not taken as seen', async () => {
    const a = await openTab()
    a.db.setChainWritePause(60_000)
    const b = await openTab()
    const before = b.store.useCyberspace.getState().prevEventId
    const moved = await signMove(a)
    posted.length = 0
    await press(b)
    expect(posted).toHaveLength(0)
    expect(b.store.useCyberspace.getState().proof.message).toBe(b.store.OTHER_TAB_SAVING_MESSAGE)
    expect(b.store.useCyberspace.getState().prevEventId).toBe(before)
    // A's write lands (the pause ended: a read, the page hidden, or its time).
    a.db.flushChainWrites()
    await a.db.chainWritesSettled()
    // The mark was not recorded as seen, so B looks again and takes A's move in.
    await press(b)
    expect(posted).toHaveLength(0)
    expect(b.store.useCyberspace.getState().prevEventId).toBe(moved)
  }, 20_000)

  it('a mark whose chain never lands refuses only while it is young; then the move goes on from this tab\'s head (review of #536, R1)', async () => {
    // Only the clock is faked: the pause and the reads keep their real timers.
    const t0 = new Date('2026-10-30T12:00:00Z').getTime()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    try {
      const a = await openTab()
      // A signs, writes its mark, and then never writes the chain: closed or crashed inside its pause.
      a.db.setChainWritePause(3_600_000)
      const b = await openTab()
      const head = b.store.useCyberspace.getState().prevEventId
      await signMove(a)
      posted.length = 0
      // Young: refused, nothing signed, the head where it was.
      await press(b)
      expect(b.store.useCyberspace.getState().proof.message).toBe(b.store.OTHER_TAB_SAVING_MESSAGE)
      vi.setSystemTime(t0 + 3_000)
      await press(b)
      expect(b.store.useCyberspace.getState().proof.message).toBe(b.store.OTHER_TAB_SAVING_MESSAGE)
      expect(posted).toHaveLength(0)
      expect(b.store.useCyberspace.getState().prevEventId).toBe(head)
      // Past the pause and the patience: the mark is taken as seen, and the move is signed from B's head.
      const { chainWritePause } = b.db
      vi.setSystemTime(t0 + chainWritePause() + b.store.OTHER_TAB_MARK_PATIENCE_MS + 100)
      await press(b)
      expect(posted).toHaveLength(1)
      expect((posted[0] as { prevEventId: string }).prevEventId).toBe(head)
      // And the next one is not held up by it either.
      posted.length = 0
      b.store.useCyberspace.setState({ proof: { ...b.store.useCyberspace.getState().proof, status: 'idle' } })
      await press(b)
      expect(posted).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)
})
