/**
 * viewPose.ts: where the scene's camera stands and which way it looks, kept
 * each frame (scene/WorldMessages records it), so a list over the scene can
 * say which way a thing is from the view (lib/direction.ts): DISCOVERED
 * NEARBY's arrow and words beside each row.
 *
 * Plain numbers, not three's objects, so the lists read it with no scene
 * imported. Read once when a row draws, never subscribed: the camera holds
 * still while a list is up.
 */

import { directionOf, type Direction } from './direction'

interface Pose {
  /** Scene units. */
  position: [number, number, number]
  /** The camera's rotation as a unit quaternion, x y z w. */
  quaternion: [number, number, number, number]
  /** Whether a frame has recorded it yet. */
  known: boolean
}

const pose: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], known: false }

/** Keep this frame's camera. Allocates nothing. */
export function recordViewPose(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }): void {
  pose.position[0] = p.x; pose.position[1] = p.y; pose.position[2] = p.z
  pose.quaternion[0] = q.x; pose.quaternion[1] = q.y; pose.quaternion[2] = q.z; pose.quaternion[3] = q.w
  pose.known = true
}

/** Forget the camera (tests). */
export function forgetViewPose(): void {
  recordViewPose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
  pose.known = false
}

/** A world offset turned into the camera's frame: the inverse of its rotation applied. */
export function toCameraFrame(v: readonly [number, number, number], q: readonly [number, number, number, number]): [number, number, number] {
  // v' = q* v q, with q* the conjugate.
  const [x, y, z] = v
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3]
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

/** Which way a point in the scene is from the camera, or null before the first frame. */
export function directionFromView(at: readonly [number, number, number], near = 1e-6): Direction | null {
  if (!pose.known) return null
  const off: [number, number, number] = [at[0] - pose.position[0], at[1] - pose.position[1], at[2] - pose.position[2]]
  return directionOf(toCameraFrame(off, pose.quaternion), near)
}
