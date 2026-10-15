/**
 * shardPaste.test.ts - COPY on a shard in MENU fills the bench's clipboard,
 * so the ordinary PASTE puts that whole shard's geometry down in any shard
 * (arkinox, 2026-10-08): every point with its ticks and color, every face
 * with its seam, every placed object with its reference, selected and
 * undoable in one step, at the copied shard's true size.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, ticksOf, type ShardModel } from 'sno-core/shards'
import { ownAddress, useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()
const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const COLUMN = { v: 2, name: 'Column', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 4, 0]], colors: [5, 5, 5], faces: [[0, 1, 2]] }
const ref = (d: string): ['a', string] => ['a', `33331:${PK}:${d}`]

/** Place a published object (by reference) in the current shard, at `at`, facing the stamp's way. */
function place(d: string, at: [number, number, number]): void {
  w().setStampObject({ ref: ref(d), name: d, shard: fromPayload(COLUMN, d)! })
  w().placeObject(at)
}

const byId = (id: string): ShardModel => w().shards.find((s) => s.id === id)!

/**
 * A source worth copying: a stamped block (eight corners, twelve faces), one
 * face given a hard seam, a point a third of a unit off the grid lines, and
 * two placed objects, one of them placed twice.
 */
function buildSource(): string {
  const id = w().create('source')
  w().setColor([1, 0, 0])
  w().placeStamp([0, 0, 0])
  w().colorFace(3, [0, 0, 1])
  w().setColor([0, 1, 0])
  w().addVertex([40, 2 * T + 80, -40])
  w().turnStamp()
  place('column', [3 * T, 0, 0])
  place('arch', [-2 * T, 0, T])
  place('column', [0, 0, 4 * T])
  return id
}

describe('shard COPY into the bench clipboard', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFace: null, facePick: [], clip: null, level: 0, plane: 1, past: [], future: [], notice: null, tool: 'select', stampKind: 'block', stampSize: 2, stampFacing: 0, stampMode: 'shape', stampObject: null })
  })

  it('PASTE in another shard puts down identical geometry, selected, and one UNDO takes it all back', () => {
    const src = byId(buildSource())
    expect(w().copyShard(src)).toBe(true)

    // The target already has a point, so every index the paste writes is offset by one.
    w().create('target')
    w().addVertex([5 * T, 0, 5 * T])
    const before = w().current()!
    w().pasteClip('exact')
    const s = w().current()!

    // Every point on its exact ticks, sub-unit ones included, with its color.
    expect(s.vertices).toHaveLength(1 + src.vertices.length)
    expect(s.vertices.slice(1).map(ticksOf)).toEqual(src.vertices.map(ticksOf))
    expect(s.vertices.slice(1).map((v) => v.c)).toEqual(src.vertices.map((v) => v.c))
    // Every face, pointing at the pasted copies, and the seam kept on its face.
    expect(s.faces).toEqual(src.faces.map((f) => f.map((i) => i + 1)))
    expect(s.facecolors).toHaveLength(s.faces.length)
    expect(s.facecolors).toEqual(src.facecolors)
    expect(s.mode).toBe('solid')

    // Selected, exactly as a pasted selection is, ready for the nudges.
    expect(w().selection).toEqual(src.vertices.map((_, k) => 1 + k))
    expect(w().partSel).toEqual([0, 1, 2])

    // One step.
    w().undo()
    expect(w().current()).toEqual(before)
  })

  it('keeps every placed object and the reference it names', () => {
    const src = byId(buildSource())
    w().copyShard(src)
    w().create('target')
    // The target already places one of the same objects, so refs are shared, not repeated.
    place('arch', [T, 0, T])
    w().pasteClip('exact')
    const s = w().current()!
    const targets = (q: ShardModel): string[] => (q.parts ?? []).map((p) => q.refs![p.ref][1])
    expect(targets(s)).toEqual([ref('arch')[1], ...targets(src)])
    expect(s.refs).toHaveLength(2)
    expect(s.parts!.slice(1).map(({ at, turn, step }) => ({ at, turn, step }))).toEqual(src.parts!.map(({ at, turn, step }) => ({ at, turn, step })))
    expect(w().partSel).toEqual([1, 2, 3])
  })

  it('PASTE into the shard it was copied from duplicates it in place, the copy alone selected', () => {
    const id = buildSource()
    const src = byId(id)
    w().copyShard(src)
    w().pasteClip('exact')
    const s = byId(id)
    const n = src.vertices.length
    expect(s.vertices.slice(n).map(ticksOf)).toEqual(src.vertices.map(ticksOf))
    expect(s.faces).toHaveLength(src.faces.length * 2)
    expect(s.parts).toHaveLength(src.parts!.length * 2)
    expect(s.refs).toHaveLength(src.refs!.length)
    expect(w().selection).toEqual(src.vertices.map((_, k) => n + k))
    expect(w().partSel).toEqual([3, 4, 5])
  })

  it('refuses a paste that would make a shard place itself', () => {
    // The target is published as 33331:PK:<id>; the copied shard places it.
    const target = w().create('target')
    w().addVertex([0, 0, 0])
    w().create('source')
    place(target, [T, 0, 0])
    w().copyShard(w().current()!)

    w().select(target)
    const before = w().current()!
    w().pasteClip('exact', ownAddress(PK, target))
    expect(w().notice).toMatch(/cannot place itself/)
    expect(w().current()).toEqual(before)
    expect(w().past).toHaveLength(0)
  })

  it('keeps the true size: a target on another unit gets the points scaled, an empty one takes the unit', () => {
    const src = w().create('big')
    w().setUnit(3)
    w().addVertex([T, 0, 0]); w().addVertex([0, 2 * T, 0])
    w().copyShard(byId(src))

    // An empty shard has nothing for its unit to measure, so it takes the source's, and the points as they are.
    w().create('empty')
    w().pasteClip('exact')
    expect(w().current()!.unit).toBe(3)
    expect(w().current()!.vertices.map(ticksOf)).toEqual([[T, 0, 0], [0, 2 * T, 0]])

    // A shard already built at unit 2 keeps its unit; the points come twice as far out.
    w().create('half')
    w().setUnit(2)
    w().addVertex([0, 0, 0])
    w().pasteClip('exact')
    expect(w().current()!.unit).toBe(2)
    expect(w().current()!.vertices.slice(1).map(ticksOf)).toEqual([[2 * T, 0, 0], [0, 4 * T, 0]])
  })

  it('grows the grid to hold a whole shard, and a plain selection still asks for it', () => {
    const src = w().create('wide')
    w().setExtent(20)
    w().addVertex([15 * T, 0, 0])
    w().copyShard(byId(src))
    w().create('small')
    expect(w().current()!.extent).toBe(8)
    w().pasteClip('exact')
    expect(w().current()!.extent).toBe(15)
    expect(ticksOf(w().current()!.vertices[0])).toEqual([15 * T, 0, 0])

    // The same point copied as a selection is refused off the grid, as it always was.
    w().select(src)
    w().setSelection([0])
    w().copySelection()
    w().create('small too')
    w().pasteClip('exact')
    expect(w().current()!.vertices).toHaveLength(0)
    expect(w().notice).toMatch(/off the grid/)
  })

  it('an empty shard puts nothing on the clipboard', () => {
    w().create('empty')
    expect(w().copyShard(w().current()!)).toBe(false)
    expect(w().clip).toBeNull()
  })
})
