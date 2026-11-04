/**
 * multiFace.test.ts: every face tapped stays in hand (arkinox, 2026-10-31:
 * "when I tap multiple faces in FACE mode, only the most recently tapped face
 * is highlighted. Every face I tap should remain highlighted", and
 * "paintbucket fill/seam should fill/seam all selected faces").
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { expandFaceColors, newShard, vertexAt, type ShardModel } from 'sno-core/shards'
import { shardGeometry } from '../../scene/ShardMesh'
import { useWorkshop } from '../useWorkshop'

const w = useWorkshop.getState
const RED: [number, number, number] = [1, 0, 0]
const BLUE: [number, number, number] = [0, 0, 1]

/** A row of four triangles, each sharing an edge with the next: vertices 0..5, zigzag. */
function strip(): ShardModel {
  const s = newShard('strip')
  const at = (x: number, z: number): ShardModel['vertices'][number] => vertexAt([x * 120, 0, z * 120], [0.25, 0.5, 0.75])
  return { ...s, mode: 'solid', vertices: [at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(2, 0), at(2, 1)], faces: [[0, 1, 2], [2, 1, 3], [2, 3, 4], [4, 3, 5]] }
}

beforeEach(() => {
  const s = strip()
  useWorkshop.setState({ shards: [s], currentId: s.id, open: true, tool: 'face', selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], invert: false, notice: null })
})

describe('faces in hand', () => {
  it('holds every face tapped, in the order tapped, with all their corners', () => {
    w().selectFace(0); w().selectFace(3); w().selectFace(1)
    expect(w().selectedFaces).toEqual([0, 3, 1])
    expect([...w().selection].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('lets go of a face tapped again, keeping the corners the others stand on', () => {
    w().selectFace(0); w().selectFace(1)
    w().selectFace(0)
    expect(w().selectedFaces).toEqual([1])
    // Face 1 is 2, 1, 3: only corner 0 was face 0's alone.
    expect([...w().selection].sort()).toEqual([1, 2, 3])
  })

  it('a face whose corners are all in hand by others is still added, not released', () => {
    w().selectFace(0); w().selectFace(2)
    expect([...w().selection].sort()).toEqual([0, 1, 2, 3, 4])
    // Face 1's corners (2, 1, 3) are all in hand already, through 0 and 2.
    w().selectFace(1)
    expect(w().selectedFaces).toEqual([0, 2, 1])
  })

  it('under INVERT takes the corners out and lets go of any face they broke', () => {
    w().selectFace(0); w().selectFace(3)
    w().setInvert(true)
    // Face 1 shares 2 and 1 with face 0, and 3 with face 3: neither is whole now.
    w().selectFace(1)
    expect(w().selectedFaces).toEqual([])
    expect([...w().selection].sort()).toEqual([0, 4, 5])
  })

  it('let go by DESELECT, by a point tap, by a corner pick and by changing tool', () => {
    w().selectFace(0); w().selectFace(1); w().selectFace(null); expect(w().selectedFaces).toEqual([])
    w().selectFace(0); w().selectFace(1); w().selectVertex(5); expect(w().selectedFaces).toEqual([])
    w().selectFace(0); w().selectFace(1); w().pickForFace(5); expect(w().selectedFaces).toEqual([])
    w().clearFacePick()
    w().selectFace(0); w().selectFace(1); w().setTool('select'); expect(w().selectedFaces).toEqual([])
  })
})

describe('what acts on all of them', () => {
  it('SEAM gives every face in hand the color, in one undoable step, and leaves the rest looking as they did', () => {
    w().selectFace(0); w().selectFace(2)
    const past = w().past.length
    w().colorFaces(w().selectedFaces, RED)
    const s = w().current()!
    expect(s.facecolors).toHaveLength(4)
    expect(s.facecolors![0]).toEqual(RED)
    expect(s.facecolors![2]).toEqual(RED)
    expect(s.facecolors![1]).toEqual([0.25, 0.5, 0.75])
    expect(s.facecolors![3]).toEqual([0.25, 0.5, 0.75])
    expect(w().past.length).toBe(past + 1)
    w().undo()
    expect(w().current()!.facecolors).toBeUndefined()
  })

  it('FILL colors the corners of every face in hand, in one undoable step', () => {
    w().selectFace(0); w().selectFace(3)
    const past = w().past.length
    w().colorSelected(BLUE)
    const c = w().current()!.vertices.map((v) => v.c)
    for (const i of [0, 1, 2, 3, 4, 5]) expect(c[i]).toEqual(BLUE)
    expect(w().past.length).toBe(past + 1)
  })

  it('FILL with no points held still reaches every face in hand', () => {
    useWorkshop.setState({ selectedFaces: [0, 3], selection: [] })
    w().colorSelected(BLUE)
    const c = w().current()!.vertices.map((v) => v.c)
    for (const i of [0, 1, 2, 3, 4, 5]) expect(c[i]).toEqual(BLUE)
  })

  it('DELETE takes every face in hand at once, keeps the rest in order with their seams, and one UNDO brings them back', () => {
    w().colorFaces([1], RED)
    w().selectFace(0); w().selectFace(2)
    const past = w().past.length
    w().deleteSelectedFace()
    const s = w().current()!
    expect(s.faces).toEqual([[2, 1, 3], [4, 3, 5]])
    expect(s.facecolors![0]).toEqual(RED)
    expect(w().selectedFaces).toEqual([])
    expect(w().past.length).toBe(past + 1)
    w().undo()
    expect(w().current()!.faces).toHaveLength(4)
  })

  it('FLIP FACE turns each face in hand, and only those', () => {
    const before = w().current()!.faces
    w().selectFace(0); w().selectFace(2)
    w().flipSelectedFace()
    const after = w().current()!.faces
    expect(after[0]).not.toEqual(before[0])
    expect(after[2]).not.toEqual(before[2])
    expect(after[1]).toEqual(before[1])
    expect(after[3]).toEqual(before[3])
  })

  it('FLIP SURFACE with two faces in hand on one surface does what one flip does', () => {
    w().selectFace(0)
    w().flipSelectedSurface()
    const one = w().current()!.faces
    w().undo()
    w().selectFace(null); useWorkshop.setState({ selection: [] })
    w().selectFace(0); w().selectFace(2)
    expect(w().selectedFaces).toEqual([0, 2])
    w().flipSelectedSurface()
    expect(w().current()!.faces).toEqual(one)
  })

  it('FLIP SURFACE turns it once when the two in hand were wound against each other', () => {
    const s = strip()
    const wound: ShardModel = { ...s, vertices: s.vertices.slice(0, 4), faces: [[0, 1, 2], [1, 3, 2]] }
    useWorkshop.setState({ shards: [wound], currentId: wound.id })
    w().selectFace(0)
    w().flipSelectedSurface()
    const one = w().current()!.faces
    w().undo()
    w().selectFace(null); useWorkshop.setState({ selection: [] })
    w().selectFace(0); w().selectFace(1)
    expect(w().selectedFaces).toEqual([0, 1])
    w().flipSelectedSurface()
    expect(w().current()!.faces).toEqual(one)
  })

  it('FLIP SURFACE turns each surface once when the faces in hand lie on two', () => {
    const s = strip()
    const far = (x: number): ShardModel['vertices'][number] => vertexAt([x * 120, 120, 0], [0.25, 0.5, 0.75])
    // A second, separate triangle, joined to nothing.
    const two: ShardModel = { ...s, vertices: [...s.vertices, far(5), far(6), far(7)], faces: [...s.faces, [6, 7, 8]] }
    useWorkshop.setState({ shards: [two], currentId: two.id })
    const before = w().current()!.faces
    w().selectFace(0); w().selectFace(4)
    w().flipSelectedSurface()
    const after = w().current()!.faces
    expect(after[0]).not.toEqual(before[0])
    expect(after[4]).not.toEqual(before[4])
  })

  it('the dropper samples the face tapped last', () => {
    w().colorFaces([0], RED)
    w().colorFaces([2], BLUE)
    w().selectFace(2); w().selectFace(0)
    w().sampleColor()
    expect(w().color).toEqual(RED)
  })
})

describe('what is drawn, on a shard with seams (DECK-0003 §1.4a: a face color overrides its corners)', () => {
  /** The color each face is drawn with, read from what ShardMesh hands the GPU, as bytes of a pure color survive either way. */
  function drawn(): Array<[number, number, number]> {
    const s = expandFaceColors(w().current()!)
    const { colors, index } = shardGeometry(s)
    const out: Array<[number, number, number]> = []
    for (let t = 0; t + 2 < index.length; t += 3) {
      const v = index[t]
      out.push([colors[v * 3], colors[v * 3 + 1], colors[v * 3 + 2]])
    }
    return out
  }
  const GREEN: [number, number, number] = [0, 1, 0]
  beforeEach(() => {
    const s = strip()
    const seamed: ShardModel = { ...s, facecolors: s.faces.map(() => [...GREEN] as [number, number, number]) }
    useWorkshop.setState({ shards: [seamed], currentId: seamed.id })
  })

  it('FILL shows on every face in hand, and on no other', () => {
    w().selectFace(0); w().selectFace(2)
    w().colorSelected(BLUE)
    expect(drawn()).toEqual([BLUE, GREEN, BLUE, GREEN])
  })

  it('FILL with no points held still shows on the faces in hand', () => {
    useWorkshop.setState({ selectedFaces: [3], selection: [] })
    w().colorSelected(BLUE)
    expect(drawn()).toEqual([GREEN, GREEN, GREEN, BLUE])
  })

  it('FILL on points with no face in hand shows on faces standing wholly on them, and no other', () => {
    useWorkshop.setState({ tool: 'select', selectedFaces: [], selection: [0, 1, 2] })
    w().colorSelected(BLUE)
    expect(drawn()).toEqual([BLUE, GREEN, GREEN, GREEN])
  })

  it('the whole object and the joined piece show too', () => {
    w().colorAll(BLUE)
    expect(drawn()).toEqual([BLUE, BLUE, BLUE, BLUE])
    useWorkshop.setState({ selection: [0] })
    w().colorConnected(RED)
    expect(drawn()).toEqual([RED, RED, RED, RED])
  })

  it('the whole object says what it did to the seams, and how to get them back', () => {
    w().colorAll(BLUE)
    expect(w().notice).toBe('Every face took the color. UNDO brings the seams back.')
    expect(w().notice!.length).toBeLessThanOrEqual(60)
    w().undo()
    expect(drawn()).toEqual([GREEN, GREEN, GREEN, GREEN])
    // Nothing was flattened on a shard with no seams, so nothing is said.
    const s = strip()
    useWorkshop.setState({ shards: [s], currentId: s.id })
    w().colorAll(BLUE)
    expect(w().notice).toBeNull()
  })

  it('one undo brings the seams back', () => {
    w().selectFace(0)
    w().colorSelected(BLUE)
    w().undo()
    expect(drawn()).toEqual([GREEN, GREEN, GREEN, GREEN])
  })

  it('a shard with no seams gets none from a FILL', () => {
    const s = strip()
    useWorkshop.setState({ shards: [s], currentId: s.id })
    w().selectFace(0)
    w().colorSelected(BLUE)
    expect(w().current()!.facecolors).toBeUndefined()
  })
})

describe('the bench', () => {
  const bench = readFileSync(join(__dirname, '..', '..', 'workshop', 'Bench.tsx'), 'utf8')
  const lit = bench.slice(bench.indexOf('function FaceHighlight()'), bench.indexOf("* The orbit's dead zone."))

  it('lights every face in hand as one fill and one set of outlines', () => {
    expect(lit).toMatch(/s\.selectedFaces/)
    expect(lit).toMatch(/for \(const k of faces\)/)
    expect(lit.match(/<mesh /g)).toHaveLength(1)
    expect(lit.match(/<lineSegments /g)).toHaveLength(1)
  })
})
