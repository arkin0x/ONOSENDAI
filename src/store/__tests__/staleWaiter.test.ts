/**
 * staleWaiter.test.ts - a commit left waiting across a respawn ends without
 * a word (verification of #236, finding 5).
 *
 * What would go wrong silently: a commit pressed while the saved chain's
 * signatures were still being checked, then a respawn and a new move; when
 * the old check finally ended, the old commit wrote "Another device moved
 * you" and INFEASIBLE over the new proof's panel while it computed, which
 * also lifted the one-proof-at-a-time guard under it.
 */

import { describe, expect, it, vi } from 'vitest'

const { storage, ctl, posted } = vi.hoisted(() => {
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
  return { storage, ctl: { release: null as null | ((bad: Set<string>) => void) }, posted: [] as Array<{ id: number; prevEventId: string }> }
})

// The saved chain's check answers only when the test says.
vi.mock('../../lib/sigCheck', () => ({ checkSignatures: () => new Promise<Set<string>>((resolve) => { ctl.release = resolve }) }))
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: (m: { id: number; prevEventId: string }) => { posted.push(m) }, cancelProof: () => {} }))
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

describe('a commit waiting on the signature check, across a respawn', () => {
  it('ends without writing to the panel, and the new proof keeps computing, guarded', async () => {
    const spawn = sign(spawnTemplate(pk, 1_000))
    const hop = sign(hopTemplate({ createdAt: 1_001, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to: { x: home.x + 1n, y: home.y, z: home.z }, plane: home.plane, proofHash: '0'.repeat(64) }))
    void positionHex
    storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
    storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: [spawn, hop], published: [spawn.id, hop.id], stats: {} }))
    const { useCyberspace } = await import('../useCyberspace')
    const S = useCyberspace.getState
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const old = S().commit()
    await new Promise((r) => setTimeout(r, 30))
    await S().respawn()
    useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null } })
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toHaveLength(1)
    expect(S().proof.status).toBe('computing')
    // The old check ends now, and the old commit with it.
    ctl.release!(new Set())
    await old
    expect(S().proof.status).toBe('computing')
    expect(S().proof.message).toBeNull()
    expect(posted).toHaveLength(1)
    // The guard held: a second press while the new proof computes does nothing.
    await S().commit()
    expect(posted).toHaveLength(1)
  })
})
