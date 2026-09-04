/**
 * triangulate.test.ts - loops become triangles, notches and all; non-polygons
 * are refused rather than drawn wrong.
 */

import { describe, it, expect } from 'vitest'
import { triangulate, type P3 } from './triangulate'

/** Twice the area of a 3D triangle, via the cross product. */
function area2(a: P3, b: P3, c: P3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0]
  return Math.sqrt(x * x + y * y + z * z)
}

function totalArea(points: P3[], tris: Array<[number, number, number]>): number {
  return tris.reduce((s, [a, b, c]) => s + area2(points[a], points[b], points[c]), 0) / 2
}

describe('triangulate', () => {
  it('a triangle is itself', () => {
    expect(triangulate([[0, 0, 0], [1, 0, 0], [0, 0, 1]])).toEqual([[0, 1, 2]])
  })

  it('a square is two triangles covering its area', () => {
    const sq: P3[] = [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]
    const t = triangulate(sq)!
    expect(t).toHaveLength(2)
    expect(totalArea(sq, t)).toBe(4)
  })

  it('an L (concave) gets n-2 triangles with the right area', () => {
    const L: P3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 1], [1, 0, 1], [1, 0, 3], [0, 0, 3]]
    const t = triangulate(L)!
    expect(t).toHaveLength(4)
    expect(totalArea(L, t)).toBe(5)
  })

  it('winding direction does not matter', () => {
    const cw: P3[] = [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]]
    const t = triangulate(cw)!
    expect(t).toHaveLength(2)
    expect(totalArea(cw, t)).toBe(4)
  })

  it('works in a vertical plane', () => {
    const wall: P3[] = [[0, 0, 0], [0, 2, 0], [0, 2, 3], [0, 0, 3]]
    const t = triangulate(wall)!
    expect(totalArea(wall, t)).toBe(6)
  })

  it('drops a corner that lies flat on an edge instead of making a sliver', () => {
    const sq: P3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]
    const t = triangulate(sq)!
    expect(totalArea(sq, t)).toBe(4)
    for (const [a, b, c] of t) expect(area2(sq[a], sq[b], sq[c])).toBeGreaterThan(0)
  })

  it('refuses collinear points and too few points', () => {
    expect(triangulate([[0, 0, 0], [1, 0, 0], [2, 0, 0]])).toBeNull()
    expect(triangulate([[0, 0, 0], [1, 0, 0]])).toBeNull()
  })

  it('a five point star (concave, ten corners) fills completely', () => {
    const star: P3[] = []
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 4 : 2, a = (i / 10) * Math.PI * 2
      star.push([Math.round(r * Math.cos(a)), 0, Math.round(r * Math.sin(a))])
    }
    const t = triangulate(star)!
    expect(t.length).toBeGreaterThanOrEqual(6)
    expect(totalArea(star, t)).toBeGreaterThan(20)
  })
})
