/**
 * viewFlightPivot.test.ts - VIEW's fly and the camera's turn (arkinox,
 * 2026-11-12):
 *
 * 1. "When flying, dragging rotates the camera around a point in front of it
 *    that represents the distance the camera was from the cursor before it
 *    began flight. During flight, the center of orbit for the camera should
 *    be the camera itself. Make sure it transitions from this to the cursor
 *    smoothly without camera jumps."
 * 2. "If I use my right thumb to drag the screen to rotate while my left
 *    thumb holds the forward (or back) button, the camera kind of jerks
 *    around. We should maybe ignore dragging on the button if other dragging
 *    is happening."
 *
 * The camera is turned by the real OrbitControls (three-stdlib, damped as
 * drei sets it), driven by pointer events, through the rig's frame in
 * Scene.tsx's order: the controls' own update (drei, before the rig), the
 * rig's pivot, the offset's two halves, then mark, the rig's update and the
 * pivot again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three-stdlib'

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

import { flyGesture, installFlyTouches, panGesture, sceneHeld, steerToSpend, viewRig, viewOffset, type RigCamera } from '../ViewFly'
import { steerBy, takeSteer, useViewFly } from '../../lib/viewFly'
import { FlightPivot, LAND_IDLE_MS, LAND_LERP_MS, PIVOT_EASE_MS, ViewOffset, FLY_MIN_VEL } from '../../lib/viewCamera'
import { alignedOrigin, useCyberspace } from '../../store/useCyberspace'
import { viewToAvatar } from '../../store/padMode'
import { useBuilder } from '../../store/useBuilder'
import { originShift, type Position } from '../../lib/space'
import { ORBIT_MIN_DISTANCE } from '../camera'

const cs = () => useCyberspace.getState()
const DT = 1 / 60
const HEIGHT = 800

/**
 * A page for the controls: the document, its root element, and the scene's
 * element. Moves and lifts bubble through the root before the document (as
 * in the browser), so the gate on the root runs ahead of OrbitControls'
 * document listeners whenever they were added.
 */
function page() {
  const html = new EventTarget()
  const doc = Object.assign(new EventTarget(), { documentElement: html })
  const el = Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    ownerDocument: doc,
    clientHeight: HEIGHT,
    clientWidth: 400,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  })
  return { doc, el }
}
const ev = (type: string, init: Record<string, unknown>): Event => Object.assign(new Event(type), init)
const touchAt = (id: number, x: number, y: number, primary = false, pointerType = 'touch') => ({ pointerType, pointerId: id, isPrimary: primary, button: 0, buttons: 1, clientX: x, clientY: y, pageX: x, pageY: y })
/** An event on its way out of the page: the root element, then (unless stopped there) the document. */
function bubble(type: string, init: Record<string, unknown>): void {
  const first = ev(type, init)
  doc.documentElement.dispatchEvent(first)
  if (!first.cancelBubble) doc.dispatchEvent(ev(type, init))
}

let doc: ReturnType<typeof page>['doc']
let el: ReturnType<typeof page>['el']
let camera: PerspectiveCamera
let controls: OrbitControls
let rigCam: RigCamera
let uninstall: () => void
const follow = new Vector3()
const aim = new Vector3()
/** The render frame's origin last frame: a long fly re-anchors, and the camera rides the shift as Scene.tsx's does. */
let prevOrigin: Position | null = null

/** A finger landing on the scene: the document hears it first (capture), then the scene's element. */
function sceneDown(id: number, x: number, y: number, primary = false): void {
  doc.dispatchEvent(ev('pointerdown', touchAt(id, x, y, primary)))
  el.dispatchEvent(ev('pointerdown', touchAt(id, x, y, primary)))
}
/** A finger landing on a HUD control: only the document hears it. */
function hudDown(id: number, x: number, y: number, primary = false): void {
  doc.dispatchEvent(ev('pointerdown', touchAt(id, x, y, primary)))
}
const moveTo = (id: number, x: number, y: number, kind = 'touch'): void => { bubble('pointermove', touchAt(id, x, y, false, kind)) }
const lift = (id: number, x: number, y: number, kind = 'touch'): void => { bubble('pointerup', { ...touchAt(id, x, y, false, kind), buttons: 0 }) }

/**
 * One frame, in Scene.tsx's order; the camera is unlocked (a drag unlocks it),
 * the follow catches up at once. Returns the line of sight the fly flew down
 * and the render frame's shift (a re-anchor moves camera and world together:
 * not motion, so the measures take it off).
 */
function frame(): { look: Vector3; shift: Vector3 } {
  controls.update() // drei's, before the rig's frame
  viewRig.pivot(camera.position, controls.target, follow)
  const look = controls.target.clone().sub(camera.position).normalize()
  // As Scene.tsx does: the rig reads COPIES made at the top of the frame, so
  // between frames it holds the last frame's start (settle, pad and BUILD).
  rigCam.position.copy(camera.position)
  rigCam.target.copy(controls.target)
  rigCam.quaternion.copy(camera.quaternion)
  viewRig.before(rigCam, DT)
  const s = cs()
  const origin = alignedOrigin(s.anchor, s.scaleExp)
  const shift = prevOrigin ? originShift(prevOrigin, origin, s.scaleExp, s.axes()) : ([0, 0, 0] as [number, number, number])
  prevOrigin = origin
  camera.position.x += shift[0]; camera.position.y += shift[1]; camera.position.z += shift[2]
  follow.x += shift[0]; follow.y += shift[1]; follow.z += shift[2]
  const [x, y, z] = s.cursorOffset()
  aim.set(x, y, z)
  viewRig.apply(aim, shift, camera.position, follow)
  follow.copy(aim)
  controls.target.copy(follow)
  // Scene.tsx's restore of an orbit a fly brought in (a press on the scene holds it, as Scene.tsx's pressed()).
  viewRig.restoreOrbit(camera.position, controls.target, DT, sceneHeld())
  viewRig.mark(camera.position, controls.target)
  controls.update() // the rig's own
  viewRig.pivot(camera.position, controls.target, follow)
  camera.updateMatrixWorld()
  return { look, shift: new Vector3(...shift) }
}
/** How the camera moved in the world over a frame from `prev`: its render move less the frame's shift. */
const movedFrom = (prev: Vector3, f: { shift: Vector3 }): Vector3 => camera.position.clone().sub(prev).sub(f.shift)

const yaw = (): number => { const d = controls.target.clone().sub(camera.position); return Math.atan2(d.x, d.z) }
const turnOf = (a: number, b: number): number => { let t = b - a; if (t > Math.PI) t -= 2 * Math.PI; if (t < -Math.PI) t += 2 * Math.PI; return t }
/** The part of `m` across the unit line `u`. */
const across = (m: Vector3, u: Vector3): number => m.clone().addScaledVector(u, -m.dot(u)).length()

beforeEach(() => {
  ;({ doc, el } = page())
  camera = new PerspectiveCamera(55, 0.5, 0.1, 5000)
  camera.position.set(0, 0, 26)
  controls = new OrbitControls(camera, el as never)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.enablePan = false
  // As Scene.tsx sets it: the near point sits exactly on this clamp.
  controls.minDistance = ORBIT_MIN_DISTANCE
  rigCam = { position: new Vector3(), target: new Vector3(), quaternion: camera.quaternion.clone(), fov: 55, heightPx: HEIGHT }
  uninstall = installFlyTouches(el, doc, new EventTarget(), () => 0)
  useCyberspace.setState({ scaleExp: 0 })
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  viewRig.reset()
  follow.set(0, 0, 0)
  prevOrigin = null
  cs().viewHere()
  frame()
})
afterEach(() => {
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  takeSteer()
  uninstall()
  controls.dispose()
  flyGesture.clear()
  panGesture.clear()
  cs().clearFocus()
  viewRig.reset()
})

describe('FlightPivot and ViewOffset.moving', () => {
  it('the weight eases from the view centre to the camera over PIVOT_EASE_MS and back, smooth at both ends', () => {
    const p = new FlightPivot()
    expect(p.weight).toBe(0)
    p.step(true, PIVOT_EASE_MS / 2)
    expect(p.weight).toBeCloseTo(0.5, 9)
    p.step(true, PIVOT_EASE_MS)
    expect(p.weight).toBe(1)
    p.step(false, PIVOT_EASE_MS / 4)
    expect(p.weight).toBeGreaterThan(0.8)
    expect(p.weight).toBeLessThan(1)
    p.step(false, PIVOT_EASE_MS)
    expect(p.weight).toBe(0)
  })

  it('shift: at 1 the camera stays where it was and only its line of sight turns; at 0 nothing; between, the pivot is on the line of sight; a zoom is left alone', () => {
    const p = new FlightPivot()
    const before = { x: 0, y: 0, z: 26 }
    // A turn of 0.3 rad about the target, as OrbitControls makes it.
    const now = { x: 26 * Math.sin(0.3), y: 0, z: 26 * Math.cos(0.3) }
    const out = { x: 9, y: 9, z: 9 }
    expect(p.shift(before, now, out)).toEqual({ x: 0, y: 0, z: 0 })
    p.step(true, PIVOT_EASE_MS)
    p.shift(before, now, out)
    // The camera (target + offset), slid: back exactly where it was.
    expect(now.x + out.x).toBeCloseTo(before.x, 12)
    expect(now.z + out.z).toBeCloseTo(before.z, 12)
    // Half way: the camera turned about the point half way to the target.
    const half = new FlightPivot()
    half.step(true, PIVOT_EASE_MS / 2)
    half.shift(before, now, out)
    const cam = new Vector3(now.x + out.x, 0, now.z + out.z)
    const pivot = new Vector3(0, 0, 13)
    expect(cam.distanceTo(pivot)).toBeCloseTo(13, 9)
    // A pinch: the same line, half the distance, no slide.
    p.shift(before, { x: 0, y: 0, z: 13 }, out)
    expect(Math.hypot(out.x, out.y, out.z)).toBe(0)
  })

  it('a fly is moving while held and while it coasts, and not once the coast has stopped', () => {
    const o = new ViewOffset()
    expect(o.moving).toBe(false)
    for (let i = 0; i < 30; i++) o.fly(0, 0, -1, 1, DT)
    expect(o.moving).toBe(true)
    o.rest()
    o.step(DT * 1000)
    expect(o.moving).toBe(true)
    for (let i = 0; i < 120; i++) o.step(DT * 1000)
    expect(o.moving).toBe(false)
    expect(FLY_MIN_VEL).toBeGreaterThan(0)
  })
})

describe('1. in flight the camera turns in place; after it, the pivot glides out to the view centre without a jump', () => {
  it('flying and dragging: the camera moves only along the line it looks down; the fly follows the turned line; the turn is the drag\'s own', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 30; i++) frame()
    expect(viewRig.pivotWeight).toBe(1)
    sceneDown(1, 200, 400, true)
    let x = 200
    let worst = 0
    let turned = 0
    let prev = camera.position.clone()
    let y0 = yaw()
    for (let i = 0; i < 40; i++) {
      x += 3
      moveTo(1, x, 400)
      const f = frame()
      const look = f.look
      const m = movedFrom(prev, f)
      worst = Math.max(worst, across(m, look))
      turned += turnOf(y0, yaw())
      y0 = yaw()
      prev = camera.position.clone()
    }
    // 40 drags of 3 px at 2*PI per 800 px, every bit of it turned.
    expect(Math.abs(turned)).toBeGreaterThan(0.6)
    // Never swung round the point out in front: no sideways motion at all.
    expect(worst).toBeLessThan(1e-9)
    // The view centre went round the camera at the distance it had.
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(26, 6)
    lift(1, x, 400)
  })

  it('without a fly the same drag orbits the view centre exactly as before', () => {
    sceneDown(1, 200, 400, true)
    const centre = controls.target.clone()
    let x = 200
    for (let i = 0; i < 40; i++) { x += 3; moveTo(1, x, 400); frame() }
    expect(viewRig.pivotWeight).toBe(0)
    expect(controls.target.distanceTo(centre)).toBeLessThan(1e-9)
    expect(camera.position.distanceTo(centre)).toBeCloseTo(26, 6)
    expect(Math.abs(camera.position.x)).toBeGreaterThan(10)
    lift(1, x, 400)
  })

  it('the frames the pivot hands back over render exactly as the frame before them (camera matrices, no drag)', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 30; i++) frame()
    // A turn in flight, then the hand rests: the controls' damping dies away.
    sceneDown(1, 200, 400, true)
    for (let i = 1; i <= 15; i++) { moveTo(1, 200 + 4 * i, 400); frame() }
    lift(1, 260, 400)
    useViewFly.getState().setButton(0)
    // The coast: the camera still moves along its line until it stops.
    let n = 0
    while (viewOffset.moving && n++ < 200) frame()
    // The frame the coast stopped began the handover.
    expect(viewRig.pivotWeight).toBeGreaterThan(0.9)
    expect(viewRig.pivotWeight).toBeLessThan(1)
    let prev = camera.matrixWorld.clone()
    let handover = 0
    let worst = 0
    while (viewRig.pivotWeight > 0 && handover++ < 100) {
      frame()
      const m = camera.matrixWorld
      for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(m.elements[k] - prev.elements[k]))
      prev = m.clone()
    }
    expect(handover).toBeGreaterThan(5)
    expect(viewRig.pivotWeight).toBe(0)
    expect(worst).toBeLessThan(1e-6)
  })

  it('a drag held steadily across the end of a fly: the turn never changes, and the camera eases from turning in place to orbiting the view centre with no frame jumping', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 30; i++) frame()
    sceneDown(1, 100, 400, true)
    let x = 100
    const drag = (): void => { x += 2; moveTo(1, x, 400) }
    // Settle into the steady turn (damping) while flying.
    for (let i = 0; i < 30; i++) { drag(); frame() }
    useViewFly.getState().setButton(0)
    const turns: number[] = []
    const steps: number[] = []
    const weights: number[] = []
    let prev = camera.position.clone()
    let y0 = yaw()
    for (let i = 0; i < 100; i++) {
      drag()
      const f = frame()
      const m = movedFrom(prev, f)
      turns.push(turnOf(y0, yaw()))
      weights.push(viewRig.pivotWeight)
      // Only the sideways part: the coast's travel along the line is the fly's.
      const look = controls.target.clone().sub(camera.position).normalize()
      steps.push(across(m, look))
      y0 = yaw()
      prev = camera.position.clone()
    }
    // The handover happened inside the window.
    const first = weights.findIndex((w) => w < 1)
    const last = weights.findIndex((w) => w === 0)
    expect(first).toBeGreaterThan(0)
    expect(last).toBeGreaterThan(first)
    // The turn per frame is the drag's, steady through it all.
    const turn = turns[turns.length - 1]
    for (const t of turns) expect(t).toBeCloseTo(turn, 6)
    // A full orbit's swing a frame at the end, none at the start of the handover:
    // an orbit about the view's centre, come in to ORBIT_MIN_DISTANCE ahead as
    // the coast stopped (arkinox, 2026-11-12), not the 26 cells it was.
    const orbit = ORBIT_MIN_DISTANCE * Math.abs(turn)
    expect(steps[first - 1]).toBeLessThan(orbit * 0.05)
    expect(steps[steps.length - 1]).toBeCloseTo(orbit, 3)
    // No frame jumps: the swing never exceeds an orbit's, and through the
    // handover grows by at most the eased weight's steepest step (1.5 / frames
    // in PIVOT_EASE_MS) a frame. (The coast before it drifts a little off the
    // turning line of sight whatever the orbit, so the growth is measured from
    // the handover's first frame.)
    const steepest = (1.5 * DT * 1000) / PIVOT_EASE_MS
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThanOrEqual(orbit * 1.0001 + 1e-9)
      if (i >= first) expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThanOrEqual(orbit * steepest * 1.05 + 1e-9)
    }
    lift(1, x, 400)
  })

  it('the turn in flight is part of where the view has flown: the cursor lands where the view now centres, and the camera does not jump when it does', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 20; i++) frame()
    sceneDown(1, 200, 400, true)
    for (let i = 1; i <= 30; i++) { moveTo(1, 200 + 5 * i, 400); frame() }
    lift(1, 350, 400)
    useViewFly.getState().setButton(0)
    const cursor0 = { ...cs().cursor }
    let worst = 0
    let prev = camera.position.clone()
    for (let i = 0; i < 4 * 60; i++) {
      const f = frame()
      worst = Math.max(worst, movedFrom(prev, f).length())
      prev = camera.position.clone()
    }
    expect(cs().cursor).not.toEqual(cursor0)
    // Landed: the view centres on the cursor again, within the gibson it rounded to.
    const [cx, cy, cz] = cs().cursorOffset()
    expect(controls.target.distanceTo(new Vector3(cx, cy, cz))).toBeLessThan(0.9)
    // The coast's last frames and the landing: never a leap.
    expect(worst).toBeLessThan(1)
  })
})

describe('1c. the cursor lands just ahead of the camera (arkinox, 2026-11-12)', () => {
  // "when I fly in View mode, I expect the cursor to appear directly in front
  // of me or right around where the camera is. it tends to appear at the same
  // distance from the camera that it was before the flight."
  /** The cell's half-diagonal: how far the drawn cursor can be from a point inside its cell. */
  const HALF_DIAG = Math.sqrt(3) / 2
  const cursorAt = (): Vector3 => { const [x, y, z] = cs().cursorOffset(); return new Vector3(x, y, z) }
  const lookDir = (): Vector3 => controls.target.clone().sub(camera.position).normalize()
  /** Fly forward `frames` frames, let go, and run until the coast has stopped. */
  const flyAndStop = (frames: number): void => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < frames; i++) frame()
    useViewFly.getState().setButton(0)
    let n = 0
    while (viewOffset.moving && n++ < 200) frame()
  }
  /** Frames until the cursor has landed (or `limit` frames). */
  const untilLanded = (from: Position, limit = 120): number => {
    let n = 0
    while (cs().cursor === from && n++ < limit) frame()
    return n
  }

  it('after a long flight the cursor lands within a cell or so ahead of the camera along its line of sight, not the 26 cells it orbited at', () => {
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(26, 6)
    const from = cs().cursor
    // Three seconds of flight: well past a field width, so the view re-anchors on the way.
    const anchor = cs().anchor
    flyAndStop(180)
    expect(cs().anchor).not.toBe(anchor)
    // The frame the coast stopped: what the camera orbits came in to ORBIT_MIN_DISTANCE ahead.
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(ORBIT_MIN_DISTANCE, 6)
    const stopped = camera.position.clone()
    const look = lookDir()
    const frames = untilLanded(from)
    expect(cs().cursor).not.toBe(from)
    // Promptly: LAND_IDLE_MS of rest and the LAND_LERP_MS glide, a few frames over.
    expect(frames * DT * 1000).toBeLessThan(LAND_IDLE_MS + LAND_LERP_MS + 100)
    const rel = cursorAt().sub(camera.position)
    // Ahead, and close: ORBIT_MIN_DISTANCE along the line, give or take the cell it rounded to.
    expect(rel.dot(look)).toBeGreaterThan(ORBIT_MIN_DISTANCE - HALF_DIAG)
    expect(rel.length()).toBeLessThan(ORBIT_MIN_DISTANCE + HALF_DIAG)
    expect(across(rel, look)).toBeLessThan(HALF_DIAG)
    // The camera never moved for any of it.
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-9)
  })

  it('the camera renders exactly as it was from the coast\'s stop through the handover, the landing and after (camera matrices); the headlamp\'s reach eases in', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 120; i++) frame()
    useViewFly.getState().setButton(0)
    const from = cs().cursor
    let reach = camera.position.distanceTo(controls.target) + viewRig.reachOwed
    let worstReach = 0
    let prev = camera.matrixWorld.clone()
    let worst = 0
    let coasted = 0
    for (let i = 0; i < 90; i++) {
      const wasMoving = viewOffset.moving
      frame()
      const r = camera.position.distanceTo(controls.target) + viewRig.reachOwed
      worstReach = Math.max(worstReach, Math.abs(r - reach))
      reach = r
      // The coast still travels down its line: measured from the frame it stops.
      if (wasMoving) { coasted++; prev = camera.matrixWorld.clone(); continue }
      const m = camera.matrixWorld
      for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(m.elements[k] - prev.elements[k]))
      prev = m.clone()
    }
    expect(coasted).toBeGreaterThan(5)
    expect(cs().cursor).not.toBe(from)
    expect(worst).toBeLessThan(1e-9)
    // 26 cells to 2 by the handover's eased weight, never in one frame.
    expect(worstReach).toBeLessThan(24 * (1.5 * DT * 1000) / PIVOT_EASE_MS * 1.05)
    expect(viewRig.reachOwed).toBe(0)
  })

  it('after landing a drag orbits a small radius about a point inside the cursor\'s cell', () => {
    const from = cs().cursor
    flyAndStop(120)
    untilLanded(from)
    for (let i = 0; i < 30; i++) frame()
    const centre = controls.target.clone()
    expect(centre.distanceTo(cursorAt())).toBeLessThan(HALF_DIAG)
    sceneDown(1, 200, 400, true)
    let x = 200
    for (let i = 0; i < 40; i++) { x += 4; moveTo(1, x, 400); frame() }
    lift(1, x, 400)
    // Turned about the near point: it stays put and the camera goes round it, ORBIT_MIN_DISTANCE out.
    expect(controls.target.distanceTo(centre)).toBeLessThan(1e-9)
    expect(camera.position.distanceTo(centre)).toBeCloseTo(ORBIT_MIN_DISTANCE, 6)
    expect(Math.abs(yaw())).toBeGreaterThan(0.3)
  })

  it('a drag through the settle never sends the cursor back out to the old distance', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 120; i++) frame()
    useViewFly.getState().setButton(0)
    const from = cs().cursor
    // A finger down as the coast runs out, and dragging all through the handover and the settle.
    sceneDown(1, 200, 400, true)
    let x = 200
    let n = 0
    while (viewOffset.moving && n++ < 200) { x += 3; moveTo(1, x, 400); frame() }
    for (let i = 0; i < 60; i++) {
      x += 3
      moveTo(1, x, 400)
      frame()
      // A drag is not rest: no landing under it, and the view's centre stays close.
      expect(cs().cursor).toBe(from)
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(ORBIT_MIN_DISTANCE, 6)
    }
    lift(1, x, 400)
    // The hand stops (the controls' damping dies away), the cursor lands: ahead and close.
    untilLanded(from, 300)
    expect(cs().cursor).not.toBe(from)
    const rel = cursorAt().sub(camera.position)
    expect(rel.length()).toBeLessThan(ORBIT_MIN_DISTANCE + HALF_DIAG)
    expect(rel.dot(lookDir())).toBeGreaterThan(0)
  })

  it('a short hop too: the cursor comes to just ahead of the camera, wherever it was before, and the camera stays', () => {
    const from = cs().cursor
    flyAndStop(5)
    const stopped = camera.position.clone()
    untilLanded(from)
    expect(cs().cursor).not.toBe(from)
    const rel = cursorAt().sub(camera.position)
    expect(rel.length()).toBeLessThan(ORBIT_MIN_DISTANCE + HALF_DIAG)
    expect(rel.dot(lookDir())).toBeGreaterThan(ORBIT_MIN_DISTANCE - HALF_DIAG)
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-9)
  })
})

describe('1d. review of #690', () => {
  const cursorAt = (): Vector3 => { const [x, y, z] = cs().cursorOffset(); return new Vector3(x, y, z) }
  const tap = (frames: number): void => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < frames; i++) frame()
    useViewFly.getState().setButton(0)
  }
  const rest = (frames: number): void => { for (let i = 0; i < frames; i++) frame() }

  it('1: short taps after a landing add up: the camera only ever goes forward, and the cursor follows it', () => {
    tap(120)
    rest(90)
    const from = cs().cursor
    const look = controls.target.clone().sub(camera.position).normalize()
    let prev = camera.position.clone()
    let back = 0
    let travelled = 0
    for (let t = 0; t < 8; t++) {
      // A 100 ms tap, then long enough to land.
      tap(6)
      for (let i = 0; i < 60; i++) {
        const f = frame()
        const m = movedFrom(prev, f)
        back = Math.min(back, m.dot(look))
        travelled += m.dot(look)
        prev = camera.position.clone()
      }
    }
    // Never a step back along the line (before the fix every tap slid back by the last).
    expect(back).toBeGreaterThan(-1e-9)
    expect(travelled).toBeGreaterThan(1)
    expect(cs().cursor).not.toBe(from)
    expect(cursorAt().distanceTo(camera.position)).toBeLessThan(ORBIT_MIN_DISTANCE + Math.sqrt(3) / 2)
  })

  it('2: RECALL after a fly asks the orbit back out to its distance before the fly; so does VIEW ending', () => {
    tap(120)
    rest(90)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(ORBIT_MIN_DISTANCE, 6)
    expect(viewRig.takeRestore()).toBeNull()
    viewToAvatar()
    frame()
    expect(viewRig.takeRestore()).toBeCloseTo(26, 6)
    expect(viewRig.takeRestore()).toBeNull()
    // VIEW ending (RETURN) after another fly.
    viewRig.reset()
    cs().viewHere()
    frame()
    tap(120)
    rest(90)
    cs().clearFocus()
    frame()
    expect(viewRig.takeRestore()).toBeGreaterThan(ORBIT_MIN_DISTANCE + 1)
  })

  it('2: a hand dolly after the fly makes the distance its own: nothing is restored', () => {
    tap(120)
    rest(90)
    // A pinch's worth: the camera out along its line.
    const off = camera.position.clone().sub(controls.target).multiplyScalar(3)
    camera.position.copy(controls.target).add(off)
    rest(5)
    viewToAvatar()
    frame()
    expect(viewRig.takeRestore()).toBeNull()
  })

  it('4: another fly started as the lamp\'s reach comes in does not step it', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 120; i++) frame()
    useViewFly.getState().setButton(0)
    let n = 0
    while (viewOffset.moving && n++ < 200) frame()
    frame()
    expect(viewRig.reachOwed).toBeGreaterThan(5)
    let reach = camera.position.distanceTo(controls.target) + viewRig.reachOwed
    let worst = 0
    let owed = viewRig.reachOwed
    let rose = 0
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 40; i++) {
      frame()
      const r = camera.position.distanceTo(controls.target) + viewRig.reachOwed
      worst = Math.max(worst, Math.abs(r - reach))
      reach = r
      // Its own clock: it keeps fading through the second fly, never climbing back (round 2, 5).
      rose = Math.max(rose, viewRig.reachOwed - owed)
      owed = viewRig.reachOwed
    }
    expect(worst).toBeLessThan(24 * (1.5 * DT * 1000) / PIVOT_EASE_MS * 1.05)
    expect(rose).toBe(0)
    expect(viewRig.reachOwed).toBe(0)
  })

  // Round 2 (the rig reads per-frame copies of the camera, as in Scene.tsx).
  const lookNow = (): Vector3 => controls.target.clone().sub(camera.position).normalize()
  const up = (): { axis: 'x' | 'y' | 'z'; dir: 1 | -1 } => { const u = cs().axes().up; return { axis: u.axis, dir: u.dir as 1 | -1 } }
  /** The view still looks the way it did and what it orbits is in front of it, close. */
  const facing = (look0: Vector3): void => {
    expect(lookNow().dot(look0)).toBeGreaterThan(0.9)
    expect(controls.target.clone().sub(camera.position).dot(look0)).toBeGreaterThan(0)
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(ORBIT_MIN_DISTANCE + 2)
  }
  const flyToStop = (): void => {
    tap(120)
    let n = 0
    while (viewOffset.moving && n++ < 200) frame()
  }

  it('round 2, 1: a pad press between the coast stopping and the landing does not turn the camera round', () => {
    const from = cs().cursor
    flyToStop()
    expect(cs().cursor).toBe(from)
    const look0 = lookNow()
    cs().moveCursor(up())
    for (let i = 0; i < 40; i++) frame()
    facing(look0)
  })

  it('round 2, 1: BUILD entered between the coast stopping and the landing does not turn the camera round', () => {
    const from = cs().cursor
    flyToStop()
    expect(cs().cursor).toBe(from)
    const look0 = lookNow()
    useBuilder.getState().enter('build')
    try {
      expect(cs().cursor).not.toBe(from)
      for (let i = 0; i < 40; i++) frame()
      facing(look0)
    } finally { useBuilder.getState().exit() }
  })

  it('round 2, 1: two presses between the same two frames in the coast bring the view in once', () => {
    tap(120)
    frame(); frame()
    expect(viewOffset.moving).toBe(true)
    const look0 = lookNow()
    cs().moveCursor(up())
    cs().moveCursor(up())
    for (let i = 0; i < 40; i++) frame()
    facing(look0)
  })

  it('round 2, 2: a fly started just after RECALL ends the restore: after its coast the orbit stays in close', () => {
    tap(120)
    rest(90)
    viewToAvatar()
    expect(viewRig.restoreTo).not.toBeNull()
    rest(12)
    tap(30)
    let n = 0
    while (viewOffset.moving && n++ < 200) frame()
    expect(viewRig.restoreTo).toBeNull()
    const d0 = camera.position.distanceTo(controls.target)
    expect(d0).toBeCloseTo(ORBIT_MIN_DISTANCE, 6)
    for (let i = 0; i < 120; i++) {
      frame()
      // Not pushed back out by a restore still running.
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(d0, 6)
    }
  })

  it('round 2, 3: anything else holding the camera (the tutorial\'s zoom, a /demo step) ends a pending restore; Scene.tsx says so', () => {
    tap(120)
    rest(90)
    viewToAvatar()
    expect(viewRig.restoreTo).not.toBeNull()
    expect(viewRig.restoreOrbit(camera.position, controls.target, DT, true)).toBe(false)
    expect(viewRig.restoreTo).toBeNull()
    const src = readFileSync('src/scene/Scene.tsx', 'utf8')
    expect(src).toMatch(/viewRig\.restoreOrbit\(c\.object\.position, c\.target, dt, s\.walking \|\| pressed\(\) > 0 \|\| tutorialZoom !== null \|\| want !== null \|\| eye\.current !== null\)/)
  })

  it('round 2, 4: RETURN whose re-frame cuts (resetting the rig) still asks the orbit back out', () => {
    tap(120)
    rest(90)
    cs().clearFocus()
    // The rig effect's cut, before any frame sees VIEW gone.
    viewRig.reset()
    expect(viewRig.restoreTo).toBeCloseTo(26, 6)
  })

  it('round 2, 6: a pad press with the camera unlocked (its distance changes as the follow point moves) is not a hand dolly', () => {
    tap(120)
    rest(90)
    // The first press eases the landing's remainder out (the camera rides the
    // offset); once that is over, a press moves only the follow point.
    cs().moveCursor(up())
    rest(40)
    const d0 = camera.position.distanceTo(controls.target)
    cs().moveCursor(up())
    rest(40)
    // The harness's camera is unlocked: the follow point moved, the camera did not.
    expect(Math.abs(camera.position.distanceTo(controls.target) - d0)).toBeGreaterThan(0.01)
    viewToAvatar()
    expect(viewRig.restoreTo).toBeCloseTo(26, 6)
  })
})

describe('1a. the tutorial\'s auto-rotate is not a hand turn (review of #685, 3)', () => {
  it('a turn the pivot is told not to answer is left as an orbit, and only marked', () => {
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 30; i++) frame()
    expect(viewRig.pivotWeight).toBe(1)
    const centre = controls.target.clone()
    // The controls turn the camera about the target, as auto-rotate does.
    const off = camera.position.clone().sub(centre).applyAxisAngle(new Vector3(0, 1, 0), 0.2)
    camera.position.copy(centre).add(off)
    const turnedTo = camera.position.clone()
    viewRig.pivot(camera.position, controls.target, follow, false)
    expect(camera.position.distanceTo(turnedTo)).toBe(0)
    expect(controls.target.distanceTo(centre)).toBe(0)
    // Marked: the next pivot does not answer it late.
    viewRig.pivot(camera.position, controls.target, follow)
    expect(camera.position.distanceTo(turnedTo)).toBe(0)
  })
})

describe('1b. RECALL in VIEW (#683) and the pivot', () => {
  for (const when of ['mid-flight, the fly still held', 'in the handover, after the coast'] as const) {
    it(`RECALL ${when}: the fly lands, the pivot stops sliding at once, and the camera does not jump on that frame`, () => {
      useViewFly.getState().setButton(1)
      for (let i = 0; i < 25; i++) frame()
      sceneDown(1, 200, 400, true)
      let x = 200
      for (let i = 0; i < 10; i++) { x += 3; moveTo(1, x, 400); frame() }
      if (when === 'in the handover, after the coast') {
        useViewFly.getState().setButton(0)
        let n = 0
        while (viewOffset.moving && n++ < 200) { x += 3; moveTo(1, x, 400); frame() }
        expect(viewRig.pivotWeight).toBeGreaterThan(0)
        expect(viewRig.pivotWeight).toBeLessThan(1)
      }
      const flownBefore = viewOffset.flown
      expect(flownBefore).toBe(true)
      viewToAvatar()
      // The landing released the offset: nothing flown, so nothing for the pivot to slide.
      expect(viewOffset.flown).toBe(false)
      const prev = camera.position.clone()
      x += 3
      moveTo(1, x, 400)
      const f = frame()
      // The frame RECALL lands in: the camera moves no more than one frame of a drag, a fly and the ease home.
      expect(movedFrom(prev, f).length()).toBeLessThan(2)
      if (when === 'in the handover, after the coast') {
        // Nothing flies now: the drag orbits the view's centre again (its distance kept), no slide.
        const d0 = camera.position.distanceTo(controls.target)
        x += 3
        moveTo(1, x, 400)
        frame()
        expect(viewOffset.flown).toBe(false)
        expect(camera.position.distanceTo(controls.target)).toBeCloseTo(d0, 6)
      }
      lift(1, x, 400)
    })
  }
})

describe('2. a finger that landed on a HUD control never moves the camera', () => {
  /** The scene finger drags 40 frames; with `hud`, a thumb rests on a HUD button and wobbles. */
  function twoThumbs(hud: boolean): number[] {
    if (hud) hudDown(7, 40, 700, true)
    sceneDown(1, 200, 400, !hud)
    const yaws: number[] = []
    let x = 200
    for (let i = 0; i < 40; i++) {
      if (hud) moveTo(7, 40 + (i % 2 ? 1.5 : -1.5), 700 + (i % 4 < 2 ? 1 : -1))
      x += 3
      moveTo(1, x, 400)
      frame()
      yaws.push(yaw())
    }
    if (hud) lift(7, 40, 700)
    // After the thumb lifts, the scene finger's drag goes on turning.
    for (let i = 0; i < 5; i++) { x += 3; moveTo(1, x, 400); frame(); yaws.push(yaw()) }
    lift(1, x, 400)
    return yaws
  }

  it('the resting thumb\'s wobble and its lift change nothing: the camera turns exactly as with the scene finger alone', () => {
    const alone = twoThumbs(false)
    // Fresh controls, so no damping carries over from the first run, then the camera back where it began.
    controls.dispose()
    controls = new OrbitControls(camera, el as never)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.enablePan = false
    controls.minDistance = ORBIT_MIN_DISTANCE
    viewRig.reset()
    prevOrigin = null
    camera.position.set(0, 0, 26)
    follow.set(0, 0, 0)
    frame()
    const withThumb = twoThumbs(true)
    expect(withThumb.length).toBe(alone.length)
    for (let i = 0; i < alone.length; i++) expect(withThumb[i]).toBeCloseTo(alone[i], 9)
    // And it did turn, steadily one way.
    for (let i = 1; i < withThumb.length; i++) expect(turnOf(withThumb[i - 1], withThumb[i])).toBeLessThan(0)
  })

  it('two fingers on the scene still pinch: the gate only keeps out fingers from elsewhere', () => {
    sceneDown(1, 150, 400, true)
    sceneDown(2, 250, 400)
    const d0 = camera.position.distanceTo(controls.target)
    for (let i = 1; i <= 10; i++) { moveTo(1, 150 - 5 * i, 400); moveTo(2, 250 + 5 * i, 400); frame() }
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(d0 * 0.8)
    lift(2, 300, 400)
    lift(1, 100, 400)
  })

  it('with no finger on the scene, a HUD finger\'s moves and lift go on to the document as before', () => {
    const heard: string[] = []
    const later = (e: Event): void => { heard.push(e.type) }
    doc.addEventListener('pointermove', later)
    doc.addEventListener('pointerup', later)
    hudDown(7, 40, 700, true)
    moveTo(7, 42, 700)
    lift(7, 42, 700)
    expect(heard).toEqual(['pointermove', 'pointerup'])
    // With a finger on the scene, they stop short of it.
    heard.length = 0
    sceneDown(1, 200, 400, true)
    hudDown(8, 40, 700)
    moveTo(8, 42, 700)
    lift(8, 42, 700)
    moveTo(1, 210, 400)
    expect(heard).toEqual(['pointermove'])
    lift(1, 210, 400)
    doc.removeEventListener('pointermove', later)
    doc.removeEventListener('pointerup', later)
  })

  it("the fly button's drag is spent only with nothing pressed on the scene, and drained either way", () => {
    steerBy(12, -3)
    expect(steerToSpend()).toEqual({ dx: 12, dy: -3 })
    sceneDown(1, 200, 400, true)
    expect(sceneHeld()).toBe(true)
    steerBy(2, 1)
    expect(steerToSpend()).toBeNull()
    lift(1, 200, 400)
    expect(sceneHeld()).toBe(false)
    // What the button gathered while the scene finger was down is gone, not saved up.
    expect(steerToSpend()).toBeNull()
    steerBy(1, 0)
    expect(steerToSpend()).toEqual({ dx: 1, dy: 0 })
  })

  it('a pen on the scene closes the gate too, and the steer waits for it (review of #685, 1)', () => {
    const heard: string[] = []
    const later = (e: Event): void => { heard.push(e.type) }
    doc.addEventListener('pointermove', later)
    const down = touchAt(3, 200, 400, true, 'pen')
    doc.dispatchEvent(ev('pointerdown', down))
    el.dispatchEvent(ev('pointerdown', down))
    expect(sceneHeld()).toBe(true)
    steerBy(5, 0)
    expect(steerToSpend()).toBeNull()
    hudDown(7, 40, 700)
    moveTo(7, 42, 700)
    expect(heard).toEqual([])
    lift(3, 200, 400, 'pen')
    expect(sceneHeld()).toBe(false)
    moveTo(7, 44, 700)
    expect(heard).toEqual(['pointermove'])
    lift(7, 44, 700)
    doc.removeEventListener('pointermove', later)
  })

  it("Scene.tsx's rig: the steer is steerToSpend's, the pivot runs after it and around the rig's update, never answering the tutorial's auto-rotate", () => {
    const src = readFileSync('src/scene/Scene.tsx', 'utf8')
    const at = src.indexOf('\nfunction Rig(')
    const body = src.slice(at, src.indexOf('\nfunction ', at + 1))
    const loop = body.slice(body.indexOf('useFrame((state, dt) =>'))
    expect(loop).toMatch(/const steer = steerToSpend\(\)/)
    const top = loop.indexOf('viewRig.pivot(')
    expect(top).toBeGreaterThan(loop.indexOf('steerToSpend()'))
    expect(top).toBeLessThan(loop.indexOf('viewRig.before('))
    const update = loop.indexOf('c.update()')
    expect(loop.lastIndexOf('viewRig.mark(', update)).toBeGreaterThan(loop.indexOf('viewRig.apply('))
    expect(loop.indexOf('viewRig.pivot(', update)).toBeGreaterThan(update)
    expect(loop.match(/viewRig\.pivot\([^)]*!c\.autoRotate\)/g)?.length).toBe(2)
  })
})
