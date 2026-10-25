/**
 * walkGravity.ts - GRAVITY in WALK: the numbers, the switch kept on this
 * device, and the pure parts of a fall (arkinox, rulings of 2026-10-24;
 * design onosendai/gravity-walk-assessment-2026-10-23.md §4, which the
 * rulings supersede where they differ). The fall itself, and what it
 * publishes, is the walk's (store/useWalk.ts).
 *
 * Down is cyberspace -Y everywhere. A fall is an animation on this device,
 * at a real gravitational acceleration, and makes no proof while it falls.
 * It resolves into ordinary walk hops, each from where the hop before it
 * left off: on landing, on a move made in mid-air, at the last gibson a hop
 * from where it left off can afford, or when gravity is switched off.
 *
 * ## The scale
 *
 * A gibson has no size of its own at walking scale, so one is chosen here:
 * the walker's gibson is GIBSON_METRES, about 0.147 m. It is the scale at
 * which the ruled jump (JUMP_HEIGHT 3 gibsons, about JUMP_HANG_S 0.6 s in the
 * air) is exactly Earth's standard gravity, 9.80665 m/s^2: 3 gibsons is a
 * 0.44 m standing jump, which a person does in 0.6 s. At that scale a Maze
 * Kit riser of 1 gibson is a 15 cm stair step and a 16-gibson tile is 2.35 m,
 * so the kit's own proportions agree with it. WALK_GRAVITY is then about
 * 66.7 gibsons/s^2: a drop of one tile takes 0.69 s, a 48-gibson shaft 1.2 s.
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

import { clampAxis, type Position } from '../lib/space'
import { stepLimit, type WallItem } from './walkWalls'

/** How high a jump rises, in gibsons. */
export const JUMP_HEIGHT = 3

/** How long a jump that lands where it left is in the air, in seconds. */
export const JUMP_HANG_S = 0.6

/** Down, in gibsons/s^2: the ruled jump at Earth's gravity (8h / T^2), about 66.7. */
export const WALK_GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_HANG_S * JUMP_HANG_S)

/** A jump's speed off the floor, in gibsons/s (4h / T): 20. */
export const JUMP_SPEED = (4 * JUMP_HEIGHT) / JUMP_HANG_S

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
 * The furthest, in whole gibsons, a hop from `from` straight along Y may go
 * (`dir` -1 down, 1 up) and still be affordable by `affordable` (the walk's
 * segment budget), at most `max`. Cost only grows with the distance (the
 * highest binary boundary crossed), so it is a binary search.
 */
export function affordableAlongY(from: Position, dir: 1 | -1, max: bigint, affordable: (from: Position, to: Position) => boolean): bigint {
  // The axis ends: never past them.
  const room = dir < 0 ? from.y - clampAxis(from.y - max) : clampAxis(from.y + max) - from.y
  let lo = 0n
  let hi = room
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (affordable(from, { ...from, y: from.y + BigInt(dir) * mid })) lo = mid
    else hi = mid - 1n
  }
  return lo
}

/** The whole axis, from any point: the most a fall could ever go. */
const AXIS_SPAN = 1n << 85n

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
 * `stand`): drop 0.
 */
export function fallLimit(from: Position, items: readonly WallItem[], affordable: (from: Position, to: Position) => boolean): FallLimit {
  const reach = affordableAlongY(from, -1, AXIS_SPAN, affordable)
  // With nothing affordable below, still asked one gibson down: standing there is landed.
  const down = stepLimit(from, 'y', -1, reach > 0n ? reach : 1n, items, true)
  if (down.by !== null && down.reach <= reach) return { drop: down.reach, lands: true, by: down.by }
  return { drop: reach, lands: false, by: null }
}

/** How far a jump from `from` may rise among `items`: JUMP_HEIGHT, under a ceiling, and no further than a hop can afford. */
export function jumpRise(from: Position, items: readonly WallItem[], affordable: (from: Position, to: Position) => boolean): { rise: bigint; by: WallItem | null } {
  const up = stepLimit(from, 'y', 1, BigInt(JUMP_HEIGHT), items)
  const afford = affordableAlongY(from, 1, up.reach, affordable)
  return { rise: afford, by: up.reach < BigInt(JUMP_HEIGHT) ? up.by : null }
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
