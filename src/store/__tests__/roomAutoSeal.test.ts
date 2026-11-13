/**
 * roomAutoSeal.test.ts: whatever you place in a room of yours joins it, at
 * the room's height, whatever height was chosen (arkinox, 2026-11-09: "id
 * rather everything I place in the room be added unless I hit the X on the
 * room seal banner"). DECK-0004 §3.7.4 holds: what joins goes out at the
 * room's height; the X makes it an ordinary placement at the height chosen.
 * Nested rooms: the innermost. A door: only into a room higher than its own
 * (§3.7.6). The relay is a mock that keeps what is published. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }>, refuse: (_e: { kind: number; tags: string[][] }) => false as boolean }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => { if (relay.refuse(ev)) return { ok: false }; relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

import { newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { innermostRoomAt, roomKey, roomLookupId, roomOf, type OwnDoor } from '../../lib/doors'
import type { AudioItem } from '../../lib/audioItem'
import { HIDDEN_KIND, bagTemplate, type KeyItem } from '../../lib/hidden'
import { hexToBytes } from '../../lib/events'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets } from '../doorSecrets'
import { resetClosedDoors } from '../closedDoors'
import { closeDoor } from '../rooms'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { rememberOpened, resetOpenedChests } from '../useOpenedChests'
import { SEAL_BUSY, autoRoomFor, hereInRoom, positionOf, useShards, type MyDeployment } from '../useShards'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a740n, y: (1n << 60n) + 0x2c0n, z: (1n << 72n) + 0x7c0n }
const ROOM = 6
const INNER = 4
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }
/** In the room's cube, out of any inner cube at CURSOR. */
const BESIDE: Position = { ...CURSOR, x: CURSOR.x + (1n << BigInt(INNER)) }
const AWAY: Position = { ...CURSOR, x: CURSOR.x + (1n << 12n) }

let lock: KeyItem
const lockOf = () => ({ pubkey: lock.itemPubkey, label: lock.name })
const newest = (before: Set<string>): MyDeployment => S().mine.find((d) => !before.has(d.eventId))!

async function sealDoor(name: string, hide: number, room: number | null = null): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(hide)
  S().setDeployDoorHeight(room)
  S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(), requires: 'x', contents: [] })
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return newest(before)
}

/** Deploy what is lined up, with HIDE AT HEIGHT at `chosen`; the row it made. */
async function hideAt(chosen: number): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().setDeployHeight(chosen)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return newest(before)
}

function benchShard(unit: number): ShardModel {
  const shard: ShardModel = { ...newShard('Lamp'), unit, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }], faces: [[0, 1, 2]] }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

const audio: AudioItem = {
  title: 'Drip', about: '', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  originalHash: 'cd'.repeat(32), size: 2048, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false,
}

beforeEach(() => {
  relay.events = []
  relay.refuse = () => false
  localStorage.removeItem('onosendai:doors-closed')
  resetClosedDoors()
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('every kind of thing joins the room, whatever height was chosen', () => {
  it('a shard, a message, a key, audio, a chest and a lower door: each at the room’s height, behind its door', async () => {
    const door = await sealDoor('Room', ROOM)
    const into = { doorId: door.eventId }
    const shard = benchShard(3)
    S().startDeployShard(shard.id)
    const s = await hideAt(2)
    S().startDeployMessage('note')
    const m = await hideAt(ROOM + 2)
    S().startDeployKey(forgeKey('Spare'))
    const k = await hideAt(0)
    S().startDeployAudio(audio)
    const a = await hideAt(1)
    for (const row of [s, m, k, a]) {
      expect(row.room).toEqual(into)
      expect(row.height).toBe(ROOM)
    }
    // A chest, placed first and filled after: still the room's height when it is sealed.
    const before = new Set(S().mine.map((d) => d.eventId))
    S().startPlaceChest()
    S().setDeployHeight(3)
    expect(S().deployHeight).toBe(ROOM)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Box', lock: lockOf(), requires: '', contents: [{ kind: 'message', text: 'in the box' }] })
    expect(S().deployError).toBeNull()
    const chest = newest(before)
    expect(chest.room).toEqual(into)
    expect(chest.height).toBe(ROOM)
    S().cancelDeploy()
    // A door whose own room is lower than this one: behind it, its own room what was chosen.
    goTo(AWAY)
    goTo(BESIDE)
    const lower = await sealDoor('Lower', 2)
    expect(lower.room).toEqual(into)
    expect(lower.height).toBe(ROOM)
    expect(lower.chest?.door).toBe(2)
  }, 30000)

  it('a shard keeps the size it was set to: the height is only where it is found', async () => {
    await sealDoor('Room', ROOM)
    const shard = benchShard(3)
    S().startDeployShard(shard.id)
    S().setDeployUnit(9)
    const row = await hideAt(1)
    expect(row.height).toBe(ROOM)
    expect((JSON.parse(row.inner.content) as ShardPayload).unit).toBe(9)
    expect(row.shard?.unit).toBe(9)
  })

  it('a MOVE or EDIT keeps its own bag and height; SEAL IN ROOM moves it in (review of #633)', async () => {
    goTo(AWAY)
    S().startDeployMessage('moved in')
    const was = await hideAt(2)
    expect(was.room).toBeUndefined()
    goTo(CURSOR)
    const door = await sealDoor('Room', ROOM)
    S().startMoveItem(was.eventId)
    expect(S().deployHeight).toBe(2)
    expect(S().deployRoomSnap).toBeNull()
    expect(autoRoomFor({ ...S(), deploySealMove: true }, me(), CURSOR, door.plane)?.name).toBe('Room')
    await S().deploy()
    expect(S().deployError).toBeNull()
    const stayed = S().mine.find((d) => d.text === 'moved in')!
    expect(stayed.room).toBeUndefined()
    expect(stayed.height).toBe(2)
    S().cancelDeploy()
    // Asked: SEAL IN ROOM.
    S().startMoveItem(stayed.eventId)
    S().setDeploySealMove(true)
    expect(S().deployHeight).toBe(ROOM)
    await S().deploy()
    expect(S().deployError).toBeNull()
    const moved = S().mine.find((d) => d.text === 'moved in')!
    expect(moved.room).toEqual({ doorId: door.eventId })
    expect(moved.height).toBe(ROOM)
    S().cancelDeploy()
    expect(S().deploySealMove).toBe(false)
  })

  it('an EDIT of a shard at the room\u2019s own height, hidden before the door, stays out unless asked', async () => {
    const shard = benchShard(3)
    S().startDeployShard(shard.id)
    const before = await hideAt(ROOM)
    expect(before.room).toBeUndefined()
    await sealDoor('Room', ROOM)
    S().startEditShard(before.eventId)
    await S().deploy()
    expect(S().deployError).toBeNull()
    const shards = S().mine.filter((d) => d.type === 'shard')
    expect(shards).toHaveLength(1)
    expect(shards[0].room).toBeUndefined()
    expect(shards[0].height).toBe(ROOM)
    S().cancelDeploy()
  })
})

describe('the X, and leaving the room', () => {
  it('the X: an ordinary placement at the height chosen, in that height’s own bag', async () => {
    const door = await sealDoor('Room', ROOM)
    S().startDeployMessage('left out')
    S().setDeployHeight(2)
    expect(S().deployHeight).toBe(ROOM)
    S().setDeployLeaveOut(roomOf(positionOf(door), door.plane, ROOM))
    expect(S().deployHeight).toBe(2)
    expect(S().deployRoomSnap).toBeNull()
    await S().deploy()
    expect(S().deployError).toBeNull()
    const row = S().mine.find((d) => d.text === 'left out')!
    expect(row.room).toBeUndefined()
    expect(row.height).toBe(2)
    expect(row.lookupId).not.toBe(door.lookupId)
  })

  it('out of the room the chosen height comes back; in again, the room’s; the + and - set the chosen one meanwhile', async () => {
    await sealDoor('Room', ROOM)
    goTo(AWAY)
    S().startDeployMessage('roaming')
    S().setDeployHeight(2)
    expect(S().deployHeight).toBe(2)
    goTo(CURSOR)
    expect(S().deployHeight).toBe(ROOM)
    expect(S().deployRoomSnap?.chosen).toBe(2)
    S().setDeployHeight(3)
    expect(S().deployHeight).toBe(ROOM)
    goTo(AWAY)
    expect(S().deployHeight).toBe(3)
    expect(S().deployRoomSnap).toBeNull()
    S().cancelDeploy()
  })

  it('CANCEL inside the room gives the chosen height back', async () => {
    await sealDoor('Room', ROOM)
    S().startDeployMessage('never placed')
    S().setDeployHeight(1)
    expect(S().deployHeight).toBe(ROOM)
    S().cancelDeploy()
    expect(S().deployHeight).toBe(1)
    expect(S().deployRoomSnap).toBeNull()
  })

  it('a door being moved never joins: it stays in its own room at its own height (R7)', async () => {
    await sealDoor('Room', ROOM)
    goTo(BESIDE)
    const inner = await sealDoor('Inner', ROOM, INNER)
    S().startMoveChest(inner.eventId)
    expect(autoRoomFor(S(), me(), CURSOR, inner.plane)).toBeNull()
    expect(S().deployRoomSnap).toBeNull()
    S().cancelDeploy()
  })
})

describe('nested rooms: the innermost', () => {
  it('in both cubes, the inner room; beside it, the outer', async () => {
    const outer = await sealDoor('Outer', ROOM)
    const inner = await sealDoor('Inner', ROOM, INNER)
    S().startDeployMessage('deep')
    const deep = await hideAt(ROOM + 3)
    expect(deep.room).toEqual({ doorId: inner.eventId })
    expect(deep.height).toBe(INNER)
    goTo(BESIDE)
    S().startDeployMessage('shallow')
    const shallow = await hideAt(1)
    expect(shallow.room).toEqual({ doorId: outer.eventId })
    expect(shallow.height).toBe(ROOM)
  })

  it('innermostRoomAt: the lowest room holding the point, in its plane, of those that fit', () => {
    const at = CURSOR
    const door = (eventId: string, height: number, plane = 0): OwnDoor => ({ eventId, name: eventId, at, plane, height, secret: 'aa'.repeat(32) })
    const doors = [door('big', 9), door('mid', 6), door('small', 3), door('other plane', 2, 1)]
    expect(innermostRoomAt(doors, at, 0)?.eventId).toBe('small')
    expect(innermostRoomAt(doors, at, 0, (d) => d.height > 3)?.eventId).toBe('mid')
    expect(innermostRoomAt(doors, at, 1)?.eventId).toBe('other plane')
    expect(innermostRoomAt(doors, { ...at, x: at.x + (1n << 20n) }, 0)).toBeNull()
  })
})

describe('rooms you CLOSEd, and room keys already held (review of #633)', () => {
  it('a room CLOSEd here never takes a placement on its own', async () => {
    const door = await sealDoor('Room', ROOM)
    rememberOpened(me(), door.eventId, door.chest!.lockPubkey, [])
    await closeDoor({ eventId: door.eventId, inner: door.inner, keyHex: door.keyHex, bagId: door.bagId, lookupId: door.lookupId, author: me(), at: positionOf(door), plane: door.plane, height: door.height, createdAt: door.createdAt, type: 'chest', chest: door.chest })
    S().startDeployMessage('not into a closed room')
    S().setDeployHeight(2)
    expect(S().deployRoomSnap).toBeNull()
    expect(S().deployHeight).toBe(2)
    S().cancelDeploy()
  })

  it('a placement into a room uses the room key held here: no key is computed, nothing is bought', async () => {
    const door = await sealDoor('Room', ROOM)
    const notes: string[] = []
    const stop = useShards.subscribe((s) => { if (s.deployNote) notes.push(s.deployNote) })
    S().startDeployMessage('first in')
    const first = await hideAt(1)
    S().startDeployMessage('second in')
    const second = await hideAt(3)
    stop()
    expect(notes.some((n) => /Computing the 2\^|HOSAKA/.test(n))).toBe(false)
    const key = roomKey(hexToBytes(door.keyHex), hexToBytes(doorSecret(me(), door.eventId)!))
    expect([first.lookupId, second.lookupId]).toEqual([roomLookupId(key), roomLookupId(key)])
  })
})

describe('SEAL into a room (review of #633)', () => {
  const big = (i: number): string => `${String(i).padStart(3, '0')} ${'abcdefghij'.repeat(999)}`
  const dOf = (e: { tags: string[][] }): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''

  /** Before the door: `n` messages in its cube, spread over heights 0 to 3, so over four bags. */
  async function hiddenBefore(n: number, text: (i: number) => string = (i) => `thing ${i}`): Promise<MyDeployment[]> {
    const rows: MyDeployment[] = []
    for (let i = 0; i < n; i++) {
      goTo({ ...CURSOR, y: CURSOR.y + BigInt(i) })
      S().startDeployMessage(text(i))
      rows.push(await hideAt(i % 4))
    }
    goTo(CURSOR)
    return rows
  }

  it('SEAL of more than one room bag holds inline: since sealed entries (spec §7.6, #89) the largest move out, and the room bag stays under the limit', async () => {
    const rows = await hiddenBefore(24, big)
    const door = await sealDoor('Room', ROOM)
    expect(hereInRoom(S().mine, door)).toHaveLength(24)
    const why = await S().sealIntoRoom(door.eventId, rows.map((r) => r.eventId))
    expect(why).toBeNull()
    expect(S().mine.filter((d) => d.room?.doorId === door.eventId)).toHaveLength(24)
    const room = roomLookupId(roomKey(hexToBytes(door.keyHex), hexToBytes(doorSecret(me(), door.eventId)!)))
    const roomBags = relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === room)
    expect(Math.max(...roomBags.map((e) => JSON.stringify(e).length))).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    // What moved out went as sealed entries, sealed with the room's key.
    expect(relay.events.some((e) => e.kind === 33335)).toBe(true)
    expect(S().mine.some((d) => d.room && d.sealedRef)).toBe(true)
  }, 60000)

  it('placements past what a room bag holds inline still go, entries moving out as sealed entries, and no room bag passes the limit', async () => {
    await sealDoor('Room', ROOM)
    for (let i = 0; i < 30; i++) {
      S().startDeployMessage(big(i))
      S().setDeployHeight(2)
      await S().deploy()
      expect(S().deployError).toBeNull()
      S().cancelDeploy()
    }
    expect(S().mine.filter((d) => d.room && d.type === 'message')).toHaveLength(30)
    const roomBags = relay.events.filter((e) => e.kind === HIDDEN_KIND && S().mine.some((d) => d.room && d.lookupId === dOf(e)))
    expect(Math.max(...roomBags.map((e) => JSON.stringify(e).length))).toBeLessThanOrEqual(BAG_SAFE_BYTES)
  }, 60000)

  it('two SEAL ALLs at once: the second is refused while the first goes out', async () => {
    const rows = await hiddenBefore(4)
    const door = await sealDoor('Room', ROOM)
    const ids = rows.map((r) => r.eventId)
    const first = S().sealIntoRoom(door.eventId, ids)
    expect(S().sealingRoom).toBe(door.eventId)
    expect(await S().sealIntoRoom(door.eventId, ids)).toBe(SEAL_BUSY)
    expect(await first).toBeNull()
    expect(S().sealingRoom).toBeNull()
    expect(S().mine.filter((d) => d.room?.doorId === door.eventId)).toHaveLength(4)
  })

  it('a move that fails after others went says how many did, never that nothing moved', async () => {
    const rows = await hiddenBefore(2)
    const door = await sealDoor('Room', ROOM)
    const room = roomLookupId(roomKey(hexToBytes(door.keyHex), hexToBytes(doorSecret(me(), door.eventId)!)))
    let writes = 0
    relay.refuse = (e) => e.kind === HIDDEN_KIND && dOf(e) === room && ++writes >= 2
    const why = await S().sealIntoRoom(door.eventId, rows.map((r) => r.eventId))
    relay.refuse = () => false
    expect(why).toMatch(/^1 OF 2 MOVED\./)
    expect(why).not.toMatch(/Nothing has moved/i)
    expect(S().mine.filter((d) => d.room?.doorId === door.eventId)).toHaveLength(1)
  })

  it('a row its bag no longer holds (moved on another device) is left out, never brought back', async () => {
    goTo(CURSOR)
    S().startDeployMessage('stays')
    const a = await hideAt(2)
    S().startDeployMessage('moved elsewhere')
    const b = await hideAt(2)
    expect(a.lookupId).toBe(b.lookupId)
    // Another device rewrote the bag without it.
    const newer = Math.max(...relay.events.filter((e) => dOf(e) === a.lookupId).map((e) => e.created_at)) + 5
    const template = await bagTemplate([a.inner], hexToBytes(a.keyHex), a.lookupId, a.height, newer, HIDDEN_KIND, { ...a.bag!, heightTag: true }, { at: positionOf(a), plane: a.plane })
    relay.events.push(await useCyberspace.getState().signEvent(template) as never)
    const door = await sealDoor('Room', ROOM)
    const why = await S().sealIntoRoom(door.eventId, [a.eventId, b.eventId])
    expect(why).toBe('1 OF 2 MOVED. 1 WAS MOVED OR DELETED ON ANOTHER DEVICE.')
    expect(S().mine.find((d) => d.eventId === a.eventId)?.room).toEqual({ doorId: door.eventId })
    expect(S().mine.find((d) => d.eventId === b.eventId)?.room).toBeUndefined()
    // And it is not listed again: gone from its bag.
    expect(hereInRoom(S().mine, door).map((d) => d.eventId)).not.toContain(b.eventId)
  })

  it('HERE lists rows filed under the other door of the room around this one (§3.7.5)', async () => {
    const a = await sealDoor('A', ROOM)
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('B', ROOM)
    goTo(CURSOR)
    S().startDeployMessage('under B')
    const x = await hideAt(ROOM)
    useShards.setState({ mine: S().mine.map((d) => (d.eventId === x.eventId ? { ...d, room: { doorId: b.eventId } } : d)) })
    const inner = await sealDoor('Inner', ROOM, INNER)
    expect(inner.room?.doorId === a.eventId || inner.room?.doorId === b.eventId).toBe(true)
    expect(hereInRoom(S().mine, inner).map((d) => d.eventId)).toContain(x.eventId)
  })
})
