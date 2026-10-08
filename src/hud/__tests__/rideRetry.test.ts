/**
 * rideRetry.test.ts - a ride refused at its last step keeps its proof, and a
 * ride is refused before its work when the head cannot be confirmed (review
 * of #236, item 5).
 *
 * What would go wrong silently: a relay blip at the moment of signing
 * throwing away a finished ride proof, so RIDE again computes minutes of
 * work on a phone from scratch; and a ride computed from a head nobody can
 * confirm, only to be refused when it is done.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})
const calls = vi.hoisted(() => ({ proofs: 0, confirms: 0, answers: [] as Array<unknown[] | null>, clock: Date.now() }))
vi.mock('../../lib/hyperspace/station', async (o) => ({ ...(await o() as object), findStation: () => ({ stop: { height: 4 } }) }))
vi.mock('../../lib/hyperspace/ridePool', async (o) => ({
  ...(await o() as object),
  // A ride proof takes long: long enough that the head is asked about again at signing.
  computeRideProof: async () => { calls.proofs++; calls.clock += 60_000; vi.setSystemTime(calls.clock); return { rootHex: '0'.repeat(64), mp: 'ab', mnHex: '0'.repeat(16) } },
}))
vi.mock('../../store/useHyperspace', async (o) => ({
  ...(await o() as object),
  getStopByHeight: (height: number) => ({ height, kind: 'port', merkleRoot: 'ab'.repeat(32), blockHash: 'cd'.repeat(32), coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n }),
}))
vi.mock('../../lib/chains', async (o) => ({
  ...(await o() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => { calls.confirms++; return calls.answers.length ? calls.answers.shift() : [] }),
}))

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { enterHyperspaceTemplate, type NostrEvent } from '../../lib/events'
import { HEAD_UNCONFIRMED_MESSAGE, useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { useRideRun, startRide } from '../HyperspacePanel'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

/** A fresh chain boarded at its spawn, with a destination chosen. */
async function boarded(): Promise<void> {
  useCyberspace.setState({ events: [] })
  await placeSpawn()
  const s = useCyberspace.getState()
  const pk = s.identity.pubkey
  const enter = await s.signEvent(enterHyperspaceTemplate({ createdAt: s.events[0].created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, coordHex: pk, proofHash: 'a'.repeat(64) })) as NostrEvent
  const { x, y, z, plane } = coordToXyz(hexToCoord(pk))
  useCyberspace.setState({ events: [...s.events, enter], prevEventId: enter.id, position: { x, y, z }, headPlane: plane, plane, transit: { stage: 'boarded', enterEventId: enter.id, enterCoordHex: pk }, chainConflict: null })
  useHyperspace.setState({ destination: 5, tipHeight: 10 })
  useRideRun.setState({ error: null, progress: null, path: null })
}

describe('a ride and the head check', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    calls.clock += 60_000
    vi.setSystemTime(calls.clock)
    calls.proofs = 0
    calls.confirms = 0
    calls.answers = []
  })

  it('a ride refused at signing keeps its proof: RIDE again signs it without computing it again', async () => {
    await boarded()
    const events = useCyberspace.getState().events.length
    // Confirmed before the work; at signing the relay does not answer, twice.
    calls.answers = [[], null, null]
    await startRide()
    expect(useRideRun.getState().error).toBe(HEAD_UNCONFIRMED_MESSAGE)
    expect(calls.proofs).toBe(1)
    expect(useCyberspace.getState().events).toHaveLength(events)
    await startRide()
    expect(calls.proofs).toBe(1)
    expect(useCyberspace.getState().events).toHaveLength(events + 1)
    expect(useRideRun.getState().error).toBeNull()
  })

  it('a ride whose head cannot be confirmed is refused before any work', async () => {
    await boarded()
    calls.answers = [null, null]
    await startRide()
    expect(calls.proofs).toBe(0)
    expect(useRideRun.getState().error).toBe(HEAD_UNCONFIRMED_MESSAGE)
  })
})
