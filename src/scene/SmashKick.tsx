/**
 * SmashKick.tsx - the view's part in the smash (owner, 2026-11-27: "the view
 * moves slightly to give the first-person effect of swinging a hammer"): it
 * tilts up a little as the hammer goes overhead, comes down with the blow,
 * kicks at the impact and rings still, with a short shake
 * (lib/blueprint/hammerAnim.ts has the numbers; a few degrees at most).
 *
 * The tilt is laid over the camera just before the frame is drawn and taken
 * off again just after, so nothing else ever sees it: the look, the cursor,
 * the walk and the next frame all work from the camera as the rig left it.
 * With reduced motion the view never moves.
 */

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import { SWING_MS } from '../lib/blueprint/smash'
import { hammerPose, newPose } from '../lib/blueprint/hammerAnim'
import { hammerClock } from '../terrain/hammerClock'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** After everything that poses or reads the camera (the last is at 0.9), before the composer draws at 1. */
const KICK_PRIORITY = 0.95
/** After the composer has drawn. */
const UNKICK_PRIORITY = 1.05
/** The shake's reach at its strongest, radians. */
const SHAKE = (0.55 * Math.PI) / 180

const RIGHT = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const AHEAD = new Vector3(0, 0, 1)

export function SmashKick(): null {
  const calm = useReducedMotion()
  const kept = useRef({ rest: new Quaternion(), turn: new Quaternion(), on: false, pose: newPose() })
  useFrame((state) => {
    const k = kept.current
    k.on = false
    if (calm) return
    const now = performance.now()
    const pose = hammerPose(now, hammerClock(), SWING_MS, false, k.pose)
    if (pose.camPitch === 0 && pose.camRoll === 0 && pose.shake === 0) return
    const s = now / 1000
    const pitch = pose.camPitch + pose.shake * SHAKE * Math.sin(s * 173.0)
    const yaw = pose.shake * SHAKE * 0.7 * Math.sin(s * 131.0 + 1.7)
    const cam = state.camera
    k.rest.copy(cam.quaternion)
    cam.quaternion.multiply(k.turn.setFromAxisAngle(RIGHT, pitch))
    if (yaw !== 0) cam.quaternion.multiply(k.turn.setFromAxisAngle(UP, yaw))
    if (pose.camRoll !== 0) cam.quaternion.multiply(k.turn.setFromAxisAngle(AHEAD, pose.camRoll))
    cam.updateMatrixWorld()
    k.on = true
  }, KICK_PRIORITY)
  useFrame((state) => {
    const k = kept.current
    if (!k.on) return
    state.camera.quaternion.copy(k.rest)
    state.camera.updateMatrixWorld()
    k.on = false
  }, UNKICK_PRIORITY)
  return null
}
