/**
 * testDiscoveryDerives.test.ts: TEST DISCOVERY proves a stranger finds the bag
 * (review of #622). Up to this device's ceiling it derives the key from the
 * coordinate, off the main thread (regionKeyOffThread), and requires it to be
 * the key and lookup id the bag was sealed with before it asks the relay. A
 * wrong key from HOSAKA (heights a phone hands it) seals a bag nobody finds;
 * checked with the stored key alone, that bag would read as FOUND.
 *
 * - Match: derived, equal, found on the relay.
 * - Mismatch: a wrong stored key (and lookup id) whose bag is on the relay
 *   reads as wrongKey, and the relay is not asked.
 * - Above the ceiling: the stored key, and the result says why.
 * - Room bags: the room key from the derived region key and the door secret;
 *   without the secret, the stored key, and the result says why.
 *
 * Heights here are small (3), so the inline derivation the test runner falls
 * back to is cheap; the ceiling cases lower the calibrated ceiling instead of
 * deriving anything high, and the worker path is a spy that says when it ran.
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

const relay = vi.hoisted(() => ({ bags: [] as unknown[] }))
vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => relay.bags),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: relay.bags, trouble: null })),
  onCanonicalSignIn: () => () => {},
  relaySet: () => ['wss://relay.test'],
}))
// The worker path, as a spy over the real one: says whether, and when, a key was derived.
vi.mock('../../lib/regionKeyOffThread', async (orig) => {
  const real = await orig() as typeof import('../../lib/regionKeyOffThread')
  return { ...real, regionKeyOffThread: vi.fn(real.regionKeyOffThread) }
})

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { keepDoorSecret, resetDoorSecrets } from '../rooms'
import { HIDDEN_KIND, bagTemplate, messageInnerTemplate } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, newDoorSecret, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyAt } from '../../lib/shardCrypto'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import { useCalibration } from '../../lib/calibration'
import { queryChecked } from '../../lib/relay'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'

const HEIGHT = 3
const ME_SK = new Uint8Array(32).fill(2)
const ME = getPublicKey(ME_SK)
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const DOOR_ID = 'dd'.repeat(32)
const WRONG_KEY = new Uint8Array(32).fill(7)
const WRONG_LOOKUP = 'ee'.repeat(32)

/** A LIVE bag of your own at HEIGHT, sealed under `key` and filed under `lookupId`, and its row. */
async function deploy(key: Uint8Array, lookupId: string, room?: { doorId: string }): Promise<{ dep: MyDeployment; bag: NostrEvent }> {
  const inner = finalizeEvent(messageInnerTemplate('here', AT, 0, T), ME_SK)
  const settings = room ? ROOM_BAG_SETTINGS : undefined
  const bag = finalizeEvent(await bagTemplate([inner], key, lookupId, HEIGHT, T, HIDDEN_KIND, settings), ME_SK) as NostrEvent
  const dep: MyDeployment = {
    eventId: inner.id, inner, bagId: bag.id, type: 'message', text: 'here',
    at: { x: AT.x.toString(), y: AT.y.toString(), z: AT.z.toString() }, plane: 0, height: HEIGHT,
    lookupId, keyHex: bytesToHex(key), relays: ['wss://relay.test'], createdAt: T, published: true,
    ...(room ? { room } : {}),
  }
  return { dep, bag }
}

const test = (id: string) => useShards.getState().testDiscovery(id)

beforeEach(() => {
  localStorage.clear()
  resetDoorSecrets()
  relay.bags = []
  vi.mocked(regionKeyOffThread).mockClear()
  vi.mocked(queryChecked).mockClear()
  useCalibration.setState({ hopHeight: 17 })
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
})

describe('TEST DISCOVERY derives the key, as a stranger would', () => {
  it('finds a bag whose stored key is the one derived from its coordinate', async () => {
    const rk = regionKeyAt(AT, HEIGHT, 20)
    const { dep, bag } = await deploy(rk.key, rk.lookupId)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await test(dep.eventId)).toEqual({ outcome: 'found', key: { via: 'derived' } })
    expect(regionKeyOffThread).toHaveBeenCalledWith(AT, HEIGHT, 20)
    relay.bags = []
    expect((await test(dep.eventId)).outcome).toBe('missing')
  })

  it('says the key is wrong when HOSAKA sold a wrong one, though its bag is on the relay', async () => {
    // Sealed and filed under the wrong key: the stored key alone would find and open it.
    const { dep, bag } = await deploy(WRONG_KEY, WRONG_LOOKUP)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await test(dep.eventId)).toEqual({ outcome: 'wrongKey', key: { via: 'derived' } })
    expect(queryChecked).not.toHaveBeenCalled()
  })

  it('says the key is wrong when only the lookup id is off', async () => {
    const rk = regionKeyAt(AT, HEIGHT, 20)
    const { dep, bag } = await deploy(rk.key, WRONG_LOOKUP)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect((await test(dep.eventId)).outcome).toBe('wrongKey')
  })

  it('above this device\'s ceiling checks with the stored key, says so, and derives nothing', async () => {
    useCalibration.setState({ hopHeight: HEIGHT - 1 })
    const { dep, bag } = await deploy(WRONG_KEY, WRONG_LOOKUP)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await test(dep.eventId)).toEqual({ outcome: 'found', key: { via: 'stored', why: 'height', height: HEIGHT } })
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it('above 20 on any device checks with the stored key', async () => {
    useCalibration.setState({ hopHeight: 30 })
    const { dep, bag } = await deploy(WRONG_KEY, WRONG_LOOKUP)
    const high = { ...dep, height: 25 }
    useShards.setState({ mine: [high] })
    relay.bags = [bag]
    expect((await test(high.eventId)).key).toEqual({ via: 'stored', why: 'height', height: 25 })
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })
})

describe('TEST DISCOVERY on a room bag', () => {
  const room = { doorId: DOOR_ID }

  it('derives the room key from the derived region key and the door secret, and finds it', async () => {
    const secret = newDoorSecret()
    keepDoorSecret(ME, DOOR_ID, secret)
    const key = roomKey(regionKeyAt(AT, HEIGHT, 20).key, hexToBytes(secret))
    const { dep, bag } = await deploy(key, roomLookupId(key), room)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await test(dep.eventId)).toEqual({ outcome: 'found', key: { via: 'derived' } })
    expect(regionKeyOffThread).toHaveBeenCalledWith(AT, HEIGHT, 20)
  })

  it('says the key is wrong when the room key is not the door secret\'s', async () => {
    keepDoorSecret(ME, DOOR_ID, newDoorSecret())
    const other = roomKey(regionKeyAt(AT, HEIGHT, 20).key, hexToBytes(newDoorSecret()))
    const { dep, bag } = await deploy(other, roomLookupId(other), room)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect((await test(dep.eventId)).outcome).toBe('wrongKey')
  })

  it('without the door secret checks with the stored room key, says so, and derives nothing', async () => {
    const key = roomKey(regionKeyAt(AT, HEIGHT, 20).key, hexToBytes(newDoorSecret()))
    const { dep, bag } = await deploy(key, roomLookupId(key), room)
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await test(dep.eventId)).toEqual({ outcome: 'found', key: { via: 'stored', why: 'door', height: HEIGHT } })
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })
})
