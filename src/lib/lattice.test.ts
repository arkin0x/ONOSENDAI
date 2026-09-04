import { describe, expect, it } from 'vitest'
import { LATTICE_DIVISIONS, latticeOpacity, latticeSegments } from './lattice'
import type { ViewAxes } from './space'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

describe('lattice', () => {
  it('fades in between 2^78 and 2^80', () => {
    expect(latticeOpacity(77)).toBe(0)
    expect(latticeOpacity(78)).toBe(0)
    expect(latticeOpacity(79)).toBe(0.5)
    expect(latticeOpacity(80)).toBe(1)
    expect(latticeOpacity(84)).toBe(1)
  })
  it('spans the whole cube with eight divisions on both faces', () => {
    const origin = { x: 0n, y: 0n, z: 0n }
    const segs = latticeSegments(origin, 82, AXES)
    expect(segs).toHaveLength(2 * 2 * (LATTICE_DIVISIONS + 1))
    // at 2^82 the cube is 8 cells wide: x runs from -0.5 to 7.5 in render cells
    const xs = segs.flatMap((s) => [s.a[0], s.b[0]])
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 3)
    expect(Math.max(...xs)).toBeCloseTo(7.5, 3)
    // top face at y = 8 cells above the floor
    const ys = new Set(segs.map((s) => s.a[1]))
    expect([...ys].sort((a, b) => a - b)).toEqual([-0.5, 7.5])
    // v1's GridHelper: the two centre lines of each face are light purple,
    // every other line the face's own color: the logo's blue on top, its
    // purple on the floor
    const centre = segs.filter((s) => s.color === 0x682db5)
    expect(centre).toHaveLength(4)
    const faceColor = (y: number): Set<number> => new Set(segs.filter((s) => s.a[1] === y && s.color !== 0x682db5).map((s) => s.color))
    expect(faceColor(7.5)).toEqual(new Set([0x0062cd]))
    expect(faceColor(-0.5)).toEqual(new Set([0x78004e]))
  })
})
