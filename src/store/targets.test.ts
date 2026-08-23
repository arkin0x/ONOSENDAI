/**
 * targets.test.ts - a target is a pubkey with a position, resolved from its
 * chain when it has one and its own bits when it does not.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, spawnTemplate } from '../lib/events'
import { useCyberspace } from './useCyberspace'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const at = coordToXyz(hexToCoord(pk))
const spawn = finalizeEvent(spawnTemplate(pk, 100), sk)
const hop = finalizeEvent(hopTemplate({
  createdAt: 110, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk,
  to: { x: at.x + 7n, y: at.y, z: at.z }, plane: at.plane, proofHash: '2'.repeat(64),
}), sk)

describe('targets', () => {
  it('adds a target at its spawn coordinate, resolving', () => {
    useCyberspace.getState().addTarget(pk, 'bob')
    const t = useCyberspace.getState().targets[pk]
    expect(t.status).toBe('resolving')
    expect(t.name).toBe('bob')
    expect(t.position).toEqual({ x: at.x, y: at.y, z: at.z })
    expect(useCyberspace.getState().targetList().map((x) => x.label)).toEqual(['BOB'])
  })

  it('moves to the chain head once the chain arrives', () => {
    useCyberspace.getState().setTargetChain(pk, [spawn, hop])
    const t = useCyberspace.getState().targets[pk]
    expect(t.status).toBe('live')
    expect(t.position.x).toBe(at.x + 7n)
    expect(t.lastActive).toBe(110)
  })

  it('falls back to the spawn coordinate when the relay has no chain', () => {
    useCyberspace.getState().setTargetChain(pk, [])
    const t = useCyberspace.getState().targets[pk]
    expect(t.status).toBe('spawn')
    expect(t.position.x).toBe(at.x)
  })

  it('keeps a petname when re-added without one, and toggles off', () => {
    useCyberspace.getState().addTarget(pk)
    expect(useCyberspace.getState().targets[pk].name).toBe('bob')
    useCyberspace.getState().toggleTarget(pk)
    expect(useCyberspace.getState().targets[pk]).toBeUndefined()
    expect(useCyberspace.getState().targetList()).toEqual([])
  })

  it('ignores chains for pubkeys that are not targets', () => {
    useCyberspace.getState().setTargetChain(pk, [spawn])
    expect(useCyberspace.getState().targets[pk]).toBeUndefined()
  })
})
