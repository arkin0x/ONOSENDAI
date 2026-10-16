/**
 * signLater.test.ts - chain actions taken offline with a remote signer are
 * kept unsigned with their real ids, survive a reload, and are signed in
 * place before they go anywhere (lib/signLater.ts).
 *
 * What would go wrong silently: an unsigned action cut from the saved chain
 * on reload (the offline moves vanish), a tampered one accepted because it
 * has no signature to fail, or a signature that changes the id, which would
 * orphan every action after it.
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

import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import { isUnsigned, signsLater, soundUnsigned, templateOf, unsignedEvent } from '../../lib/signLater'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const step = (dx: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y, z: home.z })

const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent
const spawn = sign(spawnTemplate(pk, 1_000))
const hopT = (n: number, previous: NostrEvent) => hopTemplate({
  createdAt: 1_000 + n * 10,
  genesisId: spawn.id,
  previousId: previous.id,
  prevCoordHex: n === 1 ? pk : positionHex(step(BigInt(n - 1)), home.plane),
  to: step(BigInt(n)),
  plane: home.plane,
  proofHash: '0'.repeat(64),
})
const hop1 = sign(hopT(1, spawn))
// Taken offline: unsigned, each naming the one before by its real id.
const hop2u = unsignedEvent(hopT(2, hop1), pk)
const hop3u = unsignedEvent(hopT(3, hop2u), pk)

async function loadWith(events: NostrEvent[]): Promise<typeof import('../useCyberspace')['useCyberspace']['getState']> {
  storage.clear()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published: [spawn.id, hop1.id], stats: {} }))
  vi.resetModules()
  const { useCyberspace } = await import('../useCyberspace')
  return useCyberspace.getState
}

describe('an action kept unsigned', () => {
  it('has the id its contents hash to, the client tag a signer would add, and no signature', () => {
    expect(isUnsigned(hop2u)).toBe(true)
    expect(getEventHash(hop2u)).toBe(hop2u.id)
    expect(hop2u.tags.some((t) => t[0] === 'client')).toBe(true)
    expect(soundUnsigned(hop2u, pk)).toBe(true)
  })

  it('signed later by the same key, from its template, keeps its id: nothing after it changes', () => {
    const signed = sign(templateOf(hop2u) as Parameters<typeof finalizeEvent>[0])
    expect(signed.id).toBe(hop2u.id)
    expect(verifyEvent(signed)).toBe(true)
  })

  it('is not sound when its contents changed, when it is someone else\'s, or when it carries a signature', () => {
    expect(soundUnsigned({ ...hop2u, content: 'x' }, pk)).toBe(false)
    expect(soundUnsigned(hop2u, 'b'.repeat(64))).toBe(false)
    expect(soundUnsigned({ ...hop2u, sig: 'f'.repeat(128) }, pk)).toBe(false)
  })

  it('is used only for a remote signer with no network', () => {
    expect(signsLater('nip46', false)).toBe(true)
    expect(signsLater('nip46', true)).toBe(false)
    expect(signsLater('nip07', false)).toBe(false)
    expect(signsLater('local', false)).toBe(false)
  })
})

describe('the saved chain with unsigned actions', () => {
  beforeEach(() => storage.clear())

  it('loads whole on reload, and the background signature check leaves them alone', async () => {
    const S = await loadWith([spawn, hop1, hop2u, hop3u])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, hop1.id, hop2u.id, hop3u.id])
    // Give the background check its turn: nothing is cut.
    await new Promise((r) => setTimeout(r, 50))
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, hop1.id, hop2u.id, hop3u.id])
    expect(S().prevEventId).toBe(hop3u.id)
  })

  it('an unsigned action whose contents changed never existed: the chain ends before it', async () => {
    const tampered = { ...hop2u, content: 'changed' }
    const S = await loadWith([spawn, hop1, tampered, hop3u])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, hop1.id])
  })

  it('signUnsigned signs in place with the same id, and the saved chain keeps the signature', async () => {
    const S = await loadWith([spawn, hop1, hop2u, hop3u])
    const signed = await S().signUnsigned(hop2u.id)
    expect(signed.id).toBe(hop2u.id)
    expect(verifyEvent({ ...signed })).toBe(true)
    expect(isUnsigned(S().events[2])).toBe(false)
    const saved = JSON.parse(storage.getItem(`onosendai:chain:${pk}`)!) as { events: NostrEvent[] }
    expect(saved.events[2].sig).toBe(signed.sig)
    expect(isUnsigned(saved.events[3])).toBe(true)
  })
})
