/**
 * stamps.ts — shapes you place with one tap.
 *
 * A stamp is a small parametric shape on the integer grid: a block, a wedge,
 * a pyramid, a column, a ring, a star, an arrow. Each compiles to plain
 * vertices and triangles in the shard's own wire form, so a stamped shard is
 * exactly as portable as a hand-built one and the world needs to know nothing
 * about stamps. SIZE scales a shape in whole units (1 to 4); FACING turns the
 * asymmetric ones (wedge, star, arrow) a quarter turn at a time about Y.
 *
 * A stamp brings its own vertices even where the shard already has one on
 * that point. That is deliberate: colours live on vertices, so sharing a
 * corner between a red block and a blue block would blend the seam, and a
 * seam is where you want the edge crisp. What sharing would have saved is
 * budget, so the two triangles that face each other where two stamps touch
 * are dropped instead: a hidden wall costs nothing. For that to work every
 * box splits each face on the same diagonal, so two boxes meeting face to
 * face produce triangles with identical corners that the cull can match.
 *
 * Pure: a stamp is a function of (kind, size, facing) and where you put it.
 */

import { GRID_HALF, MAX_FACES, MAX_VERTICES, pointKey, type ShardModel, type ShardVertex } from './shards'
import { triangulate, type P3 } from './triangulate'

export type StampKind = 'block' | 'wedge' | 'pyramid' | 'column' | 'ring' | 'star' | 'arrow'
export const STAMPS: StampKind[] = ['block', 'wedge', 'pyramid', 'column', 'ring', 'star', 'arrow']

/** Quarter turns about Y: 0 faces +X, 1 faces +Z, 2 faces −X, 3 faces −Z. */
export type Facing = 0 | 1 | 2 | 3
export const FACING_LABEL: Record<Facing, string> = { 0: '+X', 1: '+Z', 2: '−X', 3: '−Z' }

/** The stamps a quarter turn changes. The rest look the same from every side. */
export const FACED: Record<StampKind, boolean> = { block: false, wedge: true, pyramid: false, column: false, ring: false, star: true, arrow: true }

export const MIN_SIZE = 1
export const MAX_SIZE = 4

/** One-line descriptions for the shape picker. */
export const STAMP_HELP: Record<StampKind, string> = {
  block: 'A cube, SIZE units on a side, standing on the level.',
  wedge: 'A ramp, SIZE units wide and tall, sloping down toward FACING.',
  pyramid: 'A pyramid twice SIZE wide and tall, its point straight up.',
  column: 'A post one unit wide and twice SIZE tall.',
  ring: 'A closed loop of points, SIZE units out from the tap. Best in POINTS or LINES.',
  star: 'A five point star, twice SIZE across, flat on the level.',
  arrow: 'A flat arrow pointing toward FACING.',
}

export interface Shape {
  points: P3[]
  faces: Array<[number, number, number]>
}

type Tri = [number, number, number]

/** A quad's two triangles, always split from its first corner to its third. */
function quad(a: number, b: number, c: number, d: number): Tri[] {
  return [[a, b, c], [a, c, d]]
}

/**
 * A box from (x0,y0,z0) to (x1,y1,z1). Corner order per side is fixed so a
 * neighbouring box's facing side yields the same two triangles, corner for
 * corner, which is what lets the cull find them.
 */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Shape {
  const points: P3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ]
  const faces = [
    ...quad(0, 1, 2, 3), // bottom
    ...quad(4, 5, 6, 7), // top
    ...quad(0, 1, 5, 4), // z0 side
    ...quad(3, 2, 6, 7), // z1 side
    ...quad(0, 3, 7, 4), // x0 side
    ...quad(1, 2, 6, 5), // x1 side
  ]
  return { points, faces }
}

/** Where a shape of side s sits so the tap is at or near its middle: [−⌊s/2⌋, s − ⌊s/2⌋]. */
function span(s: number): [number, number] {
  const lo = -Math.floor(s / 2)
  return [lo, lo + s]
}

/** Points on a circle of radius r at n even steps, snapped to the grid, runs of repeats collapsed. */
function circle(r: number, n: number): P3[] {
  const out: P3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const p: P3 = [Math.round(r * Math.cos(a)), 0, Math.round(r * Math.sin(a))]
    if (out.length && pointKey(out[out.length - 1]) === pointKey(p)) continue
    out.push(p)
  }
  if (out.length > 1 && pointKey(out[0]) === pointKey(out[out.length - 1])) out.pop()
  return out
}

/** A flat polygon on the level: its triangles, then the first point again so LINES closes the loop. */
function flat(points: P3[]): Shape {
  const faces = triangulate(points) ?? []
  return { points: [...points, [...points[0]] as P3], faces }
}

/** The shape in its own frame: tap at the origin, level at y = 0, facing +X. */
function local(kind: StampKind, s: number): Shape {
  switch (kind) {
    case 'block': { const [x0, x1] = span(s); const [z0, z1] = span(s); return box(x0, x1, 0, s, z0, z1) }
    case 'column': return box(0, 1, 0, 2 * s, 0, 1)
    case 'pyramid': return {
      points: [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s], [0, 2 * s, 0]],
      faces: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], ...quad(0, 1, 2, 3)],
    }
    case 'wedge': {
      const [x0, x1] = span(s); const [z0, z1] = span(s)
      return {
        points: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [x0, s, z0], [x0, s, z1]],
        faces: [...quad(0, 1, 2, 3), ...quad(0, 3, 5, 4), ...quad(1, 2, 5, 4), [0, 1, 4], [3, 2, 5]],
      }
    }
    case 'ring': { const pts = circle(s, 8 * s); return { points: [...pts, [...pts[0]] as P3], faces: [] } }
    case 'star': {
      const pts: P3[] = []
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 2 * s : s, a = (i / 10) * Math.PI * 2
        const p: P3 = [Math.round(r * Math.cos(a)), 0, Math.round(r * Math.sin(a))]
        if (!pts.length || pointKey(pts[pts.length - 1]) !== pointKey(p)) pts.push(p)
      }
      return flat(pts)
    }
    case 'arrow': return flat([[-s, 0, -s], [s, 0, -s], [s, 0, -2 * s], [3 * s, 0, 0], [s, 0, 2 * s], [s, 0, s], [-s, 0, s]])
  }
}

/** A quarter turn about Y takes +X to +Z. */
function turn(p: P3, k: number): P3 {
  let [x, y, z] = p
  for (let i = 0; i < k; i++) [x, z] = [-z, x]
  return [x, y, z]
}

/**
 * The shape as it lands: turned to FACING, moved to the tap, and pushed back
 * inside the grid if any of it would poke out. Nothing here is wider than
 * the grid, so the push always succeeds.
 */
export function compile(kind: StampKind, size: number, facing: Facing, origin: P3): Shape {
  const s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)))
  const base = local(kind, s)
  const k = FACED[kind] ? facing : 0
  const points = base.points.map((p) => { const t = turn(p, k); return [t[0] + origin[0], t[1] + origin[1], t[2] + origin[2]] as P3 })
  const shift: P3 = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity
    for (const p of points) { lo = Math.min(lo, p[a]); hi = Math.max(hi, p[a]) }
    if (lo < -GRID_HALF) shift[a] = -GRID_HALF - lo
    else if (hi > GRID_HALF) shift[a] = GRID_HALF - hi
  }
  return { points: points.map((p) => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]] as P3), faces: base.faces }
}

/** The corners of a triangle as one order-free key. */
function triKey(a: P3, b: P3, c: P3): string {
  return [pointKey(a), pointKey(b), pointKey(c)].sort().join('|')
}

export interface Stamped {
  shard: ShardModel
  /** Triangles dropped because they faced an existing one across a shared wall (both sides counted). */
  culled: number
}

/**
 * The shard with the stamp added, or null when it would not fit the budget.
 * The stamp's own vertices are appended (never merged, see the header), its
 * triangles are re-indexed, and any triangle that exactly matches an existing
 * one corner for corner is dropped along with the one it matched.
 */
export function stamp(shard: ShardModel, kind: StampKind, size: number, facing: Facing, origin: P3, color: [number, number, number]): Stamped | null {
  const shape = compile(kind, size, facing, origin)
  const base = shard.vertices.length
  const vertices: ShardVertex[] = [
    ...shard.vertices,
    ...shape.points.map((p) => ({ p: [...p] as P3, c: [...color] as [number, number, number] })),
  ]
  const existing = new Map<string, number[]>()
  shard.faces.forEach((f, i) => {
    const k = triKey(shard.vertices[f[0]].p, shard.vertices[f[1]].p, shard.vertices[f[2]].p)
    existing.set(k, [...(existing.get(k) ?? []), i])
  })
  const drop = new Set<number>()
  const added: Tri[] = []
  for (const f of shape.faces) {
    const k = triKey(shape.points[f[0]], shape.points[f[1]], shape.points[f[2]])
    const hits = existing.get(k)
    if (hits && hits.length) { drop.add(hits.pop() as number); continue }
    added.push([f[0] + base, f[1] + base, f[2] + base])
  }
  const faces = [...shard.faces.filter((_, i) => !drop.has(i)), ...added]
  if (vertices.length > MAX_VERTICES || faces.length > MAX_FACES) return null
  return { shard: { ...shard, vertices, faces }, culled: drop.size * 2 }
}

/** What the stamp would be on its own: what the aim ghost draws. */
export function preview(kind: StampKind, size: number, facing: Facing, origin: P3, color: [number, number, number]): ShardModel {
  const shape = compile(kind, size, facing, origin)
  return {
    id: 'ghost',
    name: kind,
    unit: 0,
    mode: shape.faces.length ? 'solid' : 'lines',
    vertices: shape.points.map((p) => ({ p, c: [...color] as [number, number, number] })),
    faces: shape.faces,
    updatedAt: 0,
  }
}
