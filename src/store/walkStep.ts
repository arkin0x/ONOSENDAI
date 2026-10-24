/**
 * walkStep.ts - one WALK press over stairs: the automatic step-up and
 * step-down (arkinox, 2026-10-23: "build the automatic stair step-up. I
 * think it should only work when bumping a shard with collision turned on").
 * Design: onosendai/gravity-walk-assessment-2026-10-23.md §3, decision 1.
 *
 * It is built only on the walls' own question, stepLimit (store/walkWalls.ts),
 * so it holds by exactly the faces the constraint holds by: those of a shard
 * set to ALL, or to OPAQUE while it is solid and fully opaque (DECK-0003
 * §1.12). A shard without collision has no faces here, so it is never
 * climbed, never stood on and never stepped down onto: you pass through it
 * as before.
 *
 * Standing means a blocking face is less than a gibson below you, which is
 * where the constraint stops a walker coming down onto a floor, and where
 * the Maze Kit puts its avatar ("one gibson above the sill"). Only while you
 * stand does a level press (X or Z) do more than it did:
 *
 * | Case | What the press does |
 * |---|---|
 * | the way ahead is clear | the same step as before |
 * | a blocking face is in the way | the same step lifted by 1 gibson, else by 2: the lift must be clear (headroom), the step at the lifted height must be clear, and you must stand where it lands (on top of what was in the way); the smallest lift whose step is clear is taken |
 * | no lift up to 2 works | the step stops short, as before: a wall, a riser of 3 or more, a ceiling in the way, or a parapet or a rail with nothing to stand on beyond it |
 * | after the step a blocking floor is 1 or 2 gibsons further down than standing height | it settles onto it, so you are standing again |
 * | no blocking floor within that | you stay at your height, as before: this is not gravity |
 *
 * A press of 2 to 16 gibsons (zoom 2^1 to 2^4, up to one tile) is walked
 * here as 1-gibson substeps, each with its step-up and step-down, so a coarse
 * press up a stair climbs it instead of stopping at the foot. Past a tile,
 * and for every press up or down, the step is exactly the one stepLimit
 * gives.
 *
 * The lift is counted from where you stand, which is up to a gibson above
 * the floor, so with a lift of 2 a riser climbs when its top is less than 2
 * above your standing height: every riser of 1 or 2 on the lattice (both
 * Maze Kit stairs, 53 and 58 degrees, with runs of 0.75 and 0.67, where one
 * gibson forward can cross two risers), and the kit's low water caps (2.2,
 * as the assessment listed); never a riser of 3.
 *
 * With gravity on (store/useWalk.ts), a press that walks off an edge with
 * no floor within a step-down stops on the first gibson past the edge,
 * where the fall starts: the press does not carry on through the air.
 *
 * Every piece of the move is a straight step stepLimit has cleared (the
 * lift, the step at the lifted height, the settle), so the landing is
 * reached from where you stood without crossing a blocking face: it is never
 * inside geometry you were outside of, never past a ceiling, and never on a
 * face. The chain sees none of this: the walk publishes where you went, as
 * one straight hop per segment (store/useWalk.ts), the same as any move
 * between those two places.
 */

import { clampAxis, type AxisName, type Position } from '../lib/space'
import { stepLimit, type WallItem } from './walkWalls'

/** The highest a press lifts you over what is in its way, in gibsons: the Maze Kit's stairs need 2. */
export const STEP_UP_MAX = 2n

/** The furthest a press settles you down onto a floor, in gibsons. */
export const STEP_DOWN_MAX = 2n

/** The longest press walked as substeps with step-up and step-down: one Maze Kit tile, zoom 2^4. */
export const STEP_SUBSTEP_MAX = 16n

/** Where a press goes, and the shard that held it short, if one did. */
export interface WalkStep {
  to: Position
  /** The shard whose face stopped the press short, or null when it went its full way (climbing included). */
  by: WallItem | null
}

/**
 * Whether a blocking face is less than a gibson below `at`: you stand on it.
 * With `gravity`, a face in your own plane is under you too (stepLimit `stand`).
 */
export function standing(at: Position, items: readonly WallItem[], gravity = false): boolean {
  const down = stepLimit(at, 'y', -1, 1n, items, gravity)
  return down.reach === 0n && down.by !== null
}

/** `at` moved `n` gibsons along `axis` in direction `dir`. */
function moved(at: Position, axis: AxisName, dir: 1 | -1, n: bigint): Position {
  return { ...at, [axis]: at[axis] + BigInt(dir) * n }
}

/**
 * The 1-gibson step from `at` lifted onto what is in its way: up by 1, else
 * by 2, and then along. Both moves are cleared by stepLimit, so neither
 * crosses a blocking face nor ends within its tolerance of one, and the
 * smallest lift whose step is clear must land you standing: on top of the
 * riser, never over a rail into the air. Null when no lift works: a ceiling
 * over you, nothing clear at either height, or nothing to stand on.
 */
function lifted(at: Position, axis: AxisName, dir: 1 | -1, items: readonly WallItem[], gravity: boolean): Position | null {
  for (let lift = 1n; lift <= STEP_UP_MAX; lift++) {
    if (clampAxis(at.y + lift) !== at.y + lift) return null
    // Headroom: a face over you holds this lift and every higher one.
    if (stepLimit(at, 'y', 1, lift, items).reach !== lift) return null
    const up = { ...at, y: at.y + lift }
    if (stepLimit(up, axis, dir, 1n, items).reach !== 1n) continue
    const on = moved(up, axis, dir, 1n)
    return standing(on, items, gravity) ? on : null
  }
  return null
}

/**
 * `at` settled onto a blocking floor 1 to STEP_DOWN_MAX gibsons further down
 * than standing height, and whether it stands there. It stays at `at` when
 * it stands already, or when there is no such floor (it does not stand
 * then). The settle is cleared by stepLimit and is the walls' own stop short
 * of the floor, so it ends at standing height.
 */
function settled(at: Position, items: readonly WallItem[], gravity: boolean): { at: Position; standing: boolean } {
  const down = stepLimit(at, 'y', -1, STEP_DOWN_MAX + 1n, items, gravity)
  if (down.by === null || down.reach > at.y) return { at, standing: false }
  return { at: { ...at, y: at.y - down.reach }, standing: true }
}

/**
 * Where a WALK press of `length` gibsons from `from`, along `axis` in
 * direction `dir`, goes among `items`: the walls' stop short, with the
 * step-up and step-down above while you stand on a blocking floor and step
 * level. With `gravity`, a press off an edge stops on the first gibson past it.
 */
export function walkStep(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[], gravity = false): WalkStep {
  if (axis === 'y' || length > STEP_SUBSTEP_MAX || !standing(from, items, gravity)) {
    const wall = stepLimit(from, axis, dir, length, items)
    return { to: moved(from, axis, dir, wall.reach), by: wall.by }
  }
  let at = from
  for (let n = 0n; n < length; n++) {
    const ahead = stepLimit(at, axis, dir, 1n, items)
    const next = ahead.reach === 1n ? moved(at, axis, dir, 1n) : lifted(at, axis, dir, items, gravity)
    // Held: the press stops on the last gibson it reached.
    if (next === null) return { to: at, by: ahead.by }
    const down = settled(next, items, gravity)
    at = down.at
    // Off an edge higher than a step-down, with no floor near: the rest of
    // the press is the plain step, at this height. Under gravity the press
    // ends here instead, and the fall starts from this gibson.
    if (!down.standing) {
      if (gravity) break
      const rest = length - n - 1n
      if (rest === 0n) break
      const wall = stepLimit(at, axis, dir, rest, items)
      return { to: moved(at, axis, dir, wall.reach), by: wall.by }
    }
  }
  return { to: at, by: null }
}
