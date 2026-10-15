/**
 * zeroLengthRide.test.ts - RIDE refuses a destination that is where the ride
 * would start (arkinox, 2026-10-07, Q1).
 *
 * DECK-0001 §5.6 used to allow a zero-length ride: the first ride after a
 * boarding, with the station as the destination, which set you down on the
 * station without passing a block. That is abolished. startRide must refuse
 * it before any work is done, say why, and say how to get to the station
 * instead (ride elsewhere and back). What would go wrong silently: a ride
 * that computes nothing, signs, and publishes a hyperjump every verifier
 * now rejects, freezing the chain.
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

/** The station is block 5, wherever you board. */
vi.mock('../../lib/hyperspace/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/hyperspace/station')>()),
  findStation: () => ({ stop: { height: 5 } }),
}))

/** Every ride proof asked for. */
const proofsAsked: unknown[] = []
vi.mock('../../lib/hyperspace/ridePool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/hyperspace/ridePool')>()),
  computeRideProof: async (job: unknown) => { proofsAsked.push(job); return { rootHex: 'ab'.repeat(32), mp: 'ab', mnHex: '0'.repeat(16) } },
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
import { sectorTags, spawnTemplate, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { startRide, useRideRun } from '../HyperspacePanel'

describe('the first ride after a boarding, to the station itself', () => {
  let count = 0
  beforeEach(() => {
    proofsAsked.length = 0
    useRideRun.setState({ error: null, progress: null, path: null })
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const spawn = finalizeEvent(spawnTemplate(pubkey, 1_700_000_000), sk) as NostrEvent
    const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
    const enter = finalizeEvent({
      kind: 3333, created_at: 1_700_000_001, content: '',
      tags: [
        ['A', 'enter-hyperspace'], ['e', spawn.id, '', 'genesis'], ['e', spawn.id, '', 'previous'],
        ['c', pubkey], ['C', pubkey], ['proof', 'a'.repeat(64)], ...sectorTags({ x, y, z }),
      ],
    }, sk) as NostrEvent
    useCyberspace.setState({
      identity: { ...useCyberspace.getState().identity, pubkey },
      events: [spawn, enter], genesisId: spawn.id, prevEventId: enter.id, published: {},
      position: { x, y, z }, headPlane: plane, plane,
      transit: null, exploreIndex: null, spectate: null, focus: null, chainConflict: null,
    })
    count = 2
  })

  it('is refused before any work, with the way to reach the station', async () => {
    useHyperspace.setState({ destination: 5, tipHeight: 10 })
    await startRide()
    expect(proofsAsked).toEqual([])
    expect(useRideRun.getState().error).toMatch(/Block 5 is your station/)
    expect(useRideRun.getState().error).toMatch(/ride to any other block first, then ride back to block 5/)
    expect(useCyberspace.getState().events).toHaveLength(count)
  })

  it('a ride to any other block goes ahead', async () => {
    useHyperspace.setState({ destination: 6, tipHeight: 10 })
    await startRide()
    expect(proofsAsked).toHaveLength(1)
    expect(useRideRun.getState().error).toBeNull()
  })
})
