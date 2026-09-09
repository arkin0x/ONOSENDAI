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
import { ACTION_KIND, hopTemplate, positionHex } from '../lib/events'
import { inNeighborhood, neighborhoodFilter, sectorKey, usePresence } from './usePresence'
import { useCyberspace } from './useCyberspace'

const SECTOR = 1n << 30n
const here = { x: 5n * SECTOR + 7n, y: 9n * SECTOR + 1n, z: 3n * SECTOR + 2n }

/**
 * A hop by a key to a position: the smallest positional action the parser
 * accepts. A spawn's coordinate is its pubkey, so it cannot be placed; a hop
 * can, and the parser checks the shape of its links and proof, not their truth.
 */
function spawnAt(at: { x: bigint; y: bigint; z: bigint }, createdAt: number, sk = generateSecretKey()) {
  return finalizeEvent(hopTemplate({ createdAt, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(at, 0), to: at, plane: 0, proofHash: 'c'.repeat(64) }), sk)
}

describe('the neighborhood', () => {
  it('is one filter over the three axis tags, each with the sector and its two neighbors', () => {
    const f = neighborhoodFilter(here)
    expect(f.kinds).toEqual([ACTION_KIND])
    expect(f['#X']).toEqual(['4', '5', '6'])
    expect(f['#Y']).toEqual(['8', '9', '10'])
    expect(f['#Z']).toEqual(['2', '3', '4'])
  })

  it('names the sector the way the S tag does', () => {
    expect(sectorKey(here)).toBe('5-9-3')
  })

  it('knows a position one sector over is in it, and two sectors over is not', () => {
    expect(inNeighborhood({ ...here, x: here.x + SECTOR }, here)).toBe(true)
    expect(inNeighborhood({ ...here, x: here.x + 2n * SECTOR }, here)).toBe(false)
  })
})

describe('taking people in', () => {
  beforeEach(() => { usePresence.setState({ people: {}, sector: null, loading: false }) })

  it('keeps the newest action per author', () => {
    const sk = generateSecretKey()
    usePresence.getState().ingest(spawnAt(here, 100, sk))
    usePresence.getState().ingest(spawnAt({ ...here, x: here.x + 1n }, 200, sk))
    usePresence.getState().ingest(spawnAt({ ...here, x: here.x + 2n }, 150, sk))
    const p = usePresence.getState().people[getPublicKey(sk)]
    expect(p.lastActive).toBe(200)
    expect(p.position.x).toBe(here.x + 1n)
  })

  it('leaves you out', () => {
    const sk = generateSecretKey()
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: getPublicKey(sk) } })
    usePresence.getState().ingest(spawnAt(here, 100, sk))
    expect(Object.keys(usePresence.getState().people)).toHaveLength(0)
  })

  it('others() leaves out your targets as well', () => {
    const sk = generateSecretKey()
    usePresence.getState().ingest(spawnAt(here, 100, sk))
    expect(usePresence.getState().others()).toHaveLength(1)
    useCyberspace.setState({ targets: { [getPublicKey(sk)]: { pubkey: getPublicKey(sk), npub: 'npub1x', name: null, position: here, plane: 0, lastActive: null, status: 'live' } } })
    expect(usePresence.getState().others()).toHaveLength(0)
    useCyberspace.setState({ targets: {} })
  })

  it('ignores an event that is not an action', () => {
    const sk = generateSecretKey()
    usePresence.getState().ingest(finalizeEvent({ kind: 1, created_at: 1, content: 'hi', tags: [] }, sk))
    expect(Object.keys(usePresence.getState().people)).toHaveLength(0)
  })
})

describe('arrivals', () => {
  beforeEach(() => { usePresence.setState({ people: {}, sector: null, loading: false, arrivals: 0, lastArrivalAt: null }) })

  it('someone first seen after the backfill is an arrival', () => {
    usePresence.getState().ingest(spawnAt(here, 100))
    expect(usePresence.getState().arrivals).toBe(1)
    expect(usePresence.getState().lastArrivalAt).not.toBeNull()
  })

  it('someone seen during the backfill is not', () => {
    usePresence.setState({ loading: true })
    usePresence.getState().ingest(spawnAt(here, 100))
    expect(usePresence.getState().arrivals).toBe(0)
  })

  it('a later move by someone already here is not an arrival', () => {
    const sk = generateSecretKey()
    usePresence.getState().ingest(spawnAt(here, 100, sk))
    usePresence.getState().ingest(spawnAt({ ...here, x: here.x + 1n }, 200, sk))
    expect(usePresence.getState().arrivals).toBe(1)
  })

  it('a target arriving is not announced: you already know where they are', () => {
    const sk = generateSecretKey()
    useCyberspace.setState({ targets: { [getPublicKey(sk)]: { pubkey: getPublicKey(sk), npub: 'npub1x', name: null, position: here, plane: 0, lastActive: null, status: 'live' } } })
    usePresence.getState().ingest(spawnAt(here, 100, sk))
    expect(usePresence.getState().arrivals).toBe(0)
    useCyberspace.setState({ targets: {} })
  })
})
