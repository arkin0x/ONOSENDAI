import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { DEFAULT_AXES, RAD_PER_PX, SPHERE_PX, nudgeFor, nudgeLabel, orbitBy, orbitOffset, planeAfter, setOrbitSink } from '../benchAxes'

describe('orbitOffset (the orbit ball)', () => {
  const start = new Vector3(0, 0, 10)
  it('keeps the distance and turns the view half way round across the ball\'s width', () => {
    const after = orbitOffset(start, SPHERE_PX, 0)
    expect(after.length()).toBeCloseTo(10, 6)
    // A drag to the right turns the camera the other way round the target, as a bench drag does.
    expect(after.z).toBeCloseTo(-10, 5)
    expect(Math.abs(after.x)).toBeLessThan(1e-5)
    expect(RAD_PER_PX * SPHERE_PX).toBeCloseTo(Math.PI, 12)
  })
  it('a drag down brings the camera up over the target, and never over the pole', () => {
    const up = orbitOffset(start, 0, 40)
    expect(up.y).toBeGreaterThan(0)
    expect(up.length()).toBeCloseTo(10, 6)
    const past = orbitOffset(start, 0, 10_000)
    expect(past.y).toBeLessThan(10)
    expect(past.y).toBeGreaterThan(9.99)
    const under = orbitOffset(start, 0, -10_000)
    expect(under.y).toBeLessThan(-9.99)
  })
  it('orbitBy reaches the registered sink and nothing without one', () => {
    const got: Array<[number, number]> = []
    setOrbitSink((dx, dy) => { got.push([dx, dy]) })
    orbitBy(3, -4)
    setOrbitSink(null)
    orbitBy(1, 1)
    expect(got).toEqual([[3, -4]])
  })
})

describe('benchAxes', () => {
  it('turns screen directions into model moves, with Z mirrored as the bench draws it', () => {
    expect(nudgeFor(DEFAULT_AXES, 'right')).toEqual({ axis: 0, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'left')).toEqual({ axis: 0, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'up')).toEqual({ axis: 1, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'down')).toEqual({ axis: 1, delta: -1 })
    // Toward the viewer is render +Z, which is model -Z; away is model +Z, where cyberspace +Z points.
    expect(nudgeFor(DEFAULT_AXES, 'toward')).toEqual({ axis: 2, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'away')).toEqual({ axis: 2, delta: 1 })
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'away'))).toBe('+Z')
  })
})

describe('planeAfter', () => {
  const top = { right: { axis: 0, dir: 1 }, up: { axis: 2, dir: -1 }, out: { axis: 1, dir: 1 } } as const
  it('tips the floor up to face the viewer and rolls it to face the side', () => {
    expect(planeAfter(1, DEFAULT_AXES, 'tip')).toBe(2)
    expect(planeAfter(1, DEFAULT_AXES, 'roll')).toBe(0)
    expect(planeAfter(2, DEFAULT_AXES, 'tip')).toBe(1)
    expect(planeAfter(0, DEFAULT_AXES, 'roll')).toBe(1)
  })
  it('falls back to the screen vertical when the turn would be about the normal', () => {
    // From straight above the line of sight is Y, the floor's own normal.
    expect(planeAfter(1, top, 'roll')).toBe(0)
    expect(planeAfter(1, top, 'tip')).toBe(2)
  })
})
