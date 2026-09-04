/**
 * triangulate.ts — a loop of corners into triangles.
 *
 * FILL takes the corners of a face in order, any number of them, and the wire
 * form wants triangles. A fan from the first corner is right for a convex
 * loop and wrong for anything with a notch (a star, an L, an arrow), so this
 * is ear clipping: project the loop onto the plane it mostly lies in, walk it
 * removing one convex corner (an "ear") at a time that no other corner sits
 * inside, and every removed ear is a triangle. O(n^2) over loops of at most a
 * few dozen corners, which is nothing.
 *
 * Returns loop-local indices; the caller maps them to shard indices. Returns
 * null for a loop that is not a polygon: fewer than three corners, all
 * collinear, or self-crossing so that no ear can be found. A corner that lies
 * flat on the line between its neighbours (a vertex mid-edge, common on an
 * integer grid) is dropped without a triangle rather than making a sliver.
 *
 * Pure.
 */

export type P3 = [number, number, number]
type P2 = [number, number]

/** Newell's method: the normal of a (possibly non-planar) loop, unnormalised. */
function newell(points: P3[]): P3 {
  const n: P3 = [0, 0, 0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    n[0] += (a[1] - b[1]) * (a[2] + b[2])
    n[1] += (a[2] - b[2]) * (a[0] + b[0])
    n[2] += (a[0] - b[0]) * (a[1] + b[1])
  }
  return n
}

/** Twice the signed area of triangle abc in 2D. */
function cross(a: P2, b: P2, c: P2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/** p inside or on the edge of triangle abc, given the loop's winding sign. */
function inTriangle(a: P2, b: P2, c: P2, p: P2, sign: number): boolean {
  return cross(a, b, p) * sign >= 0 && cross(b, c, p) * sign >= 0 && cross(c, a, p) * sign >= 0
}

export function triangulate(points: P3[]): Array<[number, number, number]> | null {
  const n = points.length
  if (n < 3) return null
  const normal = newell(points)
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  if (ax === 0 && ay === 0 && az === 0) return null
  // Drop the axis the loop faces along; what is left is its own plane, near enough.
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
  const pts: P2[] = points.map((p) => (drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[2], p[0]] : [p[0], p[1]]))

  let area = 0
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1] }
  if (area === 0) return null
  const sign = area > 0 ? 1 : -1

  const idx = Array.from({ length: n }, (_, i) => i)
  const tris: Array<[number, number, number]> = []
  while (idx.length > 3) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const ip = idx[(i - 1 + idx.length) % idx.length], ic = idx[i], inx = idx[(i + 1) % idx.length]
      const c = cross(pts[ip], pts[ic], pts[inx]) * sign
      if (c < 0) continue
      if (c === 0) { idx.splice(i, 1); clipped = true; break }
      let blocked = false
      for (const j of idx) {
        if (j === ip || j === ic || j === inx) continue
        if (inTriangle(pts[ip], pts[ic], pts[inx], pts[j], sign)) { blocked = true; break }
      }
      if (blocked) continue
      tris.push([ip, ic, inx])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) return null
  }
  if (idx.length === 3 && cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) !== 0) tris.push([idx[0], idx[1], idx[2]])
  return tris.length ? tris : null
}
