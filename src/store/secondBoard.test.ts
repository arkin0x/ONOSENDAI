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
import { enterHyperspaceTemplate, hyperjumpTemplate, parseAction, spawnTemplate, type NostrEvent } from '../lib/events'
import { useCyberspace } from './useCyberspace'

/** spawn, enter-hyperspace, hyperjump: a rider standing at a stop. */
function chainAtStop() {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const spawn = finalizeEvent(spawnTemplate(pubkey, 1_700_000_000), sk)
  const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
  const at = { x, y, z }
  const enter = finalizeEvent(enterHyperspaceTemplate({ createdAt: 1_700_000_001, genesisId: spawn.id, previousId: spawn.id, at, plane, proofHash: 'a'.repeat(64) }), sk)
  const stopCoord = '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f56'
  const jump = finalizeEvent(hyperjumpTemplate({ createdAt: 1_700_000_002, genesisId: spawn.id, previousId: enter.id, prevCoordHex: pubkey, toCoordHex: stopCoord, fromHeight: 100, toHeight: 398, asOf: 400, rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) }), sk)
  return { sk, pubkey, events: [spawn, enter, jump] as NostrEvent[], stopCoord }
}

describe('riding again from a stop', () => {
  beforeEach(() => {
    const { pubkey, events } = chainAtStop()
    const dest = coordToXyz(hexToCoord(events[2].tags.find((t) => t[0] === 'C')![1]))
    useCyberspace.setState({
      identity: { pubkey, npub: 'npub1test' },
      events, genesisId: events[0].id, prevEventId: events[2].id,
      position: { x: dest.x, y: dest.y, z: dest.z }, plane: dest.plane,
      transit: null, exploreIndex: null, spectate: null, focus: null,
    })
  })

  it('completes a second ride with no boarding: previous is the last hyperjump, from_height is its B, no as_of', async () => {
    const before = useCyberspace.getState().events
    const prevId = before[before.length - 1].id
    await useCyberspace.getState().completeRide({
      previousId: prevId,
      toCoordHex: '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f57',
      fromHeight: 398, toHeight: 500, rootHex: '1'.repeat(64), mp: '', mnHex: '0'.repeat(16),
    })
    const events = useCyberspace.getState().events
    expect(events).toHaveLength(before.length + 1)
    const ride = parseAction(events[events.length - 1])!
    expect(ride.type).toBe('hyperjump')
    expect(ride.previousId).toBe(prevId)
    expect(ride.fromHeight).toBe(398)
    expect(ride.toHeight).toBe(500)
    expect(ride.asOf).toBeUndefined()
    // c is the stop you stood at: the previous hyperjump's C.
    expect(ride.prevCoordHex).toBe(before[before.length - 1].tags.find((t) => t[0] === 'C')![1])
    // Still at a stop afterwards: transit stays clear so an ordinary hop can leave.
    expect(useCyberspace.getState().transit).toBeNull()
  })

  it('refuses to complete a ride off the line', async () => {
    const { events } = useCyberspace.getState()
    // A chain whose head is the spawn: not on the line, and no boarding.
    useCyberspace.setState({ events: events.slice(0, 1), prevEventId: events[0].id })
    await useCyberspace.getState().completeRide({ previousId: events[0].id, toCoordHex: 'a'.repeat(64), fromHeight: 1, toHeight: 2, rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) })
    expect(useCyberspace.getState().events).toHaveLength(1)
  })
})

describe('a ride is published under the head it was seeded by', () => {
  it('refuses a ride computed against an earlier head, even with a boarding still set', async () => {
    // Boarded at the enter event, then the head moved on without this device
    // clearing the boarding (a fork adopted from another device): the ride
    // was seeded by the enter id (§5.3) and must not be signed under the new
    // head, where every one of its leaves would be wrong.
    const { sk, events } = chainAtStop()
    const [spawn, enter] = events
    const moved = finalizeEvent(hyperjumpTemplate({ createdAt: 1_700_000_003, genesisId: spawn.id, previousId: enter.id, prevCoordHex: enter.tags.find((t) => t[0] === 'C')![1], toCoordHex: '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f56', fromHeight: 100, toHeight: 398, asOf: 400, rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) }), sk)
    useCyberspace.setState({
      events: [spawn, enter, moved], genesisId: spawn.id, prevEventId: moved.id,
      transit: { stage: 'boarded', enterEventId: enter.id, enterCoordHex: enter.tags.find((t) => t[0] === 'C')![1] },
    })
    await expect(useCyberspace.getState().completeRide({
      previousId: enter.id,
      toCoordHex: '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f57',
      fromHeight: 100, toHeight: 500, asOf: 600, rootHex: '1'.repeat(64), mp: '', mnHex: '0'.repeat(16),
    })).rejects.toThrow('chain moved')
    expect(useCyberspace.getState().events).toHaveLength(3)
    expect(useCyberspace.getState().prevEventId).toBe(moved.id)
  })
})
