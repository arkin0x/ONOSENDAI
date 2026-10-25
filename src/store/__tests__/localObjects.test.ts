/**
 * localObjects.test.ts - your own objects placed by reference are drawn from
 * your workshop in authoring views, and only there (store/localObjects.ts,
 * lib/parts.ts fetchOwnFirst and OwnPartsContext).
 *
 * The case is arkinox's (2026-10-25): the Maze Kit imported with PUBLISH off,
 * so its flooded rooms place a room and its water at addresses of his that no
 * relay holds, and the bench drew a placeholder cube for each ("we never
 * published the parts and i dont want to"). The bench now draws them; the
 * world, WALK and items draw what the relays hold, as everyone else sees it
 * ("A. inline SNO fixes this once it ships because then everyone sees the
 * same data").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

// A `d` in `slow` waits for `open()` before the relays answer: a part on a slow relay.
const relay = vi.hoisted(() => ({ asked: [] as Array<Record<string, unknown>>, slow: new Set<string>(), open: () => {}, gate: Promise.resolve() }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async (_relays: string[], filter: Record<string, unknown>) => {
    relay.asked.push(filter)
    if (relay.slow.has((filter['#d'] as string[] | undefined)?.[0] ?? '')) await relay.gate
    return []
  }),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement, type ReactElement } from 'react'
import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { readItem } from '../../lib/hidden'
import { keepOwnTable } from '../../lib/carried'
import { resolveParts } from 'sno-core/parts'
import { OwnPartsContext, fetchOwnFirst, fetchRef, forgetRef, onLocalObjects, primeRef, resolvePartsShared, touchedKeys, useResolved } from '../../lib/parts'
import { authoredConstrainOf, withConstrain } from '../../lib/walkConstrain'
import { thumbKeyOf } from '../../lib/thumbKey'
import { useItemModel } from '../../hooks/useItemModel'
import { mountHook, settle } from '../../test/hookRoot'
import { useWorkshop } from '../useWorkshop'
import { useCyberspace } from '../useCyberspace'
import { usePublished } from '../usePublished'
import { changedIds, flushLocalObjects, ownThumbKey, wireLocalObjects } from '../localObjects'
import { clearWalls, entryFor, type WallItem } from '../walkWalls'

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)
const ROOM_ID = 'maze-kit/cistern/cistern-atrium'
const WATER_ID = 'maze-kit/cistern/cistern-atrium-water-low'
const FLOODED_ID = 'maze-kit/cistern/flooded/cistern-atrium-flooded-low'
const ROOM = `a:33331:${ME}:${ROOM_ID}`
const WATER = `a:33331:${ME}:${WATER_ID}`

const addr = (pubkey: string, d: string): Ref => ['a', `33331:${pubkey}:${d}`]
const tri = (name: string, y = 0): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, y, 0], c: [1, 1, 1] }, { p: [1, y, 0], c: [1, 1, 1] }, { p: [0, y, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
/** A shard placing `refs` at the origin, one placement each, as a flooded room places its room and its water. */
const placing = (name: string, refs: Ref[]): ShardModel => ({
  ...newShard(name), mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })),
})
/** Inside the bench, as Bench.tsx provides it. */
const bench = (el: ReactElement): ReactElement => createElement(OwnPartsContext.Provider, { value: true }, el)

const w = () => useWorkshop.getState()
let unwire: () => void = () => {}

beforeEach(() => {
  relay.asked = []
  relay.slow = new Set()
  relay.gate = new Promise<void>((r) => { relay.open = r })
  // A slow fetch an earlier test left waiting is not this test's.
  forgetRef(addr(THEM, 'slow'))
  for (const id of [ROOM_ID, WATER_ID, FLOODED_ID]) forgetRef(addr(ME, id))
  usePublished.setState({ ledger: {} })
  clearWalls()
  useCyberspace.setState({ identity: { pubkey: ME, npub: 'npub-me' } })
  useWorkshop.setState({ shards: [], currentId: null })
  // As the zip import leaves them: each piece under its stable id, the flooded room naming both under your key.
  w().addShard(withConstrain(tri('Atrium'), 'all'), 'Atrium', ROOM_ID)
  w().addShard(withConstrain({ ...tri('Water'), opacity: 40 }, 'off'), 'Water', WATER_ID)
  w().addShard(placing('Atrium flooded low', [addr(ME, ROOM_ID), addr(ME, WATER_ID)]), 'Atrium flooded low', FLOODED_ID)
  unwire = wireLocalObjects()
})
afterEach(() => unwire())

const flooded = (): ShardModel => w().shards.find((s) => s.id === FLOODED_ID)!
const asked = (): string[] => relay.asked.map((f) => (f['#d'] as string[] | undefined)?.[0] ?? '')

describe('the bench and the workshop: your own unpublished pieces', () => {
  it('without the workshop answering, they go to the relays and come back placeholders (the bug)', async () => {
    unwire()
    const placed = await resolveParts(flooded(), fetchOwnFirst)
    expect(placed.map((p) => p.missing)).toEqual(['unreachable', 'unreachable'])
    expect(asked()).toContain(ROOM_ID)
  })

  it('resolve from the workshop, each keeping its own opacity and WALK setting, and no relay is asked', async () => {
    const placed = await resolveParts(flooded(), fetchOwnFirst)
    expect(placed.map((p) => p.missing)).toEqual([undefined, undefined])
    expect(placed.map((p) => p.model?.name)).toEqual(['Atrium', 'Water'])
    const water = placed[1].model!
    expect(water.opacity).toBe(40)
    expect(authoredConstrainOf(water)).toBe('off')
    expect(authoredConstrainOf(placed[0].model!)).toBe('all')
    expect(relay.asked).toEqual([])
  })

  it('are drawn as last edited here, ahead of anything a relay or the cache holds', async () => {
    primeRef(addr(ME, ROOM_ID), { v: 2, name: 'Atrium as published', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], colors: [1, 1, 1], faces: [[0, 1, 2]] })
    expect((await resolveParts(flooded(), fetchOwnFirst))[0].model?.name).toBe('Atrium')
    // The world, meanwhile, draws what was published.
    expect((await resolveParts(flooded(), fetchRef))[0].model?.name).toBe('Atrium as published')
  })

  it('an edit is said once a frame, with the address of what changed, and the next draw has it at any depth', async () => {
    const maze = placing('Maze', [addr(ME, FLOODED_ID)])
    const before = await resolveParts(maze, fetchOwnFirst)
    expect(before[0].children[1].model?.opacity).toBe(40)
    expect(touchedKeys(before).has(WATER)).toBe(true)
    const heard: string[][] = []
    const off = onLocalObjects((keys) => heard.push([...keys]))
    w().select(WATER_ID)
    w().setOpacity(70)
    w().setOpacity(71)
    w().setOpacity(70)
    expect(heard).toHaveLength(0)
    flushLocalObjects()
    off()
    expect(heard).toEqual([[WATER]])
    expect((await resolveParts(maze, fetchOwnFirst))[0].children[1].model?.opacity).toBe(70)
  })

  it('a removed piece goes back to the relays', async () => {
    w().remove(WATER_ID)
    const placed = await resolveParts(flooded(), fetchOwnFirst)
    expect(placed.map((p) => p.missing)).toEqual([undefined, 'unreachable'])
    expect(asked()).toEqual([WATER_ID])
  })

  it('a loop is drawn once and then missing, and placements past four levels are missing', async () => {
    w().addShard(placing('Loop A', [addr(ME, 'loop-b')]), 'Loop A', 'loop-a')
    w().addShard(placing('Loop B', [addr(ME, 'loop-a')]), 'Loop B', 'loop-b')
    const [b] = await resolvePartsShared(w().shards.find((s) => s.id === 'loop-a')!, fetchOwnFirst, addr(ME, 'loop-a'))
    expect(b.model?.name).toBe('Loop B')
    expect(b.children[0].missing).toBe('cycle')
    for (let i = 1; i <= 6; i++) w().addShard(placing(`Deep ${i}`, [addr(ME, `deep-${i + 1}`)]), `Deep ${i}`, `deep-${i}`)
    w().addShard(tri('Bottom'), 'Bottom', 'deep-7')
    let p = (await resolvePartsShared(w().shards.find((s) => s.id === 'deep-1')!, fetchOwnFirst))[0]
    const seen: string[] = []
    while (p) { seen.push(p.missing ?? p.model!.name); p = p.children[0] }
    expect(seen).toEqual(['Deep 2', 'Deep 3', 'Deep 4', 'Deep 5', 'deep'])
  })
})

describe('a mounted draw (useResolved)', () => {
  it('on the bench: resolves locally, redraws after an edit, and an unchanged sibling keeps its model object', async () => {
    const h = mountHook(useResolved, flooded(), bench)
    await settle()
    const before = h.current()
    expect(before.get(WATER)?.model?.opacity).toBe(40)
    const room = before.get(ROOM)!.model!
    w().select(WATER_ID)
    w().setOpacity(70)
    flushLocalObjects()
    await settle()
    const after = h.current()
    expect(after).not.toBe(before)
    expect(after.get(WATER)?.model?.opacity).toBe(70)
    // The same object, so its mesh keeps its geometry: nothing is built again for it.
    expect(after.get(ROOM)!.model).toBe(room)
    expect(relay.asked).toEqual([])
    await h.unmount()
  })

  it('in the world (no provider): your unpublished pieces go to the relays and are placeholders, and an edit redraws nothing', async () => {
    const h = mountHook(useResolved, flooded())
    await settle()
    const got = h.current()
    expect([got.get(ROOM)?.missing, got.get(WATER)?.missing]).toEqual(['unreachable', 'unreachable'])
    expect(asked().sort()).toEqual([ROOM_ID, WATER_ID].sort())
    const renders = h.renders()
    w().select(WATER_ID)
    w().setOpacity(70)
    flushLocalObjects()
    await settle()
    expect(h.renders()).toBe(renders)
    await h.unmount()
  })

  it('on the bench: does not redraw for an edit of something it does not place', async () => {
    const h = mountHook(useResolved, flooded(), bench)
    await settle()
    const before = h.current()
    w().addShard(tri('Elsewhere'), 'Elsewhere', 'elsewhere')
    w().select('elsewhere')
    w().setOpacity(50)
    flushLocalObjects()
    await settle()
    expect(h.current()).toBe(before)
    await h.unmount()
  })

  it('on the bench: an edit while a resolve waits on a slow relay part is not lost', async () => {
    relay.slow.add('slow')
    // A maze placing someone's slow part and your flooded room: the water is two levels down.
    const maze = placing('Maze', [addr(THEM, 'slow'), addr(ME, FLOODED_ID)])
    const h = mountHook(useResolved, maze, bench)
    await settle()
    expect(h.current().size).toBe(0)
    w().select(WATER_ID)
    w().setOpacity(70)
    flushLocalObjects()
    await settle()
    relay.open()
    await settle()
    expect(h.current().get(`a:33331:${ME}:${FLOODED_ID}`)!.children[1].model?.opacity).toBe(70)
    await h.unmount()
  })

  it('places nothing and listens for nothing without references', async () => {
    const h = mountHook(useResolved, null, bench)
    await settle()
    const renders = h.renders()
    w().select(WATER_ID)
    w().setOpacity(70)
    flushLocalObjects()
    await settle()
    expect(h.renders()).toBe(renders)
    expect(h.current().size).toBe(0)
    await h.unmount()
  })
})

describe('world surfaces never use the workshop', () => {
  it('fetchRef (the world, the feeds, the OBJECT picker) asks the relays for your own unpublished piece', async () => {
    expect(await fetchRef(addr(ME, ROOM_ID))).toBeNull()
    expect(relay.asked).toEqual([{ kinds: [33331], authors: [ME], '#d': [ROOM_ID] }])
  })

  it("WALK's walls resolve from the relays: your unpublished pieces stop nothing, and an edit leaves the walls alone", async () => {
    const it0: WallItem = { key: 'flooded', at: { x: 1n << 60n, y: 1n << 60n, z: 1n << 60n }, height: 84, plane: 1, shard: flooded() }
    entryFor(it0)
    await settle()
    const built = entryFor(it0)
    expect(built.missingAt).not.toBeNull()
    expect(asked().sort()).toEqual([ROOM_ID, WATER_ID].sort())
    w().select(WATER_ID)
    w().setOpacity(70)
    flushLocalObjects()
    expect(entryFor(it0)).toBe(built)
  })

  it('an item wearing your unpublished object is drawn from the relays (the cube until it is published)', async () => {
    const h = mountHook(useItemModel, { address: `33331:${ME}:${FLOODED_ID}` })
    await settle()
    expect(h.current()).toBeNull()
    expect(asked()).toContain(FLOODED_ID)
    await h.unmount()
  })
})

describe('the workshop pictures (ownThumbKey)', () => {
  it('a shard of yours placing your pieces gets a key that changes when a piece is edited', () => {
    const k1 = ownThumbKey(flooded())
    expect(k1).not.toBe(thumbKeyOf(flooded()))
    w().select(WATER_ID)
    w().setOpacity(70)
    const k2 = ownThumbKey(flooded())
    expect(k2).not.toBe(k1)
    // Two levels down too.
    const maze = placing('Maze', [addr(ME, FLOODED_ID)])
    const m1 = ownThumbKey(maze)
    w().setOpacity(55)
    expect(ownThumbKey(maze)).not.toBe(m1)
  })

  it("is the shape's key when nothing it places is yours here", () => {
    const theirs = placing('Theirs', [addr(THEM, ROOM_ID)])
    expect(ownThumbKey(theirs)).toBe(thumbKeyOf(theirs))
    expect(ownThumbKey(tri('Plain'))).toBe(thumbKeyOf(tri('Plain')))
  })
})

describe('what is answered here at all', () => {
  it("someone else's reference, even to a d you also hold, still goes to the relays", async () => {
    const placed = await resolveParts(placing('Theirs', [addr(THEM, ROOM_ID)]), fetchOwnFirst)
    expect(placed[0].missing).toBe('unreachable')
    expect(relay.asked).toEqual([{ kinds: [33331], authors: [THEM], '#d': [ROOM_ID] }])
  })

  it('a change of identity says every shard changed, under both keys, and the old key is no longer answered', async () => {
    const heard: string[] = []
    const off = onLocalObjects((keys) => heard.push(...keys))
    useCyberspace.setState({ identity: { pubkey: THEM, npub: 'npub-them' } })
    flushLocalObjects()
    off()
    for (const id of [ROOM_ID, WATER_ID, FLOODED_ID]) {
      expect(heard).toContain(`a:33331:${ME}:${id}`)
      expect(heard).toContain(`a:33331:${THEM}:${id}`)
    }
    const placed = await resolveParts(flooded(), fetchOwnFirst)
    expect(placed.map((p) => p.missing)).toEqual(['unreachable', 'unreachable'])
  })

  it('a shard published under another key is not answered for this one (kit ids are the same for everyone)', async () => {
    usePublished.setState({ ledger: { [ROOM_ID]: { at: 1, fp: '', pubkey: THEM } } })
    const placed = await resolveParts(flooded(), fetchOwnFirst)
    expect(placed.map((p) => p.missing)).toEqual(['unreachable', undefined])
  })

  it('an `e` reference names one signed event and is never answered here', async () => {
    const e: Ref = ['e', 'c'.repeat(64)]
    expect(await fetchOwnFirst(e)).toBeNull()
    expect(relay.asked).toEqual([{ ids: ['c'.repeat(64)] }])
  })
})

describe('changedIds', () => {
  it('names what was added, edited or removed, and nothing else', () => {
    const a = tri('A'), b = tri('B'), c = tri('C')
    const b2 = { ...b, name: 'B2' }
    expect(changedIds([a, b, c], [a, b2]).sort()).toEqual([b.id, c.id].sort())
    expect(changedIds([a], [a, c])).toEqual([c.id])
    expect(changedIds([a, b], [a, b])).toEqual([])
  })
})

describe('carried objects (DECK-0003 §1.10 objects)', () => {
  /** The flooded room carrying copies of its two pieces, as a hide writes it. */
  const carrying = (water = { ...toPayload(tri('Carried water')), opacity: 25 }): ShardModel => ({
    ...flooded(),
    objects: { [`33331:${ME}:${ROOM_ID}`]: toPayload(tri('Carried room')), [`33331:${ME}:${WATER_ID}`]: water },
  })

  it('on the bench, a carried copy wins over the workshop piece of the same address, and no relay is asked', async () => {
    const h = mountHook(useResolved, carrying(), bench)
    await settle()
    expect(h.current().get(WATER)?.model?.name).toBe('Carried water')
    expect(h.current().get(WATER)?.model?.opacity).toBe(25)
    expect(h.current().get(WATER)?.carried).toBe(true)
    expect(relay.asked).toEqual([])
    await h.unmount()
  })

  it('in the world, the carried pieces are drawn for everyone, and their names are never asked of a relay', async () => {
    const h = mountHook(useResolved, carrying())
    await settle()
    expect([h.current().get(ROOM)?.model?.name, h.current().get(WATER)?.model?.name]).toEqual(['Carried room', 'Carried water'])
    expect(relay.asked).toEqual([])
    await h.unmount()
    const it0: WallItem = { key: 'carried', at: { x: 1n << 60n, y: 1n << 60n, z: 1n << 60n }, height: 84, plane: 1, shard: carrying() }
    entryFor(it0)
    await settle()
    expect(entryFor(it0).missingAt).toBeNull()
    expect(relay.asked).toEqual([])
  })

  it('draws the parts again when the table changes, though the references do not', async () => {
    const h = mountHook(useResolved, carrying())
    await settle()
    expect(h.current().get(WATER)?.model?.opacity).toBe(25)
    await h.render(carrying({ ...toPayload(tri('Carried water')), opacity: 60 }))
    await settle()
    expect(h.current().get(WATER)?.model?.opacity).toBe(60)
    await h.unmount()
  })

  it('a key under another pubkey is ignored where the object is read from its event (D5)', () => {
    const raw = { ...toPayload(placing('P', [addr(THEM, 'x'), addr(ME, 'y')])), objects: { [`33331:${THEM}:x`]: toPayload(tri('X')), [`33331:${ME}:y`]: toPayload(tri('Y')) } }
    const ev = { kind: 3330, id: 'i', tags: [], content: JSON.stringify(raw) }
    expect(Object.keys(readItem({ ...ev, pubkey: ME })?.shard?.objects ?? {})).toEqual([`33331:${ME}:y`])
    expect(readItem({ ...ev, pubkey: THEM })?.shard?.objects).toEqual({ [`33331:${THEM}:x`]: toPayload(tri('X')) })
    expect(readItem(ev)?.shard?.objects).toBeUndefined()
    const m = carrying()
    expect(keepOwnTable(m, ME)).toBe(m)
  })

  it("a picture's key holds the table: a changed copy is a new picture", () => {
    expect(thumbKeyOf(carrying())).not.toBe(thumbKeyOf(flooded()))
    expect(thumbKeyOf(carrying({ ...toPayload(tri('W')), opacity: 60 }))).not.toBe(thumbKeyOf(carrying()))
  })

  it('an own picture key is never the world key once the shard names anything of yours, even with none of it here', () => {
    const elsewhere = placing('Elsewhere', [addr(ME, 'not-in-this-workshop')])
    expect(ownThumbKey(elsewhere)).not.toBe(thumbKeyOf(elsewhere))
  })

  it('on the bench, edits while a resolve waits ask the relays once more after it lands, not once per edit', async () => {
    relay.slow.add('slow')
    const maze = placing('Maze', [addr(THEM, 'empty'), addr(THEM, 'slow'), addr(ME, FLOODED_ID)])
    const h = mountHook(useResolved, maze, bench)
    await settle()
    w().select(WATER_ID)
    for (const o of [60, 61, 62]) { w().setOpacity(o); flushLocalObjects(); await settle() }
    relay.open()
    await settle()
    expect(asked().filter((d) => d === 'empty').length).toBe(2)
    expect(h.current().get(`a:33331:${ME}:${FLOODED_ID}`)!.children[1].model?.opacity).toBe(62)
    await h.unmount()
  })
})
