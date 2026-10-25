/**
 * partEditView.test.ts - the edit view of a placed part (arkinox, 2026-10-25):
 * double-tap a part's box, ROOM > WATER, EXIT returns; you edit the copy
 * carried in the shard itself, and every placement of it there follows;
 * a live link is read-only there, with DETACH; UNDO and REDO reach inside.
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
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop, LIVE_LINK_NOTICE } from '../../store/useWorkshop'
import { fetchRef, primeRef } from '../../lib/parts'

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)
const tri = (name: string): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
const w = () => useWorkshop.getState()
const table = (): Record<string, Record<string, unknown>> => (w().rootShard()!.objects ?? {}) as Record<string, Record<string, unknown>>

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], stampMode: 'shape', stampObject: null, stampFacing: 0, inside: null, past: [], future: [] })
  w().addShard(tri('Water'), 'Water', 'kit/water')
  w().create('room')
  w().rename(w().currentId!, 'Room')
  // Two placements of one copy of the water.
  w().setStampObject({ ref: ['a', `33331:${ME}:kit/water`], name: 'Water', shard: tri('Water'), copy: { sourceId: 'kit/water', pubkey: ME } })
  w().placeObject([0, 0, 0])
  w().placeObject([240, 0, 0])
})

const copyAddress = (): string => w().rootShard()!.refs![0][1]

describe('a copy, edited in place', () => {
  it('opens a copy, edits it, and every placement of it in the shard follows; the room is untouched', async () => {
    await w().enterPart(1)
    expect(w().insidePath().map((s) => s.address)).toEqual([copyAddress()])
    expect(w().current()!.name).toBe('Water')
    w().setOpacity(30)
    expect(w().current()!.opacity).toBe(30)
    expect(table()[copyAddress()].opacity).toBe(30)
    const room = w().rootShard()!
    expect(room.parts!.map((p) => p.ref)).toEqual([0, 0])
    expect(room.vertices).toEqual([])
    // The workshop's piece is not linked to it.
    expect(w().shards.find((s) => s.id === 'kit/water')!.opacity).toBeUndefined()
  })

  it('UNDO and REDO reach inside, and the view stays open', async () => {
    await w().enterPart(0)
    w().setOpacity(30)
    w().undo()
    expect(table()[copyAddress()].opacity).toBeUndefined()
    expect(w().insidePath()).toHaveLength(1)
    w().redo()
    expect(table()[copyAddress()].opacity).toBe(30)
  })

  it('EXIT returns to the shard, and another shard is never inside', async () => {
    await w().enterPart(0)
    w().exitTo(0)
    expect(w().current()!.name).toBe('Room')
    await w().enterPart(0)
    w().select('kit/water')
    expect(w().current()!.name).toBe('Water')
    expect(w().insidePath()).toEqual([])
  })

  it('a copy stamped inside a copy goes into the shard\'s one table, and removing it keeps what the shard still places', async () => {
    w().addShard(tri('Reed'), 'Reed', 'kit/reed')
    w().select(w().shards.find((s) => s.name === 'Room')!.id)
    await w().enterPart(0)
    w().setStampObject({ ref: ['a', `33331:${ME}:kit/reed`], name: 'Reed', shard: tri('Reed'), copy: { sourceId: 'kit/reed', pubkey: ME } })
    w().placeObject([0, 120, 0])
    const keys = Object.keys(table())
    expect(keys).toHaveLength(2)
    expect(table()[copyAddress()].objects).toBeUndefined()
    // The water's own payload names the reed, and the room's table holds both.
    const reed = (table()[copyAddress()].refs as string[][])[0][1]
    expect(reed).toMatch(new RegExp(`^33331:${ME}:[0-9a-f]{16}$`))
    expect(table()[reed].name).toBe('Reed')
    // What the room reads back draws them both.
    const back = fromPayload(toPayload(w().rootShard()!), 'r')!
    expect(Object.keys(back.objects ?? {}).sort()).toEqual(keys.sort())
  })
})

describe('a live link, read-only, with DETACH', () => {
  const LINK = `33331:${THEM}:tile`
  beforeEach(() => {
    primeRef(['a', LINK, 'wss://relay.test'], toPayload({ ...tri('Tile'), opacity: 70 }))
    w().setStampObject({ ref: ['a', LINK, 'wss://relay.test'], name: 'Tile', shard: tri('Tile') })
    w().placeObject([0, 0, 240])
    w().placeObject([0, 0, 480])
  })

  it('opens as its author has it and refuses edits', async () => {
    await w().enterPart(2, fetchRef)
    expect(w().insidePath()[0].live?.name).toBe('Tile')
    const before = w().rootShard()
    w().setOpacity(20)
    expect(w().notice).toBe(LIVE_LINK_NOTICE)
    expect(w().rootShard()).toBe(before)
  })

  it('DETACH makes it a copy under your key, repoints every placement, and opens the copy; UNDO puts the link back', async () => {
    await w().enterPart(2, fetchRef)
    w().detachPart(ME)
    const room = w().rootShard()!
    // A copy under your key, at a d that says nothing about it, not the link's.
    const copy = room.refs!.find((r) => r[1] !== copyAddress() && new RegExp(`^33331:${ME}:[0-9a-f]{16}$`).test(r[1]))!
    expect(copy).toBeDefined()
    expect(room.refs!.some((r) => r[1] === LINK)).toBe(false)
    expect(room.parts!.filter((p) => room.refs![p.ref] === copy)).toHaveLength(2)
    expect(w().insidePath()).toEqual([{ address: copy[1] }])
    w().setOpacity(20)
    expect(table()[copy[1]].opacity).toBe(20)
    w().undo()
    w().undo()
    expect(w().rootShard()!.refs!.some((r) => r[1] === LINK)).toBe(true)
    expect(w().insidePath()).toEqual([])
  })
})
