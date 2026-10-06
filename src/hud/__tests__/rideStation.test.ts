/**
 * rideStation.test.ts - the first ride's station is the boarding's (regression).
 *
 * DECK-0001 §4.3: the first hyperjump after an enter-hyperspace has
 * from_height = station(C_e, as_of), where C_e is the enter's coordinate.
 * startRide used to compute the station from the avatar's position and
 * `plane`, the plane lined up for the next move, which viewing EARTH sets to
 * dataspace. Boarded at a port in ideaspace, that asked for the station of a
 * place in dataspace, and the ride's from_height was wrong.
 */

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

/** Every coordinate the station was asked for. */
const stationAskedFor: bigint[] = []

vi.mock('../../lib/hyperspace/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/hyperspace/station')>()),
  findStation: (_index: unknown, coord: bigint) => {
    stationAskedFor.push(coord)
    return { stop: { height: 4 } }
  },
}))

vi.mock('../../lib/hyperspace/ridePool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/hyperspace/ridePool')>()),
  computeRideProof: async () => ({ rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) }),
}))

vi.mock('../../store/useHyperspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/useHyperspace')>()),
  getStopByHeight: (height: number) => ({
    height, kind: 'port', merkleRoot: 'ab'.repeat(32), blockHash: 'cd'.repeat(32),
    coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n,
  }),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { enterHyperspaceTemplate, spawnTemplate, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { startRide } from '../HyperspacePanel'

/** A key whose spawn is in ideaspace (plane 1). */
function ideaspaceKey(): { sk: Uint8Array; pubkey: string } {
  for (;;) {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    if (coordToXyz(hexToCoord(pubkey)).plane === 1) return { sk, pubkey }
  }
}

describe('the first ride from a boarding in ideaspace, with dataspace lined up', () => {
  let pubkey = ''
  beforeEach(() => {
    stationAskedFor.length = 0
    const key = ideaspaceKey()
    pubkey = key.pubkey
    const spawn = finalizeEvent(spawnTemplate(pubkey, 1_700_000_000), key.sk) as NostrEvent
    const enter = finalizeEvent(enterHyperspaceTemplate({ createdAt: 1_700_000_001, genesisId: spawn.id, previousId: spawn.id, coordHex: pubkey, proofHash: 'a'.repeat(64) }), key.sk) as NostrEvent
    const { x, y, z } = coordToXyz(hexToCoord(pubkey))
    useCyberspace.setState({
      identity: { ...useCyberspace.getState().identity, pubkey },
      events: [spawn, enter], genesisId: spawn.id, prevEventId: enter.id, published: {},
      position: { x, y, z },
      // Boarded in ideaspace; dataspace lined up, as viewing EARTH leaves it.
      headPlane: 1, plane: 0,
      transit: null, exploreIndex: null, spectate: null, focus: null, chainConflict: null,
    })
    useHyperspace.setState({ destination: 5, tipHeight: 10 })
  })

  it('asks for the station of the coordinate it boarded at, plane bit and all', async () => {
    await startRide()
    expect(stationAskedFor).toEqual([hexToCoord(pubkey)])
  })
})
