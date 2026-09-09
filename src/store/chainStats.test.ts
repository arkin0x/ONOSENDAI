import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { enterHyperspaceTemplate, hyperjumpTemplate, spawnTemplate, type NostrEvent } from '../lib/events'
import { addRespawn, loadRespawns, useCyberspace } from './useCyberspace'

describe('chain stats count rides', () => {
  beforeEach(() => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const spawn = finalizeEvent(spawnTemplate(pubkey, 1_700_000_000), sk)
    const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
    const enter = finalizeEvent(enterHyperspaceTemplate({ createdAt: 1_700_000_001, genesisId: spawn.id, previousId: spawn.id, at: { x, y, z }, plane, proofHash: 'a'.repeat(64) }), sk)
    const stop = '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f56'
    const jump = finalizeEvent(hyperjumpTemplate({ createdAt: 1_700_000_002, genesisId: spawn.id, previousId: enter.id, prevCoordHex: pubkey, toCoordHex: stop, fromHeight: 100, toHeight: 398, asOf: 400, rootHex: '0'.repeat(64), mp: '' }), sk)
    const events = [spawn, enter, jump] as NostrEvent[]
    const dest = coordToXyz(hexToCoord(stop))
    useCyberspace.setState({
      identity: { pubkey, npub: 'npub1test' },
      events, genesisId: spawn.id, prevEventId: jump.id,
      position: { x: dest.x, y: dest.y, z: dest.z }, plane: dest.plane,
      chain: { hops: 0, sidesteps: 0, totalOps: 0, totalHashes: 0, totalMs: 0, hyperjumps: 1, blocksRidden: 298 },
      // Boarded state, as this branch's completeRide still requires (the ride from a stop is #120).
      transit: { stage: 'boarded', enterEventId: jump.id, enterCoordHex: stop },
    })
  })

  it('a completed ride adds a hyperjump and the blocks it passed', async () => {
    await useCyberspace.getState().completeRide({
      toCoordHex: '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f57',
      fromHeight: 398, toHeight: 500, asOf: 600, rootHex: '1'.repeat(64), mp: '',
    })
    const chain = useCyberspace.getState().chain
    expect(chain.hyperjumps).toBe(2)
    expect(chain.blocksRidden).toBe(298 + 102)
    // The hop and sidestep tallies are untouched by a ride.
    expect(chain.hops).toBe(0)
    expect(chain.sidesteps).toBe(0)
  })
})

describe('respawns are counted per identity', () => {
  it('starts at zero and counts up, surviving a reload of the table', () => {
    const pk = 'f'.repeat(64)
    expect(loadRespawns(pk)).toBe(0)
    expect(addRespawn(pk)).toBe(1)
    expect(addRespawn(pk)).toBe(2)
    expect(loadRespawns(pk)).toBe(2)
    expect(loadRespawns('e'.repeat(64))).toBe(0)
  })
})
