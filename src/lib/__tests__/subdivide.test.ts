/**
 * subdivide.test.ts - a fully selected face becomes four, a neighbor that
 * shares a cut edge is split along the new point so the surface never cracks,
 * two selected ends cut one edge, every child faces the parent's way, and a
 * midpoint rounds onto a tick (arkinox, 2026-10-10, ruling B).
 */

import { describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, newShard, ticksOf, vertexAt, type ShardModel } from 'sno-core/shards'
import { newell } from 'sno-core/triangulate'
import { NEED_FACE, NOT_JOINED, midpoint, subdivide, subdivideNotice, type Subdivided } from '../subdivide'

type P3 = [number, number, number]
type Rgb = [number, number, number]
const RED: Rgb = [1, 0, 0]
const BLUE: Rgb = [0, 0, 1]
const GREEN: Rgb = [0, 1, 0]
const WHITE: Rgb = [1, 1, 1]

/**
 * A two-unit square on the floor as two triangles sharing the diagonal 0-2:
 * [0, 1, 2] and [0, 2, 3], one color per corner so a midpoint's color shows
 * which two ends it came from.
 */
function quad(facecolors?: Rgb[]): ShardModel {
  const corners: P3[] = [[0, 0, 0], [2 * T, 0, 0], [2 * T, 0, 2 * T], [0, 0, 2 * T]]
  const colors = [RED, BLUE, GREEN, WHITE]
  return {
    ...newShard('quad'),
    vertices: corners.map((p, i) => vertexAt(p, colors[i])),
    faces: [[0, 1, 2], [0, 2, 3]],
    ...(facecolors ? { facecolors } : {}),
  }
}

const ok = (r: ReturnType<typeof subdivide>): Subdivided => {
  if ('refused' in r) throw new Error(r.refused)
  return r
}

const key = (f: P3): string => [...f].sort((a, b) => a - b).join(',')
const normal = (s: ShardModel, f: P3): P3 => newell(f.map((i) => ticksOf(s.vertices[i]))) as P3
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Every child face lies in its parent's plane and looks the parent's way:
 * the dot of their normals is positive. Children are found by which parent
 * holds all of their corners once the midpoints are mapped back to the edge
 * they sit on, which here is simpler: every child shares its plane with
 * exactly the parents it came from, and the quad is flat, so one normal
 * serves for the whole floor.
 */
function allFaceUp(before: ShardModel, after: ShardModel): void {
  const up = normal(before, before.faces[0])
  for (const f of after.faces) {
    const n = normal(after, f)
    expect(dot(n, up), `face ${f.join(',')} faces the wrong way`).toBeGreaterThan(0)
  }
}

describe('subdivide: faces', () => {
  it('cuts one fully selected face into four and splits the neighbor in two along the shared midpoint', () => {
    const s = quad()
    const r = ok(subdivide(s, [0, 1, 2]))
    expect(r.cut).toBe(1)
    expect(r.split).toBe(1)
    expect(r.added).toEqual([4, 5, 6])
    expect(r.corners).toEqual([0, 1, 2])
    expect(r.shard.vertices).toHaveLength(7)
    expect(r.shard.faces).toHaveLength(6)
    // The four original vertices are untouched and keep their indices.
    expect(r.shard.vertices.slice(0, 4)).toEqual(s.vertices)
    // Midpoints in edge order 0-1, 1-2, 2-0, each halfway and with the average color.
    expect(ticksOf(r.shard.vertices[4])).toEqual([T, 0, 0])
    expect(r.shard.vertices[4].c).toEqual([0.5, 0, 0.5])
    expect(ticksOf(r.shard.vertices[5])).toEqual([2 * T, 0, T])
    expect(r.shard.vertices[5].c).toEqual([0, 0.5, 0.5])
    expect(ticksOf(r.shard.vertices[6])).toEqual([T, 0, T])
    expect(r.shard.vertices[6].c).toEqual([0.5, 0.5, 0])
    // The cut face's children, in the parent's cyclic order, then the neighbor's two.
    expect(r.shard.faces).toEqual([[0, 4, 6], [4, 1, 5], [6, 5, 2], [4, 5, 6], [0, 6, 3], [6, 2, 3]])
    // The neighbor split on the shared edge's midpoint, 6, not on a midpoint of its own: no T-junction.
    expect(r.shard.faces.filter((f) => f.includes(6))).toHaveLength(5)
    expect(r.shard.facecolors).toBeUndefined()
    allFaceUp(s, r.shard)
    expect(subdivideNotice(r)).toBe('1 face cut into 4, 1 neighbor split. 3 new points.')
  })

  it('cuts both faces into eight with the shared edge cut once: five new points', () => {
    const s = quad()
    const r = ok(subdivide(s, [0, 1, 2, 3]))
    expect(r.cut).toBe(2)
    expect(r.split).toBe(0)
    expect(r.added).toHaveLength(5)
    expect(r.shard.vertices).toHaveLength(9)
    expect(r.shard.faces).toHaveLength(8)
    // One midpoint on the diagonal, used by children of both parents.
    const diag = r.added.filter((i) => ticksOf(r.shard.vertices[i]).join(',') === [T, 0, T].join(','))
    expect(diag).toHaveLength(1)
    expect(r.shard.faces.filter((f) => f.includes(diag[0]))).toHaveLength(6)
    // Every vertex index named by a face exists, and no face repeats a corner.
    for (const f of r.shard.faces) {
      expect(f.every((i) => r.shard.vertices[i])).toBe(true)
      expect(new Set(f).size).toBe(3)
    }
    expect(new Set(r.shard.faces.map(key)).size).toBe(8)
    allFaceUp(s, r.shard)
    expect(subdivideNotice(r)).toBe('2 faces cut into 8. 5 new points.')
  })

  it('carries face colors to the children so the list stays parallel', () => {
    const s = quad([RED, BLUE])
    const r = ok(subdivide(s, [0, 1, 2]))
    expect(r.shard.facecolors).toEqual([RED, RED, RED, RED, BLUE, BLUE])
    expect(r.shard.facecolors).toHaveLength(r.shard.faces.length)
  })

  it('children follow their own parent: a neighbor wound the other way has children wound the other way', () => {
    const s = quad()
    // The neighbor turned round: it looks down while the cut face looks up.
    s.faces[1] = [0, 3, 2]
    const up = normal(s, s.faces[0])
    const down = normal(s, s.faces[1])
    expect(dot(up, down)).toBeLessThan(0)
    const r = ok(subdivide(s, [0, 1, 2]))
    expect(r.shard.faces).toHaveLength(6)
    for (const f of r.shard.faces.slice(0, 4)) expect(dot(normal(r.shard, f), up), `child ${f.join(',')}`).toBeGreaterThan(0)
    for (const f of r.shard.faces.slice(4)) expect(dot(normal(r.shard, f), down), `neighbor child ${f.join(',')}`).toBeGreaterThan(0)
  })

  it('a face holding two cut edges is cut in three, so no midpoint is left hanging', () => {
    // In FACES mode a face with two cut edges has all three corners selected
    // and is whole, so the three-way cut is only reached by a fold: a face
    // with two of its edges between the same two points, by index. Vertices
    // 0 and 2 stand on one spot here, so [0, 1, 2] holds edges 0-1 and 1-2
    // between the two selected points and each gets a midpoint of its own.
    const s: ShardModel = {
      ...newShard('fold'),
      vertices: ([[0, 0, 0], [2 * T, 0, 0], [0, 0, 0], [T, 0, 2 * T]] as P3[]).map((p) => vertexAt(p, WHITE)),
      faces: [[0, 1, 2], [0, 1, 3]],
    }
    const r = ok(subdivide(s, [0, 1, 2]))
    expect(r.cut).toBe(0)
    expect(r.split).toBe(2)
    expect(r.added).toEqual([4, 5])
    expect(ticksOf(r.shard.vertices[4])).toEqual([T, 0, 0])
    expect(ticksOf(r.shard.vertices[5])).toEqual([T, 0, 0])
    // The fold in three along both, the other face in two along 0-1's midpoint only.
    expect(r.shard.faces).toHaveLength(5)
    expect(r.shard.faces.slice(3)).toEqual([[0, 4, 3], [4, 1, 3]])
  })

  it('refuses three or more points with no whole face among them', () => {
    expect(subdivide(quad(), [0, 1, 3])).toEqual({ refused: NEED_FACE })
    expect(subdivide(quad(), [1])).toEqual({ refused: NEED_FACE })
    expect(subdivide(quad(), [])).toEqual({ refused: NEED_FACE })
  })
})

describe('subdivide: edge', () => {
  it('cuts the shared edge once and both faces in two when exactly its two ends are selected', () => {
    const s = quad()
    const r = ok(subdivide(s, [0, 2]))
    expect(r.cut).toBe(0)
    expect(r.split).toBe(2)
    expect(r.added).toEqual([4])
    expect(r.corners).toEqual([0, 2])
    expect(ticksOf(r.shard.vertices[4])).toEqual([T, 0, T])
    expect(r.shard.vertices[4].c).toEqual([0.5, 0.5, 0])
    // Each face turned so the cut edge comes first, then [a, ab, d] and [ab, b, d]: a cyclic turn, so the winding holds.
    expect(r.shard.faces).toEqual([[2, 4, 1], [4, 0, 1], [0, 4, 3], [4, 2, 3]])
    allFaceUp(s, r.shard)
    expect(subdivideNotice(r)).toBe('2 faces cut in two. 1 new point.')
  })

  it('cuts an outer edge held by one face: that face alone, in two', () => {
    const r = ok(subdivide(quad(), [0, 1]))
    expect(r.added).toEqual([4])
    expect(r.shard.faces).toEqual([[0, 4, 2], [4, 1, 2], [0, 2, 3]])
    expect(subdivideNotice(r)).toBe('1 face cut in two. 1 new point.')
  })

  it('refuses two points that no edge joins', () => {
    expect(subdivide(quad(), [1, 3])).toEqual({ refused: NOT_JOINED })
  })

  it('treats a selection as points: every vertex on the two spots counts, and each index edge gets its own midpoint', () => {
    // Two stamps touching along x = 2: each keeps its own two corners there,
    // so the line carries edges 1-2 (left square) and 4-7 (right square).
    const left: P3[] = [[0, 0, 0], [2 * T, 0, 0], [2 * T, 0, 2 * T], [0, 0, 2 * T]]
    const right: P3[] = [[2 * T, 0, 0], [4 * T, 0, 0], [4 * T, 0, 2 * T], [2 * T, 0, 2 * T]]
    const s: ShardModel = {
      ...newShard('two'),
      vertices: [...left.map((p) => vertexAt(p, RED)), ...right.map((p) => vertexAt(p, BLUE))],
      faces: [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
    }
    const r = ok(subdivide(s, [1, 2, 4, 7]))
    // Two points, two index edges along the seam, two midpoints on one spot: not merged, by design.
    expect(r.added).toEqual([8, 9])
    expect(ticksOf(r.shard.vertices[8])).toEqual([2 * T, 0, T])
    expect(ticksOf(r.shard.vertices[9])).toEqual([2 * T, 0, T])
    expect(r.shard.vertices[8].c).toEqual(RED)
    expect(r.shard.vertices[9].c).toEqual(BLUE)
    expect(r.shard.faces).toHaveLength(6)
    expect(r.corners).toEqual([1, 2, 4, 7])
  })

  it('never merges a midpoint with a vertex that already stands on its spot', () => {
    const s = quad()
    // A loose vertex already at the middle of the diagonal.
    s.vertices.push(vertexAt([T, 0, T], WHITE))
    const r = ok(subdivide(s, [0, 2]))
    expect(r.added).toEqual([5])
    expect(ticksOf(r.shard.vertices[5])).toEqual(ticksOf(r.shard.vertices[4]))
    expect(r.shard.faces.flat()).not.toContain(4)
  })
})

describe('subdivide: ticks', () => {
  it('rounds a midpoint onto a tick, .5 up, at the 1/8 division', () => {
    // 15 ticks is an eighth of a unit; its midpoint with 30 is 22.5, which rounds up to 23.
    expect(midpoint([15, 0, 0], [30, 0, 0])).toEqual([23, 0, 0])
    expect(midpoint([0, 0, 0], [15, 0, 0])).toEqual([8, 0, 0])
    // Negative ties go up too (toward +infinity), as Math.round does.
    expect(midpoint([-15, 0, 0], [0, 0, 0])).toEqual([-7, 0, 0])
    // Even differences are exact.
    expect(midpoint([15, 30, 45], [45, 30, 15])).toEqual([30, 30, 30])
  })

  it('writes the rounded midpoint as a vertex the grid holds', () => {
    const s: ShardModel = {
      ...newShard('eighths'),
      vertices: ([[15, 0, 0], [30, 0, 0], [15, 0, 15]] as P3[]).map((p) => vertexAt(p, WHITE)),
      faces: [[0, 1, 2]],
    }
    const r = ok(subdivide(s, [0, 1, 2]))
    expect(r.added.map((i) => ticksOf(r.shard.vertices[i]))).toEqual([[23, 0, 0], [23, 0, 8], [15, 0, 8]])
    for (const i of r.added) expect(ticksOf(r.shard.vertices[i]).every(Number.isInteger)).toBe(true)
  })
})
