/**
 * walkStick.test.ts - the WALK and TERRAIN stick's math (lib/walkStick.ts;
 * owner, 2026-11-28: "Where you start touching is where the amount comes
 * from - starting a touch at the left side doesn't start turning left
 * immediately").
 */

import { describe, expect, it } from 'vitest'
import { STICK_DEAD, STICK_SECTOR_HOLD, STICK_SLOW_SHARE, StickTracker, followCentre, knobAt, quantize8, stickPeriod, stickVector } from '../walkStick'

const R = 48

describe('the centre is where the finger lands', () => {
  it('a touch at the zone\'s far left moves nothing until it is dragged', () => {
    const t = new StickTracker(() => R)
    expect(t.down(1, 2, 600)).toBe(true)
    const s = t.move(1, 2, 600)!
    expect(s.vec).toEqual({ fwd: 0, strafe: 0, mag: 0 })
    expect(s.dir).toBeNull()
    expect(s.origin).toEqual({ x: 2, y: 600 })
    // Dragged right from there: right, wherever it landed.
    const r = t.move(1, 2 + R, 600)!
    expect(r.vec.strafe).toBeCloseTo(1, 9)
    expect(r.vec.fwd).toBeCloseTo(0, 9)
    expect(r.dir).toEqual({ fwd: 0, strafe: 1 })
  })

  it('one finger only: a second finger is not taken, and another finger\'s moves and lifts change nothing', () => {
    const t = new StickTracker(() => R)
    t.down(1, 100, 500)
    expect(t.down(2, 300, 500)).toBe(false)
    expect(t.move(2, 0, 0)).toBeNull()
    expect(t.up(2)).toBe(false)
    expect(t.state?.id).toBe(1)
    expect(t.up(1)).toBe(true)
    expect(t.state).toBeNull()
    // Free again.
    expect(t.down(2, 300, 500)).toBe(true)
  })
})

describe('the dead zone and the push', () => {
  it('nothing inside STICK_DEAD of the reach, in any direction (radial)', () => {
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180
      const d = STICK_DEAD * R * 0.99
      expect(stickVector(d * Math.cos(r), d * Math.sin(r), R).mag).toBe(0)
    }
    expect(STICK_DEAD).toBeCloseTo(0.12, 9)
  })

  it('the push rises from 0 at the dead zone\'s edge to 1 at the ring, linear, and stays 1 past it', () => {
    const edge = STICK_DEAD * R
    expect(stickVector(0, -(edge + 1e-6), R).mag).toBeCloseTo(0, 5)
    expect(stickVector(0, -(edge + (R - edge) / 2), R).mag).toBeCloseTo(0.5, 9)
    expect(stickVector(0, -R, R).mag).toBeCloseTo(1, 9)
    expect(stickVector(0, -3 * R, R).mag).toBe(1)
    // Rising all the way, never a jump.
    let last = 0
    for (let d = edge; d <= R; d += 0.5) {
      const m = stickVector(d, 0, R).mag
      expect(m).toBeGreaterThanOrEqual(last)
      expect(m - last).toBeLessThan(0.02)
      last = m
    }
  })

  it('forward is up the screen and right is right; the reading stays inside the unit circle', () => {
    const up = stickVector(0, -R, R)
    expect([up.fwd, up.strafe]).toEqual([1, 0])
    const diag = stickVector(R, R, R)
    expect(diag.fwd).toBeCloseTo(-Math.SQRT1_2, 9)
    expect(diag.strafe).toBeCloseTo(Math.SQRT1_2, 9)
    expect(Math.hypot(diag.fwd, diag.strafe)).toBeCloseTo(1, 9)
  })
})

describe('past the ring the centre trails the finger (semi-dynamic)', () => {
  it('inside the ring the centre stays; past it, it is dragged to the reach behind the finger', () => {
    expect(followCentre({ x: 0, y: 0 }, { x: 30, y: 0 }, R)).toEqual({ x: 0, y: 0 })
    expect(followCentre({ x: 0, y: 0 }, { x: 100, y: 0 }, R)).toEqual({ x: 52, y: 0 })
  })

  it('so a pull back the other way reverses at once, not after crossing a ring left far behind', () => {
    const t = new StickTracker(() => R)
    t.down(1, 100, 500)
    t.move(1, 400, 500)
    // The centre came along, the reach behind.
    expect(t.state!.origin.x).toBeCloseTo(352, 9)
    // Back 60px: already left of the centre, so left.
    const s = t.move(1, 340, 500)!
    expect(s.vec.strafe).toBeLessThan(0)
    expect(s.dir).toEqual({ fwd: 0, strafe: -1 })
  })

  it('the knob is drawn inside the ring', () => {
    expect(knobAt(10, 0, R)).toEqual({ dx: 10, dy: 0 })
    const k = knobAt(300, 400, R)
    expect(Math.hypot(k.dx, k.dy)).toBeCloseTo(R, 9)
  })
})

describe('8 ways for the step WALK', () => {
  const at = (deg: number, mag = 1) => {
    const r = (deg * Math.PI) / 180
    return { fwd: Math.sin(r) * mag, strafe: Math.cos(r) * mag, mag }
  }

  it('the nearest of 8 directions, by 45 degree sectors', () => {
    expect(quantize8(at(90))!.dir).toEqual({ fwd: 1, strafe: 0 })
    expect(quantize8(at(45 + 20))!.dir).toEqual({ fwd: 1, strafe: 1 })
    expect(quantize8(at(180))!.dir).toEqual({ fwd: 0, strafe: -1 })
    expect(quantize8(at(-135))!.dir).toEqual({ fwd: -1, strafe: -1 })
    expect(quantize8(at(-90))!.dir).toEqual({ fwd: -1, strafe: 0 })
    expect(quantize8({ fwd: 0, strafe: 0, mag: 0 })).toBeNull()
  })

  it('keeps the direction it has a little past its edge, so a thumb on a boundary never flickers', () => {
    const fwd = quantize8(at(90))!
    // 24 degrees off forward (past the 22.5 edge, inside the hold): still forward.
    expect(quantize8(at(66), fwd.sector)!.dir).toEqual({ fwd: 1, strafe: 0 })
    // Past the hold: the diagonal.
    const past = 90 - 22.5 - (STICK_SECTOR_HOLD * 180) / Math.PI - 1
    expect(quantize8(at(past), fwd.sector)!.dir).toEqual({ fwd: 1, strafe: 1 })
    // With no direction held before, 66 degrees is the diagonal's.
    expect(quantize8(at(66))!.dir).toEqual({ fwd: 1, strafe: 1 })
  })

  it('a full push steps at the keys\' pace, a light one slower, never slower than STICK_SLOW_SHARE of it', () => {
    expect(stickPeriod(1, 110)).toBeCloseTo(110, 9)
    expect(stickPeriod(0, 110)).toBeCloseTo(110 / STICK_SLOW_SHARE, 9)
    expect(stickPeriod(0.5, 110)).toBeGreaterThan(110)
    expect(stickPeriod(0.5, 110)).toBeLessThan(110 / STICK_SLOW_SHARE)
    expect(stickPeriod(5, 110)).toBeCloseTo(110, 9)
  })
})
