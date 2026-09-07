import { describe, expect, it } from 'vitest'
import { orientFaces } from './orient'
import { newell, type P3 } from './triangulate'
import { compile, STAMPS } from './stamps'

const outwardCount = (pts: P3[], faces: Array<[number, number, number]>): { outward: number; inward: number } => {
  const c = pts.reduce<P3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
  let outward = 0, inward = 0
  for (const f of faces) {
    const [a, b, d] = f.map((i) => pts[i])
    const n = newell([a, b, d])
    const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]
    const dot = n[0] * m[0] + n[1] * m[1] + n[2] * m[2]
    if (dot > 1e-9) outward++; else if (dot < -1e-9) inward++
  }
  return { outward, inward }
}

describe('orientFaces', () => {
  it('turns every closed stamp fully outward, whatever it was authored as', () => {
    for (const k of STAMPS) {
      const s = compile(k, 2, 0, [0, 0, 0])
      if (s.faces.length === 0) continue
      const before = outwardCount(s.points, s.faces)
      const after = outwardCount(s.points, orientFaces(s.points, s.faces))
      if (before.outward + before.inward === s.faces.length) {
        // A closed shape: all outward afterwards.
        expect(after.inward, k).toBe(0)
        expect(after.outward, k).toBe(s.faces.length)
      }
    }
  })
  it('agrees across a shared edge and faces a flat plate up', () => {
    const pts: P3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    // Two triangles of one square, wound against each other.
    const faces: Array<[number, number, number]> = [[0, 1, 2], [0, 3, 2]]
    const out = orientFaces(pts, faces)
    const n0 = newell(out[0].map((i) => pts[i])), n1 = newell(out[1].map((i) => pts[i]))
    expect(Math.sign(n0[1])).toBe(Math.sign(n1[1]))
    expect(n0[1]).toBeGreaterThan(0)
  })
  it('leaves the stored faces alone', () => {
    const pts: P3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 1]]
    const faces: Array<[number, number, number]> = [[0, 2, 1]]
    orientFaces(pts, faces)
    expect(faces[0]).toEqual([0, 2, 1])
  })
})
