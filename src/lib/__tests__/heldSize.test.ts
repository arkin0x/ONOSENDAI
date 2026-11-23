/**
 * heldSize.test.ts - BY SIZE (owner, 2026-11-23, item 8): with it on, MOVE
 * steps what is held by its own size on each axis, so a 16x16x16 block moves
 * 16 gibsons a step; the keys, a handle's tap and a handle's drag alike, and
 * a turn pivots on the middle of what is held.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, ticksOf, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { useBenchResolved } from '../../store/heldSize'
import { heldBox, heldSize, sizeStep } from '../heldSize'

const w = () => useWorkshop.getState()
const cur = (): ShardModel => w().current()!
const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const NONE = new Map()

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, level: 0, plane: 1, past: [], future: [], notice: null, tool: 'select', stampKind: 'block', stampSize: 2, stampFacing: 0, stampMode: 'shape', stampObject: null, stepBySize: false })
})

describe('heldSize', () => {
  it('is the box around the held points, per axis, in ticks', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const all = cur().vertices.map((_, i) => i)
    const size = heldSize(cur(), all, [], NONE)!
    // A SIZE 2 block: two units every way.
    expect(size).toEqual([2 * T, 2 * T, 2 * T])
    expect(heldSize(cur(), [], [], NONE)).toBeNull()
  })

  it('a flat selection steps by the snap across its plane', () => {
    expect(sizeStep([3 * T, 0, 3 * T], 1, 60, true)).toBe(60)
    expect(sizeStep([3 * T, 0, 3 * T], 0, 60, true)).toBe(3 * T)
    expect(sizeStep([3 * T, 0, 3 * T], 0, 60, false)).toBe(60)
    expect(sizeStep(null, 0, 60, true)).toBe(60)
  })

  it('rounds a size up to whole snap steps, so a move never leaves the snap grid', () => {
    // A 16-unit piece turned 45 degrees is about 22.63 units wide: 23 units on a whole-unit snap.
    expect(sizeStep([Math.round(22.63 * T), 0, 0], 0, T, true)).toBe(23 * T)
    expect(sizeStep([16 * T, 0, 0], 0, T, true)).toBe(16 * T)
    expect(sizeStep([16 * T + 1, 0, 0], 0, T / 2, true)).toBe(16.5 * T)
  })

  it('a placed object counts as drawn: its own geometry where it stands, and a unit cube until it is read', () => {
    w().create('s')
    const block = fromPayload({ v: 2, name: 'Block', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [16, 0, 0], [0, 16, 0], [0, 0, -16]], colors: [5, 5, 5, 5], faces: [] }, 'block')!
    w().setStampObject({ ref: ['a', `33331:${PK}:block`], name: 'block', shard: block })
    w().placeObject([0, 0, 0])
    const resolved = new Map([[`a:33331:${PK}:block`, { model: block, children: [] }]])
    expect(heldSize(cur(), [], [0], resolved)).toEqual([16 * T, 16 * T, 16 * T])
    // Not read yet: a unit cube about where it stands.
    expect(heldSize(cur(), [], [0], NONE)).toEqual([T, T, T])
    // The block runs to model -16 on Z (the payload's +Z is the model's -Z): its box says exactly that.
    const box = heldBox(cur(), [], [0], resolved)!
    expect(box.min).toEqual([0, 0, 0])
    expect(box.max).toEqual([16 * T, 16 * T, 16 * T])
  })
})

describe('BY SIZE in the workshop', () => {
  /** A 16-unit block of points: a SIZE 2 stamp scaled up is awkward, so eight corners by hand. */
  function bigBlock(): void {
    w().create('kit')
    w().setExtent(40)
    for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) w().addVertex([x * T, y * T, z * T])
    useWorkshop.setState({ selection: cur().vertices.map((_, i) => i) })
  }

  it('off, a move steps by the snap; on, by the held size on that axis', () => {
    bigBlock()
    w().setStepBySize(false)
    expect(w().moveStep(0)).toBe(w().step())
    w().setStepBySize(true)
    expect(w().moveStep(0)).toBe(16 * T)
    expect(w().moveStep(1)).toBe(16 * T)
    expect(w().moveStep(2)).toBe(16 * T)
    w().moveSelected(0, w().moveStep(0))
    expect(Math.min(...cur().vertices.map((v) => ticksOf(v)[0]))).toBe(16 * T)
    // Nothing held: the snap.
    w().selectVertex(null)
    expect(w().moveStep(0)).toBe(w().step())
    w().setStepBySize(false)
  })

  it('a step that would carry what is held off the grid is refused, and says so', () => {
    bigBlock()
    w().setExtent(16)
    w().setStepBySize(true)
    const before = cur()
    w().moveSelected(0, w().moveStep(0))
    expect(cur()).toBe(before)
    expect(w().notice).toMatch(/off the grid\. GRID SIZE makes it bigger\./)
    w().setStepBySize(false)
  })

  it('is kept between visits', () => {
    w().setStepBySize(true)
    expect(localStorage.getItem('onosendai:workshop-by-size')).toBe('1')
    w().setStepBySize(false)
    expect(localStorage.getItem('onosendai:workshop-by-size')).toBe('0')
  })

  it('a placed object turns about the middle of what it draws, so a kit piece turns in place', () => {
    w().create('level')
    const corner = fromPayload({ v: 2, name: 'Corner', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [16, 0, 0], [0, 16, 0], [0, 0, -16], [16, 16, -16]], colors: [5, 5, 5, 5, 5], faces: [] }, 'corner')!
    w().setStampObject({ ref: ['a', `33331:${PK}:corner`], name: 'corner', shard: corner })
    w().placeObject([0, 0, 0])
    useBenchResolved.setState({ resolved: new Map([[`a:33331:${PK}:corner`, { model: corner, children: [] }]]) })
    w().selectPart(0)
    const before = heldBox(cur(), [], [0], useBenchResolved.getState().resolved)!
    w().setStepBySize(true)
    w().rotateSelected(1)
    const after = heldBox(cur(), [], [0], useBenchResolved.getState().resolved)!
    // Same footprint, same place: turned about its own middle.
    expect(after.min).toEqual(before.min)
    expect(after.max).toEqual(before.max)
    // Off, it turns about where it stands, and swings away.
    w().setStepBySize(false)
    w().rotateSelected(1)
    const swung = heldBox(cur(), [], [0], useBenchResolved.getState().resolved)!
    expect(swung.min).not.toEqual(before.min)
    useBenchResolved.setState({ resolved: new Map() })
  })
})
