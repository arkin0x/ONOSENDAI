/**
 * keyDoor.test.ts - the tutorial dungeon's key and gate as Cyberspace
 * primitives (lib/games/keyDoor.ts), against the DEV fixture: the key item is
 * sealed to its own small region, so the world alone never reads it; the gate
 * is a DECK-0004 door in the world bag, sealed to that key item, whose looks
 * follow its state and whose room holds the finish tile. Nothing is sent.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { HIDDEN_KIND, dOf, type Hidden } from '../../hidden'
import { hexToBytes, type NostrEvent } from '../../events'
import { blocks } from '../../walkConstrain'
import { heldFromFind } from '../../inventory'
import { regionBase } from '../../doors'
import { regionKeyAt } from '../../shardCrypto'
import { parseHint } from '../../hint'
import { DOOR_AT, KEY_AT, KEY_BAG, TUTORIAL_DEV_PUBKEY, TUTORIAL_GAME } from '../tutorialGame'
import { bagList, loadWorld, worldKey } from '../world'
import { doorKey, doorLooks, doorSecretWith, keyItemHeld, readKeyBag, readRoom, sceneNow, thingsNow, worldDoorOf } from '../keyDoor'
import { startProgress } from '../progress'
import type { WorldShard } from '../play'

const G = TUTORIAL_GAME
const ME = 'cd'.repeat(32)
let events: NostrEvent[] = []
let shards: WorldShard[] = []
let door: Hidden
let keys: Hidden[] = []

beforeAll(async () => {
  if (G.world.kind !== 'fixture') throw new Error('the tests play the DEV game')
  events = await G.world.load()
  const w = await loadWorld(G)
  shards = w.shards
  door = w.door!
  keys = await readKeyBag(G)
}, 60_000)

describe('the key item, sealed to its own place', () => {
  it('is a key item signed by the game key, at the key\'s spot, wearing the public gold key', () => {
    expect(keys).toHaveLength(1)
    const k = keys[0]
    expect(k.type).toBe('key')
    expect(k.inner?.pubkey).toBe(TUTORIAL_DEV_PUBKEY)
    expect(k.inner?.sig).toBeTruthy()
    expect(k.at).toEqual(KEY_AT)
    expect(k.key?.itemPubkey).toBe(getPublicKey(hexToBytes(k.key!.secretHex)))
    expect(k.key?.model?.address).toBe(`33331:${TUTORIAL_DEV_PUBKEY}:tutorial-dungeon-key`)
    // The model is a public object (DECK-0004 §2.5), in the fixture with the bags.
    const model = events.find((e) => e.kind === 33331)!
    expect(model.tags.some((t) => t[0] === 'encrypted')).toBe(false)
    expect(JSON.parse(model.content).name).toBe('Tutorial dungeon: the key')
  })

  it('is not readable from the world: the world bag names no key and no key bag, and the world key opens no key bag', async () => {
    const { key: wk, lookupId } = worldKey(G)
    const worldBag = events.find((e) => e.kind === HIDDEN_KIND && dOf(e) === lookupId)!
    const list = (await bagList(worldBag, wk))!
    // No key item, and no reference to anything but the pieces' objects (none here: the DEV world is inline).
    expect(list.some((e) => !Array.isArray(e) && (e as { kind?: number }).kind === 3340)).toBe(false)
    expect(list.some((e) => JSON.stringify(e).includes(keys[0].key!.secretHex))).toBe(false)
    const kb = regionKeyAt(regionBase(KEY_BAG.at, KEY_BAG.height), KEY_BAG.height, 8)
    const keyBag = events.find((e) => e.kind === HIDDEN_KIND && dOf(e) === kb.lookupId)!
    expect(kb.lookupId).not.toBe(lookupId)
    expect(await bagList(keyBag, wk)).toBeNull()
    // Its own region's key opens it.
    expect((await bagList(keyBag, kb.key))!.length).toBe(1)
    // Its region is small: height 3, about the top platform.
    expect(keyBag.tags.find((t) => t[0] === 'H')?.[1]).toBe('3')
    // Both bags carry the sector hint of their region, as the DEV fixture is built (spec §7.7); its sector is the dungeon's.
    for (const [bag, h] of [[keyBag, 3], [worldBag, 6]] as const) {
      const box = parseHint(bag.tags, h)!
      expect(box.heights).toEqual([30, 30, 30])
      expect(box.base).toEqual({ x: (KEY_AT.x >> 30n) << 30n, y: (KEY_AT.y >> 30n) << 30n, z: (KEY_AT.z >> 30n) << 30n })
      expect(bag.tags.find((t) => t[0] === 'S')?.[1]).toBe(`${KEY_AT.x >> 30n}-${KEY_AT.y >> 30n}-${KEY_AT.z >> 30n}`)
    }
    // The room bag says nothing of where it is (DECK-0004 §3.7.2).
    const roomBag = events.find((e) => e.kind === HIDDEN_KIND && !e.tags.some((t) => t[0] === 'H'))!
    expect(roomBag.tags.map((t) => t[0]).sort()).toEqual(['d', 'encrypted', 'version'])
  })

  it('a bag at the key\'s place signed by another key is not the game\'s', async () => {
    const other = { ...G, pubkey: 'ef'.repeat(32) }
    expect(await readKeyBag(other)).toEqual([])
  })

  it('is held by TAKE as any key item is: by its id, or by its keypair', () => {
    expect(keyItemHeld({}, keys[0])).toBe(false)
    const row = heldFromFind(ME, keys[0], 0)!
    expect(row.type).toBe('key')
    expect(row.source).toBe('found')
    expect(keyItemHeld({ [row.id]: row }, keys[0])).toBe(true)
  })
})

describe('the gate, a DECK-0004 door', () => {
  it('is in the world bag inline, signed by the game key, height 5, one gibson inside the gate sill, sealed to the key item', () => {
    expect(door.type).toBe('chest')
    expect(door.inner?.pubkey).toBe(TUTORIAL_DEV_PUBKEY)
    expect(door.chest?.door).toBe(5)
    expect(door.at).toEqual(DOOR_AT)
    expect(door.chest?.lockPubkey).toBe(keys[0].key!.itemPubkey)
    expect(door.ref).toBeUndefined()
    expect(door.sealedRef).toBeUndefined()
  })

  it('locks the way out at height 5: its room holds the finish tile, and every world piece in that region is at height 6', async () => {
    expect(door.height).toBe(6)
    const room = regionBase(DOOR_AT, 5)
    const inRoomRegion = shards.filter((s) => regionBase(s.at, 5).x === room.x && regionBase(s.at, 5).y === room.y && regionBase(s.at, 5).z === room.z)
    // The hall and the exit shrine stand in the room's region, in the world bag, at height 6: another height, another bag (DECK-0004 §3.7.4).
    expect(inRoomRegion.map((s) => s.shard.name).sort()).toEqual(['Maze Kit: hall, dead end', 'Maze Kit: hall, straight'])
    for (const s of inRoomRegion) expect(s.height).toBe(6)
  })

  it('a door signed by another key is not the world\'s door', () => {
    expect(worldDoorOf({ ...G, pubkey: 'ef'.repeat(32) }, [door])).toBeNull()
  })

  it('opens only with the key item held, and the room it opens holds the finish tile', async () => {
    expect(doorKey(door, {}, ME)).toBeNull()
    const row = heldFromFind(ME, keys[0], 0)!
    const key = doorKey(door, { [row.id]: row }, ME)!
    expect(key.itemPubkey).toBe(door.chest!.lockPubkey)
    const secret = doorSecretWith(door, key)!
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    const room = await readRoom(G, door, secret)
    expect(room.found).toBe(true)
    expect(room.shards.map((s) => s.shard.name)).toEqual(['Maze Kit: aerocarnival checkered tile 4'])
    // The wrong secret finds no room: it is said, not shown as an empty one.
    expect(await readRoom(G, door, '00'.repeat(32))).toEqual({ shards: [], found: false })
  })

  it('wears its own looks: closed, which holds a walker, until opened; open after', () => {
    const closed = doorLooks(door, false)
    const open = doorLooks(door, true)
    expect(closed.map((w) => w.shard.name)).toEqual(['Maze Kit: hall gate (4 x 6)'])
    expect(open.map((w) => w.shard.name)).toEqual(['Maze Kit: hall gate (4 x 6), open'])
    expect(blocks(closed[0].shard)).toBe(true)
    expect(blocks(open[0].shard)).toBe(false)
    expect(closed[0].at).toEqual(DOOR_AT)
  })

  it('stands in the scene as it stands: the closed look and no room, then the open look and the room', () => {
    const room: WorldShard[] = [{ key: 'tile', shard: shards[0].shard, at: DOOR_AT, height: 6 }]
    const pr = startProgress(0)
    const shut = sceneNow(G, { shards, door, room }, pr).solid.map((w) => w.key)
    expect(shut).toContain(`${door.eventId}:closed`)
    expect(shut).not.toContain('tile')
    const opened = sceneNow(G, { shards, door, room }, { ...pr, doorOpen: true }).solid.map((w) => w.key)
    expect(opened).toContain(`${door.eventId}:open`)
    expect(opened).not.toContain(`${door.eventId}:closed`)
    expect(opened).toContain('tile')
  })

  it('offers TAKE by the key until it is in ITEMS, and OPEN at the door only with it', () => {
    const pr = startProgress(0)
    const empty = thingsNow(G, { door, keys }, pr, {}, ME)
    expect(empty.keys).toEqual([KEY_AT])
    expect(empty.door).toEqual({ at: DOOR_AT, opens: false })
    const row = heldFromFind(ME, keys[0], 0)!
    const held = thingsNow(G, { door, keys }, pr, { [row.id]: row }, ME)
    expect(held.keys).toEqual([])
    expect(held.door).toEqual({ at: DOOR_AT, opens: true })
  })
})
