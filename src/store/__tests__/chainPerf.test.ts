/**
 * chainPerf.test.ts - what one action costs does not grow with the chain
 * (arkinox, 2026-10-30: on a 1,308-action chain a WALK step took 2 to 6 s and
 * stuttered the view while looking around).
 *
 * Measured in a browser first (headful Chromium, his chain re-signed under a
 * throwaway key, relays stubbed): about 1.5 s of main-thread work per step,
 * nearly all of it the whole chain read again (buildChain) four times by the
 * two head confirmations, once more by a prompt that was not on screen, and
 * once for the new chain; and the whole IndexedDB record copied twice, once
 * when the action was signed and again when a relay took it.
 *
 * Here, per action on chains of 12 and of 1,308 actions: no whole build of
 * the chain at all, and one IndexedDB write for the two saves. The write is
 * still the whole record (one row per event is the coming event store's
 * job), so its size is reported, not held to O(1).
 */

import { provedHop } from '../fixtures/provedHop'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Whole chain builds asked for by anything outside lib/events.ts. */
const builds = vi.hoisted(() => ({ n: 0 }))
const { storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    // As on the owner's device: the chain no longer fits localStorage.
    setItem: (k: string, v: string) => {
      if (k.startsWith('onosendai:chain:') && String(v).length > 4_000) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      m.set(k, String(v))
    },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return { storage }
})

vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>()
  return { ...actual, buildChain: vi.fn((...a: Parameters<typeof actual.buildChain>) => { builds.n++; return actual.buildChain(...a) }) }
})
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})
// The relays confirm the head the way they do on every move: they send back
// the newest events they hold, which this device already has.
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async (_pk: string, _g: string | undefined, have: unknown[]) => have.slice(-2)) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))

/** A spawn and n - 1 hops along x, signed. */
function chainOf(n: number): NostrEvent[] {
  const out: NostrEvent[] = [finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent]
  for (let k = 1; k < n; k++) {
    out.push(finalizeEvent(hopTemplate({
      createdAt: 1_000 + k,
      genesisId: out[0].id,
      previousId: out[k - 1].id,
      prevCoordHex: k === 1 ? pk : positionHex({ x: home.x + BigInt(k - 1), y: home.y, z: home.z }, home.plane),
      to: { x: home.x + BigInt(k), y: home.y, z: home.z },
      plane: home.plane,
      proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk) as NostrEvent)
  }
  return out
}

/** IndexedDB writes of the chain record: how many, and how many characters of events each carried. */
function countPuts(): { puts: number; chars: number[]; stop: () => void } {
  const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (v: unknown, k?: unknown) => unknown } } }).IDBObjectStore.prototype
  const put = proto.put
  const out = { puts: 0, chars: [] as number[], stop: () => { proto.put = put } }
  proto.put = function (this: unknown, v: unknown, k?: unknown) {
    const rec = v as { key?: string; value?: { events?: unknown[] } }
    if (rec?.key === pk && rec.value?.events) { out.puts++; out.chars.push(JSON.stringify(rec.value.events).length) }
    return put.call(this, v, k)
  }
  return out
}

/** One action as the store takes it: the proof lands, the head is confirmed, it is signed and saved; then a relay takes it. */
async function act(m: typeof import('../useCyberspace')): Promise<void> {
  const s = m.useCyberspace.getState()
  m.useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + 1n } })
  await s.applyProofMessage({ type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(m.useCyberspace.getState()), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: s.prevEventId })
  const head = m.useCyberspace.getState().prevEventId
  m.useCyberspace.getState().setPublishStatus(head, 'ok')
}

async function measure(n: number): Promise<{ builds: number; puts: number; chars: number[]; grew: number }> {
  storage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  const chain = chainOf(n)
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  db.writeStoredChain(pk, { events: chain, published: chain.map((e) => e.id), stats: {}, held: false, savedAt: 1 })
  await db.chainWritesSettled()
  db.closeChainDb()
  vi.resetModules()
  const m = await import('../useCyberspace')
  await m.savedChainLoaded()
  const writes = await import('../../lib/chainDb')
  // One action first: what a load builds once (the chain drawn, its signatures checked) is not an action's cost.
  await act(m)
  await writes.chainWritesSettled()
  const before = m.useCyberspace.getState().events.length
  builds.n = 0
  const puts = countPuts()
  try {
    for (let i = 0; i < 3; i++) {
      await act(m)
      await writes.chainWritesSettled()
    }
  } finally { puts.stop() }
  return { builds: builds.n, puts: puts.puts, chars: puts.chars, grew: m.useCyberspace.getState().events.length - before }
}

beforeEach(() => { builds.n = 0 })

describe('one action, whatever the length of the chain', () => {
  it('never builds the whole chain again, and writes IndexedDB once for its two saves', async () => {
    const small = await measure(12)
    const long = await measure(1_308)
    for (const r of [small, long]) {
      expect(r.grew).toBe(3)
      expect(r.builds).toBe(0)
      expect(r.puts).toBe(3)
    }
    // Still the whole record per write: the size grows with the chain (the event store's job).
    console.info(`[chainPerf] IndexedDB characters written per action: ${small.chars[0]} at 12 actions, ${long.chars[0]} at 1,308`)
  }, 60_000)
})
