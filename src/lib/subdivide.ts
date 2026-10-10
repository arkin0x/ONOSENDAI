/**
 * subdivide.ts - a face cut into four, or an edge cut in two.
 *
 * The workshop had no way to add detail to a surface once it was built: a
 * giraffe's neck was three long triangles and stayed that way, because the
 * only road to a finer mesh was deleting the faces and filling them again by
 * hand, point by point (arkinox, 2026-10-10, ruling B). SUBDIVIDE does the
 * cut that work wanted, in two shapes that the selection tells apart:
 *
 * - FACES. Every face whose three corners are all selected is cut into four:
 *   one new point at the midpoint of each of its three edges, then the three
 *   corner triangles and the middle one. A neighbor that shares a cut edge
 *   but is not itself selected whole is cut along the new point too, in two
 *   (in three when it shares two cut edges), so the surface keeps no
 *   T-junction: when the new point is moved later, nothing cracks.
 * - EDGE. When the selection is exactly two points and a face edge joins
 *   them, one midpoint goes on that edge and every face holding the edge is
 *   cut in two. Two points with no edge between them is refused with a
 *   notice, and so is a wider selection with no whole face in it.
 *
 * One midpoint per edge per operation, keyed by the two vertex INDICES, so
 * the two faces that share an edge share the midpoint, which is what keeps
 * the mesh closed. Co-located vertices are not folded together here: an edge
 * is a pair of indices, as the faces say it is, so two stamps that touch and
 * each keep their own corners each get their own midpoint. A midpoint is
 * never merged with a vertex that already stands on its spot either. Stacking
 * is a deliberate state in this editor (lib/weld folds it on request), and an
 * edit that sometimes reused an old vertex and sometimes made a new one would
 * be hard to predict; WELD is one tap away for anyone who wants them folded.
 *
 * Winding is kept: each child lists its corners in the parent's cyclic order,
 * so each child's front is the parent's. Pure, like weld: the store wraps the
 * result in one undoable edit.
 */

import { pointKey, ticksOf, validPoint, vertexAt, type ShardModel } from 'sno-core/shards'
import { cornerAverage } from './weld'

type Tri = [number, number, number]
type P3 = [number, number, number]
type Rgb = [number, number, number]

export interface Subdivided {
  shard: ShardModel
  /** The ends of every edge that was cut: with `added`, what stays selected so a second press cuts again. */
  corners: number[]
  /** The midpoints made, as indices into the new shard's vertices, in the order they were made. */
  added: number[]
  /** Faces cut into four. 0 for an edge cut. */
  cut: number
  /** Faces cut in two or three because a neighbor's edge was cut, or every face holding the edge in an edge cut. */
  split: number
}

export type SubdivideResult = Subdivided | { refused: string }

export const NOT_JOINED = 'Those two points are not joined by an edge.'
export const NEED_FACE = 'Select a whole face, or the two ends of an edge.'
export const OFF_GRID = 'A new point would land off the grid. Nothing was cut.'

/** An edge as a map key: its two vertex indices, smaller first, so both faces that hold it find one entry. */
const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

/**
 * The midpoint of two positions in ticks, each axis rounded to the nearest
 * tick with .5 going up (Math.round). Corners always stand on ticks, so a
 * half falls out only when the two differ by an odd number of ticks, which
 * the 1/8 division (120 / 8 = 15) is the one place to produce.
 */
export function midpoint(a: P3, b: P3): P3 {
  return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round((a[2] + b[2]) / 2)]
}

/**
 * A face's children, given which of its edges carry a midpoint. Every child
 * lists its corners in the parent's cyclic order, so its front is the
 * parent's: for [a, b, c] with midpoints ab, bc, ca the four are
 * [a, ab, ca], [ab, b, bc], [ca, bc, c] and the middle [ab, bc, ca]; one cut
 * edge gives [a, ab, c] and [ab, b, c]; two consecutive cut edges give b's
 * corner [ab, b, bc] and the remaining quad as [a, ab, bc], [a, bc, c].
 */
function children(f: Tri, mid: ReadonlyMap<string, number>): Tri[] {
  const m = [mid.get(edgeKey(f[0], f[1])), mid.get(edgeKey(f[1], f[2])), mid.get(edgeKey(f[2], f[0]))]
  const n = m.filter((x) => x !== undefined).length
  if (n === 0) return [f]
  if (n === 3) {
    const [a, b, c] = f
    const [ab, bc, ca] = m as number[]
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
  }
  // Turn the face so its first edge (a, b) is a cut one, and for two cut
  // edges so the second (b, c) is too. A cyclic turn keeps the winding.
  const k = n === 1 ? m.findIndex((x) => x !== undefined) : m.findIndex((x, i) => x !== undefined && m[(i + 1) % 3] !== undefined)
  const a = f[k], b = f[(k + 1) % 3], c = f[(k + 2) % 3]
  const ab = m[k] as number
  if (n === 1) return [[a, ab, c], [ab, b, c]]
  const bc = m[(k + 1) % 3] as number
  return [[ab, b, bc], [a, ab, bc], [a, bc, c]]
}

/**
 * The shard with the selection subdivided, or why it was refused. `selection`
 * is vertex indices, as the store keeps them; indices that name no vertex are
 * ignored. No vertex moves and no index changes: midpoints are appended, and
 * each parent face is replaced in place by its children so the faces around
 * it keep their order.
 */
export function subdivide(s: ShardModel, selection: readonly number[]): SubdivideResult {
  const chosen = new Set(selection.filter((i) => s.vertices[i]))
  const at = (i: number): string => pointKey(ticksOf(s.vertices[i]))
  const points = new Set([...chosen].map(at))
  // A face is cut whole when its three corners are all in hand and stand on
  // three different spots: one with two corners on the same spot has no area
  // and nothing to cut into four.
  const whole = s.faces.map((f) => f.every((i) => chosen.has(i)) && new Set(f.map(at)).size === 3)
  const edges: Array<[number, number]> = []
  const seen = new Set<string>()
  const take = (a: number, b: number): void => { const k = edgeKey(a, b); if (!seen.has(k)) { seen.add(k); edges.push([a, b]) } }
  if (whole.some(Boolean)) {
    s.faces.forEach((f, i) => { if (whole[i]) { take(f[0], f[1]); take(f[1], f[2]); take(f[2], f[0]) } })
  } else if (points.size === 2) {
    // Two points: every face edge that runs from one to the other, by index,
    // so an edge two stamps both own along the same line is cut once each.
    for (const f of s.faces) {
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]] as Array<[number, number]>) {
        if (chosen.has(a) && chosen.has(b) && at(a) !== at(b)) take(a, b)
      }
    }
    if (edges.length === 0) return { refused: NOT_JOINED }
  } else {
    return { refused: NEED_FACE }
  }

  // One midpoint per edge, appended after every existing vertex so no index
  // moves. Its color is the average of the two ends', which is what the edge
  // already blended to there; the wire snaps it to the nearest palette entry
  // on export (sno-core toPayload), as it does every color.
  const vertices = s.vertices.slice()
  const mid = new Map<string, number>()
  const added: number[] = []
  for (const [a, b] of edges) {
    const p = midpoint(ticksOf(s.vertices[a]), ticksOf(s.vertices[b]))
    // Two corners on the grid have their midpoint on it, rounded, so this
    // cannot really fire; it is the promise that nothing here ever writes a
    // vertex the grid cannot hold.
    if (!validPoint(p, s.extent)) return { refused: OFF_GRID }
    const ca = s.vertices[a].c, cb = s.vertices[b].c
    mid.set(edgeKey(a, b), vertices.length)
    added.push(vertices.length)
    vertices.push(vertexAt(p, [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2]))
  }

  // Seams stay parallel to the faces (sno-core shards: all or none): each
  // child takes its parent's. A seam list that had fallen out of step is
  // rebuilt from what each face showed, as weld does.
  const seams: Rgb[] | null = s.facecolors
    ? s.faces.map((f, i) => (s.facecolors!.length === s.faces.length ? s.facecolors![i] : cornerAverage(s, f)))
    : null
  const faces: Tri[] = []
  const facecolors: Rgb[] = []
  const corners = new Set<number>()
  let cut = 0, split = 0
  s.faces.forEach((f, i) => {
    const kids = children(f, mid)
    if (kids.length === 4) cut++
    else if (kids.length > 1) split++
    for (const k of kids) { faces.push(k); if (seams) facecolors.push(seams[i]) }
  })
  for (const [a, b] of edges) { corners.add(a); corners.add(b) }

  return {
    shard: { ...s, vertices, faces, ...(seams ? { facecolors } : {}) },
    corners: [...corners].sort((a, b) => a - b),
    added,
    cut,
    split,
  }
}

/** One line about what was cut: "2 faces cut into 8, 1 neighbor split. 5 new points." */
export function subdivideNotice(r: Subdivided): string {
  const n = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`
  const bits: string[] = []
  if (r.cut) bits.push(`${n(r.cut, 'face')} cut into ${r.cut * 4}`)
  if (r.split) bits.push(r.cut ? `${n(r.split, 'neighbor')} split` : `${n(r.split, 'face')} cut in two`)
  return `${bits.join(', ')}. ${n(r.added.length, 'new point')}.`
}
