/**
 * doorAuthoring.test.ts: SEAL A DOOR and everything a door's author does
 * (DECK-0004 §3.7, cyberspace PR #82, held; chest and door design 4.2 to 4.8,
 * R1, R2, R3, R5, R7, R8, R10, R12, R13, and the owner's height clarification:
 * "a door is height-specific").
 *
 * Tap, choose the place, then the name and lock. Whatever is placed in the
 * room at exactly the door's height goes into the room bag, and at any other
 * height into an ordinary one; the X leaves one placement out. The relay is a
 * mock that keeps what is published and answers by `d`, so a finder's OPEN
 * reads what the author wrote. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }> }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    // An addressable event replaces its older version, as a relay does.
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (ev.kind >= 30000 && ev.kind < 40000) relay.events = relay.events.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === d))
      relay.events.push(ev)
      return { ok: true }
    }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async () => []),
    relaySet: () => ['wss://relay.test'],
  }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { forgeKey, openWithSecret, readContents, sealEntries } from '../../lib/chests'
import { bytesToHex, hexToBytes } from '../../lib/events'
import { HIDDEN_KIND, OBJECT_KIND, REFERENCE_THRESHOLD_BYTES, bagEntries, chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, rumorOf, unbag, type BagEntry, type KeyItem } from '../../lib/hidden'
import { decryptForRegion } from '../../lib/shardCrypto'
import type { NostrEvent } from '../../lib/events'
import { useWorkshop } from '../useWorkshop'
import { doorSecretWithKey, roomKey, roomLookupId, ROOM_BAG_SETTINGS } from '../../lib/doors'
import { keptInChest, lookTagsOf } from '../../lib/looks'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import { deployPoint, type Position } from '../../lib/space'
import { buildStepOf } from '../../lib/buildCursor'
import { roomOutlines } from '../../scene/DoorRooms'
import { useStash } from '../../hud/stash'
import { doorSecret, keepDoorSecret, resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { resetOpenedChests } from '../useOpenedChests'
import { behindDoor, fillingChest, hereInRoom, ownDoors, placingChest, positionOf, sealingDoor, useShards, type MyDeployment } from '../useShards'
import { openRoom } from '../rooms'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 4

let lock: KeyItem
const lockOf = (k: KeyItem = lock) => ({ pubkey: k.itemPubkey, label: k.name })
const row = (id: string): MyDeployment => S().mine.find((d) => d.eventId === id)!
const doors = (): MyDeployment[] => S().mine.filter((d) => d.chest?.door !== undefined)
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }

/** SEAL A DOOR at the cursor at height h, named and locked. */
async function sealDoor(name = 'North Door', h = HEIGHT, key = lock): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(h)
  S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(key), requires: `the ${key.name}`, contents: [] })
  expect(S().deployError).toBeNull()
  return S().mine.find((d) => !before.has(d.eventId))!
}

/** Hide a message at the cursor, at a height. */
async function hide(text: string, h: number): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployMessage(text)
  S().setDeployHeight(h)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}

/** What a finder reads behind a door: its signed event, with the secret. */
async function finderReads(d: MyDeployment, secret: string): Promise<{ found: boolean; texts: (string | undefined)[] }> {
  const o = await openRoom({ eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: d.inner.pubkey, at: positionOf(d), plane: d.plane, height: d.height, createdAt: d.createdAt, type: 'chest', chest: d.chest }, secret)
  return { found: o.found, texts: o.items.map((h) => h.text) }
}

beforeEach(() => {
  relay.events = []
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: null, deployInto: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('SEAL A DOOR: tap, choose the place, then its name and lock', () => {
  it('lines a door up on the hide bar, wearing DOOR; PLACE DOOR opens its modal', () => {
    S().startPlaceDoor()
    expect(placingChest(S().pending)).toBe(true)
    expect(S().pending).toMatchObject({ type: 'chest', door: true, look: { from: 'builtin', name: 'door' } })
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    expect(fillingChest(S().pending)).toBe(true)
    expect(useStash.getState().chest).toBe(true)
  })

  it('writes a `door` tag of its height, a look, and only a room entry; the device keeps the secret', async () => {
    const d = await sealDoor()
    expect(d.inner.tags.find((t) => t[0] === 'door')).toEqual(['door', String(HEIGHT)])
    const c = chestItemOf(d.inner)!
    expect(c.door).toBe(HEIGHT)
    expect(lookTagsOf(c.look).closed?.name).toMatch(/door/)
    const secret = doorSecretWithKey(c, lock.secretHex)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(doorSecret(me(), d.eventId)).toBe(secret)
    expect(d.height).toBe(HEIGHT)
  })

  it('then build (4.2): the mode stays on, and the next placement starts at the door\u2019s height', async () => {
    useBuilder.getState().exit()
    expect(useBuilder.getState().active).toBe(false)
    await sealDoor()
    expect(useBuilder.getState().active).toBe(true)
    expect(S().deployInto).toBe(HEIGHT)
    useBuilder.getState().exit()
    expect(useBuilder.getState().active).toBe(false)
    expect(S().deployInto).toBeNull()
  })

  it('refuses a height of 0: a door locks a region', async () => {
    S().startPlaceDoor()
    S().setDeployHeight(0)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Flat', lock: lockOf(), requires: '', contents: [] })
    expect(S().deployError).toMatch(/height 1 or more/)
    expect(doors()).toEqual([])
  })
})

describe('what is placed in its room (R1, height-specific)', () => {
  it('at the door’s height, in its cube: into the room bag, and a finder reads it', async () => {
    const d = await sealDoor()
    const secret = doorSecret(me(), d.eventId)!
    const inside = await hide('behind it', HEIGHT)
    expect(inside.room).toEqual({ doorId: d.eventId })
    const key = roomKey(hexToBytes(d.keyHex), hexToBytes(secret))
    expect(inside.lookupId).toBe(roomLookupId(key))
    expect(inside.keyHex).toBe(bytesToHex(key))
    expect(inside.bag).toEqual(ROOM_BAG_SETTINGS)
    // Nothing public: no height, hint, sector or contents, an empty content.
    const bag = relay.events.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === inside.lookupId)).at(-1)!
    expect(bag.tags.map((t) => t[0]).filter((t) => !['d', 'encrypted', 'version', 'client'].includes(t))).toEqual([])
    expect(bag.content).toBe('')
    expect(await finderReads(d, secret)).toEqual({ found: true, texts: ['behind it'] })
  })

  it('at any other height, in the same place: an ordinary placement', async () => {
    const d = await sealDoor()
    const above = await hide('above it', HEIGHT + 1)
    const below = await hide('below it', HEIGHT - 1)
    expect(above.room).toBeUndefined()
    expect(below.room).toBeUndefined()
    expect(above.bag?.heightTag).toBe(true)
    expect(behindDoor(S().mine, d)).toEqual([])
  })

  it('outside its cube, at its height: an ordinary placement', async () => {
    await sealDoor()
    goTo({ ...CURSOR, x: CURSOR.x + (1n << 12n) })
    expect((await hide('next door', HEIGHT)).room).toBeUndefined()
  })

  it('the chip names the door only inside its cube and at its height; nothing locks the height', async () => {
    const d = await sealDoor()
    S().startDeployMessage('x')
    const at = deployPoint(CURSOR, buildStepOf(C()), HEIGHT)
    expect(sealingDoor(S(), me(), at, d.plane, HEIGHT)?.name).toBe('North Door')
    expect(sealingDoor(S(), me(), at, d.plane, HEIGHT + 1)).toBeNull()
    S().setDeployHeight(HEIGHT + 1)
    expect(S().deployHeight).toBe(HEIGHT + 1)
    S().cancelDeploy()
  })

  it('nothing is sealed to another’s door, or one whose secret this device does not know', async () => {
    const d = await sealDoor()
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === d.eventId ? { ...m, inner: { ...m.inner, pubkey: 'f'.repeat(64) } } : m)) })
    expect(ownDoors(S().mine, me())).toEqual([])
    expect((await hide('not theirs', HEIGHT)).room).toBeUndefined()
  })

  it('a chest, an item and audio seal to the room the same way: anything placed', async () => {
    const d = await sealDoor()
    S().startPlaceChest()
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Chest in the room', lock: lockOf(), requires: '', contents: [{ kind: 'message', text: 'x' }] })
    expect(S().deployError).toBeNull()
    expect(S().mine.find((m) => m.chest?.name === 'Chest in the room')?.room).toEqual({ doorId: d.eventId })
    S().startDeployKey(forgeKey('Inner Key'))
    S().setDeployHeight(HEIGHT)
    await S().deploy()
    expect(S().mine.find((m) => m.key?.name === 'Inner Key')?.room).toEqual({ doorId: d.eventId })
  })
})

describe('the X on the chip (R2)', () => {
  it('leaves this one placement out, into the ordinary bag; the next asks again', async () => {
    const d = await sealDoor()
    S().startDeployMessage('left out')
    S().setDeployHeight(HEIGHT)
    const at = deployPoint(CURSOR, buildStepOf(C()), HEIGHT)
    const room = sealingDoor(S(), me(), at, d.plane, HEIGHT)!
    S().setDeployLeaveOut(`${room.plane}:${room.height}:${(room.at.x >> 4n) << 4n}:${(room.at.y >> 4n) << 4n}:${(room.at.z >> 4n) << 4n}`)
    expect(sealingDoor(S(), me(), at, d.plane, HEIGHT)).toBeNull()
    await S().deploy()
    const left = S().mine.find((m) => m.text === 'left out')!
    expect(left.room).toBeUndefined()
    expect(left.lookupId).toBe(d.lookupId)
    S().cancelDeploy()
    expect(S().deployLeaveOut).toBeNull()
    expect((await hide('sealed again', HEIGHT)).room).toEqual({ doorId: d.eventId })
  })
})

describe('two doors, one room (R5)', () => {
  it('a second door in the same cube at the same height joins it: same secret, its own lock and look', async () => {
    const a = await sealDoor('North Door')
    const other = forgeKey('Gold Key')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('East Door', HEIGHT, other)
    expect(doorSecret(me(), b.eventId)).toBe(doorSecret(me(), a.eventId))
    expect(doorSecretWithKey(chestItemOf(b.inner)!, other.secretHex)).toBe(doorSecret(me(), a.eventId))
    // Neither door is sealed into the room: both stand in the ordinary bag.
    expect(b.room).toBeUndefined()
    expect(b.lookupId).toBe(a.lookupId)
    const inside = await hide('either key', HEIGHT)
    expect(behindDoor(S().mine, row(a.eventId)).map((m) => m.eventId)).toEqual([inside.eventId])
    expect(behindDoor(S().mine, row(b.eventId)).map((m) => m.eventId)).toEqual([inside.eventId])
  })

  it('one whose secret this device does not know cannot be joined: two secrets would be two rooms', async () => {
    await sealDoor()
    localStorage.removeItem('onosendai:door-secrets')
    resetDoorSecrets()
    S().startPlaceDoor()
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Second', lock: lockOf(), requires: '', contents: [] })
    expect(S().deployError).toMatch(/Open it first/)
    expect(doors()).toHaveLength(1)
  })
})

describe('HERE: what you already hid there (R3)', () => {
  it('lists it, SEAL moves it behind the door and out of the ordinary bag', async () => {
    const before = await hide('already here', HEIGHT)
    const stays = await hide('also here', HEIGHT)
    const elsewhere = await hide('other height', HEIGHT + 1)
    const d = await sealDoor()
    expect(hereInRoom(S().mine, d).map((m) => m.eventId).sort()).toEqual([before.eventId, stays.eventId].sort())
    expect(hereInRoom(S().mine, d).map((m) => m.eventId)).not.toContain(elsewhere.eventId)
    expect(await S().sealIntoRoom(d.eventId, [before.eventId])).toBeNull()
    const moved = row(before.eventId)
    expect(moved.room).toEqual({ doorId: d.eventId })
    expect(hereInRoom(S().mine, row(d.eventId)).map((m) => m.eventId)).toEqual([stays.eventId])
    expect((await finderReads(row(d.eventId), doorSecret(me(), d.eventId)!)).texts).toEqual(['already here'])
    // SEAL ALL: the rest.
    expect(await S().sealIntoRoom(d.eventId, [stays.eventId])).toBeNull()
    expect(hereInRoom(S().mine, row(d.eventId))).toEqual([])
    expect((await finderReads(row(d.eventId), doorSecret(me(), d.eventId)!)).texts.sort()).toEqual(['already here', 'also here'])
  })

  it('never lists a door', async () => {
    const a = await sealDoor('North Door')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    await sealDoor('East Door')
    expect(hereInRoom(S().mine, row(a.eventId))).toEqual([])
  })
})

describe('EDIT (R10)', () => {
  it('a new name and label keep the seal, the secret and what stands behind it', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    expect(await S().resealDoor(d.eventId, { name: 'Renamed', requires: 'a word', lock: lockOf() })).toBeNull()
    const now = doors()[0]
    expect(now.eventId).not.toBe(d.eventId)
    expect(now.chest?.name).toBe('Renamed')
    expect(now.chest?.payload).toBe(d.chest?.payload)
    expect(now.chest?.door).toBe(HEIGHT)
    expect(doorSecret(me(), now.eventId)).toBe(secret)
    expect(row(inside.eventId).room).toEqual({ doorId: now.eventId })
  })

  it('a new lock rotates the room key: a new secret, the room moved, every door resealed, the old bag retracted', async () => {
    const a = await sealDoor('North Door')
    const gold = forgeKey('Gold Key')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('East Door', HEIGHT, gold)
    const inside = await hide('behind it', HEIGHT)
    const oldSecret = doorSecret(me(), a.eventId)!
    const oldLookup = inside.lookupId
    const next = forgeKey('New Key')
    expect(await S().resealDoor(a.eventId, { name: 'North Door', requires: 'the New Key', lock: lockOf(next) })).toBeNull()
    const [na, nb] = [doors().find((m) => m.chest?.name === 'North Door')!, doors().find((m) => m.chest?.name === 'East Door')!]
    const secret = doorSecret(me(), na.eventId)!
    expect(secret).not.toBe(oldSecret)
    // Each door keeps its own lock; both carry the new secret; the old key no longer opens the edited door.
    expect(doorSecretWithKey(chestItemOf(na.inner)!, next.secretHex)).toBe(secret)
    expect(() => doorSecretWithKey(chestItemOf(na.inner)!, lock.secretHex)).toThrow()
    expect(doorSecretWithKey(chestItemOf(nb.inner)!, gold.secretHex)).toBe(secret)
    expect(b.eventId).not.toBe(nb.eventId)
    // What stands behind it, under the new key; the old bag retracted; the old secret finds nothing new.
    const moved = S().mine.find((m) => m.text === 'behind it')!
    expect(moved.lookupId).not.toBe(oldLookup)
    expect(behindDoor(S().mine, na).map((m) => m.text)).toEqual(['behind it'])
    expect((await finderReads(na, secret)).texts).toEqual(['behind it'])
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === `${HIDDEN_KIND}:${me()}:${oldLookup}`))).toBe(true)
  })

  it('a new lock needs the secret: another device opens the door first', async () => {
    const d = await sealDoor()
    localStorage.removeItem('onosendai:door-secrets')
    resetDoorSecrets()
    expect(await S().resealDoor(d.eventId, { name: 'x', requires: '', lock: lockOf(forgeKey('New')) })).toMatch(/Open the door first/)
  })

  it('only its hider changes it', async () => {
    const d = await sealDoor()
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === d.eventId ? { ...m, inner: { ...m.inner, pubkey: 'f'.repeat(64) } } : m)) })
    expect(await S().resealDoor(d.eventId, { name: 'x', requires: '', lock: lockOf() })).toMatch(/Only the door/)
    expect(await S().deleteDoor(d.eventId, false)).toMatch(/Only the door/)
    S().startMoveChest(d.eventId)
    expect(S().pending).toBeNull()
  })
})

describe('MOVE (R7)', () => {
  it('inside its own cube: it moves, its secret and what stands behind it follow', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    S().startMoveChest(d.eventId)
    expect(S().pending).toMatchObject({ door: true, move: { eventId: d.eventId } })
    goTo({ ...CURSOR, x: CURSOR.x + 2n })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const now = doors()[0]
    expect(now.eventId).not.toBe(d.eventId)
    expect(doors()).toHaveLength(1)
    expect(doorSecret(me(), now.eventId)).toBe(secret)
    expect(row(inside.eventId).room).toEqual({ doorId: now.eventId })
    expect(chestItemOf(now.inner)?.payload).toBe(d.chest?.payload)
  })

  it('out of its cube, or to another height, is refused', async () => {
    const d = await sealDoor()
    S().startMoveChest(d.eventId)
    goTo({ ...CURSOR, x: CURSOR.x + (1n << 12n) })
    await S().deploy()
    expect(S().deployError).toMatch(/only inside its own room/)
    goTo(CURSOR)
    S().setDeployHeight(HEIGHT + 1)
    await S().deploy()
    expect(S().deployError).toMatch(/only inside its own room/)
    expect(doors()[0].eventId).toBe(d.eventId)
    S().cancelDeploy()
  })
})

describe('DELETE (R12, §3.7.8)', () => {
  it('switch off: what was behind it stands where it stood, ordinary; the room bag retracted; the door gone', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const roomLookup = inside.lookupId
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    expect(doors()).toEqual([])
    const out = S().mine.find((m) => m.text === 'behind it')!
    expect(out.room).toBeUndefined()
    const place = await regionKeyOffThread(positionOf(out), HEIGHT, 20)
    expect(out.lookupId).toBe(place.lookupId)
    expect(out.keyHex).toBe(bytesToHex(place.key))
    expect(positionOf(out)).toEqual(positionOf(inside))
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1] === `${HIDDEN_KIND}:${me()}:${roomLookup}`))).toBe(true)
  })

  it('switch on: what was behind it goes too, and no room bag is left no door names', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    await hide('and this', HEIGHT)
    expect(await S().deleteDoor(d.eventId, true)).toBeNull()
    expect(S().mine).toEqual([])
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1] === `${HIDDEN_KIND}:${me()}:${inside.lookupId}`))).toBe(true)
  })

  it('one of several: only that door goes, the room stays, what stood behind it stands behind the other', async () => {
    const a = await sealDoor('North Door')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('East Door')
    const inside = await hide('behind it', HEIGHT)
    expect(inside.room).toBeDefined()
    expect(await S().deleteDoor(inside.room!.doorId, true)).toBeNull()
    expect(doors()).toHaveLength(1)
    const left = doors()[0]
    expect([a.eventId, b.eventId]).toContain(left.eventId)
    const still = S().mine.find((m) => m.text === 'behind it')!
    expect(still.room).toEqual({ doorId: left.eventId })
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1] === `${HIDDEN_KIND}:${me()}:${still.lookupId}`))).toBe(false)
    expect((await finderReads(left, doorSecret(me(), left.eventId)!)).texts).toEqual(['behind it'])
  })

  it('without the secret the door still goes (4.11)', async () => {
    const d = await sealDoor()
    localStorage.removeItem('onosendai:door-secrets')
    resetDoorSecrets()
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    expect(doors()).toEqual([])
  })
})

describe('chests stop placing their contents; CONVERT TO DOOR (R13)', () => {
  const at = { x: 1n, y: 2n, z: 3n }
  it('anything out of a chest stays in it, wherever it was aimed; behind a door it stands', () => {
    const parent = { at, tags: [['title', 'c']] }
    expect(keptInChest({ chestId: 'c', at }, parent)).toBe(true)
    expect(keptInChest({ chestId: 'c', at: { x: 9n, y: 9n, z: 9n } }, parent)).toBe(true)
    expect(keptInChest({ at }, parent)).toBe(false)
    expect(keptInChest({ chestId: 'c', at }, { at, tags: [['door', '4']] })).toBe(false)
  })

  async function chestHere(): Promise<MyDeployment> {
    S().startPlaceChest()
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Old Room', lock: lockOf(), requires: 'the Silver Key', contents: [{ kind: 'message', text: 'inside the chest' }] })
    expect(S().deployError).toBeNull()
    return S().mine.find((m) => m.chest?.name === 'Old Room')!
  }

  it('makes a door where it stood, the same lock, DOOR by default, what it held behind it; the chest gone', async () => {
    const c = await chestHere()
    expect(await S().convertToDoor(c.eventId)).toBeNull()
    expect(S().mine.filter((m) => m.type === 'chest' && m.chest?.door === undefined)).toEqual([])
    const d = doors()[0]
    expect(positionOf(d)).toEqual(positionOf(c))
    expect(d.lookupId).toBe(c.lookupId)
    const item = chestItemOf(d.inner)!
    expect(item.lockPubkey).toBe(c.chest?.lockPubkey)
    expect(item.door).toBe(HEIGHT)
    expect(lookTagsOf(item.look).closed?.name).toMatch(/door/)
    const secret = doorSecretWithKey(item, lock.secretHex)!
    expect(doorSecret(me(), d.eventId)).toBe(secret)
    expect(behindDoor(S().mine, d).map((m) => m.text)).toEqual(['inside the chest'])
    expect((await finderReads(d, secret)).texts).toEqual(['inside the chest'])
    // The door's own plaintext holds only the room entry: nothing of the old contents.
    expect(readContents(openWithSecret(item, lock.secretHex))).toEqual([])
  })

  it('refuses a door, someone else’s chest, and a chest at height 0', async () => {
    const d = await sealDoor()
    expect(await S().convertToDoor(d.eventId)).toMatch(/Only the chest/)
    S().startPlaceChest()
    S().setDeployHeight(0)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Flat', lock: lockOf(), requires: '', contents: [{ kind: 'message', text: 'x' }] })
    const flat = S().mine.find((m) => m.chest?.name === 'Flat')!
    expect(await S().convertToDoor(flat.eventId)).toMatch(/height 0/)
  })
})

describe('the red cube (R8)', () => {
  it('only in BUILD or DEPLOY, only your own doors, one outline per room, in the plane on show', async () => {
    const a = await sealDoor('North Door')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    await sealDoor('East Door')
    expect(roomOutlines(S().mine, me(), false, a.plane)).toEqual([])
    expect(roomOutlines(S().mine, me(), true, a.plane)).toHaveLength(1)
    expect(roomOutlines(S().mine, me(), true, a.plane === 0 ? 1 : 0)).toEqual([])
    expect(roomOutlines(S().mine, 'f'.repeat(64), true, a.plane)).toEqual([])
  })
})

describe('CONVERT TO DOOR never loses anything (R13)', () => {
  const T = 1_800_000_000
  const far = (): Position => ({ ...CURSOR, x: CURSOR.x + (1n << 12n) })
  const plane = (): 0 | 1 => { S().startDeployMessage('p'); const p = C().anchorPlane; S().cancelDeploy(); return p as 0 | 1 }

  /** A chest at height 4 holding exactly these entries, as sealed. */
  async function chestHolding(entries: BagEntry[]): Promise<MyDeployment> {
    S().startPlaceChest()
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Old Room', lock: lockOf(), requires: 'the Silver Key', contents: entries.map((entry) => ({ kind: 'sealed' as const, entry, label: 'x', type: 'message' as const })) })
    expect(S().deployError).toBeNull()
    return S().mine.find((m) => m.chest?.name === 'Old Room')!
  }
  const here = (text: string, at: Position = CURSOR): BagEntry => rumorOf(messageInnerTemplate(text, at, plane(), T), me())

  /** The chest exactly as it was, nothing on the relays since, and no door. */
  async function refused(c: MyDeployment, words: string): Promise<void> {
    const mine = S().mine
    const events = relay.events.length
    expect(await S().convertToDoor(c.eventId)).toBe(words)
    expect(S().mine).toBe(mine)
    expect(relay.events.length).toBe(events)
    expect(doors()).toEqual([])
    expect(row(c.eventId)).toBe(c)
    expect(doorSecret(me(), c.eventId)).toBeNull()
  }

  it('refuses when something is aimed outside the region, and says how many', async () => {
    const outside = await C().signEvent(keyInnerTemplate(forgeKey('Far Key'), far(), plane(), T))
    await refused(await chestHolding([here('inside'), outside]), "1 CAN'T MOVE")
  })

  it('refuses when it cannot read something: an unknown kind, a reference', async () => {
    const unknown = { id: '0'.repeat(64), pubkey: me(), created_at: T, kind: 9999, tags: [['C', '0'.repeat(64)]], content: 'from the future' } as unknown as BagEntry
    const reference = ['a', `33331:${me()}:elsewhere`, 'wss://relay.test'] as BagEntry
    await refused(await chestHolding([here('inside'), unknown, reference]), "2 CAN'T MOVE")
  })

  it('refuses what a room bag would drop: signed by someone else, a rumor by someone else', async () => {
    const other = generateSecretKey()
    const signed = finalizeEvent(keyInnerTemplate(forgeKey('Their Key'), CURSOR, plane(), T), other) as NostrEvent
    const rumor = rumorOf(messageInnerTemplate('their words', CURSOR, plane(), T), signed.pubkey)
    await refused(await chestHolding([here('inside'), signed, rumor]), "2 CAN'T MOVE")
  })

  it('refuses a door in the chest no room of this height may hold (§3.7.1)', async () => {
    const sealed = sealEntries([], lock.itemPubkey)
    const tall = await C().signEvent(chestInnerTemplate({ name: 'Tall', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload, door: HEIGHT }, CURSOR, plane(), T))
    await refused(await chestHolding([here('inside'), tall]), "1 CAN'T MOVE")
  })

  it('opened with a key on another device: what the reader would filter away still counts', async () => {
    const c = await chestHolding([here('inside'), 42 as unknown as BagEntry])
    useShards.setState({ mine: S().mine.map((m) => { if (m.eventId !== c.eventId) return m; const { sealed: _s, ...rest } = m; void _s; return rest }) })
    const held = await C().signEvent(keyInnerTemplate(lock, CURSOR, plane(), T))
    useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: plane(), height: HEIGHT })
    await refused(row(c.eventId), "1 CAN'T MOVE")
  })

  it('counts everything that blocks it, at once', async () => {
    const outside = await C().signEvent(keyInnerTemplate(forgeKey('Far Key'), far(), plane(), T))
    const unknown = { id: '0'.repeat(64), pubkey: me(), created_at: T, kind: 9999, tags: [], content: '?' } as unknown as BagEntry
    const elsewhere = rumorOf(messageInnerTemplate('far words', far(), plane(), T), me())
    await refused(await chestHolding([outside, unknown, elsewhere, here('inside')]), "3 CAN'T MOVE")
  })

  it('every entry reaches the door: the room holds exactly what the chest held', async () => {
    const item = await C().signEvent(keyInnerTemplate(forgeKey('Near Key'), { ...CURSOR, x: CURSOR.x + 1n }, plane(), T))
    const c = await chestHolding([here('first'), here('second'), item])
    expect(await S().convertToDoor(c.eventId)).toBeNull()
    const d = doors()[0]
    const secret = doorSecret(me(), d.eventId)!
    const read = await openRoom({ eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: me(), at: positionOf(d), plane: d.plane, height: d.height, createdAt: d.createdAt, type: 'chest', chest: d.chest }, secret)
    expect(read.items).toHaveLength(3)
    expect(read.items.map((h) => h.text ?? h.key?.name).sort()).toEqual(['Near Key', 'first', 'second'])
    expect(S().mine.find((m) => m.chest?.name === 'Old Room' && m.chest.door === undefined)).toBeUndefined()
  })

  it('a bag rewrite that would leave one out is a refusal too: the chest stays, the room bag is taken back', async () => {
    // A chest inside holding a copy of its sibling, opened by a key held here: the bag writer leaves the copy out (publishBag).
    const sibling = here('sibling')
    const held = await C().signEvent(keyInnerTemplate(lock, CURSOR, plane(), T))
    useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: plane(), height: HEIGHT })
    const sealed = sealEntries([sibling], lock.itemPubkey)
    const nested = await C().signEvent(chestInnerTemplate({ name: 'Nested', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, CURSOR, plane(), T))
    const c = await chestHolding([sibling, nested])
    expect(await S().convertToDoor(c.eventId)).toBe("1 CAN'T MOVE")
    expect(row(c.eventId)).toBeDefined()
    expect(doors()).toEqual([])
    expect(relay.events.some((e) => e.kind === 5)).toBe(true)
  })

  it('a signer that refuses the door leaves the chest, and takes the room bag back', async () => {
    const c = await chestHolding([here('inside')])
    const sign = C().signEvent
    useCyberspace.setState({ signEvent: (async (t: { kind: number }) => { if (t.kind === 3341) throw new Error('The signer said no.'); return sign(t as never) }) as never })
    expect(await S().convertToDoor(c.eventId)).toBe('The signer said no.')
    useCyberspace.setState({ signEvent: sign })
    expect(row(c.eventId)).toBeDefined()
    expect(doors()).toEqual([])
    expect(S().mine).toHaveLength(1)
    expect(relay.events.some((e) => e.kind === 5)).toBe(true)
  })
})

describe('a large shard, hidden by reference', () => {
  /** A model large enough to go by reference. */
  function large(name = 'Monument'): ShardModel {
    const vertices = Array.from({ length: 1400 }, (_, i) => ({ p: [i % 8, (i >> 3) % 8, (i >> 6) % 8] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] }))
    const shard = { ...newShard(name), vertices, faces: [[0, 1, 2]] as Array<[number, number, number]> }
    useWorkshop.setState({ shards: [shard] })
    return shard
  }

  async function hideLarge(h = HEIGHT): Promise<MyDeployment> {
    const model = large()
    S().startDeployShard(model.id)
    S().setDeployHeight(h)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    const r = S().mine.find((d) => d.type === 'shard')!
    expect(r.ref).toBeDefined()
    expect(JSON.stringify(r.inner).length).toBeGreaterThan(REFERENCE_THRESHOLD_BYTES)
    return r
  }
  const shardRow = (): MyDeployment => S().mine.find((d) => d.type === 'shard')!
  /** The object as a relay holds it now: the newest at its address. */
  const objectOnRelay = (r: MyDeployment): NostrEvent => relay.events.find((e) => e.kind === OBJECT_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === r.inner.tags.find((x) => x[0] === 'd')?.[1])) as unknown as NostrEvent
  const opens = async (r: MyDeployment, key: Uint8Array): Promise<boolean> => (await decryptForRegion(key, objectOnRelay(r).tags.find((t) => t[0] === 'encrypted')?.[2] ?? '')) !== null
  const reads = async (d: MyDeployment): Promise<number[]> => (await openRoom({ eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: me(), at: positionOf(d), plane: d.plane, height: d.height, createdAt: d.createdAt, type: 'chest', chest: d.chest }, doorSecret(me(), d.eventId)!)).items.flatMap((h) => (h.shard ? [h.shard.vertices.length] : []))

  it('placed behind a door: sealed with the room key, its `encrypted` tag still saying cyberspace:region', async () => {
    const d = await sealDoor()
    const secret = doorSecret(me(), d.eventId)!
    const r = await hideLarge()
    expect(r.room).toEqual({ doorId: d.eventId })
    const roomK = roomKey(hexToBytes(d.keyHex), hexToBytes(secret))
    expect(await opens(r, roomK)).toBe(true)
    expect(await opens(r, hexToBytes(d.keyHex))).toBe(false)
    expect(objectOnRelay(r).tags.find((t) => t[0] === 'encrypted')?.[3]).toBe('cyberspace:region')
    expect(await reads(d)).toEqual([1400])
  })

  it('SEAL moves it between bags: resealed under the room key at the same address, gone from the ordinary bag', async () => {
    const before = await hideLarge()
    const d = await sealDoor()
    const address = before.inner.tags.find((t) => t[0] === 'd')?.[1]
    expect(hereInRoom(S().mine, d).map((m) => m.eventId)).toEqual([before.eventId])
    expect(await S().sealIntoRoom(d.eventId, [before.eventId])).toBeNull()
    const moved = shardRow()
    expect(moved.eventId).not.toBe(before.eventId)
    expect(moved.inner.tags.find((t) => t[0] === 'd')?.[1]).toBe(address)
    expect(moved.room).toEqual({ doorId: d.eventId })
    const roomK = roomKey(hexToBytes(d.keyHex), hexToBytes(doorSecret(me(), d.eventId)!))
    expect(moved.keyHex).toBe(bytesToHex(roomK))
    expect(await opens(moved, roomK)).toBe(true)
    expect(await opens(moved, hexToBytes(d.keyHex))).toBe(false)
    // The place's own bag names it no longer: only the door is left in it.
    const ordinary = relay.events.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === d.lookupId)).at(-1) as unknown as NostrEvent
    const left = await bagEntries(ordinary, hexToBytes(d.keyHex))
    expect(left.map((e) => (e as NostrEvent).kind)).toEqual([3341])
    expect(await reads(row(d.eventId))).toEqual([1400])
  })

  it('out again with the last door, switch off: resealed under the region key, a stranger at the place reads it', async () => {
    const before = await hideLarge()
    const d = await sealDoor()
    expect(await S().sealIntoRoom(d.eventId, [before.eventId])).toBeNull()
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    const out = shardRow()
    expect(out.room).toBeUndefined()
    const key = hexToBytes(out.keyHex)
    expect(out.keyHex).toBe(d.keyHex)
    expect(await opens(out, key)).toBe(true)
    const bag = relay.events.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === out.lookupId)).at(-1) as unknown as NostrEvent
    const { resolveReference } = await import('../../lib/references')
    const found = await unbag(bag, key, resolveReference, undefined, HEIGHT)
    expect(found.flatMap((h) => (h.shard ? [h.shard.vertices.length] : []))).toEqual([1400])
  })

  it('a new lock rotates a room that holds one: resealed under the new room key; the old key opens nothing at its address', async () => {
    const d = await sealDoor()
    const r = await hideLarge()
    const oldKey = roomKey(hexToBytes(d.keyHex), hexToBytes(doorSecret(me(), d.eventId)!))
    expect(await opens(r, oldKey)).toBe(true)
    const next = forgeKey('New Key')
    expect(await S().resealDoor(d.eventId, { name: 'North Door', requires: 'the New Key', lock: lockOf(next) })).toBeNull()
    const nd = doors()[0]
    const newKey = roomKey(hexToBytes(nd.keyHex), hexToBytes(doorSecret(me(), nd.eventId)!))
    const moved = shardRow()
    expect(moved.keyHex).toBe(bytesToHex(newKey))
    expect(moved.inner.tags.find((t) => t[0] === 'd')?.[1]).toBe(r.inner.tags.find((t) => t[0] === 'd')?.[1])
    expect(await opens(moved, newKey)).toBe(true)
    expect(await opens(moved, oldKey)).toBe(false)
    expect(await reads(nd)).toEqual([1400])
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1] === `${HIDDEN_KIND}:${me()}:${r.lookupId}`))).toBe(true)
    // Its address is never deleted: the deletion names the old bag, not the resealed object.
    expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1]?.startsWith(`${OBJECT_KIND}:`)))).toBe(false)
  })

  it('without the secret, nothing about it moves', async () => {
    const before = await hideLarge()
    const d = await sealDoor()
    localStorage.removeItem('onosendai:door-secrets')
    resetDoorSecrets()
    expect(await S().sealIntoRoom(d.eventId, [before.eventId])).toMatch(/Open the door first/)
    expect(shardRow().eventId).toBe(before.eventId)
    keepDoorSecret(me(), d.eventId, 'a'.repeat(64))
  })
})
