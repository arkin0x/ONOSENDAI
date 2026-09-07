import { describe, expect, it } from 'vitest'
import { orientFaces, orientShard } from './orient'
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

/**
 * arkinox's arch (2026-09-07): two pillars with a lintel built by hand across
 * their tops. The pillars' top squares stayed under the lintel, so each of
 * their edges carries three faces, and the old walk carried agreement across
 * them and turned the whole right pillar's outer faces inward.
 */
const ARCH_P = [[-4,0,-1],[-3,0,-1],[-3,0,0],[-4,0,0],[-4,4,-1],[-3,4,-1],[-3,4,0],[-4,4,0],[3,0,-1],[4,0,-1],[4,0,0],[3,0,0],[3,4,-1],[4,4,-1],[4,4,0],[3,4,0],[3,5,0],[3,5,-1],[4,5,-1],[4,5,0],[-4,4,0],[-4,4,-1],[-3,5,-1],[-3,5,0]]
const ARCH_T = [[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[60,60,60],[60,60,60],[0,0,60],[0,0,60]]
const ARCH_F: Array<[number, number, number]> = [[0,1,2],[0,2,3],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,2,6],[1,6,5],[8,10,11],[12,13,14],[12,14,15],[8,9,13],[8,13,12],[8,11,15],[8,15,12],[20,21,22],[22,23,20],[20,21,4],[4,7,20],[7,6,20],[23,20,6],[6,23,16],[16,15,6],[19,16,14],[16,15,14],[19,13,14],[19,18,13],[16,17,19],[18,17,19],[22,23,16],[16,17,22],[18,12,13],[18,17,12],[5,22,17],[12,17,5],[22,21,5],[4,5,21],[15,12,6],[5,6,12],[9,8,10],[14,13,9],[14,9,10],[15,14,10],[15,11,10]]
const archPoints = (): P3[] => ARCH_P.map((p, i) => [p[0] + ARCH_T[i][0] / 120, p[1] + ARCH_T[i][1] / 120, 0 - (p[2] + ARCH_T[i][2] / 120)])

describe('orientShard', () => {
  it('turns every outer face of the arch outward, and finds the squares inside the joins', () => {
    const pts = archPoints()
    const { faces, interior } = orientShard(pts, ARCH_F)
    const n = (i: number): P3 => { const m = newell(faces[i].map((v) => pts[v])); const l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l] }
    const expectDir = (i: number, d: P3): void => { const m = n(i); expect(m[0]).toBeCloseTo(d[0], 5); expect(m[1]).toBeCloseTo(d[1], 5); expect(m[2]).toBeCloseTo(d[2], 5) }
    // Right pillar: bottom down, +X side out, inner side toward the opening, both z sides out.
    expectDir(43, [0, -1, 0]); expectDir(12, [0, -1, 0])
    expectDir(44, [1, 0, 0]); expectDir(45, [1, 0, 0])
    expectDir(17, [-1, 0, 0]); expectDir(18, [-1, 0, 0])
    expectDir(46, [0, 0, -1]); expectDir(47, [0, 0, -1])
    expectDir(15, [0, 0, 1]); expectDir(16, [0, 0, 1])
    // Left pillar the same way round.
    expectDir(0, [0, -1, 0]); expectDir(8, [-1, 0, 0]); expectDir(10, [1, 0, 0]); expectDir(4, [0, 0, 1]); expectDir(6, [0, 0, -1])
    // The lintel's top up and its underside down.
    expectDir(31, [0, 1, 0]); expectDir(33, [0, 1, 0]); expectDir(41, [0, -1, 0]); expectDir(42, [0, -1, 0])
    // Only the pillars' tops, buried under the lintel, are inside.
    expect(interior.map((b, i) => (b ? i : -1)).filter((i) => i >= 0)).toEqual([2, 3, 13, 14])
  })

  it('finds the square between two blocks stamped one on the other, and keeps the rest outward', () => {
    const lower = compile('block', 1, 0, [0, 0, 0])
    const upper = compile('block', 1, 0, [0, 120, 0])
    const points: P3[] = [...lower.points, ...upper.points].map((p) => [p[0] / 120, p[1] / 120, 0 - p[2] / 120])
    const faces: Array<[number, number, number]> = [...lower.faces, ...upper.faces.map((f) => [f[0] + lower.points.length, f[1] + lower.points.length, f[2] + lower.points.length] as [number, number, number])]
    const { faces: out, interior } = orientShard(points, faces)
    const buried = interior.filter(Boolean).length
    expect(buried).toBe(4)
    out.forEach((f, i) => {
      if (interior[i]) return
      const m = newell(f.map((v) => points[v]))
      const c = f.reduce((a, v) => [a[0] + points[v][0] / 3, a[1] + points[v][1] / 3, a[2] + points[v][2] / 3], [0, 0, 0])
      // Outward from the joined column's middle, at (0.5, 1, -0.5).
      expect((c[0] - 0.5) * m[0] + (c[1] - 1) * m[1] + (c[2] + 0.5) * m[2]).toBeGreaterThan(0)
    })
  })
})
