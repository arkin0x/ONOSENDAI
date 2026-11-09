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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }> }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => { relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

import { newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { innermostRoomAt, roomOf, type OwnDoor } from '../../lib/doors'
import type { AudioItem } from '../../lib/audioItem'
import type { KeyItem } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { resetOpenedChests } from '../useOpenedChests'
import { autoRoomFor, positionOf, useShards, type MyDeployment } from '../useShards'
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

  it('a MOVE of something of yours into the room joins it too', async () => {
    goTo(AWAY)
    S().startDeployMessage('moved in')
    const was = await hideAt(2)
    expect(was.room).toBeUndefined()
    goTo(CURSOR)
    const door = await sealDoor('Room', ROOM)
    S().startMoveItem(was.eventId)
    expect(S().deployHeight).toBe(ROOM)
    await S().deploy()
    expect(S().deployError).toBeNull()
    const moved = S().mine.find((d) => d.text === 'moved in')!
    expect(moved.room).toEqual({ doorId: door.eventId })
    expect(moved.height).toBe(ROOM)
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
