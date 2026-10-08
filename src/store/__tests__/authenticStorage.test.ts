/**
 * authenticStorage.test.ts - a chain loaded from this device's own storage
 * takes only authentic events (spec §8.2, §8.7.3, Q4).
 *
 * What would go wrong silently: an event in local storage whose signature
 * does not verify (corrupted, tampered with, or a signer's bad answer saved
 * before anything checked it) carried on as part of the chain, so this
 * device would show and continue a chain no other reader resolves. The spec
 * says such an event never existed: the chain ends at the event before it,
 * and the identity continues from there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage } = vi.hoisted(() => {
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
const spawn = sign(spawnTemplate(pk, 1_000))
const hop = (n: number, previous: NostrEvent): NostrEvent => sign(hopTemplate({
  createdAt: 1_000 + n * 10,
  genesisId: spawn.id,
  previousId: previous.id,
  prevCoordHex: n === 1 ? pk : positionHex(step(BigInt(n - 1)), home.plane),
  to: step(BigInt(n)),
  plane: home.plane,
  proofHash: '0'.repeat(64),
}))
const hop1 = hop(1, spawn)
const hop2 = hop(2, hop1)
const hop3 = hop(3, hop2)

/** Store a chain for this identity, then load the store fresh, as a page load does. */
async function loadWith(events: NostrEvent[]): Promise<ReturnType<typeof import('../useCyberspace')['useCyberspace']['getState']>> {
  storage.clear()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published: events.map((e) => e.id), stats: {} }))
  vi.resetModules()
  const { useCyberspace } = await import('../useCyberspace')
  return useCyberspace.getState()
}

describe('a stored chain takes only authentic events (§8.7.3)', () => {
  beforeEach(() => storage.clear())

  it('a chain whose every event verifies loads whole', async () => {
    const S = await loadWith([spawn, hop1, hop2, hop3])
    expect(S.identity.pubkey).toBe(pk)
    expect(S.events.map((e) => e.id)).toEqual([spawn.id, hop1.id, hop2.id, hop3.id])
    expect(S.prevEventId).toBe(hop3.id)
  })

  it('an event whose signature does not verify never existed: the chain ends before it, and continues from there', async () => {
    const forged = { ...hop2, sig: hop2.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }
    const S = await loadWith([spawn, hop1, forged, hop3])
    expect(S.events.map((e) => e.id)).toEqual([spawn.id, hop1.id])
    expect(S.prevEventId).toBe(hop1.id)
  })
})
