/**
 * viewFly.test.ts - the rules of VIEW's free fly (arkinox, 2026-11-02 and
 * 2026-11-09): two fingers fly forward, three back, but only while those
 * gestures are on, and both are off for now; a pinch is the camera's and
 * never flies; one finger is the orbit's; the speed is the same in cells at
 * every zoom; a fly lands the cursor on the gibson nearest where the view
 * centres.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_MAX } from 'cyberspace-core'
import {
  canFly, flyDir, flySpeed, FlyGesture as BaseGesture, FLY_CELLS_PER_SECOND, FLY_HOLD_MS, landingOf, renderToCyber, TOUCH_FLY_FORWARD, TOUCH_FLY_REVERSE,
} from '../viewFly'
import { alignTo, type ViewAxes } from '../space'

/** The gesture with both touch flies on, as they were before 2026-11-09 and may be again. */
class FlyGesture extends BaseGesture {
  constructor() { super({ forward: true, reverse: true }) }
}

/** Fingers at rest, `spread` pixels apart along x, all down at `t`. */
function rest(g: FlyGesture, n: number, t = 0, spread = 200): void {
  for (let i = 0; i < n; i++) g.down(i + 1, 100 + (i * spread) / Math.max(1, n - 1), 400, t)
}

describe('the touch flies are off for now (arkinox, 2026-11-09)', () => {
  it('two fingers at rest and three at rest fly nowhere with the flags as shipped', () => {
    expect(TOUCH_FLY_FORWARD).toBe(false)
    expect(TOUCH_FLY_REVERSE).toBe(false)
    const g = new BaseGesture()
    rest(g, 2)
    expect(g.dir(10_000)).toBe(0)
    g.clear()
    rest(g, 3)
    expect(g.dir(10_000)).toBe(0)
  })

  it('each can come back on its own', () => {
    const fwd = new BaseGesture({ forward: true, reverse: false })
    rest(fwd, 2)
    expect(fwd.dir(FLY_HOLD_MS)).toBe(1)
    fwd.clear(); rest(fwd, 3)
    expect(fwd.dir(FLY_HOLD_MS)).toBe(0)
    const back = new BaseGesture({ forward: false, reverse: true })
    rest(back, 3)
    expect(back.dir(FLY_HOLD_MS)).toBe(-1)
  })
})

describe('FlyGesture (with the touch flies on): which way a touch flies', () => {
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

  it('the pad (FAR, NEAR) and the keys (R, F) fly too, after the buttons and before a touch', () => {
    expect(flyDir({ button: 0, pad: 1, key: 0, touch: 0 })).toBe(1)
    expect(flyDir({ button: 0, pad: 0, key: -1, touch: 0 })).toBe(-1)
    expect(flyDir({ button: 0, pad: -1, key: 1, touch: 1 })).toBe(-1)
    expect(flyDir({ button: 1, pad: -1, key: -1, touch: -1 })).toBe(1)
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

})

describe('landingOf: where the cursor lands once the fly comes to rest', () => {
  const origin = { x: 1000n, y: 1000n, z: 1000n }

  it('at 2^0, the cursor plus the flight to the nearest gibson, as the fly snapped before', () => {
    expect(landingOf(origin, { x: 0, y: 0, z: 3.4 }, 0)).toEqual({ ...origin, z: 1003n })
    expect(landingOf(origin, { x: 0, y: 0, z: 3.6 }, 0)).toEqual({ ...origin, z: 1004n })
    expect(landingOf(origin, { x: -2.2, y: 0.4, z: 0 }, 0)).toEqual({ x: 998n, y: 1000n, z: 1000n })
  })

  it('a flight too short to leave the cursor\'s cell changes nothing', () => {
    expect(landingOf(origin, { x: 0.3, y: -0.2, z: 0.1 }, 0)).toEqual(origin)
    const c = { x: (5n << 10n) + 7n, y: 3n << 10n, z: 9n << 10n }
    expect(landingOf(c, { x: 0.4, y: 0, z: -0.3 }, 10)).toEqual(c)
  })

  it('below the continuous range, the cell the view centres on: the flight is added to the cell\'s centre, not the cursor\'s corner', () => {
    // The cursor sits at the low corner of its 2^4 cell; the view centres on
    // the cell's centre and flies 1.4 cells on x: the centre plus 1.4 cells
    // is 1.9 cells from the corner, inside the next cell.
    const e = 4
    const c = { x: 160n, y: 160n, z: 160n }
    const to = landingOf(c, { x: 1.4, y: 0, z: 0 }, e)
    expect(alignTo(to.x, e)).toBe(alignTo(c.x, e) + 16n)
    // Measured from the corner it would have stayed in the same cell (1.4 cells from it).
    expect(alignTo(c.x + BigInt(Math.round(1.4 * 16)), e)).toBe(alignTo(c.x, e) + 16n)
    // And three cells of flight land three cells on.
    expect(alignTo(landingOf(c, { x: 0, y: -3, z: 0 }, e).y, e)).toBe(alignTo(c.y, e) - 48n)
  })

  it('a second of flight is FLY_CELLS_PER_SECOND cells at 2^0, 2^20 and 2^60', () => {
    for (const e of [0, 20, 60]) {
      const c = { x: 1n << 70n, y: 0n, z: 0n }
      const to = landingOf(c, { x: FLY_CELLS_PER_SECOND, y: 0, z: 0 }, e)
      expect(Number(to.x - alignTo(c.x, e)) / 2 ** e).toBeCloseTo(FLY_CELLS_PER_SECOND + (e === 0 ? 0 : 0.5), 6)
    }
  })

  it('stops at the edge of space', () => {
    const edge = { x: AXIS_MAX, y: 5n, z: 0n }
    expect(landingOf(edge, { x: 40, y: 0, z: 0 }, 0).x).toBe(AXIS_MAX)
    expect(landingOf({ x: 3n, y: 5n, z: 0n }, { x: -40, y: 0, z: 0 }, 0).x).toBe(0n)
  })

  it('works at the top of the ladder, where the cursor is drawn at its true place', () => {
    const mid = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
    const to = landingOf(mid, { x: 0, y: 0.4, z: 0 }, 80)
    expect(Number(to.y - mid.y) / 2 ** 80).toBeCloseTo(0.4, 9)
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
