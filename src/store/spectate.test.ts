/**
 * spectate.test.ts - someone else's chain becomes the focus chain, and only
 * the focus: your own position, cursor and chain are untouched throughout.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../lib/events'
import { SPAWN, useCyberspace } from './useCyberspace'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const theirSpawn = coordToXyz(hexToCoord(pk))
const spawn = finalizeEvent(spawnTemplate(pk, 100), sk)
function hop(prev: NostrEvent, at: number, dx: bigint): NostrEvent {
  const prevC = prev.tags.find((t) => t[0] === 'C')![1]
  const from = coordToXyz(hexToCoord(prevC))
  return finalizeEvent(hopTemplate({
    createdAt: at, genesisId: spawn.id, previousId: prev.id, prevCoordHex: prevC,
    to: { x: from.x + dx, y: from.y, z: from.z }, plane: from.plane, proofHash: '1'.repeat(64),
  }), sk)
}
const h1 = hop(spawn, 110, 1n)
const h2 = hop(h1, 120, 1n)

describe('spectate', () => {
  it('begins at their spawn coordinate while the chain loads', () => {
    useCyberspace.getState().beginSpectate(pk)
    const s = useCyberspace.getState()
    expect(s.spectate?.status).toBe('loading')
    expect(s.anchor).toEqual({ x: theirSpawn.x, y: theirSpawn.y, z: theirSpawn.z })
    expect(s.anchorPlane).toBe(theirSpawn.plane)
    expect(s.atHead()).toBe(false)
    expect(s.cursorOffset()).toEqual([0, 0, 0])
    expect(s.focusPubkey()).toBe(pk)
  })

  it('anchors on their head once the chain arrives, and the explorer walks it', () => {
    useCyberspace.getState().setSpectateChain(pk, [h2, spawn, h1])
    let s = useCyberspace.getState()
    expect(s.spectate?.status).toBe('live')
    expect(s.spectate?.lastActive).toBe(120)
    expect(s.focusChain().map((a) => a.id)).toEqual([spawn.id, h1.id, h2.id])
    expect(s.anchor.x).toBe(theirSpawn.x + 2n)
    expect(s.readoutPair().map((p) => p.x)).toEqual([theirSpawn.x + 1n, theirSpawn.x + 2n])

    s.explore(0)
    s = useCyberspace.getState()
    expect(s.anchor.x).toBe(theirSpawn.x)
    expect(s.exploreIndex).toBe(0)
    // Your own chain is not what is being walked.
    expect(s.position).toEqual(SPAWN)
  })

  it('keeps the explorer parked when their chain grows, and follows at their head', () => {
    const h3 = hop(h2, 130, 1n)
    useCyberspace.getState().setSpectateChain(pk, [spawn, h1, h2, h3])
    let s = useCyberspace.getState()
    expect(s.exploreIndex).toBe(0)
    expect(s.anchor.x).toBe(theirSpawn.x)
    s.explore(null)
    useCyberspace.getState().setSpectateChain(pk, [spawn, h1, h2, h3, hop(h3, 140, 1n)])
    s = useCyberspace.getState()
    expect(s.exploreIndex).toBeNull()
    expect(s.anchor.x).toBe(theirSpawn.x + 4n)
  })

  it('refuses the controls and the plane toggle', () => {
    const s = useCyberspace.getState()
    const cursor = s.cursor
    s.moveCursor({ axis: 'x', dir: 1 })
    expect(useCyberspace.getState().cursor).toEqual(cursor)
    const plane = s.plane
    s.togglePlane()
    expect(useCyberspace.getState().plane).toBe(plane)
  })

  it('ignores a chain for a pubkey no longer being spectated', () => {
    useCyberspace.getState().setSpectateChain('0'.repeat(64), [spawn])
    expect(useCyberspace.getState().spectate?.pubkey).toBe(pk)
  })

  it('ends back at your own head', () => {
    useCyberspace.getState().endSpectate()
    const s = useCyberspace.getState()
    expect(s.spectate).toBeNull()
    expect(s.exploreIndex).toBeNull()
    expect(s.anchor).toEqual(s.position)
    expect(s.atHead()).toBe(true)
    expect(s.focusPubkey()).toBe(s.identity.pubkey)
  })

  it('reports an empty chain as such, anchored on the spawn coordinate', () => {
    useCyberspace.getState().beginSpectate(pk)
    useCyberspace.getState().setSpectateChain(pk, [])
    const s = useCyberspace.getState()
    expect(s.spectate?.status).toBe('empty')
    expect(s.focusChain()).toEqual([])
    expect(s.anchor.x).toBe(theirSpawn.x)
    s.exploreStep(1)
    expect(useCyberspace.getState().exploreIndex).toBeNull()
    useCyberspace.getState().endSpectate()
  })
})
