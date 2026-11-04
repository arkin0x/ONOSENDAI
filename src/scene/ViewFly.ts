/**
 * ViewFly.ts - VIEW's free fly in the scene (lib/viewFly.ts has the rules).
 *
 * The rig (Scene.tsx) calls tickViewFly at the top of every frame, before it
 * frames the cursor, the way it calls WALK's tickFall: the cursor moves along
 * the line the camera looks down, and the rig, told a fly is under way, holds
 * the camera locked to the cursor so it keeps its place behind it ("the
 * cursor stays in the same position relative to the camera"). Without the
 * lock, an orbit earlier in the view would leave the camera where it was and
 * the cursor would fly off from it.
 *
 * useFlyTouches feeds the scene's touches to the gesture. Only touches that
 * land on the scene's canvas: a finger on a button or a panel is that
 * control's. Moves and lifts are heard on the document in the capture phase,
 * as the walk look hears them, so a finger that drifts over the HUD or a
 * release a HUD handler stops still counts.
 */

import { useEffect } from 'react'
import type { Vector3 } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { canFly, flyDir, flyStep, FlyGesture, NO_CARRY, renderToCyber, useViewFly, type FlyCarry } from '../lib/viewFly'

/** The scene's one gesture, fed by useFlyTouches and read every frame. */
export const flyGesture = new FlyGesture()

/** What rounding to the nearest gibson left over, between frames of one fly. */
let carry: FlyCarry = { ...NO_CARRY }

/**
 * One frame of VIEW's fly, from the camera at `eye` looking at `target`
 * (render space), over `dt` seconds. True while a fly is under way, which is
 * the rig's cue to keep the camera locked to the cursor.
 */
export function tickViewFly(eye: Vector3, target: Vector3, dt: number, now: number = performance.now()): boolean {
  useViewFly.getState().setTouch(flyGesture.dir(now))
  const s = useCyberspace.getState()
  const dir = flyDir()
  if (dir === 0 || !canFly(s, useBuilder.getState().active)) { carry = { ...NO_CARRY }; return false }
  const fx = target.x - eye.x
  const fy = target.y - eye.y
  const fz = target.z - eye.z
  const len = Math.hypot(fx, fy, fz)
  if (len === 0) return false
  const along = renderToCyber([fx / len, fy / len, fz / len], s.axes())
  const step = flyStep(s.cursor, carry, along, dir, dt, s.scaleExp)
  carry = step.carry
  if (step.moved) s.aimView(step.cursor, s.anchorPlane)
  return true
}

/** Feed the touches that land on `surface` (the scene's canvas) to the fly gesture. */
export function useFlyTouches(surface: HTMLElement): void {
  useEffect(() => {
    const touch = (e: PointerEvent): boolean => e.pointerType === 'touch'
    const down = (e: PointerEvent): void => {
      if (!touch(e)) return
      // The first finger of a touch: no other is down, so any finger still
      // counted is one whose lift was never heard (it ended off the page, or
      // a handler swallowed it) and must not turn two fingers into three.
      if (e.isPrimary) flyGesture.clear()
      flyGesture.down(e.pointerId, e.clientX, e.clientY, performance.now())
    }
    const move = (e: PointerEvent): void => { if (touch(e)) flyGesture.move(e.pointerId, e.clientX, e.clientY) }
    const up = (e: PointerEvent): void => { if (touch(e)) flyGesture.up(e.pointerId, performance.now()) }
    const clear = (): void => { flyGesture.clear(); useViewFly.getState().setTouch(0) }
    surface.addEventListener('pointerdown', down)
    const doc = surface.ownerDocument
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', clear)
    return () => {
      surface.removeEventListener('pointerdown', down)
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [surface])
}
