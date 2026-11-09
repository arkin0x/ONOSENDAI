/**
 * ViewFly.ts - the camera's offset from its orbit in the scene: VIEW's fly
 * and the two-finger pan (lib/viewFly.ts and lib/viewCamera.ts have the rules).
 *
 * The rig (Scene.tsx) calls two things every frame:
 *
 * - viewRig.before, at the top of the frame, before it reads the cursor,
 *   the way it calls WALK's tickFall: it flies the view along the line the
 *   camera looks down while a fly is held, takes the frame's pan, and after
 *   LAND_IDLE_MS of rest glides the cursor box to where the view now centres
 *   and lands the cursor there (aimView) when the glide ends. A zoom, or the
 *   view ceasing to be one that flies (BUILD), lands an unlanded fly at once.
 * - viewRig.apply, once the rig knows the target it frames this frame and how
 *   far the render frame shifted since the last: it moves the camera and the
 *   follow point by however much the offset changed, whether or not the camera
 *   is locked to the cursor, so a pan or a fly carries the camera straight
 *   across and the orbit's distance and angle stay exactly as they were; it
 *   sees the cursor move (by anything: the pad, a tap, a jump, the landing)
 *   and eases the camera back onto its orbit; and it returns the target with
 *   the offset added.
 *
 * A long fly re-anchors the free view every field width, as moving the
 * cursor did (useCyberspace rideView), without moving the cursor
 * (reanchorView), so the field keeps being drawn ahead of the camera. The
 * rig's focus effect is told that re-anchor is the fly's (takeFlyReanchor),
 * so it neither glides nor re-locks the camera for it.
 *
 * useFlyTouches feeds the scene's touches to both gestures: the fly's (off
 * for now, lib/viewFly.ts TOUCH_FLY_FORWARD) and the pan's, plus the mouse's
 * right or Shift drag to the pan. Only presses that land on the scene's
 * canvas: a finger on a button or a panel is that control's. Moves and lifts
 * are heard on the document in the capture phase, as the walk look hears
 * them, so a finger that drifts over the HUD or a release a HUD handler stops
 * still counts.
 */

import { useEffect } from 'react'
import { Vector3, type Quaternion } from 'three'
import { alignedOrigin, samePosition, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useTv } from '../store/useTv'
import { aimCentres, GRID_RADIUS, type AxisName, type Position, type ViewAxes } from '../lib/space'
import { canFly, flyDir, FlyGesture, landingOf, setFlyLanding, useViewFly } from '../lib/viewFly'
import { cursorGlide, OFFSET_EPS, PanGesture, setViewCentre, ViewOffset, type Vec3Out } from '../lib/viewCamera'

/** The scene's fly gesture (two and three fingers at rest; off for now), fed by useFlyTouches. */
export const flyGesture = new FlyGesture()
/** The scene's pan gesture (two fingers that drag, a right or Shift drag of the mouse). */
export const panGesture = new PanGesture()
/** The camera's offset from its orbit about the cursor. */
export const viewOffset = new ViewOffset()

/** Scratch, so the frame allocates nothing. */
const look = new Vector3()
const right = new Vector3()
const up = new Vector3()
const px = { x: 0, y: 0 }
const want: Vec3Out = { x: 0, y: 0, z: 0 }
const flownCyber: Record<AxisName, number> = { x: 0, y: 0, z: 0 }

/** A render-space offset as cyberspace components (the view's axes are a signed permutation), into flownCyber. */
function toCyber(x: number, y: number, z: number, axes: ViewAxes): Record<AxisName, number> {
  flownCyber.x = 0; flownCyber.y = 0; flownCyber.z = 0
  flownCyber[axes.right.axis] += x * axes.right.dir
  flownCyber[axes.up.axis] += y * axes.up.dir
  flownCyber[axes.out.axis] += z * axes.out.dir
  return flownCyber
}

/** Where the view has flown to, as a coordinate the cursor could land on; null when it has not flown. */
function flownLanding(scaleExp: number = useCyberspace.getState().scaleExp): Position | null {
  if (!viewOffset.flown) return null
  const s = useCyberspace.getState()
  return landingOf(s.cursor, toCyber(viewOffset.fx, viewOffset.fy, viewOffset.fz, s.axes()), scaleExp)
}

/** Whether the free view the cursor rides is up, so a landing can be written (aimView). */
const driven = (): boolean => {
  const s = useCyberspace.getState()
  return s.focus?.drive === true && s.exploreIndex === null
}

// A pad press before the fly lands steps from where the view has flown (useCyberspace moveCursor).
setFlyLanding(() => (driven() && !useCyberspace.getState().walking ? flownLanding() : null))

/** The re-anchor the fly just made, for the rig's focus effect to pass over. */
let flyReanchor = false
/** True once after the fly re-anchored the view: the focus change is the fly's, not a new subject. */
export function takeFlyReanchor(): boolean {
  const was = flyReanchor
  flyReanchor = false
  return was
}

/** The camera, as the frame sees it: where it is, where it looks, its field of view and the canvas height. */
export interface RigCamera {
  position: Vector3
  target: Vector3
  quaternion: Quaternion
  fov: number
  heightPx: number
}

/**
 * The rig's half of the offset: what it has already put into the camera and
 * the follow point, and the target it framed last frame, to tell a moved
 * cursor from a moved render frame.
 */
export class ViewRigOffset {
  private applied = new Vector3()
  private last = new Vector3()
  private lastValid = false
  private lastScale: number | null = null
  private landing: Position | null = null

  /** True while a fly is under way (the rig's glide waits it out). */
  flying = false

  /**
   * The top of the frame: fly, pan, and the landing's timing, `dt` seconds.
   * May write the cursor (a landing), so it runs before the rig reads it.
   */
  before(cam: RigCamera, dt: number): void {
    const s = useCyberspace.getState()
    const building = useBuilder.getState().active
    const tv = useTv.getState().on
    useViewFly.getState().setTouch(flyGesture.dir(performance.now()))

    // A zoom: an unlanded fly lands now, where it was flown at the old zoom,
    // and the rig frames the new zoom afresh (apply sees the scale change).
    if (this.lastScale !== null && s.scaleExp !== this.lastScale) {
      if (viewOffset.flown && driven()) this.land(flownLanding(this.lastScale))
      viewOffset.clear()
    }
    this.lastScale = s.scaleExp

    const flies = canFly(s, building) && !tv
    // The view stopped being one that flies (BUILD, RETURN, history) with a
    // fly unlanded: still a free view (BUILD), it lands now; else it eases back.
    if (!flies && viewOffset.flown) {
      if (driven() && !s.walking && !tv) this.land(flownLanding())
      viewOffset.release()
    }

    const dir = flies ? flyDir() : 0
    this.flying = dir !== 0
    if (dir !== 0) {
      look.copy(cam.target).sub(cam.position)
      const len = look.length()
      if (len > 0) viewOffset.fly(look.x / len, look.y / len, look.z / len, dir, dt)
    } else viewOffset.rest()

    // The pan: any third-person view, never WALK or TV.
    const pans = !s.walking && !tv
    if (panGesture.take(px) && pans) {
      // A drag of one pixel moves the world under the finger by one pixel at
      // the distance of what the camera orbits, as OrbitControls pans.
      const dist = cam.position.distanceTo(cam.target)
      const k = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, cam.heightPx)
      right.set(1, 0, 0).applyQuaternion(cam.quaternion)
      up.set(0, 1, 0).applyQuaternion(cam.quaternion)
      viewOffset.pan(
        (-px.x * right.x + px.y * up.x) * k,
        (-px.x * right.y + px.y * up.y) * k,
        (-px.x * right.z + px.y * up.z) * k,
      )
    }
    // WALK and TV are first person and watching: the camera goes back to its orbit.
    if (!pans && viewOffset.held) viewOffset.release()

    const event = viewOffset.step(dt * 1000)
    if (event === 'glide-start') {
      const to = flies ? flownLanding() : null
      if (to) {
        // Where the box goes: the landing cell less the cursor's cell, in render cells.
        const origin = alignedOrigin(s.anchor, s.scaleExp)
        const a = aimCentres(s.cursor, origin, s.scaleExp, s.axes()).cell
        const b = aimCentres(to, origin, s.scaleExp, s.axes()).cell
        cursorGlide.from = s.cursor
        cursorGlide.dx = b[0] - a[0]
        cursorGlide.dy = b[1] - a[1]
        cursorGlide.dz = b[2] - a[2]
        this.landing = to
      } else viewOffset.cancelGlide()
    } else if (event === 'land') {
      if (flies && this.landing && cursorGlide.from === s.cursor) this.land(this.landing)
      // Whatever the landing left over (under a gibson, or the cursor's place
      // inside its cell) eases out; the cursor's move itself is rebased in apply.
      viewOffset.release()
      this.landing = null
    }
    cursorGlide.share = viewOffset.glide
  }

  /**
   * The frame's target `aim` (render, drawn frame), and how far the render
   * frame shifted since the last frame, or null when there is no continuous
   * path (a zoom, a cut, the first frame): the camera and follow point take
   * the offset's change, and `aim` comes back with the offset added.
   */
  apply(aim: Vector3, shift: readonly [number, number, number] | null, camera: Vector3, follow: Vector3): void {
    if (shift === null) {
      // The rig framed the camera itself (a zoom, a cut): back on the orbit, nothing owed.
      viewOffset.clear()
      this.applied.set(0, 0, 0)
      this.last.copy(aim)
      this.lastValid = true
      cursorGlide.share = 0
      setViewCentre(0, 0, 0)
      return
    }
    if (this.lastValid && viewOffset.active) {
      // The target moved in the world (not by the frame's shift): the cursor
      // moved. The offset eases back from exactly where the camera is.
      const dx = aim.x - (this.last.x + shift[0])
      const dy = aim.y - (this.last.y + shift[1])
      const dz = aim.z - (this.last.z + shift[2])
      if (Math.abs(dx) > OFFSET_EPS || Math.abs(dy) > OFFSET_EPS || Math.abs(dz) > OFFSET_EPS) {
        viewOffset.rebase(dx, dy, dz)
        this.applied.x -= dx
        this.applied.y -= dy
        this.applied.z -= dz
      }
    }
    this.last.copy(aim)
    this.lastValid = true
    viewOffset.offset(want)
    const ddx = want.x - this.applied.x
    const ddy = want.y - this.applied.y
    const ddz = want.z - this.applied.z
    if (ddx !== 0 || ddy !== 0 || ddz !== 0) {
      camera.x += ddx; camera.y += ddy; camera.z += ddz
      follow.x += ddx; follow.y += ddy; follow.z += ddz
      this.applied.set(want.x, want.y, want.z)
    }
    aim.x += want.x
    aim.y += want.y
    aim.z += want.z
    setViewCentre(want.x, want.y, want.z)
    // Flown out of the field's reach: the view re-anchors on where it has
    // flown, the cursor staying where it waits (useCyberspace reanchorView).
    if (viewOffset.flown && (Math.abs(aim.x) > GRID_RADIUS || Math.abs(aim.y) > GRID_RADIUS || Math.abs(aim.z) > GRID_RADIUS)) {
      const at = driven() ? flownLanding() : null
      if (at) {
        const s = useCyberspace.getState()
        const before = s.anchor
        s.reanchorView(at)
        if (useCyberspace.getState().anchor !== before) flyReanchor = true
      }
    }
  }

  /** The rig re-framed the camera itself (a cut or a re-frame in its effect): nothing owed, nothing to compare with. */
  reset(): void {
    viewOffset.clear()
    this.applied.set(0, 0, 0)
    this.lastValid = false
    cursorGlide.share = 0
    setViewCentre(0, 0, 0)
  }

  private land(to: Position | null): void {
    const s = useCyberspace.getState()
    // A fly too short to leave the cursor's cell writes nothing.
    if (!to || samePosition(to, s.cursor)) return
    s.aimView(to, s.anchorPlane)
  }
}

/** The rig's one offset. */
export const viewRig = new ViewRigOffset()

type Listening = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Feed the presses that land on `surface` to the fly and pan gestures:
 * downs on the surface, moves and lifts on `doc` in the capture phase, and
 * the page's own count of fingers left after each lift. A mouse's right
 * button, or its left with Shift held, drags a pan. Returns the uninstall.
 */
export function installFlyTouches(surface: Listening, doc: Listening, win: Listening, clock: () => number = () => performance.now()): () => void {
  const touch = (e: PointerEvent): boolean => e.pointerType === 'touch'
  let mouse: { id: number; x: number; y: number } | null = null
  const down = (ev: Event): void => {
    const e = ev as PointerEvent
    if (e.pointerType === 'mouse') {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        mouse = { id: e.pointerId, x: e.clientX, y: e.clientY }
        panGesture.setMouse(true)
      }
      return
    }
    if (!touch(e)) return
    // The first finger of a touch: no other is down, so any finger still
    // counted is one whose lift was never heard (it ended off the page, or
    // a handler swallowed it) and must not turn two fingers into three.
    if (e.isPrimary) { flyGesture.clear(); panGesture.clear() }
    flyGesture.down(e.pointerId, e.clientX, e.clientY, clock())
    panGesture.down(e.pointerId, e.clientX, e.clientY)
  }
  const move = (ev: Event): void => {
    const e = ev as PointerEvent
    if (mouse && e.pointerId === mouse.id) {
      // A release this listener never heard (let go off the page) ends the drag.
      if ((e.buttons & 3) === 0) { mouse = null; panGesture.setMouse(false); return }
      panGesture.drag(e.clientX - mouse.x, e.clientY - mouse.y)
      mouse.x = e.clientX
      mouse.y = e.clientY
      return
    }
    if (!touch(e)) return
    flyGesture.move(e.pointerId, e.clientX, e.clientY)
    panGesture.move(e.pointerId, e.clientX, e.clientY)
  }
  const up = (ev: Event): void => {
    const e = ev as PointerEvent
    if (mouse && e.pointerId === mouse.id) { mouse = null; panGesture.setMouse(false); return }
    if (!touch(e)) return
    flyGesture.up(e.pointerId, clock())
    panGesture.up(e.pointerId)
  }
  // After the lift's pointer event: how many fingers the page says are still down.
  const left = (ev: Event): void => {
    const n = (ev as TouchEvent).touches?.length ?? 0
    flyGesture.touchesLeft(n)
    panGesture.touchesLeft(n)
  }
  const clear = (): void => {
    flyGesture.clear()
    panGesture.clear()
    mouse = null
    useViewFly.getState().setTouch(0)
  }
  // In the capture phase, so the gestures have counted a finger before
  // OrbitControls hears it land (the rig's onStart asks how many are down).
  surface.addEventListener('pointerdown', down, { capture: true })
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerup', up, true)
  doc.addEventListener('pointercancel', up, true)
  doc.addEventListener('touchend', left, true)
  doc.addEventListener('touchcancel', left, true)
  win.addEventListener('blur', clear)
  return () => {
    surface.removeEventListener('pointerdown', down, { capture: true })
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('pointercancel', up, true)
    doc.removeEventListener('touchend', left, true)
    doc.removeEventListener('touchcancel', left, true)
    win.removeEventListener('blur', clear)
    clear()
  }
}

/** Feed the presses that land on `surface` (the scene's canvas) to the fly and pan gestures. */
export function useFlyTouches(surface: HTMLElement): void {
  useEffect(() => installFlyTouches(surface, surface.ownerDocument, window), [surface])
}
