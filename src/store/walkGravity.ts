/**
 * walkGravity.ts - GRAVITY in WALK: the numbers, the switch kept on this
 * device, and the pure parts of a fall (arkinox, rulings of 2026-10-24;
 * design onosendai/gravity-walk-assessment-2026-10-23.md §4, which the
 * rulings supersede where they differ). The fall itself, and what it
 * publishes, is the walk's (store/useWalk.ts).
 *
 * Down is the axis nearest the screen's down (lib/walkDown.ts; arkinox,
 * 2026-11-10, superseding "down is cyberspace -Y everywhere" of 2026-10-24):
 * cyberspace -Y in the default view and in any view turned only left or
 * right, and along X or Z once the compass's view controls tip the view.
 * Everything here takes it as `down`, -Y when absent. A fall is an animation on this device,
 * at a real gravitational acceleration, and makes no proof while it falls.
 * It resolves into ordinary walk hops, each from where the hop before it
 * left off: on landing, on a move made in mid-air, at the last gibson a hop
 * from where it left off can afford, or when gravity is switched off.
 *
 * ## The scale
 *
 * A gibson has no size of its own at walking scale, so one is chosen here:
 * the walker's gibson is GIBSON_METRES, about 0.147 m. It is the scale at
 * which the first ruled jump (3 gibsons, about 0.6 s in the air; ruling D5 of
 * 2026-10-24) is exactly Earth's standard gravity, 9.80665 m/s^2: 3 gibsons
 * is a 0.44 m standing jump, which a person does in 0.6 s. At that scale a
 * Maze Kit riser of 1 gibson is a 15 cm stair step and a 16-gibson tile is
 * 2.35 m, so the kit's own proportions agree with it. WALK_GRAVITY is then
 * about 66.7 gibsons/s^2: a drop of one tile takes 0.69 s, a 48-gibson shaft
 * 1.2 s.
 *
 * Gravity stays exactly that; only the jump changed (arkinox's play test of
 * 2026-11-10: "maybe jump should do 5 Gibsons instead of 3. let's try
 * that"). JUMP_HEIGHT is 5 gibsons (0.74 m), off the floor at JUMP_SPEED,
 * about 25.8 gibsons/s, and about JUMP_HANG_S 0.775 s in the air. Pressed
 * again in the air, JUMP is a double jump (the same play test): one more of
 * DOUBLE_JUMP_HEIGHT, 3 gibsons, from wherever you are, once per time in the
 * air (store/useWalk.ts).
 *
 * No terminal velocity. A person's (about 55 m/s, 374 gibsons/s here) is
 * reached only after hundreds of metres; a maze-scale drop of 48 gibsons
 * ends at 80 gibsons/s (12 m/s), where air drag would change the time by a
 * few percent. All drag would do is stretch a long drop toward an invisible
 * floor (a big grid boundary, see fallLimits) from minutes into tens of
 * minutes.
 *
 * ## Which hop a fall can afford
 *
 * By its cost, not its length: the walk's own segment budget
 * (useWalk segmentAffordable, the per-axis LCA against this machine's
 * compute), so a big grid boundary below you is an invisible floor and you
 * hover above it. The same holds for a jump's rise.
 */

import { clampAxis, type AxisDirection, type Position } from '../lib/space'
import { WORLD_DOWN, upOf } from '../lib/walkDown'
import { stepLimit, underSolid, type WallItem } from './walkWalls'

/**
 * Down, in gibsons/s^2: the first ruled jump (3 gibsons, 0.6 s in the air:
 * 8h / T^2) at Earth's gravity, about 66.7. Fixed: a higher jump is a faster
 * launch, never a different gravity.
 */
export const WALK_GRAVITY = (8 * 3) / (0.6 * 0.6)

/** The speed off the floor, in gibsons/s, that rises `h` gibsons (sqrt(2 g h)): JUMP_SPEED for JUMP_HEIGHT. */
export function launchSpeed(h: number): number {
  return h > 0 ? Math.sqrt(2 * WALK_GRAVITY * h) : 0
}

/** How high a jump rises, in gibsons (play test of 2026-11-10; it was 3). */
export const JUMP_HEIGHT = 5

/** A jump's speed off the floor, in gibsons/s (sqrt(2 g h)): about 25.8. */
export const JUMP_SPEED = launchSpeed(JUMP_HEIGHT)

/** How long a jump that lands where it left is in the air, in seconds (2 v / g): about 0.775. */
export const JUMP_HANG_S = (2 * JUMP_SPEED) / WALK_GRAVITY

/** How high a double jump rises above where it was pressed, in gibsons. */
export const DOUBLE_JUMP_HEIGHT = 3

/** A double jump's upward speed, in gibsons/s: set to this, not added (sqrt(2 g h)), 20. */
export const DOUBLE_JUMP_SPEED = launchSpeed(DOUBLE_JUMP_HEIGHT)

/** Standard gravity, m/s^2. */
export const STANDARD_GRAVITY = 9.80665

/** The walker's gibson at that gravity, in metres: about 0.147. */
export const GIBSON_METRES = STANDARD_GRAVITY / WALK_GRAVITY

/** How far a sampled height may be off a whole gibson and still count as on it. */
const EPS = 1e-6

/** How high the arc is `t` seconds in, in gibsons above where it started, from a speed of `v0` upward. */
export function arcHeight(v0: number, t: number): number {
  return v0 * t - (WALK_GRAVITY * t * t) / 2
}

/** The arc's speed upward `t` seconds in, in gibsons/s. */
export function arcSpeed(v0: number, t: number): number {
  return v0 - WALK_GRAVITY * t
}

/** The highest an arc from a speed of `v0` upward rises, in gibsons. */
export function arcApex(v0: number): number {
  return v0 > 0 ? (v0 * v0) / (2 * WALK_GRAVITY) : 0
}

/**
 * The whole gibson an arc has actually been at, at height `r` above where it
 * started (whole gibsons above or below), never one it has yet to reach:
 * rising, the one just under it; past the top, the one just over it, but
 * never above the highest whole gibson it rose to (`peak`).
 */
export function reachedHeight(r: number, rising: boolean, peak: number): number {
  return rising ? Math.floor(r + EPS) : Math.min(peak, Math.ceil(r - EPS))
}

/** The highest whole gibson an arc from `v0` reaches under a ceiling `top` gibsons above where it started. */
export function arcPeak(v0: number, top: number): number {
  return Math.min(top, Math.floor(arcApex(v0) + EPS))
}

/**
 * The furthest, in whole gibsons, a hop from `from` straight along `along`
 * may go and still be affordable by `affordable` (the walk's segment
 * budget), at most `max`. Cost only grows with the distance (the highest
 * binary boundary crossed), so it is a binary search.
 */
export function affordableAlong(from: Position, along: AxisDirection, max: bigint, affordable: (from: Position, to: Position) => boolean): bigint {
  const a = along.axis
  // The axis ends: never past them.
  const room = along.dir < 0 ? from[a] - clampAxis(from[a] - max) : clampAxis(from[a] + max) - from[a]
  let lo = 0n
  let hi = room
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (affordable(from, { ...from, [a]: from[a] + BigInt(along.dir) * mid })) lo = mid
    else hi = mid - 1n
  }
  return lo
}

/** affordableAlong straight along Y (`dir` -1 down, 1 up). */
export function affordableAlongY(from: Position, dir: 1 | -1, max: bigint, affordable: (from: Position, to: Position) => boolean): bigint {
  return affordableAlong(from, { axis: 'y', dir }, max, affordable)
}

/** The whole axis, from any point: the most a fall could ever go. */
const AXIS_SPAN = 1n << 85n

/**
 * How far a fall from `from` along `down` may go before the next gibson
 * would cost a hop more than `affordable` allows: the last gibson above a
 * big grid boundary it cannot cross. It is a binary search over the whole
 * axis, 85 asks of the segment budget, and it depends only on `from`'s place
 * along `down` (a straight hop changes one axis), so the walk keeps it per
 * height and region (store/useWalk.ts fallReachAt).
 */
export function fallReach(from: Position, affordable: (from: Position, to: Position) => boolean, down: AxisDirection = WORLD_DOWN): bigint {
  return affordableAlong(from, down, AXIS_SPAN, affordable)
}

/** Where a fall from a point comes to rest. */
export interface FallLimit {
  /** Whole gibsons down to it. */
  drop: bigint
  /** True when it is a floor you stand on (A); false when it is the last gibson a hop can afford (C). */
  lands: boolean
  /** The shard whose face it stands on, when it lands. */
  by: WallItem | null
}

/**
 * Where a fall from `from` comes to rest among `items`: standing height
 * above the first blocking face below it (the walls' own stop short, the
 * same faces the constraint holds by), unless that is further than a hop
 * from `from` can afford, in which case the last gibson it can. A floor no
 * item has is not there, so it is fallen through. A floor in the plane of
 * `from` with open space above it holds you (store/walkWalls.ts stepLimit,
 * `stand`): drop 0. Below is along `down`. `reach` is fallReach's answer
 * when the caller already has it.
 */
export function fallLimit(from: Position, items: readonly WallItem[], affordable: (from: Position, to: Position) => boolean, down: AxisDirection = WORLD_DOWN, reach: bigint = fallReach(from, affordable, down)): FallLimit {
  // With nothing affordable below, still asked one gibson down: standing there is landed.
  const floor = stepLimit(from, down.axis, down.dir, reach > 0n ? reach : 1n, items, down)
  if (floor.by !== null && floor.reach <= reach) return { drop: floor.reach, lands: true, by: floor.by }
  return { drop: reach, lands: false, by: null }
}

/**
 * How far a jump from `from` may rise among `items`: JUMP_HEIGHT (or
 * `height`, a bounce's launch), under a ceiling, and no further than a hop
 * can afford. Right under a solid's
 * underside (a face in your plane with the solid just above you,
 * underSolid) it does not rise at all. Up is against `down`.
 */
export function jumpRise(from: Position, items: readonly WallItem[], affordable: (from: Position, to: Position) => boolean, height: number = JUMP_HEIGHT, down: AxisDirection = WORLD_DOWN): { rise: bigint; by: WallItem | null; unseen?: boolean } {
  const lid = underSolid(from, items, down)
  if (lid) return { rise: 0n, by: lid }
  const want = BigInt(height)
  const rise = upOf(down)
  const up = stepLimit(from, rise.axis, rise.dir, want, items)
  const afford = affordableAlong(from, rise, up.reach, affordable)
  // The ceiling's `unseen` comes with it, from the same stop (store/wallHint.ts).
  return up.reach < want && up.by ? { rise: afford, by: up.by, ...(up.unseen !== undefined ? { unseen: up.unseen } : {}) } : { rise: afford, by: null }
}

// ---------------------------------------------------------------------------
// The switch, per device.

export const GRAVITY_KEY = 'onosendai:walkGravity'

/** The stored choice: off unless it was explicitly switched on here. */
export function loadGravity(): boolean {
  try {
    return localStorage.getItem(GRAVITY_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveGravity(on: boolean): void {
  try { localStorage.setItem(GRAVITY_KEY, on ? 'on' : 'off') } catch { /* storage blocked: kept for this visit */ }
}

/**
 * How fast, in steps per second across gravity (a step is 2^zoom gibsons,
 * lib/space.ts stepFor), a walker can best steer in the air, for the rescue
 * check (canStillLand): above both walks' top speeds
 * (fluid WALK's FLUID_MAX_SPEED, 12.5, which a running jump keeps; the step
 * WALK's held key, one step every 110 ms, about 9.1), with room for quick
 * taps and for a diagonal, so a platform any real input could reach is
 * always counted as reachable.
 */
export const AIR_REACH_SPEED = 20

/** How many points along the arc canStillLand tries the double jump at, beside the best one worked out. */
const DOUBLE_TRIES = 24

/** The later time (s from now) an arc at height `h` moving up at `v` is at height `y` on its way down; null when it never gets that high. */
function downThrough(h: number, v: number, y: number): number | null {
  const d = v * v + 2 * WALK_GRAVITY * (h - y)
  if (d < 0) return null
  const t = (v + Math.sqrt(d)) / WALK_GRAVITY
  // Already under it, and going down: that was in the past.
  return t < 0 ? null : t
}

/**
 * The latest time, in seconds from now, at which an arc at height `h` moving
 * up at `v` gibsons/s can still be at height `y` or above, best case: with
 * the double jump (DOUBLE_JUMP_SPEED, set and never lowering the arc, as
 * store/useWalk.ts airJump does it) when `canDouble`, pressed at the best
 * moment. Null when no arc it can make reaches `y`. Ceilings are left out:
 * best case.
 */
export function latestAt(h: number, v: number, y: number, canDouble: boolean): number | null {
  let best = downThrough(h, v, y)
  if (!canDouble) return best
  const g = WALK_GRAVITY
  const vd = DOUBLE_JUMP_SPEED
  // A press at time s: the arc goes on from h(s) at max(v(s), vd).
  const tryAt = (s: number): void => {
    if (!(s >= 0)) return
    const hs = h + v * s - (g * s * s) / 2
    const t = downThrough(hs, Math.max(v - g * s, vd), y)
    if (t !== null && (best === null || s + t > best)) best = s + t
  }
  // Pressed later than where the arc is DOUBLE_JUMP_HEIGHT under y, it can never get back up to y.
  const last = downThrough(h, v, y - (vd * vd) / (2 * g))
  if (last === null) return best
  for (let i = 0; i <= DOUBLE_TRIES; i++) tryAt((last * i) / DOUBLE_TRIES)
  // The best press on the way down is where the arc's height is (v^2 + 2 g h + 2 g y - vd^2) / 4g (its energy).
  const hBest = (v * v + 2 * g * h + 2 * g * y - vd * vd) / (4 * g)
  const sBest = downThrough(h, v, hBest)
  if (sBest !== null) tryAt(sBest)
  tryAt(Math.max(0, v / g))
  return best
}

/**
 * One wall's box as the rescue check sees it: `d`, the most whole gibsons
 * across gravity between the walker's column and the box (0 over it), and
 * `lo` and `top`, how high its bottom and its top are above the walker's
 * anchor (whole gibsons, up against gravity; the box is a gibson bigger than
 * the wall all round).
 */
export interface RescueBox { d: number; lo: number; top: number }

/**
 * Whether any input left could still put the walker on a wall (arkinox,
 * 2026-11-22: "we don't want to turn off gravity if the user jumping or
 * double jumping would save them"): from height `h` (above the anchor)
 * moving up at `v`, with the double jump still to use when `canDouble`,
 * steering at AIR_REACH_SPEED steps of `step` gibsons a second, could it be
 * over some box in `boxes` while still at or above a height in it, before it
 * falls past it, never under `bottom`, the boundary no hop can cross.
 *
 * What is straight under you is fallLimit's, exactly; this is about walls
 * off to the side. Best case throughout, so it says no only when nothing
 * could land you: any height in a box may be a floor (a platform's floor
 * under a pillar on it, the bottom stair of a flight), no ceiling is in the
 * way, the box is taken as wide as its widest, and steering is faster than
 * either walk goes. The cost of that: beside a deep wall, gravity goes off
 * only once you are under its bottom.
 */
export function canStillLand(h: number, v: number, canDouble: boolean, bottom: number, boxes: readonly RescueBox[], step = 1): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    // A box whose top is under the boundary: never reached.
    if (b.top < bottom) continue
    const t = latestAt(h, v, Math.max(b.lo, bottom), canDouble)
    if (t !== null && (t * AIR_REACH_SPEED + 1) * step >= b.d) return true
  }
  return false
}

/**
 * Whether a fall that comes to rest at `limit` never lands: nothing below
 * catches it before a grid boundary no hop from here can afford, so it
 * would fall to that invisible floor and hover there (C). Unless Hard Mode
 * Gravity is on, the walk turns gravity off once no input left could land
 * it anywhere else either (canStillLand; store/useWalk.ts gravityOffOverVoid;
 * arkinox, 2026-11-22).
 */
export function nothingCatches(limit: FallLimit): boolean {
  return !limit.lands
}

// ---------------------------------------------------------------------------
// Hard Mode Gravity, per device (arkinox, 2026-11-22: "lets make an opt-in
// off-by-default setting called 'Hard Mode Gravity'"). Off, a move that would
// fall with nothing to catch it turns gravity off; on, it falls, as before.

export const HARD_GRAVITY_KEY = 'onosendai:walkGravityHard'

/** The stored choice: off unless it was explicitly switched on here. */
export function loadHardGravity(): boolean {
  try {
    return localStorage.getItem(HARD_GRAVITY_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveHardGravity(on: boolean): void {
  try { localStorage.setItem(HARD_GRAVITY_KEY, on ? 'on' : 'off') } catch { /* storage blocked: kept for this visit */ }
}
