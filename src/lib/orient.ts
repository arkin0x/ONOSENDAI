/**
 * orient.ts - faces wound the same way, for shading.
 *
 * A shard's faces come from stamps, from hand-picked corners and from FILL,
 * and their windings agree with nothing: half a stamped block's triangles
 * wind inward. Drawn unlit and two-sided, as in the world, that never showed.
 * The bench lights its faces and paints their backs dark, so that an open
 * shape shows its inside, and for that every face must wind outward.
 *
 * This pass rewinds a copy for drawing; the stored faces are untouched. Faces
 * that share an edge are made to agree (a shared edge runs opposite ways in
 * two consistently wound faces), component by component; a closed component
 * is then flipped outward by its signed volume, and a flat one is turned to
 * face up, or the nearest axis its normal leans along.
 */

import { newell, type P3 } from './triangulate'

type Face = [number, number, number]

const key = (a: number, b: number): string => `${a}>${b}`

export function orientFaces(points: P3[], faces: Face[]): Face[] {
  const out: Face[] = faces.map((f) => [f[0], f[1], f[2]])
  const n = out.length
  if (n === 0) return out
  // Directed edges as wound now: edge a>b of face i.
  const byEdge = new Map<string, number[]>()
  const add = (a: number, b: number, i: number): void => {
    const k = a < b ? key(a, b) : key(b, a)
    byEdge.set(k, [...(byEdge.get(k) ?? []), i])
  }
  out.forEach((f, i) => { add(f[0], f[1], i); add(f[1], f[2], i); add(f[2], f[0], i) })
  const seen = new Array<boolean>(n).fill(false)
  const component: number[] = []
  const flip = (f: Face): void => { const t = f[1]; f[1] = f[2]; f[2] = t }
  const hasDirected = (f: Face, a: number, b: number): boolean =>
    (f[0] === a && f[1] === b) || (f[1] === a && f[2] === b) || (f[2] === a && f[0] === b)
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue
    const queue = [start]
    seen[start] = true
    component.length = 0
    while (queue.length) {
      const i = queue.shift() as number
      component.push(i)
      const f = out[i]
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]] as Array<[number, number]>) {
        const k = a < b ? key(a, b) : key(b, a)
        for (const j of byEdge.get(k) ?? []) {
          if (j === i || seen[j]) continue
          // Consistent neighbours run the shared edge the other way: b>a.
          if (hasDirected(out[j], a, b)) flip(out[j])
          seen[j] = true
          queue.push(j)
        }
      }
    }
    // The component as a whole: outward when closed, up when flat.
    let volume = 0
    let nx = 0, ny = 0, nz = 0
    for (const i of component) {
      const [a, b, c] = out[i].map((v) => points[v])
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
      const m = newell([a, b, c]); nx += m[0]; ny += m[1]; nz += m[2]
    }
    let inward: boolean
    if (Math.abs(volume) > 1e-9) inward = volume < 0
    else {
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
      inward = ay >= ax && ay >= az ? ny < 0 : ax >= az ? nx < 0 : nz < 0
    }
    if (inward) for (const i of component) flip(out[i])
  }
  return out
}
