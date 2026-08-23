/**
 * respawn.test.ts - a respawn is a new chain, not an edit to the old one.
 *
 * The things that would go wrong silently: the new spawn inheriting the old
 * head as its previous link, the published map still holding the old ids so
 * the publisher never sends the new spawn, or the position staying where the
 * old chain left it while the events say otherwise.
 */

import { describe, it, expect } from 'vitest'
import { parseAction } from '../lib/events'
import { SPAWN, useCyberspace } from './useCyberspace'

describe('respawn', () => {
  it('replaces the chain with a single spawn at the pubkey and resets the cursor', () => {
    const before = useCyberspace.getState()
    const oldGenesis = before.genesisId
    // Pretend the chain had gone somewhere.
    useCyberspace.setState({
      position: { ...SPAWN, x: SPAWN.x + 5n },
      cursor: { ...SPAWN, x: SPAWN.x + 9n },
      chain: { hops: 3, sidesteps: 1, totalOps: 99, totalHashes: 7, totalMs: 12 },
    })

    useCyberspace.getState().respawn()
    const s = useCyberspace.getState()

    expect(s.events).toHaveLength(1)
    const spawn = parseAction(s.events[0])
    expect(spawn?.type).toBe('spawn')
    expect(spawn?.pubkey).toBe(s.identity.pubkey)
    expect(s.genesisId).toBe(s.events[0].id)
    expect(s.prevEventId).toBe(s.events[0].id)
    expect(s.genesisId).not.toBe(oldGenesis)
    expect(s.position).toEqual(SPAWN)
    expect(s.cursor).toEqual(SPAWN)
    expect(s.positionHistory).toEqual([SPAWN])
    expect(s.plane).toBe(spawn?.plane)
    expect(s.headPlane).toBe(spawn?.plane)
    expect(s.chain).toEqual({ hops: 0, sidesteps: 0, totalOps: 0, totalHashes: 0, totalMs: 0 })
    expect(Object.keys(s.published)).toEqual([s.events[0].id])
    expect(s.published[s.events[0].id]).toBe('queued')
    expect(s.pendingTarget).toBeNull()
  })

  it('ignores a relay result for an event the respawn retired', () => {
    const s = useCyberspace.getState()
    s.setPublishStatus('0'.repeat(64), 'ok')
    expect(useCyberspace.getState().published['0'.repeat(64)]).toBeUndefined()
  })
})
