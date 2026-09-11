import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// The spectator would fetch from the relay; here it only does what its first
// synchronous step does, which is what the restore has to survive.
vi.mock('./spectator', () => ({
  spectate: async (pubkey: string) => { useCyberspace.getState().beginSpectate(pubkey) },
  stopSpectating: () => {},
}))

import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { rememberNearbyReturn, watchNearbyReturn } from './nearbyReturn'
import type { ActionEvent } from './events'

const friend = 'f1'.repeat(32)
const link = (i: number): ActionEvent => ({ id: String(i).repeat(32).slice(0, 64), pubkey: friend, createdAt: 100 + i, type: 'hop', coordHex: 'c'.repeat(64), position: { x: 1000n + BigInt(i), y: 5n, z: 5n }, plane: 0, prevCoordHex: null, genesisId: null, previousId: null, proofHash: null, sector: '0-0-0' })

describe('RETURN after VIEW from Nearby Loot', () => {
  let stop: () => void
  beforeEach(() => {
    stop?.()
    stop = watchNearbyReturn()
    useShards.setState({ nearbyOpen: false, nearbyReturn: null })
    useCyberspace.setState({ focus: null, spectate: null, exploreIndex: null })
  })

  it('puts you back on the friend at the same link, and reopens the list', () => {
    const s = useCyberspace.getState()
    s.beginSpectate(friend)
    useCyberspace.setState({ spectate: { ...useCyberspace.getState().spectate!, actions: [link(0), link(1), link(2)], status: 'live' }, exploreIndex: 1, anchor: link(1).position, anchorPlane: 0 })
    rememberNearbyReturn()
    useShards.getState().setNearbyOpen(false)
    s.focusOn({ x: 7n, y: 7n, z: 7n }, 0, 'A SHARD', 0)
    expect(useCyberspace.getState().spectate).toBeNull()

    useCyberspace.getState().clearFocus()

    const after = useCyberspace.getState()
    expect(after.spectate?.pubkey).toBe(friend)
    expect(after.exploreIndex).toBe(1)
    expect(after.anchor.x).toBe(1001n)
    expect(useShards.getState().nearbyOpen).toBe(true)
    expect(useShards.getState().nearbyReturn).toBeNull()
  })

  it('with no spectation, only the list comes back', () => {
    rememberNearbyReturn()
    useCyberspace.getState().focusOn({ x: 7n, y: 7n, z: 7n }, 0, 'A NOTE', 0)
    useCyberspace.getState().clearFocus()
    expect(useCyberspace.getState().spectate).toBeNull()
    expect(useShards.getState().nearbyOpen).toBe(true)
  })

  it('a snapshot already waiting is not overwritten by a second VIEW', () => {
    useCyberspace.getState().beginSpectate(friend)
    rememberNearbyReturn()
    useCyberspace.getState().focusOn({ x: 7n, y: 7n, z: 7n }, 0, 'ONE', 0)
    rememberNearbyReturn()
    expect(useShards.getState().nearbyReturn?.spectate?.pubkey).toBe(friend)
  })
})
