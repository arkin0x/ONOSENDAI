/**
 * gravity.ts - gravity and jumps inside a game, as game logic (DECK-0002 §8:
 * physics is the game's). Pure: every function takes the time it is asked at
 * and the world's walls, and returns where the player is now. Nothing here
 * signs or publishes anything; play stays on the device (DECK-0002 §6).
 *
 * The numbers and the arc are WALK's, imported, so a jump in a game feels
 * like a jump in cyberspace (store/walkGravity.ts): WALK_GRAVITY, a jump of
 * JUMP_HEIGHT 5 gibsons, a double jump of DOUBLE_JUMP_HEIGHT 3 once per time
 * in the air, never lowering the arc. The rules for a press are WALK's too:
 * one gibson per press, in the air as on the ground; standing, a press climbs
 * a riser of 1 or 2 and settles down a drop of 1 or 2; further down you fall.
 * The walls are the game's own (lib/games/play.ts blocked): the faces of the
 * world shards that hold a walker.
 *
 * Where it differs from WALK, and why (kept simple on purpose):
 *
 * - Down is always -Y. WALK's gravity is being made to follow the view (the
 *   axis nearest the screen's down). A game is built with a floor; the game's
 *   camera never tips far enough for another axis to be nearest the screen's
 *   down (game/GameView.tsx keeps its pitch between -0.6 and 1.3 radians),
 *   and a dungeon whose floor turned with the camera would not be the
 *   dungeon that was built.
 * - Gravity is always on in a game that has it. It is the game's physics,
 *   not a switch of the player's.
 * - No hop is made and nothing is paid for: WALK's falls resolve into real
 *   hops with proof of work, and inside a bracket every base action is
 *   invalid (spec §8.11.4 rule 3). So there is no segment budget, no
 *   invisible floor at a grid boundary, and no bounce: the edge of the
 *   game's region is the only floor that is not a face.
 */

import { arcApex, arcHeight, arcSpeed, DOUBLE_JUMP_SPEED, JUMP_SPEED } from '../../store/walkGravity'
import type { AxisName, Position } from '../space'
import { blocked, inRegion, type WorldShard } from './play'
import type { GameDef } from './types'

/** An arc through the air: a jump, a double jump, or a fall from rest. */
export interface Arc {
  /** The whole Y the arc is measured from. */
  from: bigint
  /** The arc's height above `from` when it began, in gibsons (a double jump begins between whole gibsons). */
  y0: number
  /** Its speed upward when it began, in gibsons/s. */
  v0: number
  /** When it began, in ms on the caller's clock. */
  t0: number
}

/** The player under gravity: where they are, and the arc they follow while in the air. */
export interface Body {
  at: Position
  /** Null while standing. */
  arc: Arc | null
  /** The double jump is spent for this time in the air. */
  doubled: boolean
}

type Rules = Pick<GameDef, 'region'>

/** How far a sampled height may be off a whole gibson and still count as on it (walkGravity's EPS). */
const EPS = 1e-6
/** The highest riser a level press climbs, and the deepest drop it settles down (WALK's stair rule). */
const STAIR = 2

const up = (p: Position, n = 1): Position => ({ ...p, y: p.y + BigInt(n) })

/** Whether something holds the player at `p` from below: a face under them, or the floor of the region. */
export function standing(game: Rules, p: Position, world: readonly WorldShard[]): boolean {
  return !inRegion(game, up(p, -1)) || blocked(p, 'y', -1, world)
}

/** One gibson along `axis` from `p`, unless a face or the region's edge is in the way. */
function free(game: Rules, p: Position, axis: AxisName, dir: 1 | -1, world: readonly WorldShard[]): Position | null {
  const to = { ...p, [axis]: p[axis] + BigInt(dir) }
  return inRegion(game, to) && !blocked(p, axis, dir, world) ? to : null
}

/** A fall from rest at `p`, beginning `now`. */
function fallFrom(p: Position, now: number): Arc {
  return { from: p.y, y0: 0, v0: 0, t0: now }
}

/** The arc's height above its `from` at `now`, and whether it is still rising. */
function sample(arc: Arc, now: number): { h: number; rising: boolean } {
  const s = Math.max(0, now - arc.t0) / 1000
  return { h: arc.y0 + arcHeight(arc.v0, s), rising: arcSpeed(arc.v0, s) > 0 }
}

/**
 * JUMP: off the floor at JUMP_SPEED, or in the air the double jump, once per
 * time in the air: the upward speed set to the larger of what it is and
 * DOUBLE_JUMP_SPEED, from wherever the arc is (WALK's double jump).
 */
export function jump(game: Rules, body: Body, now: number, world: readonly WorldShard[]): Body {
  if (!body.arc) {
    if (!standing(game, body.at, world) || !free(game, body.at, 'y', 1, world)) return body
    return { ...body, arc: { from: body.at.y, y0: 0, v0: JUMP_SPEED, t0: now } }
  }
  if (body.doubled) return body
  const { h } = sample(body.arc, now)
  const s = Math.max(0, now - body.arc.t0) / 1000
  const v = Math.max(arcSpeed(body.arc.v0, s), DOUBLE_JUMP_SPEED)
  // Measured from the whole gibson the player is at, never more than a gibson off it.
  const off = Math.max(-1, Math.min(1, h - Number(body.at.y - body.arc.from)))
  return { at: body.at, doubled: true, arc: { from: body.at.y, y0: off, v0: v, t0: now } }
}

/**
 * Where a player who has just come to `to` standing-wise ends up: on a floor
 * right under them, settled down a drop of 1 or 2, or falling.
 */
function settle(game: Rules, to: Position, now: number, world: readonly WorldShard[]): Body {
  if (standing(game, to, world)) return { at: to, arc: null, doubled: false }
  let p = to
  for (let d = 1; d <= STAIR; d++) {
    const next = free(game, p, 'y', -1, world)
    if (!next) break
    p = next
    if (standing(game, p, world)) return { at: p, arc: null, doubled: false }
  }
  return { at: to, arc: fallFrom(to, now), doubled: false }
}

/**
 * One level press, a gibson along X or Z. In the air it moves you if the way
 * is free and the arc goes on from there. Standing, a wall in the way is
 * climbed if it is a riser of 1 or 2, and past an edge you settle down a drop
 * of 1 or 2 or fall.
 */
export function move(game: Rules, body: Body, axis: 'x' | 'z', dir: 1 | -1, now: number, world: readonly WorldShard[]): Body {
  const ahead = free(game, body.at, axis, dir, world)
  if (body.arc) return ahead ? { ...body, at: ahead } : body
  if (ahead) return settle(game, ahead, now, world)
  // The stair rule: lift 1, then 2, and step from there.
  let lifted = body.at
  for (let lift = 1; lift <= STAIR; lift++) {
    const higher = free(game, lifted, 'y', 1, world)
    if (!higher) return body
    lifted = higher
    const over = free(game, lifted, axis, dir, world)
    if (over) return settle(game, over, now, world)
  }
  return body
}

/** What a tick did besides moving: the player came down onto something. */
export interface Ticked {
  body: Body
  landed: boolean
}

/**
 * The fall and the jump, brought up to `now`: the player follows the arc a
 * whole gibson at a time, stopped by a face above (they fall from there at
 * rest) or below (they land, and the double jump comes back). Standing on
 * nothing, they start to fall.
 */
export function tick(game: Rules, body: Body, now: number, world: readonly WorldShard[]): Ticked {
  if (!body.arc) {
    if (standing(game, body.at, world)) return { body, landed: false }
    return { body: { ...body, arc: fallFrom(body.at, now) }, landed: false }
  }
  let { at } = body
  const arc = body.arc
  const { h, rising } = sample(arc, now)
  let cur = Number(at.y - arc.from)
  // WALK's reachedHeight: rising, the whole gibson just under the arc; past the top, the one just over it, but never
  // above the arc's highest whole gibson, worked out rather than sampled, so a frame that steps over the top still
  // reaches it (a jump of 5 reaches 5).
  const peak = Math.floor(arc.y0 + arcApex(arc.v0) + EPS)
  const want = rising ? Math.floor(h + EPS) : Math.min(peak, Math.ceil(h - EPS))
  while (cur < want) {
    const next = free(game, at, 'y', 1, world)
    if (!next) {
      // A ceiling: the rise ends here, and the fall begins at rest.
      return { body: { at, arc: fallFrom(at, now), doubled: body.doubled }, landed: false }
    }
    at = next
    cur++
  }
  while (cur > want || (!rising && cur === want && standing(game, at, world))) {
    if (standing(game, at, world)) return { body: { at, arc: null, doubled: false }, landed: true }
    at = up(at, -1)
    cur--
  }
  return { body: { at, arc, doubled: body.doubled }, landed: false }
}
