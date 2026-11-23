/**
 * walkDown.ts - which way is down for GRAVITY in WALK (arkinox, 2026-11-10:
 * "gravity always needs to be up and down relative to how the user is
 * seeing the world, not relative to how the world is rotated").
 *
 * Down is the cyberspace axis nearest the screen's down: the opposite of the
 * view's up, as the compass's view controls leave it (store/useCyberspace.ts
 * rotate). WALK lives on the gibson grid, so down is always one of the six
 * axis directions, never a diagonal. In the default view, and in any view
 * turned only left or right, it is -Y, as it always was.
 *
 * It is read from the view, not from the camera's own up: in WALK the camera
 * also tilts as you look up and down (lib/walkLook.ts), and a look past 45
 * degrees would otherwise turn gravity under your feet. The view's up is the
 * up the camera turns about, so it is the up you see.
 *
 * The rest are small helpers for physics written along one axis: a height is
 * a coordinate measured up, against gravity, so a fall's arithmetic is the
 * same whichever axis it runs along.
 */

import { Vector3, type Quaternion } from 'three'
import { flipHandedness, type AxisDirection, type AxisName, type Position } from './space'

/** Down by default, and in every level view: cyberspace -Y. */
export const WORLD_DOWN: Readonly<AxisDirection> = Object.freeze({ axis: 'y', dir: -1 })

/** Two components this close count as a tie (float error only). */
const TIE = 1e-9

/** Tied axes go to the one gravity already has, and then in this order. */
const TIE_ORDER: readonly AxisName[] = ['y', 'x', 'z']

/** Whether two axis directions are the same. */
export function sameDir(a: AxisDirection, b: AxisDirection): boolean {
  return a.axis === b.axis && a.dir === b.dir
}

/**
 * Down from `up`, the screen's up as a cyberspace vector: the axis direction
 * nearest the opposite of `up`. A tie (up exactly between two or three axes)
 * goes to `prefer`, the down gravity has now, when it is one of the tied
 * ones, so gravity never flickers on a tie; else to Y, then X, then Z. With
 * no direction at all to go by, `prefer`.
 */
export function downFromUp(up: { x: number; y: number; z: number }, prefer: AxisDirection = WORLD_DOWN): AxisDirection {
  const big = Math.max(Math.abs(up.x), Math.abs(up.y), Math.abs(up.z))
  if (!(big > TIE)) return prefer
  const tied = (a: AxisName): boolean => Math.abs(up[a]) >= big - TIE
  const down = (a: AxisName): AxisDirection => ({ axis: a, dir: up[a] > 0 ? -1 : 1 })
  if (tied(prefer.axis) && sameDir(down(prefer.axis), prefer)) return prefer
  const axis = TIE_ORDER.find(tied) ?? 'y'
  return down(axis)
}

/**
 * Down in the view `view` (store/useCyberspace.ts `view`, a render-space
 * quaternion): the axis nearest the screen's down. Ties as downFromUp.
 */
export function viewDown(view: Quaternion, prefer: AxisDirection = WORLD_DOWN): AxisDirection {
  return downFromUp(flipHandedness(new Vector3(0, 1, 0).applyQuaternion(view)), prefer)
}

/** Up, against gravity `down`. */
export function upOf(down: AxisDirection): AxisDirection {
  return { axis: down.axis, dir: down.dir < 0 ? 1 : -1 }
}

/** How high `p` is against gravity `down`: its coordinate along that axis, measured up. */
export function heightOf(p: Position, down: AxisDirection): bigint {
  return down.dir < 0 ? p[down.axis] : -p[down.axis]
}

/** `p` at height `h` against gravity `down` (heightOf), the other two axes as they are. */
export function atHeight(p: Position, down: AxisDirection, h: bigint): Position {
  return { ...p, [down.axis]: down.dir < 0 ? h : -h }
}

/** `p` raised `n` gibsons against gravity `down` (lowered, for a negative `n`). */
export function raised(p: Position, down: AxisDirection, n: bigint): Position {
  return { ...p, [down.axis]: p[down.axis] - BigInt(down.dir) * n }
}
