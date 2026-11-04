/**
 * walkEye.ts: where the WALK camera's eye is, in render space.
 *
 * In WALK the camera is inside your avatar, so the avatar has to be drawn
 * exactly where the eye is on every frame, not where the store says you
 * stand: the eye runs ahead of the chain (store/useWalk.ts), and an avatar
 * drawn one ease behind the eye would put the camera in its wall. The rig
 * (Scene.tsx Rig) writes this each frame, before anything else in the scene
 * runs its frame, and the avatar reads it.
 *
 * A module-level mutable vector for the same reason travelOffset is one: it
 * changes every frame, and nothing should re-render because of it.
 */

import { Vector3 } from 'three'
import type { ViewAxes } from './space'

/** The eye's target in render cells: the predicted head the walk is easing toward. */
export const walkEye = new Vector3()

/**
 * A fall in WALK (store/useWalk.ts), as the rig draws it: while `active`,
 * the eye is `offset` gibsons along cyberspace +Y from the cursor (negative
 * below it), and follows that height exactly instead of easing to it. Written
 * once a frame by the fall (tickFall), read once a frame by the rig: two
 * numbers, so a fall allocates nothing per frame.
 */
export const walkFall = { active: false, offset: 0 }

/**
 * Which way the WALK camera looks, in cyberspace axes (lib/walkSlide.ts
 * walkHeading reads it for a forward or backward press): `forward` is where
 * it looks and `right` its right, unit vectors. Written once a frame by the
 * scene (Scene.tsx ScreenAxes) while walking; `valid` is false until then and
 * outside WALK, and a press then steps along the screen's axes as it always
 * has. Plain numbers, so a frame allocates nothing.
 */
export const walkFacing = { valid: false, forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 } }

/** `v`, in the scene's local frame (whose x, y, z are `local`'s right, up and out), as cyberspace axes, into `out` and scaled by `k`. */
function toCyberspace(v: { x: number; y: number; z: number }, local: ViewAxes, k: number, out: { x: number; y: number; z: number }): void {
  const c = [v.x, v.y, v.z]
  const slots = [local.right, local.up, local.out]
  for (let i = 0; i < 3; i++) out[slots[i].axis] = slots[i].dir * c[i] * k
}

/**
 * Set walkFacing from the camera's right and out (its +Z, toward the viewer)
 * in the scene's local frame `local`: the camera looks along -out.
 */
export function setWalkFacing(right: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }, local: ViewAxes): void {
  toCyberspace(out, local, -1, walkFacing.forward)
  toCyberspace(right, local, 1, walkFacing.right)
  walkFacing.valid = true
}
