/**
 * orient.ts - faces wound the same way, for shading.
 *
 * A shard's faces come from stamps, from hand-picked corners and from FILL,
 * and their windings agree with nothing: half a stamped block's triangles
 * wind inward. Drawn unlit and two-sided, as in the world, that never showed.
 * The bench lights its faces and paints their backs dark, so that an open
 * shape shows its inside, and for that every face must wind outward.
 *
 * This pass rewinds a copy for drawing; the stored faces are untouched.
 *
 * Two facts decide a face's way round. Faces that share a clean edge (one
 * with exactly two faces on it) are made to agree, since a shared edge runs
 * opposite ways in two consistently wound faces; that groups the faces into
 * patches. Then each patch is turned as a whole by what its faces can see: a
 * ray from a face's middle along its normal crosses the rest of the shard an
 * even number of times when the normal points out of a closed solid and an
 * odd number when it points in. The patch goes the way most of its area
 * votes. A patch whose rays cross nothing (a flat plate, an open shell) falls
 * back to its signed volume, or to facing up.
 *
 * Edges with three or more faces on them do not carry agreement across. They
 * are where solids touch: a block built on a block leaves the square between
 * them inside the join, with the lower block's top, the upper block's sides
 * and the lower block's sides all meeting on its edges. Passing agreement
 * through such an edge is what used to turn a whole side of a shape inward,
 * depending on which face the walk happened to reach first. A face whose
 * rays cross an odd number of faces both ways is inside the solid; it is
 * reported so the bench can leave it undrawn, where it would only fight the
 * face it sits against.
 */

import { newell, type P3 } from './triangulate'

type Face = [number, number, number]

export interface Oriented {
  /** The faces, rewound. */
  faces: Face[]
  /** Which faces sit inside the solid, with faces on both sides of them. */
  interior: boolean[]
}

const key = (a: number, b: number): string => (a < b ? `${a}>${b}` : `${b}>${a}`)

const EPS = 1e-9
/**
 * Whether a ray from `o` along `d` meets triangle abc ahead of its start
 * (Moller and Trumbore). Rays run at a slight slant to the axes, so on the
 * axis-aligned shapes the bench makes they cross faces, not edges.
 */
function hit(o: P3, d: P3, a: P3, b: P3, c: P3): boolean {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
  if (Math.abs(det) < EPS) return false
  const inv = 1 / det
  const t = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inv
  if (u < 0 || u > 1) return false
  const q = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]]
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv
  if (v < 0 || u + v > 1) return false
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
  return dist > 1e-7
}

/** How many other faces a ray from face `i`'s middle crosses along `dir`. */
function crossings(points: P3[], faces: Face[], i: number, origin: P3, dir: P3): number {
  let n = 0
  for (let j = 0; j < faces.length; j++) {
    if (j === i) continue
    const f = faces[j]
    if (hit(origin, dir, points[f[0]], points[f[1]], points[f[2]])) n++
  }
  return n
}

/** A slant that no axis-aligned edge lies along, added to every ray. */
const SLANT: P3 = [0.0173, 0.0311, 0.0237]

export function orientShard(points: P3[], faces: Face[]): Oriented {
  const out: Face[] = faces.map((f) => [f[0], f[1], f[2]])
  const n = out.length
  const interior = new Array<boolean>(n).fill(false)
  if (n === 0) return { faces: out, interior }

  // Which faces lie on each edge, whichever way they run it.
  const byEdge = new Map<string, number[]>()
  out.forEach((f, i) => {
    for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) byEdge.set(key(a, b), [...(byEdge.get(key(a, b)) ?? []), i])
  })
  const flip = (f: Face): void => { const t = f[1]; f[1] = f[2]; f[2] = t }
  const hasDirected = (f: Face, a: number, b: number): boolean =>
    (f[0] === a && f[1] === b) || (f[1] === a && f[2] === b) || (f[2] === a && f[0] === b)

  // Each face's middle, normal and area, and what its rays cross each way.
  const normal: P3[] = [], area: number[] = [], fwd: number[] = [], back: number[] = []
  for (let i = 0; i < n; i++) {
    const [a, b, c] = out[i].map((v) => points[v])
    const m = newell([a, b, c])
    const len = Math.hypot(m[0], m[1], m[2])
    normal.push(len > 0 ? [m[0] / len, m[1] / len, m[2] / len] : [0, 1, 0])
    area.push(len / 2)
    const mid: P3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
    const d: P3 = [normal[i][0] + SLANT[0], normal[i][1] + SLANT[1], normal[i][2] + SLANT[2]]
    fwd.push(crossings(points, out, i, mid, d))
    back.push(crossings(points, out, i, mid, [-d[0], -d[1], -d[2]]))
    interior[i] = fwd[i] % 2 === 1 && back[i] % 2 === 1
  }

  const seen = new Array<boolean>(n).fill(false)
  const patch: number[] = []
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue
    const queue = [start]
    seen[start] = true
    patch.length = 0
    while (queue.length) {
      const i = queue.shift() as number
      patch.push(i)
      const f = out[i]
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
        const on = byEdge.get(key(a, b)) ?? []
        if (on.length !== 2) continue
        for (const j of on) {
          if (j === i || seen[j]) continue
          if (hasDirected(out[j], a, b)) flip(out[j])
          seen[j] = true
          queue.push(j)
        }
      }
    }
    // The patch as a whole, by what its faces see. A face's normal was
    // measured as it was wound at the start; a face the walk flipped now
    // faces the other way, so its vote turns with it.
    let vote = 0
    for (const i of patch) {
      if (interior[i]) continue
      const turned = hasDirected(out[i], faces[i][0], faces[i][1]) ? 1 : -1
      const outward = fwd[i] % 2 === 0 && back[i] % 2 === 1 ? 1 : fwd[i] % 2 === 1 && back[i] % 2 === 0 ? -1 : 0
      vote += turned * outward * area[i]
    }
    let inward: boolean
    if (vote !== 0) inward = vote < 0
    else {
      // Nothing to see: closed by its own volume, or flat and facing up.
      let volume = 0, nx = 0, ny = 0, nz = 0
      for (const i of patch) {
        const [a, b, c] = out[i].map((v) => points[v])
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        const m = newell([a, b, c]); nx += m[0]; ny += m[1]; nz += m[2]
      }
      if (Math.abs(volume) > 1e-9) inward = volume < 0
      else {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
        inward = ay >= ax && ay >= az ? ny < 0 : ax >= az ? nx < 0 : nz < 0
      }
    }
    if (inward) for (const i of patch) flip(out[i])
  }
  return { faces: out, interior }
}

/** The faces rewound outward; see orientShard. */
export function orientFaces(points: P3[], faces: Face[]): Face[] {
  return orientShard(points, faces).faces
}
