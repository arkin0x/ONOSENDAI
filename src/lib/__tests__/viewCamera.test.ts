/**
 * viewCamera.test.ts - the camera's offset from its orbit (lib/viewCamera.ts):
 * the fly's linear, frame-rate independent glide; the coast, then LAND_IDLE_MS
 * of rest, then the cursor box's LAND_LERP_MS glide and the landing; the
 * landing kept under the camera (keep); movement calling a
 * glide off; the pan staying until the cursor moves and then easing back over
 * EASE_BACK_MS; and two fingers told apart as a pinch or a pan.
 */

import { describe, expect, it } from 'vitest'
import { EASE_BACK_MS, FLY_RAMP_S, LAND_IDLE_MS, LAND_LERP_MS, nearShift, PAN_SLOP_PX, PanGesture, StartLock, ViewOffset, ease, type OffsetEvent } from '../viewCamera'
import { FLY_CELLS_PER_SECOND, FLY_MAX_DT } from '../viewFly'

const off = (v: ViewOffset): [number, number, number] => { const o = v.offset({ x: 0, y: 0, z: 0 }); return [o.x, o.y, o.z] }

/** Run `ms` of frames `frameMs` apart, flying `sign` (or resting), and say what the last frame asked. */
function run(v: ViewOffset, ms: number, frameMs: number, sign: 1 | -1 | 0): OffsetEvent[] {
  const events: OffsetEvent[] = []
  for (let t = 0; t < ms - 1e-9; t += frameMs) {
    if (sign !== 0) v.fly(0, 0, -1, sign, frameMs / 1000)
    else v.rest()
    events.push(v.step(frameMs))
  }
  return events
}

/** Rest frames `frameMs` apart until a let-go fly's coast has stopped; what they asked. */
function coastOut(v: ViewOffset, frameMs = 16): OffsetEvent[] {
  const events: OffsetEvent[] = []
  for (let i = 0; v.moving && i < 1000; i++) { v.rest(); events.push(v.step(frameMs)) }
  return events
}

describe('the fly: quadratic ease-in to cruise, exponential ease-out (arkinox, 2026-11-11)', () => {
  it('eases in: the first frames move less than a cruise frame, then it reaches FLY_CELLS_PER_SECOND', () => {
    const v = new ViewOffset()
    const steps: number[] = []
    let last = 0
    // Past FLY_RAMP_S the speed is at cruise; 40 frames at 60fps is well past it.
    for (let i = 0; i < 40; i++) {
      v.fly(0, 0, -1, 1, 1 / 60)
      v.step(1000 / 60)
      const z = off(v)[2]
      steps.push(last - z)
      last = z
    }
    const cruise = FLY_CELLS_PER_SECOND / 60
    expect(steps[0]).toBeLessThan(cruise)
    expect(steps[5]).toBeGreaterThan(steps[0])
    // At cruise every frame is the same, FLY_CELLS_PER_SECOND of the zoom a second.
    expect(steps[39]).toBeCloseTo(cruise, 6)
  })

  it('is frame-rate independent over a fixed time, ramp and all', () => {
    const totals = [30, 60, 144].map((fps) => {
      const v = new ViewOffset()
      run(v, 2000, 1000 / fps, 1)
      return -off(v)[2]
    })
    for (const t of totals) expect(Math.abs(t - totals[1])).toBeLessThan(0.6)
  })

  it('eases out: let go, it coasts a little further and then stops', () => {
    const v = new ViewOffset()
    for (let i = 0; i < 40; i++) { v.fly(0, 0, -1, 1, 1 / 60); v.step(1000 / 60) }
    const atRelease = off(v)[2]
    for (let i = 0; i < 60; i++) { v.rest(); v.step(1000 / 60) }
    const afterCoast = off(v)[2]
    expect(afterCoast).toBeLessThan(atRelease)
    for (let i = 0; i < 60; i++) { v.rest(); v.step(1000 / 60) }
    expect(off(v)[2]).toBeCloseTo(afterCoast, 9)
  })

  it('a long frame (a tab coming back) is clamped to FLY_MAX_DT', () => {
    const v = new ViewOffset()
    v.fly(0, 0, -1, 1, 5)
    const rampT = Math.min(1, FLY_MAX_DT / FLY_RAMP_S)
    expect(-off(v)[2]).toBeCloseTo(FLY_CELLS_PER_SECOND * rampT * rampT * FLY_MAX_DT, 9)
  })
})

describe('the landing: the coast, a short rest, then the box glides, then the cursor moves', () => {
  it('nothing while flying, however long, nor while it coasts; LAND_IDLE_MS after the coast stops the glide starts; LAND_LERP_MS later it lands', () => {
    const v = new ViewOffset()
    expect(run(v, 5000, 16, 1)).not.toContain('glide-start')
    // The coast is not rest (arkinox, 2026-11-12: the cursor comes in close once the flight stops).
    expect(coastOut(v)).not.toContain('glide-start')
    expect(LAND_IDLE_MS).toBeLessThanOrEqual(300)
    const rest = run(v, LAND_IDLE_MS - 16, 16, 0)
    expect(rest).not.toContain('glide-start')
    expect(v.glide).toBe(0)
    expect(run(v, 16, 16, 0)).toEqual(['glide-start'])
    // The box glides, eased, and lands on the frame it gets there.
    const glide = run(v, LAND_LERP_MS, 16, 0)
    expect(glide.slice(0, -1).every((e) => e === 'none')).toBe(true)
    expect(glide.at(-1)).toBe('land')
    expect(v.glide).toBe(1)
  })

  it('a long frame while flying (a stall) is not counted as rest', () => {
    const v = new ViewOffset()
    v.fly(0, 0, -1, 1, 0.1)
    expect(v.step(1900)).toBe('none')
    v.rest()
    coastOut(v)
    expect(run(v, LAND_IDLE_MS + 16, 16, 0)).toContain('glide-start')
  })

  it('the glide is eased: slow at both ends', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBe(0.5)
    expect(ease(0.1)).toBeLessThan(0.1)
    expect(ease(0.9)).toBeGreaterThan(0.9)
  })

  it('a pan alone never lands: the cursor does not move for a pan', () => {
    const v = new ViewOffset()
    v.pan(3, 1, 0)
    for (let i = 0; i < 400; i++) expect(v.step(16)).toBe('none')
    expect(off(v)).toEqual([3, 1, 0])
  })

  it('new movement calls a running glide off: the box goes back the way it came, and the rest starts again', () => {
    for (const move of [(v: ViewOffset) => v.fly(0, 0, -1, 1, 0.016), (v: ViewOffset) => v.pan(0.5, 0, 0)]) {
      const v = new ViewOffset()
      run(v, 500, 16, 1)
      coastOut(v)
      run(v, LAND_IDLE_MS, 16, 0)
      run(v, LAND_LERP_MS / 2, 16, 0)
      const halfway = v.glide
      expect(halfway).toBeGreaterThan(0)
      move(v)
      v.rest()
      expect(v.step(16)).toBe('none')
      expect(v.glide).toBeLessThan(halfway)
      // On its way back: no landing, and no new start until it is back.
      const back = run(v, LAND_LERP_MS / 2 - 40, 16, 0)
      expect(back).not.toContain('land')
      expect(back).not.toContain('glide-start')
      expect(v.glide).toBeLessThan(halfway)
      // Once back and rested, it starts again.
      expect(run(v, LAND_IDLE_MS + LAND_LERP_MS, 16, 0)).toContain('glide-start')
    }
  })

  it('keep: the landing holds what is left over as a pan, so nothing eases and nothing more lands', () => {
    const v = new ViewOffset()
    run(v, 500, 16, 1)
    coastOut(v)
    const flown = off(v)
    v.keep()
    expect(v.flown).toBe(false)
    expect(v.held).toBe(true)
    expect(off(v)).toEqual(flown)
    // The rig takes the cursor's move off it (a pan the other way): what is left stays, however long.
    v.pan(0, 0, -Math.round(flown[2]))
    const left = off(v)
    for (let i = 0; i < 300; i++) expect(v.step(16)).toBe('none')
    expect(off(v)).toEqual(left)
    // The next move of the cursor eases it out as ever.
    v.rebase(0, 0, 0)
    run(v, EASE_BACK_MS + 32, 16, 0)
    expect(v.active).toBe(false)
  })

  it('nearShift: the target comes in along the line of sight to `near` ahead of the camera; a nearer target is left alone', () => {
    const out = { x: 9, y: 9, z: 9 }
    // The camera 26 out along (3, 4, 12)/13 from its target.
    const camLess = { x: 6, y: 8, z: 24 }
    nearShift(camLess, 2, out)
    const left = { x: camLess.x - out.x, y: camLess.y - out.y, z: camLess.z - out.z }
    expect(Math.hypot(left.x, left.y, left.z)).toBeCloseTo(2, 12)
    // Still the same line: the camera looks exactly where it looked.
    expect(left.x / 2).toBeCloseTo(3 / 13, 12)
    expect(left.z / 2).toBeCloseTo(12 / 13, 12)
    expect(nearShift({ x: 0, y: 0, z: 1.5 }, 2, out)).toEqual({ x: 0, y: 0, z: 0 })
    expect(nearShift({ x: 0, y: 0, z: 0 }, 2, out)).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('the pan: it stays until the cursor moves, then eases back', () => {
  it('stays put, frame after frame', () => {
    const v = new ViewOffset()
    v.pan(2, -1, 0.5)
    for (let i = 0; i < 300; i++) v.step(16)
    expect(off(v)).toEqual([2, -1, 0.5])
    expect(v.active).toBe(true)
  })

  it('the cursor moving re-expresses the offset against it (no jump), then eases to nothing over EASE_BACK_MS', () => {
    const v = new ViewOffset()
    v.pan(4, 0, 0)
    // The cursor moved 1 cell right: the camera's target is the same place the frame it moves.
    v.rebase(1, 0, 0)
    expect(off(v)[0]).toBeCloseTo(3, 12)
    const xs: number[] = []
    for (let t = 0; t < EASE_BACK_MS; t += 16) { v.step(16); xs.push(off(v)[0]) }
    // Smoothly down, never overshooting.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1])
    v.step(16)
    expect(off(v)[0]).toBe(0)
    expect(v.active).toBe(false)
  })

  it('a pan during the ease stops it where it is and goes on from there', () => {
    const v = new ViewOffset()
    v.pan(4, 0, 0)
    v.rebase(0, 0, 0)
    v.step(EASE_BACK_MS / 2)
    const mid = off(v)[0]
    v.pan(1, 0, 0)
    expect(off(v)[0]).toBeCloseTo(mid + 1, 12)
    for (let i = 0; i < 100; i++) v.step(16)
    expect(off(v)[0]).toBeCloseTo(mid + 1, 12)
  })

  it('a fly beginning eases a pan out: FAR and NEAR count as moving the cursor', () => {
    const v = new ViewOffset()
    v.pan(3, 0, 0)
    v.fly(0, 0, -1, 1, 0.1)
    v.step(0)
    expect(off(v)[0]).toBeCloseTo(3, 12)
    for (let t = 0; t <= EASE_BACK_MS; t += 16) { v.fly(0, 0, -1, 1, 0.016); v.step(16) }
    expect(off(v)[0]).toBeCloseTo(0, 9)
    expect(v.flown).toBe(true)
  })

  it('clear is back on the orbit at once', () => {
    const v = new ViewOffset()
    v.pan(1, 2, 3)
    v.fly(0, 0, -1, 1, 0.1)
    v.clear()
    expect(off(v)).toEqual([0, 0, 0])
    expect(v.active).toBe(false)
    expect(v.flown).toBe(false)
  })
})

describe('PanGesture: two fingers, a pinch or a pan', () => {
  it('a drag of the midpoint is a pan, from where the fingers landed (the slop is not lost)', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(1, 100 + PAN_SLOP_PX + 5, 300); g.move(2, 300 + PAN_SLOP_PX + 5, 300)
    expect(g.panning).toBe(true)
    expect(g.pinching).toBe(false)
    const out = { x: 0, y: 0 }
    expect(g.take(out)).toBe(true)
    expect(out.x).toBeCloseTo(PAN_SLOP_PX + 5, 9)
    expect(out.y).toBe(0)
    // Taken once.
    expect(g.take(out)).toBe(false)
  })

  it('a fast swipe whose first finger is a whole frame ahead of the second is still a pan', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(1, 140, 300)
    expect(g.pinching).toBe(false)
    g.move(2, 340, 300)
    expect(g.panning).toBe(true)
  })

  it('a change of spread is a pinch: it never pans, even when the midpoint then travels', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(2, 340, 300)
    g.move(2, 345, 300)
    expect(g.pinching).toBe(true)
    g.move(1, 200, 400); g.move(2, 440, 400)
    expect(g.panning).toBe(false)
    expect(g.take({ x: 0, y: 0 })).toBe(false)
  })

  it('a pan stays a pan when its fingers drift apart: the zoom stands aside for the rest of the touch', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(1, 100, 340); g.move(2, 300, 340)
    expect(g.panning).toBe(true)
    g.move(1, 100, 340); g.move(2, 380, 340)
    expect(g.panning).toBe(true)
    expect(g.pinching).toBe(false)
  })

  it('within the slops it is neither', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(1, 103, 302); g.move(2, 302, 301)
    expect(g.panning).toBe(false)
    expect(g.pinching).toBe(false)
  })

  it('one finger (the orbit) and three fingers never pan', () => {
    const g = new PanGesture()
    g.down(1, 100, 300)
    g.move(1, 200, 300)
    expect(g.panning).toBe(false)
    g.down(2, 300, 300); g.down(3, 500, 300)
    g.move(1, 260, 360); g.move(2, 360, 360); g.move(3, 560, 360)
    expect(g.panning).toBe(false)
    expect(g.take({ x: 0, y: 0 })).toBe(false)
  })

  it('a lift ends the pan; the page saying fewer fingers than counted clears it', () => {
    const g = new PanGesture()
    g.down(1, 100, 300); g.down(2, 300, 300)
    g.move(1, 100, 340); g.move(2, 300, 340)
    g.up(2)
    expect(g.panning).toBe(false)
    g.down(3, 300, 340)
    g.touchesLeft(0)
    expect(g.fingers).toBe(0)
  })

  it('the mouse pans while its drag is on, and only then', () => {
    const g = new PanGesture()
    g.drag(5, 5)
    expect(g.take({ x: 0, y: 0 })).toBe(false)
    g.setMouse(true)
    expect(g.panning).toBe(true)
    g.drag(5, -2)
    const out = { x: 0, y: 0 }
    g.take(out)
    expect(out).toEqual({ x: 5, y: -2 })
    g.setMouse(false)
    expect(g.panning).toBe(false)
  })
})

describe('StartLock: when the camera stops following the cursor (review of #635, S1)', () => {
  it('a two-finger pan never unlocks: the first finger\'s start alone only arms it', () => {
    const l = new StartLock()
    expect(l.start(1)).toBe(false) // the first finger lands: OrbitControls starts
    expect(l.start(2)).toBe(false) // the second
    for (let i = 0; i < 30; i++) expect(l.frame(false, false, 2)).toBe(false) // panning
    expect(l.frame(false, false, 0)).toBe(false) // lifted
    expect(l.frame(true, true, 2)).toBe(false) // nothing armed any more
  })

  it('a pinch unlocks once it shows itself', () => {
    const l = new StartLock()
    l.start(1); l.start(2)
    expect(l.frame(false, false, 2)).toBe(false)
    expect(l.frame(true, false, 2)).toBe(true)
    expect(l.frame(true, false, 2)).toBe(false)
  })

  it('a real one-finger (or mouse) drag unlocks; a tap that never drags does not', () => {
    const drag = new StartLock()
    drag.start(1)
    expect(drag.frame(false, true, 1)).toBe(true)
    const tap = new StartLock()
    tap.start(1)
    expect(tap.frame(false, false, 1)).toBe(false)
    expect(tap.frame(false, false, 0)).toBe(false)
  })

  it('the wheel (a start with nothing pressed) unlocks at once, as a pinch does', () => {
    expect(new StartLock().start(0)).toBe(true)
  })
})

describe('ViewOffset.hold: an orbit or a zoom is not rest (review N5)', () => {
  it('holds the landing off and calls a glide back', () => {
    const v = new ViewOffset()
    v.fly(0, 0, -1, 1, 0.1)
    v.rest()
    coastOut(v)
    v.step(LAND_IDLE_MS - 50)
    v.hold()
    expect(run(v, LAND_IDLE_MS - 32, 16, 0)).not.toContain('glide-start')
    expect(run(v, 48, 16, 0)).toContain('glide-start')
    run(v, 100, 16, 0)
    const g = v.glide
    v.hold()
    v.step(16)
    expect(v.glide).toBeLessThan(g)
  })
})
