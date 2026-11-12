/**
 * ViewFly.ts - the camera's offset from its orbit in the scene: VIEW's fly
 * and the two-finger pan (lib/viewFly.ts and lib/viewCamera.ts have the rules).
 *
 * The rig (Scene.tsx) calls two things every frame:
 *
 * - viewRig.before, at the top of the frame, before it reads the cursor,
 *   the way it calls WALK's tickFall: it flies the view along the line the
 *   camera looks down while a fly is held, takes the frame's pan, and the
 *   frame the fly's coast stops brings the view's centre in along the line
 *   of sight to ORBIT_MIN_DISTANCE ahead of the camera, the camera staying
 *   put (arkinox, 2026-11-12: "when I fly in View mode, I expect the cursor
 *   to appear directly in front of me or right around where the camera is").
 *   After LAND_IDLE_MS of rest it glides the cursor box there and lands the
 *   cursor (aimView) when the glide ends, the camera still not moving (keep).
 *   A pad press, a zoom or BUILD in the coast stops it there first (settle);
 *   a zoom, or the view ceasing to be one that flies (BUILD), lands an
 *   unlanded fly at once. RECALL, or VIEW ending, eases the orbit back out
 *   to its distance before the fly (takeRestore, Scene.tsx).
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
 *
 * It also keeps a finger that landed off the scene away from the camera
 * (arkinox, 2026-11-12: "If I use my right thumb to drag the screen to
 * rotate while my left thumb holds the forward (or back) button, the camera
 * kind of jerks around"). OrbitControls hears moves and lifts on the whole
 * document and never asks whose they are: the resting thumb's every wobble on
 * the button was read as the dragging thumb, and the camera turned by the
 * gap between the two thumbs, back and forth, frame after frame; its lift
 * ended the drag. While a finger is on the scene, the moves and lifts of a
 * finger that landed anywhere else stop at the page's root on their way out,
 * after every control's own handlers and before the document hears them.
 */

import { useEffect } from 'react'
import { Vector3, type Quaternion } from 'three'
import { alignedOrigin, samePosition, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useTv } from '../store/useTv'
import { aimCentres, GRID_RADIUS, type AxisName, type Position, type ViewAxes } from '../lib/space'
import { canFly, flyDir, FlyGesture, landingOf, PINCH_SLOP_PX, setFlyLander, setFlyLanding, takeSteer, useViewFly } from '../lib/viewFly'
import { cursorGlide, ease, FlightPivot, nearShift, OFFSET_EPS, PanGesture, PIVOT_EASE_MS, setViewCentre, ViewOffset, type Vec3Out } from '../lib/viewCamera'
import { ORBIT_MIN_DISTANCE } from './camera'

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
const turned: Vec3Out = { x: 0, y: 0, z: 0 }
const slid: Vec3Out = { x: 0, y: 0, z: 0 }
const near: Vec3Out = { x: 0, y: 0, z: 0 }
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

// A pad press before the fly lands steps from where the view has flown
// (useCyberspace moveCursor); in the coast, from where it comes to rest just
// ahead of the camera, the tail cut short (review of #690, 3).
setFlyLanding(() => {
  if (!driven() || useCyberspace.getState().walking) return null
  viewRig.settle()
  return flownLanding()
})

/**
 * The focus the fly's last re-anchor made (reanchorView writes a new focus
 * object), for the rig's focus effect to pass over. Identity, not a flag: a
 * flag set by a re-anchor the effect never saw (it did not run for it) stuck,
 * and the next real change of focus (RETURN, a stop) was passed over as the
 * fly's, the camera left on the avatar (review of #635, B1).
 */
let flyFocus: unknown = null
/**
 * Whether `focus` (the store's now) is the one the fly's re-anchor made, so
 * this change of focus is the fly's and not a new subject. Every call
 * forgets the record: it answers for the effect run that asks, never later.
 */
export function takeFlyReanchor(focus: unknown): boolean {
  const mine = focus !== null && focus === flyFocus
  flyFocus = null
  return mine
}

/** The mouse on the scene, for the rig's follow (StartLock): a button down, and whether a plain left (orbit) or middle (dolly) drag has moved the camera. */
export const sceneMouse = { down: false, dragged: false }

/**
 * A pen pressed on the scene, by its pointer id: OrbitControls drives it as
 * a mouse. Kept apart from sceneMouse, whose press the follow's unlock
 * counts (StartLock), so a pen's orbit unlocks as it always has.
 */
let scenePen: number | null = null

/** Anything pressed on the scene now: a finger, the mouse or a pen. */
export function sceneHeld(): boolean {
  return panGesture.fingers > 0 || sceneMouse.down || scenePen !== null
}

/**
 * Drag-to-steer's drag for this frame (lib/viewFly.ts steerBy), or null.
 * Always drained; null while anything is pressed on the scene, which is
 * already turning the camera (arkinox, 2026-11-12: "ignore dragging on the
 * button if other dragging is happening"), so a resting thumb's wobble on
 * the button is never spent.
 */
export function steerToSpend(): { dx: number; dy: number } | null {
  const steer = takeSteer()
  return (steer.dx !== 0 || steer.dy !== 0) && !sceneHeld() ? steer : null
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
  /** The camera's offset from its target last frame: a change is the user orbiting or zooming. */
  private orbit = new Vector3()
  private orbitValid = false
  /** Where (aim, drawn frame) a re-anchor was last asked and declined, so it is not asked again every frame. */
  private declinedAt = new Vector3()
  private declined = false
  /** What a drag turns the camera about: the camera in flight, the view's centre at rest (lib/viewCamera.ts FlightPivot). */
  private pivotAt = new FlightPivot()
  /** The camera less its target when last marked: a turn since then is the hand's (pivot). */
  private turnFrom = new Vector3()
  private turnValid = false
  /** Whether a fly was under way last frame: the frame it stops brings the view's centre in (before). */
  private wasMoving = false
  /** The view's centre's move in to just ahead of the camera, owed to the follow point alone (apply). */
  private nearOwed = new Vector3()
  /** The fly has just landed: the cursor's move this frame is held under the camera, not eased (apply, ViewOffset.keep). */
  private keeping = false
  /** The headlamp's reach still owed for the view's centre coming in, render cells, and how far (0..1) it has faded (reachOwed). */
  private nearGap = 0
  private nearT = 1
  /** The camera of the last frame (settle, between frames). */
  private lastCam: RigCamera | null = null
  /**
   * The orbit's distance before a fly brought it in, render cells: RECALL or
   * VIEW ending eases the camera back out to it (restoreOrbit). Forgotten when
   * the hand dollies, whose distance it then is (pivot).
   */
  private preFlight: number | null = null
  /** The orbit distance being eased back out to (restoreOrbit, or WALK's exit: takeRestore); null when none. */
  private backTo: number | null = null

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
    this.lastCam = cam
    // An orbit, a pinch or a wheel in progress is not rest: no landing under it.
    look.copy(cam.position).sub(cam.target)
    if (this.orbitValid && look.distanceToSquared(this.orbit) > 1e-10) viewOffset.hold()
    this.orbit.copy(look)
    this.orbitValid = true
    // VIEW ended (HOP, history, RETURN) after a fly brought the orbit in: back out to where it was.
    if (this.preFlight !== null && !driven()) this.askRestore()
    this.nearT = Math.min(1, this.nearT + (Math.max(0, dt) * 1000) / PIVOT_EASE_MS)

    // A zoom: an unlanded fly lands now, where it was flown at the old zoom,
    // and the rig frames the new zoom afresh (apply sees the scale change).
    if (this.lastScale !== null && s.scaleExp !== this.lastScale) {
      if (viewOffset.flown && driven()) {
        // In the coast: it rests just ahead of the camera first (review of #690, 3).
        this.settle(cam)
        this.land(flownLanding(this.lastScale))
      }
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
    // The frame the fly's coast stops: the view's centre comes in along the
    // line of sight to just ahead of the camera, so the turn's pivot hands
    // over to there and the cursor lands there (arkinox, 2026-11-12: "I often
    // fly into a room that I want to look around, but my orbit takes me out of
    // the room immediately because my cursor appeared way off from where the
    // camera stopped"). Before the landing below is worked out from it.
    const moving = flies && viewOffset.moving
    if (this.wasMoving && !moving && flies && viewOffset.flown) this.comeNear(cam)
    this.wasMoving = moving
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
      if (flies && this.landing && cursorGlide.from === s.cursor) {
        this.land(this.landing)
        // The camera stays where the flight stopped: what the landing left
        // over (the view's centre inside the cell the cursor landed in) is
        // held, and the cursor's move itself is taken off it in apply.
        viewOffset.keep()
        this.keeping = true
      } else viewOffset.release()
      this.landing = null
    }
    cursorGlide.share = viewOffset.glide
    useViewFly.getState().setFlown(viewOffset.flown)
    // In flight a drag turns the camera in place; once the coast has stopped
    // the pivot eases back out to the view's centre, now just ahead (pivot).
    this.pivotAt.step(moving, dt * 1000)
  }

  /**
   * Bring the view's centre in along the line of sight to ORBIT_MIN_DISTANCE
   * ahead of the camera (lib/viewCamera.ts nearShift), the camera staying put.
   * The orbit's own closest approach, so the controls never push the camera
   * back out to it. Recorded as flown, so the cursor lands there; owed to the
   * follow point alone (apply), not the camera.
   */
  private comeNear(cam: RigCamera): void {
    look.copy(cam.position).sub(cam.target)
    nearShift(look, ORBIT_MIN_DISTANCE, near)
    if (near.x === 0 && near.y === 0 && near.z === 0) return
    const from = look.length()
    if (this.preFlight === null) this.preFlight = from
    // What the lamp is still owed, plus this: it fades from where it stands, never stepping.
    this.nearGap = this.reachOwed + (from - ORBIT_MIN_DISTANCE)
    this.nearT = 0
    viewOffset.slide(near.x, near.y, near.z)
    this.applied.x += near.x; this.applied.y += near.y; this.applied.z += near.z
    this.nearOwed.x += near.x; this.nearOwed.y += near.y; this.nearOwed.z += near.z
  }

  /**
   * A fly that will not wait out its coast (a pad press, a zoom, BUILD): the
   * coast stops where it is and the view's centre comes in just ahead of the
   * camera now, so the landing is there (review of #690, 3). Only a coast
   * still running: once it has stopped the view has already come in, and the
   * camera here (between frames, the last frame's, whose target was the far
   * one) would bring it in a second time, past the camera. Not while a fly
   * key is held: that fly goes on.
   */
  settle(cam: RigCamera | null = this.lastCam): void {
    if (!viewOffset.flown || !viewOffset.moving || flyDir() !== 0 || !cam) return
    viewOffset.stopCoast()
    this.wasMoving = false
    this.comeNear(cam)
  }

  /** RECALL or VIEW ending: the orbit goes back out to its distance before the fly brought it in (restoreOrbit). */
  private askRestore(): void {
    if (this.preFlight === null) return
    this.backTo = this.preFlight
    this.preFlight = null
  }

  /** The orbit distance being eased back out to, or null. */
  get restoreTo(): number | null {
    return this.backTo
  }

  /** In WALK, which eases nothing: the distance leaving WALK returns to, once (Scene.tsx), or null. */
  takeRestore(): number | null {
    const r = this.backTo
    this.backTo = null
    return r
  }

  /**
   * One frame, `dt` seconds, of the orbit easing back out to its distance
   * before a fly (askRestore), along the line the camera looks down, as the
   * tutorial's zoom eases (Scene.tsx). Given up for good when anything else
   * takes the camera: `held` (WALK, a press on the scene, the tutorial's
   * zoom, a /demo step, WALK's eye), or a fly (review of #690, round 2).
   * Returns whether it moved the camera.
   */
  restoreOrbit(camera: Vector3, target: Vector3, dt: number, held: boolean): boolean {
    if (this.backTo === null) return false
    if (held || this.flying || viewOffset.flown) { this.backTo = null; return false }
    look.copy(camera).sub(target)
    const cur = look.length()
    if (cur < 1e-4) look.set(0, 0, 1)
    const to = Math.min(GRID_RADIUS * 4, Math.max(ORBIT_MIN_DISTANCE, this.backTo))
    const d = cur < 1e-4 ? to : cur + (to - cur) * (1 - Math.exp(-Math.max(0, dt) / 0.4))
    camera.copy(target).addScaledVector(look.normalize(), d)
    if (Math.abs(d - to) < 0.05) this.backTo = null
    return true
  }

  /** How much of a turn is made about the camera now: 1 in flight, 0 at rest (lib/viewCamera.ts FlightPivot). */
  get pivotWeight(): number {
    return this.pivotAt.weight
  }

  /**
   * The distance the view's centre came in by when the fly stopped, still
   * owed to whatever reads the camera's distance from its target as a reach
   * (the headlamp, Scene.tsx HeadlampRig): it fades over PIVOT_EASE_MS, with
   * the pivot's handover, so the lamp's reach comes in rather than stepping;
   * its own fade, so another fly started in it does not cut it short.
   */
  get reachOwed(): number {
    return this.nearGap * (1 - ease(this.nearT))
  }

  /**
   * Note the camera less its target, as it stands, so the next pivot can tell
   * the hand's turn (OrbitControls, drag-to-steer) from the rig's own moves.
   */
  mark(camera: Vector3, target: Vector3): void {
    this.turnFrom.copy(camera).sub(target)
    this.turnValid = true
  }

  /**
   * The camera turned about its target since the last mark: in flight, slide
   * the camera, the target and the follow point together so the turn is one
   * about the camera instead (lib/viewCamera.ts FlightPivot), and record the
   * slide as flown so the cursor lands where the view now centres. Marks
   * afresh. Never moves the camera but to answer a turn. `answer` false (the
   * tutorial's auto-rotate is on, whose turn is the camera's, not a hand's)
   * only marks.
   */
  pivot(camera: Vector3, target: Vector3, follow: Vector3, answer = true): void {
    // The orbit's distance changed across the controls' update (a pinch, a
    // wheel), the only thing between a mark and here: the hand dollied, so the
    // distance is its own, nothing to restore. A pad press moving the follow
    // point (an unlocked camera's distance changes) is not between the two.
    if (this.preFlight !== null && this.turnValid) {
      const was = this.turnFrom.length()
      const now = Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z)
      if (Math.abs(now - was) > 1e-6 * Math.max(1, now)) this.preFlight = null
    }
    if (answer && this.turnValid && viewOffset.flown && this.pivotAt.weight > 0) {
      turned.x = camera.x - target.x; turned.y = camera.y - target.y; turned.z = camera.z - target.z
      this.pivotAt.shift(this.turnFrom, turned, slid)
      if (slid.x !== 0 || slid.y !== 0 || slid.z !== 0) {
        camera.x += slid.x; camera.y += slid.y; camera.z += slid.z
        target.x += slid.x; target.y += slid.y; target.z += slid.z
        follow.x += slid.x; follow.y += slid.y; follow.z += slid.z
        // Already in the camera and the follow point: apply owes nothing for it.
        viewOffset.slide(slid.x, slid.y, slid.z)
        this.applied.x += slid.x; this.applied.y += slid.y; this.applied.z += slid.z
      }
    }
    this.mark(camera, target)
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
      // A zoom that settled a coasting fly first (before): the follow point
      // has come in, so the zoom carries the near orbit (Scene.tsx carryOrbit).
      follow.add(this.nearOwed)
      this.nearOwed.set(0, 0, 0)
      this.nearGap = 0
      this.keeping = false
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
        // The fly's own landing is held where it is (ViewOffset.keep); any
        // other move of the cursor eases the camera back onto its orbit.
        if (this.keeping) viewOffset.keptMove(dx, dy, dz)
        else viewOffset.rebase(dx, dy, dz)
        this.applied.x -= dx
        this.applied.y -= dy
        this.applied.z -= dz
      }
    }
    this.keeping = false
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
    // A stopped fly's view centre, come in to just ahead (comeNear): the
    // follow point goes straight there, along the line of sight, and the
    // camera does not, so it neither moves nor (locked) chases the follow.
    if (this.nearOwed.x !== 0 || this.nearOwed.y !== 0 || this.nearOwed.z !== 0) {
      follow.add(this.nearOwed)
      // The camera less its target changes by this, not by a hand: no hold, no dolly for it.
      this.orbit.sub(this.nearOwed)
      this.nearOwed.set(0, 0, 0)
    }
    aim.x += want.x
    aim.y += want.y
    aim.z += want.z
    setViewCentre(want.x, want.y, want.z)
    // Flown out of the field's reach: the view re-anchors on where it has
    // flown, the cursor staying where it waits (useCyberspace reanchorView).
    // Asked again only once the view has gone a cell on from where it was
    // last declined, so a decline costs nothing per frame (review N2).
    if (viewOffset.flown && (Math.abs(aim.x) > GRID_RADIUS || Math.abs(aim.y) > GRID_RADIUS || Math.abs(aim.z) > GRID_RADIUS) &&
      !(this.declined && aim.distanceToSquared(this.declinedAt) < 1)) {
      const at = driven() ? flownLanding() : null
      if (at) {
        const s = useCyberspace.getState()
        const before = s.anchor
        s.reanchorView(at)
        const after = useCyberspace.getState()
        if (after.anchor !== before) { flyFocus = after.focus; this.declined = false } else { this.declinedAt.copy(aim); this.declined = true }
      }
    }
  }

  /**
   * Land an unlanded fly now, at once (BUILD entering, RECALL: they ask
   * through landFly). BUILD's lands just ahead of the camera, a coast cut
   * short (settle). RECALL's (`home`) is about to go home: no settling, and
   * the orbit goes back out to its distance before the fly (takeRestore).
   */
  landNow(home = false): void {
    if (home) this.askRestore()
    if (!viewOffset.flown || !driven()) return
    if (!home) this.settle()
    this.land(flownLanding())
    viewOffset.release()
    this.landing = null
  }

  /** The rig re-framed the camera itself (a cut or a re-frame in its effect): nothing owed, nothing to compare with. */
  reset(): void {
    viewOffset.clear()
    this.applied.set(0, 0, 0)
    this.lastValid = false
    this.declined = false
    this.turnValid = false
    this.wasMoving = false
    this.nearGap = 0
    this.nearOwed.set(0, 0, 0)
    this.keeping = false
    // A re-frame. VIEW ended (RETURN's cut, review of #690 round 2): the
    // restore is asked first, as RECALL asks it; else nothing is left to restore.
    if (!driven()) this.askRestore()
    this.preFlight = null
    this.pivotAt.clear()
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

// BUILD entering lands an unlanded fly before it reads the cursor (useBuilder enter, review N6); RECALL too, going home.
setFlyLander((home) => viewRig.landNow(home))

type Listening = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/** The events a finger from off the scene is kept from the camera by (installFlyTouches' gate). */
const GATED = ['pointermove', 'pointerup', 'pointercancel'] as const

/**
 * Feed the presses that land on `surface` to the fly and pan gestures:
 * downs on the surface, moves and lifts on `doc` in the capture phase, and
 * the page's own count of fingers left after each lift. A mouse's right
 * button, or its left with Shift held, drags a pan. Returns the uninstall.
 */
export function installFlyTouches(surface: Listening, doc: Listening, win: Listening, clock: () => number = () => performance.now()): () => void {
  const touch = (e: PointerEvent): boolean => e.pointerType === 'touch'
  let mouse: { id: number; x: number; y: number } | null = null
  // A plain left press: OrbitControls' orbit, once it drags past the slop.
  let orbiting: { id: number; x: number; y: number } | null = null
  // Fingers that landed off the scene (a HUD button, a panel): never the camera's.
  const elsewhere = new Set<number>()
  // Every finger, on the document first (the capture phase runs from the top
  // down): the surface's own listener, which hears it next, takes it back.
  const landed = (ev: Event): void => {
    const e = ev as PointerEvent
    if (e.pointerType === 'mouse') return
    // The first finger of a touch: any still listed lifted unheard.
    if (e.isPrimary) elsewhere.clear()
    elsewhere.add(e.pointerId)
  }
  // On the way out of the page, after the controls' own handlers: a finger
  // (or pen) from elsewhere goes no further while anything is pressed on
  // the scene, a finger, the mouse or a pen (review of #685, 1).
  const gate = (ev: Event): void => {
    const e = ev as PointerEvent
    if (e.pointerType === 'mouse' || !elsewhere.has(e.pointerId)) return
    if (e.type !== 'pointermove') elsewhere.delete(e.pointerId)
    if (sceneHeld()) e.stopImmediatePropagation()
  }
  const down = (ev: Event): void => {
    const e = ev as PointerEvent
    if (e.pointerType === 'mouse') {
      sceneMouse.down = true
      sceneMouse.dragged = false
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        mouse = { id: e.pointerId, x: e.clientX, y: e.clientY }
        panGesture.setMouse(true)
      // The left button orbits and the middle dollies: either, dragged, is the hand moving the camera (StartLock).
      } else if (e.button === 0 || e.button === 1) orbiting = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    if (e.pointerType === 'pen') { elsewhere.delete(e.pointerId); scenePen = e.pointerId; return }
    if (!touch(e)) return
    elsewhere.delete(e.pointerId)
    // The first finger of a touch: no other is down, so any finger still
    // counted is one whose lift was never heard (it ended off the page, or
    // a handler swallowed it) and must not turn two fingers into three.
    if (e.isPrimary) { flyGesture.clear(); panGesture.clear() }
    flyGesture.down(e.pointerId, e.clientX, e.clientY, clock())
    panGesture.down(e.pointerId, e.clientX, e.clientY)
  }
  const move = (ev: Event): void => {
    const e = ev as PointerEvent
    if (orbiting && e.pointerId === orbiting.id && Math.hypot(e.clientX - orbiting.x, e.clientY - orbiting.y) > PINCH_SLOP_PX) sceneMouse.dragged = true
    if (mouse && e.pointerId === mouse.id) {
      // A release this listener never heard (let go off the page) ends the drag.
      if ((e.buttons & 3) === 0) { mouse = null; panGesture.setMouse(false); return }
      panGesture.drag(e.clientX - mouse.x, e.clientY - mouse.y)
      mouse.x = e.clientX
      mouse.y = e.clientY
      return
    }
    // A pen moving with its tip up let go where the page did not hear it.
    if (scenePen === e.pointerId && (e.buttons & 1) === 0) scenePen = null
    if (!touch(e)) return
    flyGesture.move(e.pointerId, e.clientX, e.clientY)
    panGesture.move(e.pointerId, e.clientX, e.clientY)
  }
  const up = (ev: Event): void => {
    const e = ev as PointerEvent
    if (e.pointerType === 'mouse') { sceneMouse.down = false; sceneMouse.dragged = false; orbiting = null }
    if (mouse && e.pointerId === mouse.id) { mouse = null; panGesture.setMouse(false); return }
    if (scenePen === e.pointerId) { scenePen = null; return }
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
    orbiting = null
    scenePen = null
    elsewhere.clear()
    sceneMouse.down = false
    sceneMouse.dragged = false
    useViewFly.getState().setTouch(0)
  }
  // In the capture phase, so the gestures have counted a finger before
  // OrbitControls hears it land (the rig's onStart asks how many are down).
  surface.addEventListener('pointerdown', down, { capture: true })
  doc.addEventListener('pointerdown', landed, true)
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerup', up, true)
  doc.addEventListener('pointercancel', up, true)
  doc.addEventListener('touchend', left, true)
  doc.addEventListener('touchcancel', left, true)
  // The page's root element, bubbling: below the document, so the gate runs
  // before any document listener whenever it was added (OrbitControls adds
  // its own as each drag starts). Without one (the tests), the document itself.
  const root: Listening = (doc as { documentElement?: Listening | null }).documentElement ?? doc
  for (const type of GATED) root.addEventListener(type, gate)
  win.addEventListener('blur', clear)
  return () => {
    surface.removeEventListener('pointerdown', down, { capture: true })
    doc.removeEventListener('pointerdown', landed, true)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('pointercancel', up, true)
    doc.removeEventListener('touchend', left, true)
    doc.removeEventListener('touchcancel', left, true)
    for (const type of GATED) root.removeEventListener(type, gate)
    win.removeEventListener('blur', clear)
    clear()
  }
}

/** Feed the presses that land on `surface` (the scene's canvas) to the fly and pan gestures. */
export function useFlyTouches(surface: HTMLElement): void {
  useEffect(() => installFlyTouches(surface, surface.ownerDocument, window), [surface])
}
