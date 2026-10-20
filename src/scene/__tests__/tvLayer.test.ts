/**
 * tvLayer.test.ts: a spawning avatar grows from a point to its size, and the
 * camera lands on the new place after a cut.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { carryAcross, framingDirection, grownAt, inDrawnFrame, TV_CARRY_MAX_CELLS } from '../TvLayer'
import { originShift, type Position, type ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'

describe('grownAt', () => {
  it('is whole for an avatar that did not spawn on screen', () => {
    expect(grownAt(undefined, 5)).toBe(1)
  })
  it('is nothing before the spawn, grows, and is whole after', () => {
    expect(grownAt(Infinity, 1000)).toBe(0)
    expect(grownAt(1000, 1000)).toBe(0)
    const half = grownAt(1000, 1450)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
    expect(grownAt(1000, 5000)).toBe(1)
  })
})

describe('framingDirection', () => {
  const sun = new Vector3(0.3, 0.2, 0.93).normalize()
  const base = { from: 13, to: 10, polar: 0.7, name: 'medium' as const, view: 'above' as const, spin: 1 as const }

  it('stands a sun shot on the far side of the subject from the sun, at any point of its sway', () => {
    for (const theta of [0, 0.4, 1.3, 2.9]) {
      const d = framingDirection({ ...base, sun: true }, theta, sun, new Vector3())
      // The camera looks along -d: toward the sun.
      expect(d.clone().negate().dot(sun)).toBeGreaterThan(0.7)
    }
  })

  it('circles an ordinary shot at its angle from overhead', () => {
    const d = framingDirection({ ...base, sun: false }, 1, sun, new Vector3())
    expect(d.y).toBeCloseTo(Math.cos(0.7))
    expect(d.length()).toBeCloseTo(1)
  })

  it('looks up at the sun from below on a below shot', () => {
    const d = framingDirection({ ...base, view: 'below', sun: true }, 0, sun, new Vector3())
    expect(d.y).toBeLessThan(0)
  })
})

describe('the TV camera across a cut', () => {
  const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: -1 }, out: { axis: 'z', dir: 1 } }
  const A: Position = { x: 1000n, y: 2000n, z: 3000n }
  // Where the new shot's point is, against the new anchor: the store's cursorOffset.
  const live: [number, number, number] = [0.4338, 0.1526, 0.4331]

  // A cut as it plays: one frame drawn before React commits the new anchor
  // (the store at B, the scene still at A), on which the camera's point is
  // put on what it looks at; then the commit, which moves the frame.
  function cutTo(B: Position): Vector3 {
    const smooth = new Vector3(...inDrawnFrame(live, B, A, 0, AXES))
    const shift = originShift(alignedOrigin(A, 0), alignedOrigin(B, 0), 0, AXES)
    carryAcross(smooth, shift, new Vector3(...inDrawnFrame(live, B, B, 0, AXES)))
    return smooth
  }

  it('lands on the new place after a short cut, which is carried', () => {
    const smooth = cutTo({ x: A.x + 50n, y: A.y - 20n, z: A.z + 7n })
    expect(smooth.distanceTo(new Vector3(...live))).toBeLessThan(1e-9)
  })

  it('lands on the new place after a cut across the universe, which is cut, not carried', () => {
    const far = 1n << 80n
    const smooth = cutTo({ x: A.x + far, y: A.y - far, z: A.z + far })
    expect(smooth.toArray()).toEqual(live)
  })

  it('carries a re-anchor inside a shot whole, and cuts from the bound up', () => {
    const smooth = new Vector3(5, 0, -2)
    expect(carryAcross(smooth, [-16, 0, 3], new Vector3())).toBe(false)
    expect(smooth.toArray()).toEqual([-11, 0, 1])
    expect(carryAcross(smooth, [0, TV_CARRY_MAX_CELLS, 0], new Vector3(1, 2, 3))).toBe(true)
    expect(smooth.toArray()).toEqual([1, 2, 3])
  })

  it('leaves a point alone when the scene is already drawn at the store\'s anchor', () => {
    expect(inDrawnFrame(live, A, A, 0, AXES)).toBe(live)
  })
})
