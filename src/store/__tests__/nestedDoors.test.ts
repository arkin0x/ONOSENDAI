/**
 * nestedDoors.test.ts: doors inside rooms (DECK-0004 §3.7.6, cyberspace PR
 * #82, held; chest and door design 4.4, 4.5, R6).
 *
 * A door hidden at an outer door's height in its cube, with a room of its own
 * lower, is sealed into the outer room like anything else. Heights never
 * compete: the chip names the door whose height you are at. A finder opens the
 * outer door, sees the inner one closed, and opens it in turn. The red cube's
 * line count is the depth. The relay is a mock that keeps what is published
 * and answers by `d`. No network.
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

import { forgeKey } from '../../lib/chests'
import { HIDDEN_KIND, chestItemOf, type Hidden, type KeyItem } from '../../lib/hidden'
import { doorSecretWithKey } from '../../lib/doors'
import type { Position } from '../../lib/space'
import { deployPoint } from '../../lib/space'
import { buildStepOf } from '../../lib/buildCursor'
import { roomLines, roomOutlines } from '../../scene/DoorRooms'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { resetOpenedChests } from '../useOpenedChests'
import { behindDoor, behindDoorDeep, doorDepth, effectiveDoorHeight, positionOf, sealingDoor, useShards, type MyDeployment } from '../useShards'
import { openRoom } from '../rooms'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a740n, y: (1n << 60n) + 0x2c0n, z: (1n << 72n) + 0x7c0n }
const OUTER = 6
const INNER = 4

let lock: KeyItem
const lockOf = (k: KeyItem = lock) => ({ pubkey: k.itemPubkey, label: k.name })
const named = (name: string): MyDeployment => S().mine.find((d) => d.chest?.name === name)!
const textRow = (text: string): MyDeployment => S().mine.find((d) => d.text === text)!
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }

/** SEAL A DOOR hidden at `hide`, its own room at `room`. */
async function sealDoor(name: string, hide: number, room: number | null = null): Promise<MyDeployment> {
  S().startPlaceDoor()
  S().setDeployHeight(hide)
  S().setDeployDoorHeight(room)
  S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(), requires: 'the Silver Key', contents: [] })
  expect(S().deployError).toBeNull()
  return named(name)
}

async function hide(text: string, h: number): Promise<MyDeployment> {
  S().startDeployMessage(text)
  S().setDeployHeight(h)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return textRow(text)
}

const asFound = (d: MyDeployment): Hidden => ({ eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: d.inner.pubkey, at: positionOf(d), plane: d.plane, height: d.height, createdAt: d.createdAt, type: 'chest', chest: d.chest, ...(d.room ? { room: d.room } : {}) })

beforeEach(() => {
  relay.events = []
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a door inside a room (R6)', () => {
  it('hidden at the outer door’s height, its own room lower: sealed behind the outer door', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    expect(inner.room).toEqual({ doorId: outer.eventId })
    expect(inner.height).toBe(OUTER)
    expect(inner.chest?.door).toBe(INNER)
    expect(inner.inner.tags.find((t) => t[0] === 'door')).toEqual(['door', String(INNER)])
    expect(doorSecret(me(), inner.eventId)).not.toBe(doorSecret(me(), outer.eventId))
    expect(behindDoor(S().mine, outer).map((d) => d.eventId)).toEqual([inner.eventId])
  })

  it('at the same height it joins the room rather than entering it (R5)', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const second = await sealDoor('Second', OUTER)
    expect(second.room).toBeUndefined()
    expect(doorSecret(me(), second.eventId)).toBe(doorSecret(me(), outer.eventId))
  })

  it('a door’s room is never above the height it is hidden at', () => {
    expect(effectiveDoorHeight(null, 6)).toBe(6)
    expect(effectiveDoorHeight(4, 6)).toBe(4)
    expect(effectiveDoorHeight(8, 6)).toBe(6)
  })

  it('a lower room in no room of yours: an ordinary placement, at the height it is hidden at', async () => {
    const d = await sealDoor('Lone', OUTER, INNER)
    expect(d.room).toBeUndefined()
    expect(d.height).toBe(OUTER)
    expect(d.chest?.door).toBe(INNER)
  })
})

describe('heights never compete (4.5)', () => {
  it('each placement goes to the door of the height it is at, or to no door at all', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    const at = deployPoint(CURSOR, buildStepOf(C()), OUTER)
    S().startDeployMessage('x')
    expect(sealingDoor(S(), me(), at, inner.plane, OUTER)?.name).toBe('Outer')
    expect(sealingDoor(S(), me(), at, inner.plane, INNER)?.name).toBe('Inner')
    expect(sealingDoor(S(), me(), at, inner.plane, INNER - 1)).toBeNull()
    S().cancelDeploy()
    expect((await hide('inner one', INNER)).room).toEqual({ doorId: inner.eventId })
    expect((await hide('outer one', OUTER)).room).toEqual({ doorId: outer.eventId })
    // Inside the outer cube, outside the inner: no door at the inner's height here.
    goTo({ ...CURSOR, x: CURSOR.x + (1n << BigInt(INNER)) })
    expect((await hide('beside it', INNER)).room).toBeUndefined()
    expect((await hide('in the outer', OUTER)).room).toEqual({ doorId: outer.eventId })
  })
})

describe('a finder opens them in turn (§3.7.6)', () => {
  it('the outer room shows the inner door, closed; its own room opens only with its own secret', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    await hide('deep inside', INNER)
    const seen = await openRoom(asFound(outer), doorSecret(me(), outer.eventId)!)
    expect(seen.items.map((h) => h.chest?.name)).toEqual(['Inner'])
    const found = seen.items[0]
    expect(found.room).toEqual({ doorId: outer.eventId })
    expect(found.keyHex).not.toBe(asFound(outer).keyHex)
    const secret = doorSecretWithKey(found.chest!, lock.secretHex)!
    expect(secret).toBe(doorSecret(me(), inner.eventId))
    const behind = await openRoom(found, secret)
    expect(behind.found).toBe(true)
    expect(behind.items.map((h) => h.text)).toEqual(['deep inside'])
    expect(behind.items[0].height).toBe(INNER)
  })

  it('nothing behind the inner door is in the outer room bag', async () => {
    const outer = await sealDoor('Outer', OUTER)
    await sealDoor('Inner', OUTER, INNER)
    await hide('deep inside', INNER)
    const seen = await openRoom(asFound(outer), doorSecret(me(), outer.eventId)!)
    expect(seen.items.some((h) => h.text === 'deep inside')).toBe(false)
  })
})

describe('the red cube’s lines (4.4, R6)', () => {
  it('one line at the top level, two inside a room, three inside that', async () => {
    const a = await sealDoor('A', 8)
    const b = await sealDoor('B', 8, OUTER)
    const c = await sealDoor('C', OUTER, INNER)
    expect(c.room).toEqual({ doorId: b.eventId })
    expect(doorDepth(S().mine, a)).toBe(1)
    expect(doorDepth(S().mine, b)).toBe(2)
    expect(doorDepth(S().mine, c)).toBe(3)
    const lines = roomOutlines(S().mine, me(), true, a.plane).map((o) => [o.name, o.depth])
    expect(lines.sort()).toEqual([['A', 1], ['B', 2], ['C', 3]])
    expect(roomLines(1)).toHaveLength(1)
    expect(roomLines(2)).toHaveLength(2)
    expect(roomLines(3)).toHaveLength(3)
    expect(roomLines(3)[0]).toBe(1)
    expect(roomLines(3)[1]).toBeLessThan(1)
    // A room's outline is as deep as the deepest of its doors: a second door of B's room, at the top level.
    const sibling = await sealDoor('B too', OUTER)
    expect(sibling.chest?.door).toBe(OUTER)
    expect(doorDepth(S().mine, sibling)).toBe(1)
    // Whichever of the room's rows comes first.
    for (const rows of [S().mine, [...S().mine].reverse()]) {
      expect(roomOutlines(rows, me(), true, a.plane).filter((o) => o.height === OUTER).map((o) => o.depth)).toEqual([2])
    }
    // Only for you, only while building (R8).
    expect(roomOutlines(S().mine, me(), false, a.plane)).toEqual([])
  })
})

describe('MOVE, DELETE and EDIT with a door behind a door', () => {
  it('MOVE of a nested door whose outer secret is not known here: refused; it never lands in the public bag, nor strips that bag\u2019s tags', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    const place = deployPoint(CURSOR, buildStepOf(C()), OUTER)
    const ordinaryBefore = relay.events.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === outer.lookupId)).length
    localStorage.setItem('onosendai:door-secrets', JSON.stringify({ [me()]: { [inner.eventId]: doorSecret(me(), inner.eventId) } }))
    resetDoorSecrets()
    S().startMoveChest(inner.eventId)
    expect(sealingDoor(S(), me(), place, inner.plane, OUTER)?.secret).toBeNull()
    goTo({ ...CURSOR, x: CURSOR.x + 2n })
    await S().deploy()
    expect(S().deployError).toMatch(/OPEN it first/)
    expect(named('Inner').eventId).toBe(inner.eventId)
    expect(relay.events.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === outer.lookupId))).toHaveLength(ordinaryBefore)
    S().cancelDeploy()
  })

  it('MOVE: inside its own cube it stays behind the outer door; out of it, refused', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    const behind = await hide('deep inside', INNER)
    S().startMoveChest(inner.eventId)
    goTo({ ...CURSOR, x: CURSOR.x + 2n })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const moved = named('Inner')
    expect(moved.eventId).not.toBe(inner.eventId)
    expect(moved.room).toEqual({ doorId: outer.eventId })
    expect(moved.lookupId).toBe(inner.lookupId)
    expect(textRow('deep inside').room).toEqual({ doorId: moved.eventId })
    expect(behind.lookupId).toBe(textRow('deep inside').lookupId)
    S().startMoveChest(moved.eventId)
    goTo({ ...CURSOR, x: CURSOR.x + (1n << BigInt(INNER)) })
    await S().deploy()
    expect(S().deployError).toMatch(/only inside its own room/)
    S().cancelDeploy()
  })

  it('DELETE the outer, switch on: the inner door and what is behind it go too, and no room bag is left', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    const deep = await hide('deep inside', INNER)
    await hide('outer thing', OUTER)
    expect(behindDoorDeep(S().mine, outer)).toHaveLength(3)
    expect(behindDoor(S().mine, outer)).toHaveLength(2)
    const outerRoom = behindDoor(S().mine, outer)[0].lookupId
    expect(await S().deleteDoor(outer.eventId, true)).toBeNull()
    expect(S().mine).toEqual([])
    for (const lookup of [outerRoom, deep.lookupId]) {
      expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[1] === `${HIDDEN_KIND}:${me()}:${lookup}`))).toBe(true)
    }
    expect(inner.eventId).toBeTruthy()
  })

  it('DELETE the outer, switch off: the inner door stands in the ordinary bag, closed, its room untouched', async () => {
    const outer = await sealDoor('Outer', OUTER)
    await sealDoor('Inner', OUTER, INNER)
    await hide('deep inside', INNER)
    expect(await S().deleteDoor(outer.eventId, false)).toBeNull()
    const now = named('Inner')
    expect(now.room).toBeUndefined()
    expect(now.bag?.heightTag).toBe(true)
    expect(now.chest?.door).toBe(INNER)
    expect(textRow('deep inside').room).toEqual({ doorId: now.eventId })
    const behind = await openRoom(asFound(now), doorSecret(me(), now.eventId)!)
    expect(behind.items.map((h) => h.text)).toEqual(['deep inside'])
  })

  it('EDIT the outer’s lock: only the outer room rotates; the inner door moves with it, its own secret and room untouched', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    const deep = await hide('deep inside', INNER)
    const innerSecret = doorSecret(me(), inner.eventId)
    const outerSecret = doorSecret(me(), outer.eventId)
    const next = forgeKey('New Key')
    expect(await S().resealDoor(outer.eventId, { name: 'Outer', requires: 'the New Key', lock: lockOf(next) })).toBeNull()
    const nowOuter = named('Outer')
    expect(doorSecret(me(), nowOuter.eventId)).not.toBe(outerSecret)
    const nowInner = named('Inner')
    expect(nowInner.room).toEqual({ doorId: nowOuter.eventId })
    expect(doorSecret(me(), nowInner.eventId)).toBe(innerSecret)
    expect(textRow('deep inside').lookupId).toBe(deep.lookupId)
    expect(chestItemOf(nowInner.inner)?.door).toBe(INNER)
    const seen = await openRoom(asFound(nowOuter), doorSecret(me(), nowOuter.eventId)!)
    expect(seen.items.map((h) => h.chest?.name)).toEqual(['Inner'])
  })

  it('EDIT the inner’s name: resealed in the outer room bag', async () => {
    const outer = await sealDoor('Outer', OUTER)
    const inner = await sealDoor('Inner', OUTER, INNER)
    expect(await S().resealDoor(inner.eventId, { name: 'Renamed', requires: '', lock: lockOf() })).toBeNull()
    const seen = await openRoom(asFound(named('Outer')), doorSecret(me(), outer.eventId)!)
    expect(seen.items.map((h) => h.chest?.name)).toEqual(['Renamed'])
  })
})
