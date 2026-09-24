/**
 * weld.ts - points standing on the same spot become one.
 *
 * PASTE and DUPLICATE put copies down exactly where their originals stand,
 * on purpose: the copy is then moved into place, and merging it with what
 * it landed on would take that away (arkinox, 2026-09-24). So stacking is
 * never undone by itself. WELD is the deliberate act that undoes it once the
 * shape is settled: every group of vertices at one exact tick position
 * collapses to its first member, faces renumber, faces that collapsed to a
 * line or doubled another go.
 *
 * Colour is the one thing that can be lost in a merge. A corner belongs to
 * every face touching it, so two stacked corners of different colours were
 * giving two faces two different looks; one surviving corner cannot. When
 * any merge joins colours that differ, every face is given its own colour
 * (DECK-0003 facecolors), the look it already had from its corners, so the
 * object draws exactly as before with fewer vertices. A 129-square floor
 * pasted square by square went from 516 vertices, past the format's 512, to
 * 291 this way.
 */

import { pointKey, ticksOf, type ShardModel, type ShardVertex } from 'sno-core/shards'

type Tri = [number, number, number]
type Rgb = [number, number, number]

export interface Welded {
  shard: ShardModel
  /** How many vertices were folded into another. */
  merged: number
  /** Whether faces were given their own colours to keep their look. */
  colored: boolean
}

const sameColor = (a: ShardVertex, b: ShardVertex): boolean => a.c[0] === b.c[0] && a.c[1] === b.c[1] && a.c[2] === b.c[2]

/** The colour a face shows without one of its own: the average of its corners. */
function cornerAverage(s: ShardModel, f: Tri): Rgb {
  const sum: Rgb = [0, 0, 0]
  for (const i of f) {
    const v = s.vertices[i]
    if (v) { sum[0] += v.c[0]; sum[1] += v.c[1]; sum[2] += v.c[2] }
  }
  return [sum[0] / 3, sum[1] / 3, sum[2] / 3]
}

/**
 * Weld the shard, or only the vertices in `only` when given (a selection):
 * stacked vertices outside it are left alone and never merged into.
 * Null when nothing stands on anything.
 */
export function weld(s: ShardModel, only?: ReadonlySet<number>): Welded | null {
  const rep = new Map<string, number>()
  const to = new Array<number>(s.vertices.length)
  let merged = 0
  let conflict = false
  s.vertices.forEach((v, i) => {
    if (only && !only.has(i)) { to[i] = i; return }
    const key = pointKey(ticksOf(v))
    const r = rep.get(key)
    if (r === undefined) { rep.set(key, i); to[i] = i; return }
    to[i] = r
    merged++
    if (!sameColor(v, s.vertices[r])) conflict = true
  })
  if (merged === 0) return null

  // Faces keep the look they had: their own colour if they had one, else
  // what their corners blended to, computed on the corners as they were.
  const needColors = conflict || !!s.facecolors
  const before: Rgb[] | null = needColors
    ? s.faces.map((f, i) => (s.facecolors && s.facecolors.length === s.faces.length ? s.facecolors[i] : cornerAverage(s, f)))
    : null

  const index = new Map<number, number>()
  const keep: number[] = []
  s.vertices.forEach((_, i) => { if (to[i] === i) { index.set(i, keep.length); keep.push(i) } })

  const faces: Tri[] = []
  const facecolors: Rgb[] = []
  const seen = new Set<string>()
  s.faces.forEach((f, i) => {
    const g = f.map((j) => index.get(to[j]) as number) as Tri
    // A face whose corners fell together is a line or a point now, and a
    // face that became another face's twin says nothing the first did not.
    if (g[0] === g[1] || g[1] === g[2] || g[0] === g[2]) return
    const key = [...g].sort((a, b) => a - b).join(',')
    if (seen.has(key)) return
    seen.add(key)
    faces.push(g)
    if (before) facecolors.push(before[i])
  })

  return {
    shard: { ...s, vertices: keep.map((i) => s.vertices[i]), faces, facecolors: before ? facecolors : undefined },
    merged,
    colored: conflict && !s.facecolors,
  }
}

/** How many vertices stand on a spot another vertex already holds. */
export function stackedCount(s: Pick<ShardModel, 'vertices'>): number {
  return s.vertices.length - new Set(s.vertices.map((v) => pointKey(ticksOf(v)))).size
}
