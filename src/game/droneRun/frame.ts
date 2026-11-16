/**
 * frame.ts - where the simulation's numbers land on screen.
 *
 * The simulation works in region-local gibsons on cyberspace axes. The game's
 * canvas draws the world as the dungeon does (game/GameView.tsx AXES, lib/space.ts
 * itemCentre at zoom 0): render x = x, render y = y, render z = -z, so a
 * shard placed at a whole number has its origin exactly there.
 *
 * Handedness. ONOSENDAI draws cyberspace with +X to the right of a viewer
 * facing +Z (spec §11.3, DECK-0002 §9.4), so facing -Z, the run's way, +X is
 * on the left. The simulation's input (types.ts RunInput) is in that same
 * hand and the screen's own terms: strafe +1 is right on screen, and yaw
 * turns as the camera's yaw does (positive turns the view left on screen).
 * So the input layer's numbers (input.ts) go to the simulation as they are,
 * with no flip, and a recorded input log reads the same on any client that
 * follows the spec. D moves right on screen, a mouse moved right turns the
 * view right, and the world is drawn exactly as everywhere else in
 * ONOSENDAI (unmirrored).
 */

import type { RunInput, Vec3 } from '../../lib/games/droneRun/types'

/** A region-local point into `out` as the canvas draws it (render frame). */
export function toRender(p: Readonly<Vec3> | ArrayLike<number>, out: { x: number; y: number; z: number }): void {
  out.x = p[0]
  out.y = p[1]
  out.z = -p[2]
}

/** The simulation's yaw for a screen yaw: the same number (both are the spec's hand). */
export function simYaw(screenYaw: number): number {
  return screenYaw
}

/** The three.js camera's rotation about Y for a screen yaw: 0 faces cyberspace -Z, which is render +Z. */
export function cameraYaw(screenYaw: number): number {
  return Math.PI + screenYaw
}

/** A step's input (input.ts) as the simulation takes it: a copy, every field as it is. Writes into `out` when given. */
export function toSimInput(input: RunInput, out?: RunInput): RunInput {
  const o = out ?? { move: { fwd: 0, strafe: 0 }, yaw: 0, pitch: 0, jump: false, fire: false, select: null, reload: false }
  o.move.fwd = input.move.fwd
  o.move.strafe = input.move.strafe
  o.yaw = simYaw(input.yaw)
  o.pitch = input.pitch
  o.jump = input.jump
  o.fire = input.fire
  o.select = input.select
  o.reload = input.reload
  if (input.aim) o.aim = { yaw: simYaw(input.aim.yaw), pitch: input.aim.pitch }
  else delete o.aim
  if (input.sprint) o.sprint = true
  else delete o.sprint
  return o
}

/** The yaw and pitch, in the simulation's terms (RunInput's look and aim), that look from `eye` at `target` (region-local). */
export function lookAtScreen(eye: Readonly<Vec3>, target: Readonly<Vec3>): { yaw: number; pitch: number } {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2]
  const len = Math.hypot(dx, dy, dz) || 1
  // The sim's look direction: (sin y cos p, sin p, -cos y cos p).
  return { yaw: Math.atan2(dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / len))) }
}

/** a + (b - a) * t into `out`, three numbers. */
export function lerp3(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}
