/**
 * fluid.ts - fluid WALK's movement, for the drone run's body. The numbers
 * and the arithmetic are fluid WALK's own (lib/fluidWalk.ts), re-exported,
 * so running in the game feels like walking in cyberspace: FLUID_MAX_SPEED
 * (1000/110 gibsons/s, a held key's pace), FLUID_ACCEL 45 and FLUID_DECEL 60
 * on the ground, FLUID_AIR_ACCEL 30 and FLUID_AIR_DECEL 8 in the air. A step
 * of fluid WALK is one gibson here (the game is at 2^0).
 *
 * What the game adds: the look's yaw turned into the forward and right
 * vectors wishOf takes, and the look direction with pitch for aiming. The
 * hand is the spec's (spec §11.3, DECK-0002 §9.4: facing +Z, right is +X):
 * yaw 0 faces -Z, where right is -X; increasing yaw turns left, toward +X,
 * as ONOSENDAI's camera yaw does, so the view passes its yaw through as is.
 * Right is up x forward.
 */

import { wishOf, type Vec } from '../../../fluidWalk'
import type { Vec3 } from '../types'

export { FLUID_MAX_SPEED, FLUID_ACCEL, FLUID_DECEL, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, accelerate, wishOf, type Vec } from '../../../fluidWalk'

/** Level forward for a yaw: (sin yaw, 0, -cos yaw). */
export function forwardOf(yaw: number): Vec {
  return { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) }
}

/** Level right for a yaw, up x forward: (-cos yaw, 0, -sin yaw). Facing -Z (yaw 0) it is -X. */
export function rightOf(yaw: number): Vec {
  return { x: -Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
}

/** Where the held move asks to go, level, length at most 1. */
export function wishFor(yaw: number, fwd: number, strafe: number): Vec {
  return wishOf(forwardOf(yaw), rightOf(yaw), 'y', clamp1(fwd), clamp1(strafe), null, 0)
}

/** The unit look direction for a yaw and pitch. */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch)
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]
}

function clamp1(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
}
