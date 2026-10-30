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
const step = (dx: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent

/** A chain of `n` actions: a spawn and n - 1 hops. */
function chainOf(n: number): NostrEvent[] {
  const spawn = sign(spawnTemplate(pk, 1_000))
  const out = [spawn]
  for (let i = 1; i < n; i++) {
    out.push(sign(hopTemplate({
      createdAt: 1_000 + i * 10,
      genesisId: spawn.id,
      previousId: out[i - 1].id,
      prevCoordHex: i === 1 ? pk : positionHex(step(BigInt(i - 1)), home.plane),
      to: step(BigInt(i)),
      plane: home.plane,
      proofHash: '0'.repeat(64),
    })))
  }
  return out
}

const FULL = 40
/** What localStorage kept before it filled up: the owner's 1,133 of 1,308, scaled down. */
const KEPT = 25
const chain = chainOf(FULL)
const ids = (events: NostrEvent[]): string[] => events.map((e) => e.id)

/** The stored chain of the first `n` actions, as saveChain writes it. */
const storedJson = (n: number): string => JSON.stringify({ version: 2, events: chain.slice(0, n), published: ids(chain.slice(0, n)), stats: {} })

/** A page load: the store imported afresh over the same localStorage and the same IndexedDB. */
async function pageLoad(): Promise<typeof import('../useCyberspace')> {
  vi.resetModules()
  return import('../useCyberspace')
}

/** Every IndexedDB write queued so far has landed. */
async function writesLanded(): Promise<void> {
  const { chainWritesSettled } = await import('../../lib/chainDb')
  await chainWritesSettled()
}

beforeEach(() => {
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
  })

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

/** The self-check answered "none", so the respawn below is an ordinary chain, not a held one. */
function useCyberspaceSpawn(m: typeof import('../useCyberspace')): void {
  m.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
}
