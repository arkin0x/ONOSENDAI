/**
 * ViewFly.ts - VIEW's free fly in the scene (lib/viewFly.ts has the rules).
 *
 * The rig (Scene.tsx) calls rigViewFly at the top of every frame, before it
 * frames the cursor, the way it calls WALK's tickFall: the cursor moves along
 * the line the camera looks down, and while it does the camera is locked to
 * the cursor so it keeps its place behind it ("the cursor stays in the same
 * position relative to the camera"). Without the lock, an orbit earlier in
 * the view would leave the camera where it was and the cursor would fly off
 * from it. When the fly ends the camera goes back to following or not, as it
 * was before (FlyFollow).
 *
 * The fly runs every frame but writes the cursor to the store at most
 * FLY_WRITE_MS apart (and once more when it stops), so what reads the cursor
 * re-renders 20 times a second, not 60 (review of #592).
 *
 * useFlyTouches feeds the scene's touches to the gesture (installFlyTouches).
 * Only touches that land on the scene's canvas: a finger on a button or a
 * panel is that control's. Moves and lifts are heard on the document in the
 * capture phase, as the walk look hears them, so a finger that drifts over
 * the HUD or a release a HUD handler stops still counts.
 */

import { useEffect } from 'react'
import type { Vector3 } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import type { Position } from '../lib/space'
import { canFly, flyDir, flyStep, FlyFollow, FlyGesture, FLY_WRITE_MS, NO_CARRY, renderToCyber, useViewFly, type FlyCarry } from '../lib/viewFly'

/** The scene's one gesture, fed by useFlyTouches and read every frame. */
export const flyGesture = new FlyGesture()
/** The rig's follow across a fly. */
export const flyFollow = new FlyFollow()

/** What rounding to the nearest gibson left over, between frames of one fly. */
let carry: FlyCarry = { ...NO_CARRY }
/** Where the fly has the cursor, written to the store at most FLY_WRITE_MS apart; null when not flying. */
let pending: Position | null = null
/** The cursor as last written or read, so a move by anything else (a pad press, a jump) is seen. */
let written: Position | null = null
/** Whether `pending` is ahead of the store, and when the store was last written. */
let dirty = false
let lastWrite = -Infinity

function write(now: number): void {
  const s = useCyberspace.getState()
  if (pending) s.aimView(pending, s.anchorPlane)
  written = useCyberspace.getState().cursor
  dirty = false
  lastWrite = now
}

/**
 * One frame of VIEW's fly, from the camera at `eye` looking at `target`
 * (render space), over `dt` seconds. True while a fly is under way.
 */
export function tickViewFly(eye: Vector3, target: Vector3, dt: number, now: number = performance.now()): boolean {
  useViewFly.getState().setTouch(flyGesture.dir(now))
  const s = useCyberspace.getState()
  const dir = flyDir()
  const allowed = canFly(s, useBuilder.getState().active)
  if (dir === 0 || !allowed) {
    // Released: the last of the way is written now, so nothing is lost. Not
    // when the view itself ended (RETURN, BUILD): that cursor is not the fly's.
    if (dirty && allowed) write(now)
    carry = { ...NO_CARRY }
    pending = null
    dirty = false
    // The next fly's first step is written at once.
    lastWrite = -Infinity
    return false
  }
  const fx = target.x - eye.x
  const fy = target.y - eye.y
  const fz = target.z - eye.z
  const len = Math.hypot(fx, fy, fz)
  if (len === 0) return false
  // Something else moved the cursor since the last write: fly on from there.
  if (pending === null || s.cursor !== written) { pending = s.cursor; written = s.cursor; dirty = false }
  const along = renderToCyber([fx / len, fy / len, fz / len], s.axes())
  const step = flyStep(pending, carry, along, dir, dt, s.scaleExp)
  carry = step.carry
  if (step.moved) { pending = step.cursor; dirty = true }
  if (dirty && now - lastWrite >= FLY_WRITE_MS) write(now)
  return true
}

/** The rig's refs that a fly drives. */
export interface FlyRig {
  /** The camera follows the cursor. */
  locked: { current: boolean }
  /** Seconds of stretched follow left. */
  glideLeft: { current: number }
}

/**
 * The rig's frame of the fly: tickViewFly, then the camera locked while it
 * flies and handed back its own follow after, and no glide while it flies:
 * the view re-anchors every field width of a long fly (the store's
 * rideView), which the rig's focus effect takes for a new subject and eases
 * toward over GLIDE_SECONDS, and the cursor would pull ahead.
 */
export function rigViewFly(rig: FlyRig, eye: Vector3, target: Vector3, dt: number, now: number = performance.now()): boolean {
  const flying = tickViewFly(eye, target, dt, now)
  rig.locked.current = flyFollow.frame(rig.locked.current, flying, flyGesture.count > 0)
  if (flying) rig.glideLeft.current = 0
  return flying
}

type Listening = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Feed the touches that land on `surface` to the fly gesture: downs on the
 * surface, moves and lifts on `doc` in the capture phase, and the page's own
 * count of fingers left after each lift. Returns the uninstall.
 */
export function installFlyTouches(surface: Listening, doc: Listening, win: Listening, clock: () => number = () => performance.now()): () => void {
  const touch = (e: PointerEvent): boolean => e.pointerType === 'touch'
  const down = (ev: Event): void => {
    const e = ev as PointerEvent
    if (!touch(e)) return
    // The first finger of a touch: no other is down, so any finger still
    // counted is one whose lift was never heard (it ended off the page, or
    // a handler swallowed it) and must not turn two fingers into three.
    if (e.isPrimary) flyGesture.clear()
    flyGesture.down(e.pointerId, e.clientX, e.clientY, clock())
  }
  const move = (ev: Event): void => { const e = ev as PointerEvent; if (touch(e)) flyGesture.move(e.pointerId, e.clientX, e.clientY) }
  const up = (ev: Event): void => { const e = ev as PointerEvent; if (touch(e)) flyGesture.up(e.pointerId, clock()) }
  // After the lift's pointer event: how many fingers the page says are still down.
  const left = (ev: Event): void => { flyGesture.touchesLeft((ev as TouchEvent).touches?.length ?? 0) }
  const clear = (): void => { flyGesture.clear(); useViewFly.getState().setTouch(0) }
  surface.addEventListener('pointerdown', down)
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerup', up, true)
  doc.addEventListener('pointercancel', up, true)
  doc.addEventListener('touchend', left, true)
  doc.addEventListener('touchcancel', left, true)
  win.addEventListener('blur', clear)
  return () => {
    surface.removeEventListener('pointerdown', down)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('pointercancel', up, true)
    doc.removeEventListener('touchend', left, true)
    doc.removeEventListener('touchcancel', left, true)
    win.removeEventListener('blur', clear)
    clear()
  }
}

/** Feed the touches that land on `surface` (the scene's canvas) to the fly gesture. */
export function useFlyTouches(surface: HTMLElement): void {
  useEffect(() => installFlyTouches(surface, surface.ownerDocument, window), [surface])
}
