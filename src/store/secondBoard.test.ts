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
  const jump = finalizeEvent(hyperjumpTemplate({ createdAt: 1_700_000_002, genesisId: spawn.id, previousId: enter.id, prevCoordHex: pubkey, toCoordHex: stopCoord, fromHeight: 100, toHeight: 398, asOf: 400, rootHex: '0'.repeat(64), mp: '' }), sk)
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
      toCoordHex: '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f57',
      fromHeight: 398, toHeight: 500, rootHex: '1'.repeat(64), mp: '',
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
    await useCyberspace.getState().completeRide({ toCoordHex: 'a'.repeat(64), fromHeight: 1, toHeight: 2, rootHex: '0'.repeat(64), mp: '' })
    expect(useCyberspace.getState().events).toHaveLength(1)
  })
})
