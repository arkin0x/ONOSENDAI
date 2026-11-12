/**
 * viewFlyTick.test.ts - the camera's offset against the real store, one frame
 * at a time, as Scene.tsx's rig runs it (scene/ViewFly.ts viewRig.before and
 * viewRig.apply; arkinox, 2026-11-09):
 *
 * - VIEW's fly moves the camera along its line of sight, linearly, and not
 *   the cursor; once it has stopped the view's centre comes in to just ahead
 *   of the camera, and a moment later the cursor box glides to that cell and
 *   the cursor moves there when it arrives, the camera never moving.
 * - Movement calls a glide off; a pad press before the landing steps from
 *   where the view has flown.
 * - A pan moves the camera and its target, never the cursor, and stays until
 *   the cursor moves; then the camera eases back onto its orbit.
 * - Neither happens in WALK; a zoom lands an unlanded fly at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Quaternion, Vector3 } from 'three'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { flyGesture, panGesture, takeFlyReanchor, viewOffset, viewRig, type RigCamera } from '../ViewFly'
import { readFileSync } from 'node:fs'
import { FLY_CELLS_PER_SECOND, renderToCyber, useViewFly } from '../../lib/viewFly'
import { cursorGlide, EASE_BACK_MS, LAND_IDLE_MS, LAND_LERP_MS } from '../../lib/viewCamera'
import { ORBIT_MIN_DISTANCE } from '../camera'
import { alignedOrigin, useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import { alignTo, originShift, type Position } from '../../lib/space'

const cs = () => useCyberspace.getState()
const DT = 1 / 60

/**
 * A camera 10 cells behind what it orbits, looking down render -z, and the
 * rig's follow point, driven as Scene.tsx drives them: the offset's frame,
 * then the cursor's target in the frame the anchor draws, the render frame's
 * shift carried by both, the offset applied, and the follow point eased
 * straight onto the target (the rig eases it over FOLLOW_TAU; here at once).
 */
class Harness {
  cam: RigCamera = { position: new Vector3(0, 0, 10), target: new Vector3(), quaternion: new Quaternion(), fov: 55, heightPx: 800 }
  follow = new Vector3()
  private aim = new Vector3()
  private origin: Position | null = null
  private scale = -1

  frame(dt = DT): void {
    viewRig.before(this.cam, dt)
    const s = cs()
    const o = alignedOrigin(s.anchor, s.scaleExp)
    let shift: [number, number, number] | null = null
    if (this.origin && this.scale === s.scaleExp) {
      shift = originShift(this.origin, o, s.scaleExp, s.axes())
      this.cam.position.x += shift[0]; this.cam.position.y += shift[1]; this.cam.position.z += shift[2]
      this.follow.x += shift[0]; this.follow.y += shift[1]; this.follow.z += shift[2]
    }
    const zoomed = this.scale !== s.scaleExp
    this.origin = o
    this.scale = s.scaleExp
    const [x, y, z] = s.cursorOffset()
    this.aim.set(x, y, z)
    viewRig.apply(this.aim, shift, this.cam.position, this.follow)
    if (zoomed) {
      // A zoom: the camera keeps its offset from the target, as carryOrbit does.
      this.cam.position.add(this.aim).sub(this.follow)
    } else {
      // Locked follow: the camera moves with the follow point.
      this.cam.position.add(this.aim).sub(this.follow)
    }
    this.follow.copy(this.aim)
    this.cam.target.copy(this.follow)
  }

  run(ms: number): void {
    for (let t = 0; t < ms - 1e-9; t += DT * 1000) this.frame()
  }

  /** The camera's offset from its target: the orbit's distance and angle. */
  orbit(): Vector3 {
    return this.cam.position.clone().sub(this.cam.target)
  }

  /** Where the cursor is drawn now, in the drawn frame. */
  cursorAt(): Vector3 {
    const [x, y, z] = cs().cursorOffset()
    return new Vector3(x, y, z)
  }
}

/** Frames until a let-go fly's coast has stopped. */
const coast = (): void => { for (let i = 0; viewOffset.moving && i < 600; i++) h.frame() }

/** Where looking down render -z goes, in cyberspace: one axis, with its sign. */
const ahead = (): { x: number; y: number; z: number } => renderToCyber([0, 0, -1], cs().axes())

let h: Harness
beforeEach(() => {
  useCyberspace.setState({ scaleExp: 0 })
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  flyGesture.clear()
  panGesture.clear()
  viewRig.reset()
  h = new Harness()
})
afterEach(() => {
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  panGesture.clear()
  useBuilder.getState().exit()
  cs().clearFocus()
  if (cs().walking) useCyberspace.setState({ walking: false })
  viewRig.reset()
})

describe('VIEW\'s fly moves the camera, not the cursor', () => {
  it('held, the camera and its target glide down the line of sight, easing in to FLY_CELLS_PER_SECOND cells a second; the cursor stays', () => {
    cs().viewHere()
    h.frame()
    const cursor = cs().cursor
    const orbit = h.orbit()
    const start = h.cam.target.clone()
    useViewFly.getState().setButton(1)
    const zs: number[] = []
    for (let i = 0; i < 60; i++) { h.frame(); zs.push(h.cam.target.z) }
    expect(cs().cursor).toBe(cursor)
    // Eased in: a second of holding flies toward -z, less than a full linear
    // second (FLY_CELLS_PER_SECOND) because the first part of the hold ramps up.
    const flew = start.z - h.cam.target.z
    expect(flew).toBeGreaterThan(0)
    expect(flew).toBeLessThan(FLY_CELLS_PER_SECOND)
    expect(h.cam.target.x).toBeCloseTo(start.x, 9)
    // Quadratic ease-in: the per-frame step grows, then holds at cruise,
    // FLY_CELLS_PER_SECOND of the zoom a second.
    const steps = zs.map((z, i) => (i === 0 ? start.z - z : zs[i - 1] - z))
    expect(steps[0]).toBeLessThan(steps[30])
    expect(steps[59]).toBeCloseTo(FLY_CELLS_PER_SECOND * DT, 6)
    // The orbit's distance and angle are untouched.
    expect(h.orbit().distanceTo(orbit)).toBeLessThan(1e-9)
  })

  it('the same number of cells at 2^0 and 2^12, and the landing 4,096 times the gibsons', () => {
    const land = (scaleExp: number): number => {
      cs().clearFocus()
      viewRig.reset()
      useCyberspace.setState({ scaleExp })
      h = new Harness()
      cs().viewHere()
      h.frame()
      const from = { ...cs().cursor }
      useViewFly.getState().setButton(1)
      // Long enough to leave the cursor's cell once the view comes in close.
      h.run(1500)
      useViewFly.getState().setButton(0)
      coast()
      h.run(LAND_IDLE_MS + LAND_LERP_MS + 100)
      const a = ahead()
      const axis = a.x !== 0 ? 'x' : a.y !== 0 ? 'y' : 'z'
      return Number(alignTo(cs().cursor[axis], scaleExp) - alignTo(from[axis], scaleExp)) / 2 ** scaleExp
    }
    // The same hold flies the same number of cells at either zoom; at 2^12
    // each is 4,096 times the gibsons. The count is whatever the eased fly
    // covers, derived here, not a fixed number.
    const l0 = Math.abs(land(0))
    const l12 = Math.abs(land(12))
    expect(l0).toBe(l12)
    expect(l0).toBeGreaterThan(0)
  })

  it('once it stops, the view centres just ahead of the camera; LAND_IDLE_MS later the box glides LAND_LERP_MS there, and only then does the cursor move', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(1500)
    useViewFly.getState().setButton(0)
    coast()
    // Where the view centres once it has eased to a stop: ORBIT_MIN_DISTANCE
    // ahead of the camera, not the 10 cells it orbited at, which is where the
    // cursor will land (arkinox, 2026-11-12).
    const flown = h.cam.target.clone()
    const stopped = h.cam.position.clone()
    expect(h.orbit().length()).toBeCloseTo(ORBIT_MIN_DISTANCE, 9)
    h.run(LAND_IDLE_MS - 50)
    expect(cs().cursor).toBe(from)
    expect(cursorGlide.share).toBe(0)
    h.run(100)
    // The glide is under way: the box is pushed toward the landing, the cursor has not moved.
    expect(cs().cursor).toBe(from)
    expect(cursorGlide.from).toBe(from)
    expect(cursorGlide.share).toBeGreaterThan(0)
    // The box is pushed toward the landing, however many cells the fly covered.
    expect(Math.hypot(cursorGlide.dx, cursorGlide.dy, cursorGlide.dz)).toBeGreaterThan(0)
    h.run(LAND_LERP_MS)
    expect(cs().cursor).not.toBe(from)
    // Where the view centred: the new cursor is drawn within half a cell of it on every axis.
    const at = h.cursorAt()
    expect(Math.abs(at.x - flown.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(at.y - flown.y)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(at.z - flown.z)).toBeLessThanOrEqual(0.5)
    // Neither the camera nor what it orbits moves when the cursor lands, nor
    // after: what the landing left over (the view's centre inside the cell)
    // is held, not eased out.
    h.run(EASE_BACK_MS + 50)
    expect(h.cam.target.distanceTo(flown)).toBeLessThan(1e-9)
    expect(h.cam.position.distanceTo(stopped)).toBeLessThan(1e-9)
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(0.87)
    expect(viewOffset.flown).toBe(false)
  })

  it('the landing does not jump the camera: frame to frame it moves less than a fly frame, and what it orbits only comes in along its line of sight', () => {
    cs().viewHere()
    h.frame()
    useViewFly.getState().setButton(1)
    h.run(700)
    useViewFly.getState().setButton(0)
    let last = h.cam.position.clone()
    let lastTarget = h.cam.target.clone()
    let worst = 0
    let sideways = 0
    for (let i = 0; i < ((1000 + LAND_IDLE_MS + LAND_LERP_MS + EASE_BACK_MS) / 1000) * 60 + 30; i++) {
      const look = h.cam.target.clone().sub(h.cam.position).normalize()
      h.frame()
      worst = Math.max(worst, h.cam.position.distanceTo(last))
      // The target's move less the camera's, across the line the camera looked down.
      const rel = h.cam.target.clone().sub(lastTarget).sub(h.cam.position.clone().sub(last))
      sideways = Math.max(sideways, rel.clone().addScaledVector(look, -rel.dot(look)).length())
      last = h.cam.position.clone()
      lastTarget = h.cam.target.clone()
    }
    // Never more than a fly frame in one frame: the ease-out coast's first
    // frame is the largest, and it is under a cruise frame's travel.
    expect(worst).toBeLessThan(FLY_CELLS_PER_SECOND * DT)
    // The view's centre came in along the line of sight: nothing turned.
    expect(sideways).toBeLessThan(1e-9)
    expect(h.orbit().length()).toBeCloseTo(ORBIT_MIN_DISTANCE, 9)
  })

  it('moving again calls a running glide off: the box goes back, and the cursor stays', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(1500)
    useViewFly.getState().setButton(0)
    coast()
    h.run(LAND_IDLE_MS + LAND_LERP_MS / 2)
    const halfway = cursorGlide.share
    expect(halfway).toBeGreaterThan(0)
    useViewFly.getState().setButton(1)
    h.frame()
    useViewFly.getState().setButton(0)
    expect(cursorGlide.share).toBeLessThan(halfway)
    // On its way back, and the cursor has not moved.
    h.run(LAND_LERP_MS / 2 - 40)
    expect(cursorGlide.share).toBeLessThan(halfway / 2)
    expect(cs().cursor).toBe(from)
    // Rested again, it lands after all.
    h.run(LAND_IDLE_MS + LAND_LERP_MS + 100)
    expect(cs().cursor).not.toBe(from)
  })

  it('a pad press before the landing steps from where the view has flown, so the camera is not pulled back', () => {
    cs().viewHere()
    h.frame()
    const from = { ...cs().cursor }
    const startTarget = h.cam.target.clone()
    useViewFly.getState().setButton(1)
    h.run(1000)
    useViewFly.getState().setButton(0)
    h.frame()
    const flown = h.cam.target.clone()
    // How many cells the eased fly covered, derived from the camera's travel.
    const flownCells = Math.round(flown.distanceTo(startTarget))
    // One cell up the screen.
    const up = cs().axes().up
    cs().moveCursor({ axis: up.axis, dir: up.dir as 1 | -1 })
    const a = ahead()
    const axis = (['x', 'y', 'z'] as const).find((k) => a[k] !== 0)!
    expect(Math.abs(Number(cs().cursor[axis] - from[axis]))).toBe(flownCells)
    h.run(EASE_BACK_MS + 50)
    // The camera went one cell up from where it had flown, not back to the
    // start: its depth stays at the flown depth (within the ease-out coast's
    // short tail), nowhere near the start it would be pulled back to.
    expect(h.cam.target.y - flown.y).toBeCloseTo(1, 6)
    expect(Math.abs(h.cam.target.z - flown.z)).toBeLessThan(FLY_CELLS_PER_SECOND * DT)
  })

  it('does nothing in BUILD or WALK, and BUILD lands an unlanded fly at once', () => {
    cs().viewHere()
    h.frame()
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    h.frame()
    const from = cs().cursor
    useBuilder.getState().toggle()
    expect(useBuilder.getState().active).toBe(true)
    h.frame()
    expect(cs().cursor).not.toBe(from)
    const built = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(300)
    expect(viewOffset.flown).toBe(false)
    expect(cs().cursor).toBe(built)
  })

  it('a zoom lands an unlanded fly where it was flown, and frames the new zoom on the cursor', () => {
    cs().viewHere()
    h.frame()
    const from = { ...cs().cursor }
    const startTarget = h.cam.target.clone()
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    h.frame()
    // The fly landed at the old zoom: the cursor steps by the cells it covered.
    const flownCells = Math.round(h.cam.target.distanceTo(startTarget))
    cs().adjustScale(1)
    h.frame()
    const a = ahead()
    const axis = (['x', 'y', 'z'] as const).find((k) => a[k] !== 0)!
    expect(Math.abs(Number(cs().cursor[axis] - from[axis]))).toBe(flownCells)
    expect(viewOffset.active).toBe(false)
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(1e-9)
  })

  it('a zoom after the landing works as ever: the orbit, now ORBIT_MIN_DISTANCE out, is carried, and the camera frames the cursor again', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(1500)
    useViewFly.getState().setButton(0)
    coast()
    h.run(LAND_IDLE_MS + LAND_LERP_MS + 100)
    expect(cs().cursor).not.toBe(from)
    const orbit = h.orbit()
    expect(orbit.length()).toBeCloseTo(ORBIT_MIN_DISTANCE, 9)
    for (const step of [1, -1, -1]) {
      cs().adjustScale(step)
      h.frame()
      expect(viewOffset.active).toBe(false)
      expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(1e-9)
      expect(h.orbit().distanceTo(orbit)).toBeLessThan(1e-9)
    }
  })

  it('a long fly re-anchors the view on where it has flown, and the cursor still waits', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    const anchor = cs().anchor
    useViewFly.getState().setButton(1)
    h.run(4000)
    expect(cs().anchor).not.toBe(anchor)
    expect(cs().cursor).toBe(from)
    // The camera kept flying straight through the re-anchor: the cursor is
    // drawn far behind it, nearly four seconds of cruise (less the ease-in).
    const behind = h.cam.target.distanceTo(h.cursorAt())
    expect(behind).toBeGreaterThan(3 * FLY_CELLS_PER_SECOND)
    expect(behind).toBeLessThan(4 * FLY_CELLS_PER_SECOND)
  })
})

describe('the pan', () => {
  /** Two fingers that land and drag `dx`, `dy` CSS pixels together. */
  const drag = (dx: number, dy: number): void => {
    panGesture.down(1, 100, 400); panGesture.down(2, 300, 400)
    for (let i = 1; i <= 10; i++) {
      panGesture.move(1, 100 + (dx * i) / 10, 400 + (dy * i) / 10)
      panGesture.move(2, 300 + (dx * i) / 10, 400 + (dy * i) / 10)
    }
  }
  const lift = (): void => { panGesture.up(1); panGesture.up(2) }

  it('moves the camera and its target across the screen, never the cursor, and keeps the orbit', () => {
    cs().viewHere()
    h.frame()
    const cursor = cs().cursor
    const orbit = h.orbit()
    const start = h.cam.target.clone()
    drag(100, 0)
    h.frame()
    lift()
    // Dragged right, the world follows the fingers: the camera goes left.
    expect(h.cam.target.x).toBeLessThan(start.x)
    expect(h.cam.target.y).toBeCloseTo(start.y, 9)
    expect(cs().cursor).toBe(cursor)
    expect(h.orbit().distanceTo(orbit)).toBeLessThan(1e-9)
    // A drag of the screen's height moves the target by what the screen shows at its distance.
    const shown = 2 * 10 * Math.tan((55 * Math.PI) / 360)
    expect(start.x - h.cam.target.x).toBeCloseTo((100 / 800) * shown, 9)
  })

  it('stays where it was put, however long, and never lands the cursor', () => {
    cs().viewHere()
    h.frame()
    const cursor = cs().cursor
    drag(0, -120)
    h.frame()
    lift()
    const panned = h.cam.target.clone()
    h.run(LAND_IDLE_MS * 2)
    expect(h.cam.target.distanceTo(panned)).toBeLessThan(1e-9)
    expect(cs().cursor).toBe(cursor)
  })

  it('the cursor moving brings the camera back onto its orbit about it, smoothly, over EASE_BACK_MS', () => {
    cs().viewHere()
    h.frame()
    drag(160, 0)
    h.frame()
    lift()
    const panned = h.cam.target.clone()
    const right = cs().axes().right
    cs().moveCursor({ axis: right.axis, dir: right.dir as 1 | -1 })
    h.frame()
    // No jump on the frame the cursor moves.
    expect(h.cam.target.distanceTo(panned)).toBeLessThan(0.05)
    let last = h.cam.target.clone()
    for (let t = 0; t < EASE_BACK_MS; t += DT * 1000) {
      h.frame()
      expect(h.cam.target.distanceTo(last)).toBeLessThan(0.25)
      last = h.cam.target.clone()
    }
    h.frame()
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(1e-9)
  })

  it('works in any third-person view: at your head (HOP) too', () => {
    h.frame()
    const start = h.cam.target.clone()
    drag(0, 80)
    h.frame()
    lift()
    expect(h.cam.target.y).toBeGreaterThan(start.y)
  })

  it('never in WALK: a drag there moves nothing, and an offset already made eases out', () => {
    h.frame()
    drag(100, 0)
    h.frame()
    lift()
    expect(viewOffset.active).toBe(true)
    useCyberspace.setState({ walking: true })
    h.run(EASE_BACK_MS + 50)
    expect(viewOffset.active).toBe(false)
    const before = h.cam.target.clone()
    drag(100, 0)
    h.frame()
    lift()
    expect(h.cam.target.distanceTo(before)).toBeLessThan(1e-9)
  })
})

describe('review of #635', () => {
  it('B1: a fly re-anchor along z alone is the fly\'s only while its focus stands; RETURN after it is a real change of focus', () => {
    cs().viewHere()
    h.frame()
    const anchor = { ...cs().anchor }
    useViewFly.getState().setButton(1)
    h.run(4000)
    useViewFly.getState().setButton(0)
    const a = ahead()
    const axis = (['x', 'y', 'z'] as const).find((k) => a[k] !== 0)!
    // Moved along the line of sight only: the old focusPoint (x alone) never changed, so the effect never ran.
    expect(cs().anchor[axis]).not.toBe(anchor[axis])
    for (const k of ['x', 'y', 'z'] as const) if (k !== axis) expect(cs().anchor[k]).toBe(anchor[k])
    const flown = cs().focus
    // RETURN, with no effect run in between: the change is not the fly's.
    cs().clearFocus()
    expect(takeFlyReanchor(cs().focus)).toBe(false)
    // And asked for the fly's own focus after any run, it has forgotten it too.
    expect(takeFlyReanchor(flown)).toBe(false)
  })

  it('B1: the effect\'s focus point reads all three axes, and it asks with the focus it sees', () => {
    const src = readFileSync('src/scene/Scene.tsx', 'utf8')
    expect(src).toMatch(/const focusPoint = useCyberspace\(\(s\) => \(s\.focus \? `\$\{s\.focus\.position\.x\},\$\{s\.focus\.position\.y\},\$\{s\.focus\.position\.z\}` : ''\)\)/)
    expect(src).toMatch(/const flyMoved = takeFlyReanchor\(s\.focus\)/)
  })

  it('B1: the fly\'s own re-anchor is recognised by the focus it made', () => {
    cs().viewHere()
    h.frame()
    useViewFly.getState().setButton(1)
    let seen = false
    for (let i = 0; i < 300 && !seen; i++) {
      const before = cs().focus
      h.frame()
      if (cs().focus !== before) seen = takeFlyReanchor(cs().focus)
    }
    expect(seen).toBe(true)
  })

  it('N5: orbiting or zooming after a fly holds the landing off; it comes 2 s after the hand stops', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    // Three seconds of orbit: the camera turns about its target every frame.
    for (let t = 0; t < 3000; t += DT * 1000) {
      const o = h.cam.position.clone().sub(h.cam.target).applyAxisAngle(new Vector3(0, 1, 0), 0.01)
      h.cam.position.copy(h.cam.target).add(o)
      h.frame()
    }
    expect(cs().cursor).toBe(from)
    h.run(LAND_IDLE_MS - 100)
    expect(cs().cursor).toBe(from)
    h.run(LAND_LERP_MS + 300)
    expect(cs().cursor).not.toBe(from)
  })

  it('N2: a re-anchor the store declines is not asked again every frame', () => {
    cs().viewHere()
    h.frame()
    useViewFly.getState().setButton(1)
    h.run(100)
    useViewFly.getState().setButton(0)
    coast()
    // Panned far off the field (the flight itself is small): the view centre is out of reach, the landing is not.
    // The stopped fly orbits ORBIT_MIN_DISTANCE out, so a pixel pans that much less.
    const spy = vi.spyOn(cs(), 'reanchorView')
    const calls = (): number => spy.mock.calls.length
    useCyberspace.setState({ reanchorView: spy as never })
    panGesture.down(1, 100, 400); panGesture.down(2, 300, 400)
    for (let i = 1; i <= 20; i++) { panGesture.move(1, 100 + i * 600, 400); panGesture.move(2, 300 + i * 600, 400) }
    h.frame()
    panGesture.up(1); panGesture.up(2)
    expect(Math.abs(h.cam.target.x)).toBeGreaterThan(24)
    for (let i = 0; i < 60; i++) h.frame()
    // Asked once, declined, and not asked again while the view stays put.
    expect(calls()).toBe(1)
    spy.mockRestore()
  })

  it('N6: BUILD entering lands an unlanded fly before it asks whether the cursor left the avatar', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(1000)
    useViewFly.getState().setButton(0)
    h.frame()
    useBuilder.getState().enter('build')
    expect(cs().cursor).not.toBe(from)
    expect(useBuilder.getState().leftAvatar).toBe(true)
    expect(viewOffset.flown).toBe(false)
  })
})
