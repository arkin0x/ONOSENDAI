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
    const segs = latticeSegments(origin, 82, AXES, 0)
    expect(segs).toHaveLength(2 * 2 * (LATTICE_DIVISIONS + 1))
    // at 2^82 the cube is 8 cells wide: x runs from -0.5 to 7.5 in render cells
    const xs = segs.flatMap((s) => [s.a[0], s.b[0]])
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 3)
    expect(Math.max(...xs)).toBeCloseTo(7.5, 3)
    // top face at y = 8 cells above the floor
    const ys = new Set(segs.map((s) => s.a[1]))
    expect([...ys].sort((a, b) => a - b)).toEqual([-0.5, 7.5])
    // the centre lines carry their own colour, the rest the cross colour
    const centre = segs.filter((s) => s.color !== 0x682db5)
    expect(centre).toHaveLength(4)
    expect(new Set(centre.map((s) => s.color))).toEqual(new Set([0x3b0097, 0x3a0c40]))
  })
  it('ideaspace uses the sky and ground colours', () => {
    const segs = latticeSegments({ x: 0n, y: 0n, z: 0n }, 82, AXES, 1)
    expect(new Set(segs.filter((s) => s.color !== 0x682db5).map((s) => s.color))).toEqual(new Set([0x0062cd, 0x78004e]))
  })
})
