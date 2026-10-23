import { afterEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { WALK_LOOK_DEG_PER_WIDTH, clearWalkLook, lookRadPerPx, takeWalkLook, walkLookBy } from '../walkLook'
import { orbitOffset } from '../../workshop/benchAxes'

/** Spend everything pending at a steady frame time; returns the per-frame steps. */
function drain(dt: number, frames = 2000): Array<[number, number]> {
  const steps: Array<[number, number]> = []
  for (let i = 0; i < frames; i++) {
    const s = takeWalkLook(dt)
    if (s[0] === 0 && s[1] === 0) break
    steps.push(s)
  }
  return steps
}

const yawDeg = (v: Vector3): number => (Math.atan2(v.x, v.z) * 180) / Math.PI

afterEach(() => clearWalkLook())

describe('WALK look gain', () => {
  it('a drag across the whole screen turns WALK_LOOK_DEG_PER_WIDTH, on a phone and a desktop alike', () => {
    for (const width of [412, 1920]) {
      const look = orbitOffset(new Vector3(0, 0, 0.001), width / 4, 0, lookRadPerPx(width))
      // A quarter of the screen, a quarter of the full turn.
      expect(Math.abs(yawDeg(look))).toBeCloseTo(WALK_LOOK_DEG_PER_WIDTH / 4, 6)
      expect(look.length()).toBeCloseTo(0.001, 9)
    }
  })
  it('sits in the range asked for: half to one whole turn per screen width', () => {
    expect(WALK_LOOK_DEG_PER_WIDTH).toBeGreaterThanOrEqual(180)
    expect(WALK_LOOK_DEG_PER_WIDTH).toBeLessThanOrEqual(360)
  })
  it('never looks over a pole, however far the drag', () => {
    const up = orbitOffset(new Vector3(0, 0, 0.001), 0, 1e6, lookRadPerPx(412))
    const down = orbitOffset(new Vector3(0, 0, 0.001), 0, -1e6, lookRadPerPx(412))
    expect(up.y).toBeGreaterThan(0)
    expect(up.y).toBeLessThan(0.001)
    expect(down.y).toBeLessThan(0)
    expect(Math.hypot(up.x, up.z)).toBeGreaterThan(0)
  })
})

describe('WALK look coast', () => {
  it('spends every pixel dragged, at 30, 60 and 144 frames a second', () => {
    for (const fps of [30, 60, 144]) {
      walkLookBy(300, -40)
      const steps = drain(1 / fps)
      const sum = steps.reduce((a, s) => [a[0] + s[0], a[1] + s[1]], [0, 0])
      expect(sum[0]).toBeCloseTo(300, 9)
      expect(sum[1]).toBeCloseTo(-40, 9)
      expect(takeWalkLook(1 / fps)).toEqual([0, 0])
    }
  })
  it('only ever moves toward where the drag was going, a smaller step each frame: no overshoot, no jitter', () => {
    walkLookBy(500, 0)
    const steps = drain(1 / 60)
    expect(steps.every((s) => s[0] > 0)).toBe(true)
    let sum = 0
    for (const s of steps) { sum += s[0]; expect(sum).toBeLessThanOrEqual(500 + 1e-9) }
    // Each step smaller than the last, but for the final hundredth of a pixel spent at once.
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i][0]).toBeLessThanOrEqual(steps[i - 1][0])
    expect(steps[steps.length - 1][0]).toBeLessThan(0.01)
    // And it is over in well under a second.
    expect(steps.length).toBeLessThan(60)
  })
  it('lands the same at any frame rate: the share spent by time t does not depend on the frame time', () => {
    walkLookBy(100, 0)
    let fast = 0
    for (let i = 0; i < 12; i++) fast += takeWalkLook(1 / 120)[0]
    clearWalkLook()
    walkLookBy(100, 0)
    let slow = 0
    for (let i = 0; i < 3; i++) slow += takeWalkLook(1 / 30)[0]
    expect(fast).toBeCloseTo(slow, 9)
  })
  it('a long frame (a tab coming back) spends the rest and goes no further', () => {
    walkLookBy(80, 20)
    const [x, y] = takeWalkLook(10)
    expect(x).toBeCloseTo(80, 9)
    expect(y).toBeCloseTo(20, 9)
  })
  it('a zero or negative frame time turns nothing, and clearing drops a drag not yet spent', () => {
    walkLookBy(50, 0)
    expect(takeWalkLook(0)).toEqual([0, 0])
    expect(takeWalkLook(-1)).toEqual([0, 0])
    clearWalkLook()
    expect(takeWalkLook(1 / 60)).toEqual([0, 0])
  })
  it('ignores a drag that is not a number', () => {
    walkLookBy(Number.NaN, 5)
    walkLookBy(Infinity, 0)
    expect(takeWalkLook(1)).toEqual([0, 0])
  })
})
