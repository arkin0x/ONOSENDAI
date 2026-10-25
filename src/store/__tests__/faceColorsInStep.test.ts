/**
 * faceColorsInStep.test.ts - face colors (SEAM) stay one per face through
 * every workshop edit that takes faces away or adds them.
 *
 * `facecolors` is one entry per face, in the order `faces` gives them
 * (DECK-0003 §1.4a), and a list of any other length is a defect: sno-core
 * leaves it off the wire and draws every face from its corners, so a list
 * left one short silently loses every seam on the shard, not just the one
 * face. These build a strip with a different seam on each face, take a face
 * away or add one, and check that every face still standing shows exactly the
 * color it had, on the bench and through toPayload and fromPayload.
 */

import { beforeEach, describe, expect, it } from 'vitest'

// The stores keep shards and deployments in localStorage; the test runs where
// there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { TICKS_PER_UNIT as T, fromPayload, hexToRgb, newShard, pointKey, rgbToHex, ticksOf, toPayload, vertexAt, type ShardModel } from 'sno-core/shards'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
import { useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()
const RED = hexAt(BUILT_IN, 238)
const BLUE = hexAt(BUILT_IN, 239)
const GREEN = hexAt(BUILT_IN, 246)
const GOLD = hexAt(BUILT_IN, 40)
const WHITE = hexAt(BUILT_IN, 225)

/**
 * A flat strip two units long on the floor, two quads of two triangles, every
 * corner white and every face its own seam:
 *
 *   3---4---5
 *   | \ | \ |
 *   0---1---2
 */
function strip(): ShardModel {
  const at = (x: number, z: number) => vertexAt([x * T, 0, z * T], hexToRgb(WHITE))
  const s: ShardModel = {
    ...newShard('Strip'),
    mode: 'solid',
    vertices: [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1)],
    faces: [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
    facecolors: [RED, BLUE, GREEN, GOLD].map(hexToRgb),
  }
  useWorkshop.setState({ shards: [s], currentId: s.id, selection: [], partSel: [], selectedFace: null, facePick: [], clip: null, past: [], future: [], notice: null, color: hexToRgb(WHITE), level: 0, stampKind: 'block', stampSize: 1, stampFacing: 0 })
  return s
}

/** A face by where its corners stand, in order, so it is the same face after the vertices renumber. */
const where = (s: ShardModel, f: [number, number, number]): string => f.map((i) => pointKey(ticksOf(s.vertices[i]))).join(' ')

/** Each face's seam, by where it stands. Fails when the list is out of step, which is the bug. */
function seams(s: ShardModel): Map<string, string> {
  expect(s.facecolors).toBeDefined()
  expect(s.facecolors).toHaveLength(s.faces.length)
  return new Map(s.faces.map((f, i) => [where(s, f), rgbToHex(s.facecolors![i])]))
}

/** The seams again after the shard has been to the wire and back. */
function onTheWire(s: ShardModel): Map<string, string> {
  const payload = toPayload(s)
  expect(payload.facecolors).toBeDefined()
  const back = fromPayload(JSON.parse(JSON.stringify(payload)), 'x')
  expect(back).not.toBeNull()
  return seams(back!)
}

/** Every face that was there before and still is shows the color it had, on the bench and on the wire. */
function keptSeams(before: ShardModel, after: ShardModel): void {
  const was = seams(before)
  const now = seams(after)
  const wire = onTheWire(after)
  for (const [k, hex] of now) {
    if (!was.has(k)) continue
    expect(hex).toBe(was.get(k))
    expect(wire.get(k)).toBe(was.get(k))
  }
}

beforeEach(() => { strip() })

describe('taking faces away', () => {
  it('DELETE on a selected face keeps every other face\'s seam', () => {
    const before = w().current()!
    w().removeFace(1)
    const after = w().current()!
    expect(after.faces).toHaveLength(3)
    // Out of step, the wire carried no seams at all: every face lost its color, not just this one.
    expect(toPayload(after).facecolors).toEqual([238, 246, 40])
    keptSeams(before, after)
    expect([...seams(after).values()]).toEqual([RED, GREEN, GOLD])
  })

  it('deleteSelectedFace keeps them too, and UNDO puts the face back with its own seam', () => {
    const before = w().current()!
    useWorkshop.setState({ selectedFace: 0 })
    w().deleteSelectedFace()
    keptSeams(before, w().current()!)
    w().undo()
    expect([...seams(w().current()!).values()]).toEqual([RED, BLUE, GREEN, GOLD])
  })

  it('deleting a point takes its faces and keeps the rest\'s seams, through the renumbering', () => {
    const before = w().current()!
    useWorkshop.setState({ selection: [2] })
    w().deleteSelected()
    const after = w().current()!
    expect(after.vertices).toHaveLength(5)
    expect(after.faces).toHaveLength(3)
    keptSeams(before, after)
  })

  it('CUT keeps the seams of what stays', () => {
    const before = w().current()!
    useWorkshop.setState({ selection: [0] })
    w().cutSelection()
    const after = w().current()!
    expect(after.faces).toHaveLength(2)
    keptSeams(before, after)
  })
})

describe('adding faces', () => {
  it('FILL keeps every seam, and the new face looks as its corners make it look', () => {
    w().addVertex([0, 0, 2 * T])
    const before = w().current()!
    useWorkshop.setState({ selection: [3, 4, 6] })
    w().fillSelection()
    const after = w().current()!
    expect(after.faces).toHaveLength(5)
    keptSeams(before, after)
    expect(rgbToHex(after.facecolors![4])).toBe(WHITE)
  })

  it('a face picked corner by corner keeps every seam', () => {
    w().addVertex([0, 0, 2 * T])
    const before = w().current()!
    useWorkshop.setState({ tool: 'face', facePick: [] })
    w().pickForFace(3); w().pickForFace(4); w().pickForFace(6)
    w().fill()
    const after = w().current()!
    expect(after.faces).toHaveLength(5)
    keptSeams(before, after)
  })

  it('a stamp keeps every seam, and its own faces take its color', () => {
    const before = w().current()!
    useWorkshop.setState({ color: hexToRgb(RED) })
    w().placeStamp([5 * T, 0, 5 * T])
    const after = w().current()!
    expect(after.faces.length).toBeGreaterThan(4)
    keptSeams(before, after)
    after.facecolors!.slice(4).forEach((c) => expect(rgbToHex(c)).toBe(RED))
  })

  it('a stamp that culls a shared wall keeps the seams of the faces it did not cull', () => {
    useWorkshop.setState({ shards: [{ ...newShard('Blocks'), id: 'b' }], currentId: 'b' })
    w().placeStamp([0, 0, 0])
    const one = w().current()!
    one.faces.forEach((_, i) => w().colorFace(i, hexToRgb(hexAt(BUILT_IN, (i * 8) % 192))))
    const before = w().current()!
    w().placeStamp([T, 0, 0])
    const after = w().current()!
    // The wall the two blocks share went from both: two of the first block's faces among them.
    expect(after.faces.length).toBeLessThan(2 * one.faces.length)
    keptSeams(before, after)
  })
})
