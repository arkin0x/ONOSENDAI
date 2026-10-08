/**
 * sigCheckHang.test.ts - a signature check that never answers does not hold
 * a new chain's moves (review of #242).
 *
 * What would go wrong silently: the wait for the saved chain's check keyed
 * on the identity, so a check that never finished held every chain action,
 * a respawn's new chain included, for the rest of the page.
 */

import { describe, expect, it, vi } from 'vitest'

const { storage, posted } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return { storage, posted: [] as Array<{ id: number }> }
})

// The check never answers.
vi.mock('../../lib/sigCheck', () => ({ checkSignatures: () => new Promise<Set<string>>(() => {}) }))
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: (m: { id: number }) => { posted.push(m) }, cancelProof: () => {} }))
vi.mock('../../lib/chains', async (orig) => ({ ...(await orig() as object), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import { moveDirection } from '../../lib/moves'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => JSON.parse(JSON.stringify(finalizeEvent(t, sk))) as NostrEvent
const within = <T>(p: Promise<T>, ms: number): Promise<T | 'still waiting'> => Promise.race([p, new Promise<'still waiting'>((r) => setTimeout(() => r('still waiting'), ms))])

describe('a signature check that never answers', () => {
  it('holds the old chain\'s moves, saying so, but a respawn stops waiting on it', async () => {
    const spawn = sign(spawnTemplate(pk, 1_000))
    const hop = sign(hopTemplate({ createdAt: 1_001, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to: { x: home.x + 1n, y: home.y, z: home.z }, plane: home.plane, proofHash: '0'.repeat(64) }))
    void positionHex
    storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
    storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: [spawn, hop], published: [spawn.id, hop.id], stats: {} }))
    const { useCyberspace, SIG_CHECK_MESSAGE } = await import('../useCyberspace')
    const S = useCyberspace.getState
    S().moveCursor(moveDirection(S().axes(), 'right'))
    expect(await within(S().commit(), 300)).toBe('still waiting')
    expect(S().proof.message).toBe(SIG_CHECK_MESSAGE)
    expect(posted).toEqual([])
    await S().respawn()
    useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null } })
    S().moveCursor(moveDirection(S().axes(), 'right'))
    expect(await within(S().commit(), 1_000)).not.toBe('still waiting')
    expect(posted).toHaveLength(1)
  })
})
