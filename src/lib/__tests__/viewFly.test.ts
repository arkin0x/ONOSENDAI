/**
 * viewFly.test.ts - the rules of VIEW's free fly (arkinox, 2026-11-02): two
 * fingers fly forward, three back; a pinch is the camera's and never flies;
 * one finger is the orbit's; the speed is the same in cells at every zoom;
 * the cursor lands on the nearest gibson.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_MAX } from 'cyberspace-core'
import {
  canFly, flyDir, flySpeed, flyStep, FlyGesture, FLY_CELLS_PER_SECOND, FLY_HOLD_MS, FLY_MAX_DT, NO_CARRY, renderToCyber,
} from '../viewFly'
import type { ViewAxes } from '../space'

/** Fingers at rest, `spread` pixels apart along x, all down at `t`. */
function rest(g: FlyGesture, n: number, t = 0, spread = 200): void {
  for (let i = 0; i < n; i++) g.down(i + 1, 100 + (i * spread) / Math.max(1, n - 1), 400, t)
}

describe('FlyGesture: which way a touch flies', () => {
  it('two fingers at rest fly forward, once they have rested FLY_HOLD_MS', () => {
    const g = new FlyGesture()
    rest(g, 2)
    expect(g.dir(0)).toBe(0)
    expect(g.dir(FLY_HOLD_MS - 1)).toBe(0)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
    expect(g.dir(5000)).toBe(1)
  })

  it('three fingers at rest fly back', () => {
    const g = new FlyGesture()
    rest(g, 3)
    expect(g.dir(FLY_HOLD_MS)).toBe(-1)
  })

  it('one finger never flies: it is the orbit', () => {
    const g = new FlyGesture()
    rest(g, 1)
    g.move(1, 300, 500)
    expect(g.dir(10_000)).toBe(0)
  })

  it('four fingers do not fly', () => {
    const g = new FlyGesture()
    rest(g, 4)
    expect(g.dir(10_000)).toBe(0)
  })

  it('a pinch never flies, even when the fingers then come to rest', () => {
    const g = new FlyGesture()
    rest(g, 2)
    // Spreading 40 px of 200 within the hold: a zoom.
    g.move(2, 340, 400)
    expect(g.dir(FLY_HOLD_MS)).toBe(0)
    expect(g.dir(10_000)).toBe(0)
  })

  it('a slow pinch is caught at its first few pixels, before the hold is up', () => {
    const g = new FlyGesture()
    rest(g, 2)
    // 12 px of spread, the first step of a pinch at 100 px a second.
    g.move(2, 312, 400)
    expect(g.dir(FLY_HOLD_MS)).toBe(0)
  })

  it('a pinch that closes is a pinch too', () => {
    const g = new FlyGesture()
    rest(g, 2)
    g.move(2, 260, 400)
    expect(g.dir(10_000)).toBe(0)
  })

  it('a fly under way stops when the fingers start to pinch', () => {
    const g = new FlyGesture()
    rest(g, 2)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
    g.move(1, 60, 400)
    expect(g.dir(FLY_HOLD_MS + 50)).toBe(0)
  })

  it('a finger that wobbles within the slop still flies', () => {
    const g = new FlyGesture()
    rest(g, 2)
    g.move(2, 303, 402)
    g.move(1, 98, 399)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
  })

  it('two fingers moving together (not apart) still fly: only a change of spread is a pinch', () => {
    const g = new FlyGesture()
    rest(g, 2)
    // Fingers report in turn, a few pixels at a time, as a real drag does.
    for (let i = 1; i <= 15; i++) { g.move(1, 100 + 4 * i, 400 + 4 * i); g.move(2, 300 + 4 * i, 400 + 4 * i) }
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
  })

  it('lifting stops the fly at once', () => {
    const g = new FlyGesture()
    rest(g, 2)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
    g.up(2, FLY_HOLD_MS + 10)
    expect(g.dir(FLY_HOLD_MS + 10)).toBe(0)
    expect(g.count).toBe(1)
  })

  it('three fingers lifted one at a time do not fly forward on the way down', () => {
    const g = new FlyGesture()
    rest(g, 3)
    expect(g.dir(1000)).toBe(-1)
    g.up(3, 1000)
    expect(g.dir(1040)).toBe(0)
    g.up(2, 1060)
    expect(g.dir(2000)).toBe(0)
  })

  it('three fingers landing one after another start the hold again at each finger', () => {
    const g = new FlyGesture()
    g.down(1, 100, 400, 0)
    g.down(2, 300, 400, 20)
    // The third lands before two have rested a whole hold: no forward first.
    g.down(3, 200, 300, 20 + FLY_HOLD_MS - 10)
    expect(g.dir(20 + FLY_HOLD_MS)).toBe(0)
    expect(g.dir(20 + 2 * FLY_HOLD_MS)).toBe(-1)
  })

  it('a pinch that becomes two at rest after a finger lifts and lands again flies', () => {
    const g = new FlyGesture()
    rest(g, 2)
    g.move(2, 360, 400)
    expect(g.dir(FLY_HOLD_MS)).toBe(0)
    g.up(2, 500)
    g.down(2, 300, 400, 600)
    expect(g.dir(600 + FLY_HOLD_MS)).toBe(1)
  })

  it('a lift it never saw land, and clear, are harmless', () => {
    const g = new FlyGesture()
    g.up(99, 0)
    rest(g, 2)
    g.clear()
    expect(g.count).toBe(0)
    expect(g.dir(10_000)).toBe(0)
  })
})

describe('the buttons win over the scene', () => {
  it('flyDir takes the button when one is held', () => {
    expect(flyDir({ button: 0, touch: 0 })).toBe(0)
    expect(flyDir({ button: 0, touch: -1 })).toBe(-1)
    expect(flyDir({ button: 1, touch: -1 })).toBe(1)
    expect(flyDir({ button: -1, touch: 0 })).toBe(-1)
  })
})

describe('canFly: only in a free view', () => {
  const drive = { drive: true }
  it('flies in a free view, and not in BUILD, WALK, history or a fixed look', () => {
    expect(canFly({ focus: drive, exploreIndex: null, walking: false }, false)).toBe(true)
    expect(canFly({ focus: drive, exploreIndex: null, walking: false }, true)).toBe(false)
    expect(canFly({ focus: drive, exploreIndex: null, walking: true }, false)).toBe(false)
    expect(canFly({ focus: drive, exploreIndex: 3, walking: false }, false)).toBe(false)
    expect(canFly({ focus: { drive: false }, exploreIndex: null, walking: false }, false)).toBe(false)
    expect(canFly({ focus: null, exploreIndex: null, walking: false }, false)).toBe(false)
  })
})

describe('the speed scales with the zoom', () => {
  it('is the same number of cells a second at every zoom', () => {
    for (const e of [0, 1, 10, 33, 52, 84]) expect(flySpeed(e) / 2 ** e).toBe(FLY_CELLS_PER_SECOND)
  })

  it('doubles in gibsons with every step of zoom out', () => {
    for (const e of [0, 7, 40, 83]) expect(flySpeed(e + 1)).toBe(2 * flySpeed(e))
  })

  it('a second of flight crosses FLY_CELLS_PER_SECOND cells at 2^0, 2^20 and 2^60', () => {
    const along = { x: 1, y: 0, z: 0 }
    for (const e of [0, 20, 60]) {
      let cursor = { x: 1n << 70n, y: 0n, z: 0n }
      let carry = { ...NO_CARRY }
      for (let i = 0; i < 20; i++) ({ cursor, carry } = flyStep(cursor, carry, along, 1, 0.05, e))
      expect(Number(cursor.x - (1n << 70n)) / 2 ** e).toBeCloseTo(FLY_CELLS_PER_SECOND, 6)
    }
  })
})

describe('flyStep: the cursor on the nearest gibson', () => {
  const origin = { x: 1000n, y: 1000n, z: 1000n }

  it('a slow frame at 2^0 moves nothing and carries the fraction, until it adds up to the nearest gibson', () => {
    // 8 cells a second at 1/60 s is 0.133 of a gibson a frame.
    let r = flyStep(origin, NO_CARRY, { x: 0, y: 0, z: 1 }, 1, 1 / 60, 0)
    expect(r.moved).toBe(false)
    expect(r.cursor).toEqual(origin)
    expect(r.carry.z).toBeCloseTo(8 / 60, 9)
    const frames = [r]
    for (let i = 0; i < 5; i++) { r = flyStep(r.cursor, r.carry, { x: 0, y: 0, z: 1 }, 1, 1 / 60, 0); frames.push(r) }
    // 4 frames: 0.533, the nearest gibson is one on.
    expect(frames.map((f) => f.cursor.z - origin.z)).toEqual([0n, 0n, 0n, 1n, 1n, 1n])
    expect(frames[3].carry.z).toBeCloseTo(4 * 8 / 60 - 1, 9)
  })

  it('whole gibsons land exactly, with nothing carried', () => {
    // 8 cells a second of 4 gibsons, for 1/16 s: 2 gibsons.
    const r = flyStep(origin, NO_CARRY, { x: 1, y: 0, z: 0 }, 1, 0.0625, 2)
    expect(r.cursor).toEqual({ ...origin, x: 1002n })
    expect(r.carry.x).toBe(0)
  })

  it('back goes the other way', () => {
    const r = flyStep(origin, NO_CARRY, { x: 1, y: 0, z: 0 }, -1, 0.0625, 2)
    expect(r.cursor.x).toBe(998n)
  })

  it('a slanting line of sight moves every axis it leans along, each to its nearest gibson', () => {
    const k = Math.SQRT1_2
    const r = flyStep(origin, NO_CARRY, { x: k, y: -k, z: 0 }, 1, 0.1, 4)
    // 8 * 16 * 0.1 = 12.8 gibsons along the line: 9.05 on x and -9.05 on y.
    expect(r.cursor).toEqual({ x: 1009n, y: 991n, z: 1000n })
    expect(r.carry.x).toBeCloseTo(12.8 * k - 9, 9)
    expect(r.carry.y).toBeCloseTo(-12.8 * k + 9, 9)
  })

  it('stops at the edge of space and drops what that axis owed', () => {
    const edge = { x: AXIS_MAX, y: 5n, z: 0n }
    const r = flyStep(edge, NO_CARRY, { x: 1, y: 0, z: 0 }, 1, 0.1, 10)
    expect(r.cursor.x).toBe(AXIS_MAX)
    expect(r.carry.x).toBe(0)
    expect(r.moved).toBe(false)
    const low = flyStep({ x: 3n, y: 5n, z: 0n }, NO_CARRY, { x: 1, y: 0, z: 0 }, -1, 0.1, 10)
    expect(low.cursor.x).toBe(0n)
    expect(low.moved).toBe(true)
  })

  it('a long frame (a tab coming back) flies no further than FLY_MAX_DT', () => {
    const r = flyStep(origin, NO_CARRY, { x: 1, y: 0, z: 0 }, 1, 30, 0)
    expect(r.cursor.x - origin.x).toBe(BigInt(Math.round(FLY_CELLS_PER_SECOND * FLY_MAX_DT)))
  })

  it('works at the top of the ladder, where a gibson is far below a cell', () => {
    const mid = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
    const r = flyStep(mid, NO_CARRY, { x: 0, y: 1, z: 0 }, 1, 0.05, 80)
    expect(r.moved).toBe(true)
    const cells = Number(r.cursor.y - mid.y) / 2 ** 80
    expect(cells).toBeCloseTo(FLY_CELLS_PER_SECOND * 0.05, 9)
  })
})

describe('renderToCyber: the camera frame back to cyberspace axes', () => {
  it('straight on, render is cyberspace', () => {
    const axes: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
    expect(renderToCyber([0, 0, -1], axes)).toEqual({ x: 0, y: 0, z: -1 })
  })

  it('a turned view maps each render axis to its own cyberspace axis and sign', () => {
    const axes: ViewAxes = { right: { axis: 'z', dir: -1 }, up: { axis: 'x', dir: 1 }, out: { axis: 'y', dir: -1 } }
    expect(renderToCyber([0.6, 0, -0.8], axes)).toEqual({ x: 0, y: 0.8, z: -0.6 })
    expect(renderToCyber([0, 1, 0], axes)).toEqual({ x: 1, y: 0, z: 0 })
  })
})
