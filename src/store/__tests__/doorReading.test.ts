/**
 * doorReading.test.ts: reading a door (DECK-0004 §3.7.3, cyberspace PR #82,
 * held; chest and door design 4.9, R5, R11, R17).
 *
 * A door, its room bag and what the room holds are built and signed here as
 * a writer would; the relay is mocked to answer the room bag's `d` alone.
 * OPEN (always a tap) reads the secret, derives the room key from the
 * place's key, fetches the room bag from the door's signer only, and the
 * room's entries stand where they were hidden, each marked with its door.
 * A door found in a bag higher than itself computes its own height's key. A
 * room bag signed by anyone else is not the room. Both doors of one room
 * open together. A door is dropped where it may not stand. A reload opens
 * the room again with the secret kept. An item behind a door waits for
 * TAKE. No network.
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

const relay = vi.hoisted(() => ({ bags: [] as Array<{ d: string; event: unknown }> }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async (f: { '#d'?: string[] }) => relay.bags.filter((b) => f['#d']?.includes(b.d)).map((b) => b.event)),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, rumorOf, unbag, type BagEntry, type Hidden } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, doorSecretWithKey, newDoorSecret, roomEntries, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { openedByHand, resetOpenedChests } from '../useOpenedChests'
import { useShards } from '../useShards'
import { doorSecret, enterRoom, keepDoorSecret, resetDoorSecrets } from '../rooms'
import { doorWallKey, wallItems } from '../walkWalls'

const hider = generateSecretKey()
const HIDER = getPublicKey(hider)
const T = 1_800_000_000
/** A place with bits all the way down, in ideaspace (plane 1, where the WALK test looks). */
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const PLANE = 1 as const

interface Built { door: Hidden; doorEvent: NostrEvent; lock: ReturnType<typeof forgeKey>; secret: string; lookupId: string; key: Uint8Array }

/** A door of `doorHeight` found in a bag of `bagHeight`, its room bag on the relay holding a message and an item. */
async function build(doorHeight: number, bagHeight: number, at: Position = AT, secret = newDoorSecret(), signer = hider): Promise<Built> {
  const lock = forgeKey('Silver Key')
  const sealed = sealEntries(roomEntries(secret) as BagEntry[], lock.itemPubkey)
  const t = chestInnerTemplate({ name: 'North Door', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: 'the Silver Key', payload: sealed.payload }, at, PLANE, T)
  t.tags.splice(t.tags.length - 1, 0, ['door', String(doorHeight)])
  const doorEvent = finalizeEvent(t, hider) as NostrEvent
  const bagKey = (await regionKeyOffThread(at, bagHeight, 20)).key
  const loc = doorHeight === bagHeight ? bagKey : (await regionKeyOffThread(at, doorHeight, 20)).key
  const key = roomKey(loc, hexToBytes(secret))
  const lookupId = roomLookupId(key)
  const inside: Position = { x: at.x + 1n, y: at.y, z: at.z }
  const entries = [rumorOf(messageInnerTemplate('behind the door', inside, PLANE, T), getPublicKey(signer)), finalizeEvent(keyInnerTemplate(forgeKey('Gold Key'), inside, PLANE, T), signer)]
  const roomBag = finalizeEvent(await bagTemplate(entries, key, lookupId, doorHeight, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), signer) as NostrEvent
  relay.bags.push({ d: lookupId, event: roomBag })
  const door: Hidden = { eventId: doorEvent.id, inner: doorEvent, keyHex: bytesToHex(bagKey), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: PLANE, height: bagHeight, createdAt: T, type: 'chest', chest: chestItemOf(doorEvent)! }
  return { door, doorEvent, lock, secret, lookupId, key }
}

const me = (): string => useCyberspace.getState().identity.pubkey

beforeEach(() => {
  relay.bags = []
  localStorage.removeItem('onosendai:chests-opened')
  localStorage.removeItem('onosendai:door-secrets')
  resetOpenedChests()
  resetDoorSecrets()
  useShards.setState({ mine: [], discovered: {}, deleted: {}, curated: null })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
})

describe('OPEN on a door', () => {
  it('reads its secret with the key it is locked to, and the room stands where it was hidden', async () => {
    const b = await build(3, 3)
    useShards.setState({ discovered: { [b.door.eventId]: b.door } })
    expect(doorSecretWithKey(b.door.chest!, b.lock.secretHex)).toBe(b.secret)
    const opened = await enterRoom(b.door, b.secret)
    expect(opened?.found).toBe(true)
    expect(opened?.lookupId).toBe(b.lookupId)
    // The room bag as the spec's example has it: d, encrypted, version, and nothing public.
    const bag = relay.bags[0].event as NostrEvent
    expect(bag.tags.map((t) => t[0])).toEqual(['d', 'encrypted', 'version'])
    expect(bag.tags[1][1]).toBe('aes-256-gcm')
    expect(bag.content).toBe('')
    const behind = Object.values(useShards.getState().discovered).filter((h) => h.room?.doorId === b.door.eventId)
    expect(behind.map((h) => h.type).sort()).toEqual(['key', 'message'])
    for (const h of behind) {
      expect(h.at.x).toBe(AT.x + 1n)
      expect(h.lookupId).toBe(b.lookupId)
      expect(h.height).toBe(3)
    }
    // Drawn where they stand, as any find is.
    expect(useShards.getState().drawnItems().some((w) => w.type === 'message' && w.text === 'behind the door')).toBe(true)
    // Opened by hand, the secret kept: a reload opens it again.
    expect(openedByHand(me(), b.door.eventId, b.door.chest!.lockPubkey)).toBe(true)
    expect(doorSecret(me(), b.door.eventId)).toBe(b.secret)
  })

  it('what is in a room carries the room key, which seals its comments (§3.7.2)', async () => {
    const b = await build(3, 3)
    useShards.setState({ discovered: { [b.door.eventId]: b.door } })
    await enterRoom(b.door, b.secret)
    const w = useShards.getState().worldItems().find((x) => x.type === 'message')!
    expect(w.roomKeyHex).toBe(bytesToHex(b.key))
    // The door itself stands in an ordinary bag: its comments stay the region's.
    expect(useShards.getState().worldItems().find((x) => x.key === b.door.eventId)?.roomKeyHex).toBeUndefined()
  })

  it('an item behind a door waits for TAKE: nothing is held by opening', async () => {
    const b = await build(3, 3)
    useShards.setState({ discovered: { [b.door.eventId]: b.door } })
    await enterRoom(b.door, b.secret)
    expect(Object.keys(useInventory.getState().items)).toEqual([])
  })

  it('a door lower than its bag computes its own height’s key for the room', async () => {
    const b = await build(2, 4)
    useShards.setState({ discovered: { [b.door.eventId]: b.door } })
    const opened = await enterRoom(b.door, b.secret)
    expect(opened?.found).toBe(true)
    expect(opened?.items.every((h) => h.height === 2)).toBe(true)
  })

  it('a room bag signed by anyone else is not the room: it could not be retrieved, not empty', async () => {
    const b = await build(3, 3, AT, newDoorSecret(), generateSecretKey())
    const opened = await enterRoom(b.door, b.secret)
    expect(opened?.found).toBe(false)
    expect(opened?.items).toEqual([])
  })

  it('the wrong secret opens no room', async () => {
    const b = await build(3, 3)
    const opened = await enterRoom(b.door, newDoorSecret())
    expect(opened?.found).toBe(false)
  })

  it('the door stops blocking WALK once opened (R11)', async () => {
    const b = await build(3, 3)
    useShards.setState({ discovered: { [b.door.eventId]: b.door } })
    expect(wallItems(PLANE).map((w) => w.key)).toContain(doorWallKey(b.door.eventId))
    await enterRoom(b.door, b.secret)
    expect(wallItems(PLANE).map((w) => w.key)).not.toContain(doorWallKey(b.door.eventId))
  })
})

describe('two doors, one room (R5)', () => {
  it('opening either opens both, for you', async () => {
    const a = await build(3, 3)
    // Another doorway of the same 2^3 room: AT.x ends in 0x35, so 0x37 is in the same aligned cube (0x30 to 0x37).
    const elsewhere: Position = { x: AT.x + 2n, y: AT.y, z: AT.z }
    const b = await build(3, 3, elsewhere, a.secret)
    useShards.setState({ discovered: { [a.door.eventId]: a.door, [b.door.eventId]: b.door } })
    await enterRoom(b.door, b.secret)
    expect(openedByHand(me(), a.door.eventId, a.door.chest!.lockPubkey)).toBe(true)
    expect(openedByHand(me(), b.door.eventId, b.door.chest!.lockPubkey)).toBe(true)
    expect(doorSecret(me(), a.door.eventId)).toBe(a.secret)
  })

  it('a door of another height or region is another room, and stays shut', async () => {
    const a = await build(3, 3)
    const far: Position = { x: AT.x + (1n << 10n), y: AT.y, z: AT.z }
    const b = await build(3, 3, far, a.secret)
    useShards.setState({ discovered: { [a.door.eventId]: a.door, [b.door.eventId]: b.door } })
    await enterRoom(a.door, a.secret)
    expect(openedByHand(me(), b.door.eventId, b.door.chest!.lockPubkey)).toBe(false)
  })
})

describe('where a door may stand, read (§3.7.1)', () => {
  it('a door higher than the bag it is in is dropped; a door in a room not lower than the room is dropped', async () => {
    const b = await build(3, 3)
    const key = (await regionKeyOffThread(AT, 2, 20)).key
    const outer = finalizeEvent(await bagTemplate([b.doorEvent], key, 'd'.repeat(64), 2, T), hider) as NostrEvent
    expect(await unbag(outer, key, undefined, undefined, 2)).toEqual([])
    const fine = finalizeEvent(await bagTemplate([b.doorEvent], key, 'd'.repeat(64), 4, T), hider) as NostrEvent
    expect(await unbag(fine, key, undefined, undefined, 4)).toHaveLength(1)
    expect(await unbag(fine, key, undefined, undefined, 3, undefined, { doorId: 'x' })).toEqual([])
    expect(await unbag(fine, key, undefined, undefined, 4, undefined, { doorId: 'x' })).toHaveLength(1)
  })
})

describe('a reload', () => {
  it('opens a door opened by hand again, with the secret kept here', async () => {
    const b = await build(3, 3)
    keepDoorSecret(me(), b.door.eventId, b.secret)
    localStorage.setItem('onosendai:chests-opened', JSON.stringify({ [me()]: [b.door.eventId] }))
    resetOpenedChests()
    useShards.getState().addDiscovered([b.door])
    await vi.waitFor(() => expect(Object.values(useShards.getState().discovered).some((h) => h.room?.doorId === b.door.eventId)).toBe(true))
  })

  it('opens nothing for a door never opened by hand', async () => {
    const b = await build(3, 3)
    keepDoorSecret(me(), b.door.eventId, b.secret)
    useShards.getState().addDiscovered([b.door])
    await new Promise((r) => setTimeout(r, 50))
    expect(Object.values(useShards.getState().discovered).some((h) => h.room)).toBe(false)
  })
})
