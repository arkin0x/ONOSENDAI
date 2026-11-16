/**
 * player.ts - the first-person body: a standing cylinder (spec.player:
 * height 2, radius 0.35, eye 1.75 by default) that runs with fluid WALK's
 * acceleration (sim/fluid.ts), falls with WALK's gravity, jumps 5 and double
 * jumps exactly 3 more, and climbs or settles a riser of 1 or 2 without a
 * jump, as WALK's stair rule does (lib/games/gravity.ts).
 *
 * How it meets the world (sim/solids.ts):
 *
 * - Floors and ceilings (FLAT triangles) are found by straight casts at nine
 *   points of the footprint (the middle and a ring just inside the radius),
 *   so the body stands on a ledge while any part of it is over the ledge.
 * - Walls are met by a column of balls filling the body from just above the
 *   feet to the top of the head. A move is taken only if no ball touches a
 *   wall where it ends. Moves are cut into sub-steps of at most MAX_SUB, under
 *   half the radius, so no sub-step can carry a ball across a face: the body
 *   never goes through a wall at any speed.
 * - On the ground a move is a stair move: lift by up to STEP_UP (less under a
 *   ceiling), move across, then drop onto the highest floor under the
 *   footprint within the lift plus STEP_DOWN. A riser of 2 is climbed and one
 *   of 3 is a wall; a drop of 1 or 2 is settled down onto; a deeper one is
 *   fallen. If the lifted move is blocked (a lintel, a low ceiling ahead), a
 *   lower lift is tried.
 * - Blocked, it slides: the balls are pushed clear of the walls they touch
 *   (level pushes only), and the velocity becomes what the slide moved, so
 *   speed along a wall is kept and speed into it is lost. Failing that, each
 *   level axis alone is tried.
 * - The region's walls hold it too: the body never leaves the region box.
 *
 * Kept small and documented, for feel (class c candidates):
 * - COYOTE_S: a jump within 0.1 s of walking off an edge is still a ground jump.
 * - JUMP_BUFFER_S: a jump pressed within 0.1 s before landing (with the
 *   double jump spent) jumps on landing.
 * - MAX_FALL: falling speed is capped at 60 gibsons/s, so a sub-step stays
 *   short.
 *
 * State is mutated in place (stepPlayer); it is plain data.
 */

import { DOUBLE_JUMP_SPEED, JUMP_SPEED, WALK_GRAVITY } from '../../../../store/walkGravity'
import type { PlayerSpec, RunInput, Vec3 } from '../types'
import { FLUID_ACCEL, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, FLUID_DECEL, FLUID_MAX_SPEED, accelerate, wishFor } from './fluid'
import { segmentCast, sphereHits, spherePush, type Solids } from './solids'

export { DOUBLE_JUMP_SPEED, JUMP_SPEED, WALK_GRAVITY }

/** The highest riser climbed without a jump, and the deepest drop settled onto, gibsons (WALK's stair rule). */
export const STEP_UP = 2
export const STEP_DOWN = 2
/** The longest sub-step, gibsons: under half the default radius. */
export const MAX_SUB = 0.15
/** Gap kept from floors and ceilings, gibsons. */
export const SKIN = 0.02
/** The wall balls start this far above the feet, so a floor never touches them. */
const FOOT_CLEAR = 0.05
/** The footprint ring, as a share of the radius. */
const RING = 0.95
export const COYOTE_S = 0.1
export const JUMP_BUFFER_S = 0.1
export const MAX_FALL = 60
/** The look's pitch is held inside this, radians. */
export const PITCH_LIMIT = 1.45

/** The body. `pos` is the middle of the feet, region-local gibsons. */
export interface Body {
  pos: Vec3
  vel: Vec3
  grounded: boolean
  /** The double jump is spent for this time in the air. */
  doubled: boolean
  coyote: number
  jumpBuffer: number
  yaw: number
  pitch: number
}

/** The box the body may move in: the region, as a solid box. */
export interface Bounds {
  lo: Vec3
  hi: Vec3
}

/** Region-local bounds of a region `size` gibsons a side: each gibson n spans n - 0.5 to n + 0.5. */
export function regionBounds(size = 256): Bounds {
  return { lo: [-0.5, -0.5, -0.5], hi: [size - 0.5, size - 0.5, size - 0.5] }
}

/** What happened to the body this step, for the view. */
export interface BodyEvents {
  jumped: 0 | 1 | 2
  landed: boolean
}

/** A body standing at `pos` facing `yaw`. */
export function makeBody(pos: Vec3, yaw = 0): Body {
  return { pos: [pos[0], pos[1], pos[2]], vel: [0, 0, 0], grounded: false, doubled: false, coyote: 0, jumpBuffer: 0, yaw, pitch: 0 }
}

/** The eye, region-local. */
export function eyeOf(b: Body, spec: PlayerSpec): Vec3 {
  return [b.pos[0], b.pos[1] + spec.eye, b.pos[2]]
}

/** The heights of the wall balls above the feet. */
function ballHeights(spec: PlayerSpec): number[] {
  const r = spec.radius
  const lo = FOOT_CLEAR + r, hi = Math.max(lo, spec.height - r)
  const n = Math.max(1, Math.ceil((hi - lo) / r)) + 1
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}

const heightsCache = new WeakMap<PlayerSpec, number[]>()
function heightsOf(spec: PlayerSpec): number[] {
  let h = heightsCache.get(spec)
  if (!h) { h = ballHeights(spec); heightsCache.set(spec, h) }
  return h
}

/** The footprint's nine sample offsets. */
function footprint(r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [[0, 0]]
  for (let k = 0; k < 8; k++) out.push([Math.cos((k * Math.PI) / 4) * r * RING, Math.sin((k * Math.PI) / 4) * r * RING])
  return out
}

const ball: Vec3 = [0, 0, 0]

/** Whether the body standing with its feet at (x, y, z) is clear of every wall and inside the bounds. */
export function bodyFree(s: Solids, spec: PlayerSpec, bounds: Bounds, x: number, y: number, z: number): boolean {
  const r = spec.radius
  if (x - r < bounds.lo[0] || x + r > bounds.hi[0] || z - r < bounds.lo[2] || z + r > bounds.hi[2]) return false
  if (y < bounds.lo[1] || y + spec.height > bounds.hi[1]) return false
  for (const h of heightsOf(spec)) {
    ball[0] = x; ball[1] = y + h; ball[2] = z
    if (sphereHits(s, ball, r, 'walls')) return false
  }
  return true
}

/** The highest floor under the footprint at (x, z), from `fromY` down at most `drop`; the region floor counts. Null for none. */
export function floorUnder(s: Solids, spec: PlayerSpec, bounds: Bounds, x: number, fromY: number, z: number, drop: number): number | null {
  let best: number | null = null
  for (const [ox, oz] of footprint(spec.radius)) {
    const h = segmentCast(s, [x + ox, fromY, z + oz], [x + ox, fromY - drop, z + oz], 'flats')
    if (h && (best === null || h.point[1] > best)) best = h.point[1]
  }
  if (best === null && fromY - drop <= bounds.lo[1]) best = bounds.lo[1]
  return best
}

/** The lowest ceiling over the footprint's middle and four ring points from `fromY` up at most `rise`; the region top counts. Null for none. */
function ceilingOver(s: Solids, spec: PlayerSpec, bounds: Bounds, x: number, fromY: number, z: number, rise: number): number | null {
  let best: number | null = null
  const fp = footprint(spec.radius)
  for (const k of [0, 1, 3, 5, 7]) {
    const [ox, oz] = fp[k]
    const h = segmentCast(s, [x + ox, fromY, z + oz], [x + ox, fromY + rise, z + oz], 'flats')
    if (h && (best === null || h.point[1] < best)) best = h.point[1]
  }
  if (best === null && fromY + rise >= bounds.hi[1]) best = bounds.hi[1]
  return best
}

/** A stair move on the ground to (tx, tz): the new feet height, or NaN when blocked. Grounded stays true unless no floor is within reach (Infinity: walked off, at the old height). */
function stairMove(s: Solids, spec: PlayerSpec, bounds: Bounds, b: Body, tx: number, tz: number): number {
  const feet = b.pos[1]
  const top = feet + spec.height
  const ceil = ceilingOver(s, spec, bounds, b.pos[0], top, b.pos[2], STEP_UP + SKIN)
  const maxLift = ceil === null ? STEP_UP : Math.max(0, Math.min(STEP_UP, ceil - top - SKIN))
  const lifts = maxLift > 1 ? [maxLift, 1, 0] : maxLift > 0 ? [maxLift, 0] : [0]
  for (const lift of lifts) {
    if (!bodyFree(s, spec, bounds, tx, feet + lift, tz)) continue
    const from = feet + Math.max(lift, 0.25) + SKIN
    const g = floorUnder(s, spec, bounds, tx, from, tz, from - feet + STEP_DOWN)
    if (g === null) return bodyFree(s, spec, bounds, tx, feet, tz) ? Infinity : NaN
    if (bodyFree(s, spec, bounds, tx, g, tz)) return g
  }
  return NaN
}

const push: Vec3 = [0, 0, 0]

/**
 * Where a blocked level move to (tx, tz) slides to with the feet at `y`:
 * the balls pushed clear of the walls they touch, level pushes only, the
 * deepest first, a few rounds for a corner.
 */
function slideTarget(s: Solids, spec: PlayerSpec, tx: number, y: number, tz: number): [number, number] {
  let x = tx, z = tz
  for (let it = 0; it < 4; it++) {
    let px = 0, pz = 0, deepest = 0, touching = 0
    for (const h of heightsOf(spec)) {
      push[0] = 0; push[1] = 0; push[2] = 0
      ball[0] = x; ball[1] = y + h; ball[2] = z
      touching += spherePush(s, ball, spec.radius + 0.001, push, 'walls')
      const l = Math.hypot(push[0], push[2])
      if (l > deepest) { deepest = l; px = push[0]; pz = push[2] }
    }
    if (!touching || deepest < 1e-12) break
    x += px; z += pz
  }
  return [x, z]
}

/** One level sub-step of (dx, dz): on the ground a stair move, in the air a plain one; blocked, a slide. */
function level(s: Solids, spec: PlayerSpec, bounds: Bounds, b: Body, dx: number, dz: number): void {
  const x = b.pos[0], z = b.pos[2]
  const tryOne = (tx: number, tz: number): boolean => {
    if (b.grounded) {
      const g = stairMove(s, spec, bounds, b, tx, tz)
      if (Number.isNaN(g)) return false
      b.pos[0] = tx; b.pos[2] = tz
      if (g === Infinity) { b.grounded = false; b.coyote = COYOTE_S; b.vel[1] = 0 } else b.pos[1] = g
      return true
    }
    if (!bodyFree(s, spec, bounds, tx, b.pos[1], tz)) return false
    b.pos[0] = tx; b.pos[2] = tz
    return true
  }
  if (dx === 0 && dz === 0) {
    if (b.grounded) tryOne(x, z)
    return
  }
  if (tryOne(x + dx, z + dz)) return
  const [sx, sz] = slideTarget(s, spec, x + dx, b.pos[1], z + dz)
  if (tryOne(sx, sz)) {
    // The velocity loses what points into the wall (the push's way, reversed); along it is kept.
    const nx = sx - (x + dx), nz = sz - (z + dz), nl = Math.hypot(nx, nz)
    if (nl > 1e-12) {
      const into = (b.vel[0] * nx + b.vel[2] * nz) / nl
      if (into < 0) { b.vel[0] -= (nx / nl) * into; b.vel[2] -= (nz / nl) * into }
    }
    return
  }
  if (tryOne(x + dx, z)) { b.vel[2] = 0; return }
  if (tryOne(x, z + dz)) { b.vel[0] = 0; return }
  b.vel[0] = 0; b.vel[2] = 0
}

/** One vertical sub-step of `dy` in the air: stopped by a ceiling, landing on a floor. */
function vertical(s: Solids, spec: PlayerSpec, bounds: Bounds, b: Body, dy: number, ev: BodyEvents): void {
  if (dy > 0) {
    const top = b.pos[1] + spec.height
    const c = ceilingOver(s, spec, bounds, b.pos[0], top, b.pos[2], dy + SKIN)
    if (c !== null && c - SKIN < top + dy) {
      b.pos[1] = Math.max(b.pos[1], c - SKIN - spec.height)
      b.vel[1] = 0
    } else b.pos[1] += dy
    return
  }
  if (dy < 0) {
    const g = floorUnder(s, spec, bounds, b.pos[0], b.pos[1] + SKIN, b.pos[2], -dy + SKIN)
    if (g !== null && g >= b.pos[1] + dy) {
      b.pos[1] = g
      land(b, ev)
    } else b.pos[1] += dy
  }
}

function land(b: Body, ev: BodyEvents): void {
  b.vel[1] = 0
  b.grounded = true
  b.doubled = false
  b.coyote = 0
  ev.landed = true
}

/**
 * One fixed step of `dt` seconds: look, run, jump, fall, collide. Mutates
 * `b`; returns what happened for the view.
 */
export function stepPlayer(b: Body, spec: PlayerSpec, s: Solids, bounds: Bounds, input: RunInput, dt: number): BodyEvents {
  const ev: BodyEvents = { jumped: 0, landed: false }
  if (Number.isFinite(input.yaw)) b.yaw = input.yaw
  if (Number.isFinite(input.pitch)) b.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, input.pitch))
  const v = { x: b.vel[0], y: 0, z: b.vel[2] }
  const wish = wishFor(b.yaw, input.move.fwd, input.move.strafe)
  accelerate(v, wish, FLUID_MAX_SPEED, b.grounded ? FLUID_ACCEL : FLUID_AIR_ACCEL, b.grounded ? FLUID_DECEL : FLUID_AIR_DECEL, dt)
  b.vel[0] = v.x; b.vel[2] = v.z

  const groundJump = (): void => { b.vel[1] = JUMP_SPEED; b.grounded = false; b.coyote = 0; b.jumpBuffer = 0; ev.jumped = 1 }
  if (input.jump) {
    if (b.grounded || b.coyote > 0) groundJump()
    else if (!b.doubled) { b.vel[1] = Math.max(b.vel[1], DOUBLE_JUMP_SPEED); b.doubled = true; ev.jumped = 2 }
    else b.jumpBuffer = JUMP_BUFFER_S
  }

  let dy = 0
  if (!b.grounded) {
    dy = b.vel[1] * dt - 0.5 * WALK_GRAVITY * dt * dt
    b.vel[1] = Math.max(-MAX_FALL, b.vel[1] - WALK_GRAVITY * dt)
  }
  const dx = b.vel[0] * dt, dz = b.vel[2] * dt
  const n = Math.max(1, Math.ceil(Math.max(Math.hypot(dx, dz), Math.abs(dy)) / MAX_SUB))
  const sub = dt / n
  for (let i = 0; i < n; i++) {
    if (!b.grounded && dy !== 0) {
      const wasRising = dy > 0
      vertical(s, spec, bounds, b, dy / n, ev)
      // A ceiling stopped the rise: what is left of this step is not climbed.
      if (wasRising && b.vel[1] === 0) dy = 0
      if (b.grounded) dy = 0
    }
    level(s, spec, bounds, b, b.vel[0] * sub, b.vel[2] * sub)
  }
  if (b.grounded && b.jumpBuffer > 0) groundJump()
  b.coyote = Math.max(0, b.coyote - dt)
  b.jumpBuffer = Math.max(0, b.jumpBuffer - dt)
  return ev
}

/** Sets the body down on the floor under `at` within `maxDrop` (or leaves it at `at`, falling). */
export function placeBody(b: Body, spec: PlayerSpec, s: Solids, bounds: Bounds, maxDrop = 4): void {
  const g = floorUnder(s, spec, bounds, b.pos[0], b.pos[1] + SKIN, b.pos[2], maxDrop + SKIN)
  if (g !== null) { b.pos[1] = g; b.grounded = true } else b.grounded = false
}
