/**
 * viewFlyTick.test.ts - the camera's offset against the real store, one frame
 * at a time, as Scene.tsx's rig runs it (scene/ViewFly.ts viewRig.before and
 * viewRig.apply; arkinox, 2026-11-09):
 *
 * - VIEW's fly moves the camera along its line of sight, linearly, and not
 *   the cursor; two seconds after it stops the cursor box glides to the cell
 *   the view now centres on, and the cursor moves there when it arrives.
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

import { flyGesture, panGesture, viewOffset, viewRig, type RigCamera } from '../ViewFly'
import { FLY_CELLS_PER_SECOND, renderToCyber, useViewFly } from '../../lib/viewFly'
import { cursorGlide, EASE_BACK_MS, LAND_IDLE_MS, LAND_LERP_MS } from '../../lib/viewCamera'
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
  it('held, the camera and its target glide down the line of sight, linearly, FLY_CELLS_PER_SECOND cells a second; the cursor stays', () => {
    cs().viewHere()
    h.frame()
    const cursor = cs().cursor
    const orbit = h.orbit()
    const start = h.cam.target.clone()
    useViewFly.getState().setButton(1)
    const zs: number[] = []
    for (let i = 0; i < 60; i++) { h.frame(); zs.push(h.cam.target.z) }
    expect(cs().cursor).toBe(cursor)
    expect(h.cam.target.z - start.z).toBeCloseTo(-FLY_CELLS_PER_SECOND, 6)
    expect(h.cam.target.x).toBeCloseTo(start.x, 9)
    // Linear: the same step every frame.
    for (let i = 1; i < zs.length; i++) expect(zs[i - 1] - zs[i]).toBeCloseTo(FLY_CELLS_PER_SECOND * DT, 9)
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
      h.run(500)
      useViewFly.getState().setButton(0)
      h.run(LAND_IDLE_MS + LAND_LERP_MS + 100)
      const a = ahead()
      const axis = a.x !== 0 ? 'x' : a.y !== 0 ? 'y' : 'z'
      return Number(alignTo(cs().cursor[axis], scaleExp) - alignTo(from[axis], scaleExp)) / 2 ** scaleExp
    }
    expect(Math.abs(land(0))).toBe(4)
    expect(Math.abs(land(12))).toBe(4)
  })

  it('two seconds after it stops, the box glides LAND_LERP_MS to the cell the view centres on, and only then does the cursor move', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    const flown = h.cam.target.clone()
    h.run(LAND_IDLE_MS - 50)
    expect(cs().cursor).toBe(from)
    expect(cursorGlide.share).toBe(0)
    h.run(100)
    // The glide is under way: the box is pushed toward the landing, the cursor has not moved.
    expect(cs().cursor).toBe(from)
    expect(cursorGlide.from).toBe(from)
    expect(cursorGlide.share).toBeGreaterThan(0)
    expect(Math.hypot(cursorGlide.dx, cursorGlide.dy, cursorGlide.dz)).toBeCloseTo(4, 6)
    h.run(LAND_LERP_MS)
    expect(cs().cursor).not.toBe(from)
    // Where the view centred: the new cursor is drawn within half a cell of it on every axis.
    const at = h.cursorAt()
    expect(Math.abs(at.x - flown.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(at.y - flown.y)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(at.z - flown.z)).toBeLessThanOrEqual(0.5)
    // The camera does not jump when the cursor lands, and ends framing it exactly.
    expect(h.cam.target.distanceTo(flown)).toBeLessThan(0.51)
    h.run(EASE_BACK_MS + 50)
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(1e-9)
    expect(viewOffset.active).toBe(false)
  })

  it('the landing does not jump the camera: frame to frame it moves less than a fly frame', () => {
    cs().viewHere()
    h.frame()
    useViewFly.getState().setButton(1)
    h.run(700)
    useViewFly.getState().setButton(0)
    let last = h.cam.target.clone()
    let worst = 0
    for (let i = 0; i < ((LAND_IDLE_MS + LAND_LERP_MS + EASE_BACK_MS) / 1000) * 60 + 30; i++) {
      h.frame()
      worst = Math.max(worst, h.cam.target.distanceTo(last))
      last = h.cam.target.clone()
    }
    expect(worst).toBeLessThan(0.1)
  })

  it('moving again calls a running glide off: the box goes back, and the cursor stays', () => {
    cs().viewHere()
    h.frame()
    const from = cs().cursor
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    h.run(LAND_IDLE_MS + LAND_LERP_MS / 2)
    const halfway = cursorGlide.share
    expect(halfway).toBeGreaterThan(0)
    useViewFly.getState().setButton(1)
    h.frame()
    useViewFly.getState().setButton(0)
    expect(cursorGlide.share).toBeLessThan(halfway)
    h.run(LAND_LERP_MS + 50)
    expect(cursorGlide.share).toBe(0)
    expect(cs().cursor).toBe(from)
  })

  it('a pad press before the landing steps from where the view has flown, so the camera is not pulled back', () => {
    cs().viewHere()
    h.frame()
    const from = { ...cs().cursor }
    useViewFly.getState().setButton(1)
    h.run(1000)
    useViewFly.getState().setButton(0)
    h.frame()
    const flown = h.cam.target.clone()
    // One cell up the screen.
    const up = cs().axes().up
    cs().moveCursor({ axis: up.axis, dir: up.dir as 1 | -1 })
    const a = ahead()
    const axis = (['x', 'y', 'z'] as const).find((k) => a[k] !== 0)!
    expect(Math.abs(Number(cs().cursor[axis] - from[axis]))).toBe(FLY_CELLS_PER_SECOND)
    h.run(EASE_BACK_MS + 50)
    // The camera went one cell up from where it had flown, not back to the start.
    expect(h.cam.target.y - flown.y).toBeCloseTo(1, 6)
    expect(h.cam.target.z).toBeCloseTo(flown.z, 6)
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
    useViewFly.getState().setButton(1)
    h.run(500)
    useViewFly.getState().setButton(0)
    h.frame()
    cs().adjustScale(1)
    h.frame()
    const a = ahead()
    const axis = (['x', 'y', 'z'] as const).find((k) => a[k] !== 0)!
    expect(Math.abs(Number(cs().cursor[axis] - from[axis]))).toBe(4)
    expect(viewOffset.active).toBe(false)
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeLessThan(1e-9)
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
    // The camera kept flying straight through the re-anchor: the cursor is drawn 32 cells behind it.
    expect(h.cam.target.distanceTo(h.cursorAt())).toBeCloseTo(4 * FLY_CELLS_PER_SECOND, 6)
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
