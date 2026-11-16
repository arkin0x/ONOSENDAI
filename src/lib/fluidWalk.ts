/**
 * fluidWalk.ts: the numbers and the pure math of fluid WALK (arkinox,
 * 2026-11-16: "WALK mode does not snap to gibsons at all, but just anchors
 * move events to the nearest gibson as needed ... the walk buttons become
 * acceleration buttons instead of step buttons").
 *
 * The walker has a smooth position and a velocity. The keys and the pad
 * accelerate it up to a walking speed, and it slows to a stop when they are
 * let go. Its nearest gibson is the anchor: each time that changes, one
 * legal step to it goes through the walk's own move path
 * (store/useWalk.ts fluidCross), so the chain still only ever holds whole
 * gibsons. Everything stateful is in store/walkFluid.ts; this file is the
 * arithmetic, so it can be tested on its own.
 *
 * | Number | Value | Why |
 * |---|---|---|
 * | FLUID_MAX_SPEED | 9 steps/s | today's held key: one step every WALK_HOLD_MS (110 ms). Held distances, running jumps and the AeroCarnival gap classes stay what they were measured at |
 * | FLUID_ACCEL | 45 steps/s^2 | full speed in 0.2 s: quick, but you feel it pick up |
 * | FLUID_DECEL | 60 steps/s^2 | stops from full speed in 0.15 s, coasting about 0.7 of a step |
 * | FLUID_AIR_ACCEL / FLUID_AIR_DECEL | 30 / 8 steps/s^2 | steering in the air is softer, and a running jump keeps its speed |
 * | FLUID_NUDGE_MS | 120 ms | a tap pushes this long: about half a step, enough to cross into the next gibson from the middle of one |
 *
 * A step is 2^zoom gibsons, the length a press walked: at the usual 2^0 it
 * is one gibson.
 */

import type { AxisDirection, AxisName, Position } from './space'

/** The walking speed, in steps per second: one step every 110 ms, as a held key walked (store/walkHold.ts WALK_HOLD_MS). */
export const FLUID_MAX_SPEED = 1000 / 110

/** How fast the walk picks up, in steps per second per second: full speed in 0.2 s. */
export const FLUID_ACCEL = 45

/** How fast it slows with nothing held, in steps per second per second: from full speed to a stop in about 0.15 s. */
export const FLUID_DECEL = 60

/** Steering in the air: softer than on the ground. */
export const FLUID_AIR_ACCEL = 30

/** Slowing in the air with nothing held: a running jump mostly keeps its speed. */
export const FLUID_AIR_DECEL = 8

/** How long a tap pushes, in ms: a tap is a short nudge, about half a step. */
export const FLUID_NUDGE_MS = 120

/**
 * How near a corner both ways have to be for a crossing to be one diagonal
 * step: within this much of a step of the second boundary, moving toward
 * it. A walk at about 45 degrees then makes diagonal steps, round the open
 * side of a corner and along a diagonal walkway, as the 8-direction walk did
 * (lib/walkSlide.ts), instead of a zigzag that steps off it.
 */
export const FLUID_DIAGONAL_ZONE = 0.25

/**
 * How far into its gibson the smooth position may go toward a face that
 * holds it, in steps from the middle: the eye stops this far short of the
 * gibson's edge (and FLUID_FACE_GAP short of the face itself, when that is
 * nearer). The anchor never moves into the wall: only the eye goes this
 * close.
 */
export const FLUID_WALL_REACH = 0.3

/** Never nearer a face than this, in gibsons, measured along the way you go. */
export const FLUID_FACE_GAP = 0.15

/** How far toward a ledge the edge safety lets the eye go, in steps from the middle. */
export const FLUID_EDGE_REACH = 0.45

/**
 * The longest line a segment may stray from, in gibsons: the gibsons walked
 * since the segment began must all be within this of the straight hop that
 * publishes it. Under 1, so a turn round a corner is two hops, never one
 * that cuts it; over half a gibson, so a walk at any angle (the gibsons it
 * crosses zigzag round its line) is still one hop.
 */
export const FLUID_LINE_SLACK = 0.75

/**
 * Queue honesty: how the walking speed eases as the walk falls behind its
 * proofs (`behind`, store/useWalk.ts: closed segments not yet proven). Up to
 * FLUID_EASE_FROM it is full speed; then a quarter less for each one more;
 * at FLUID_HOLD_AT no new gibson is entered at all until the chain catches
 * up. That is two under the LOSING SYNC warning (SYNC_WARN_AT, 10): the
 * segment still open when the walker is held closes once it is still
 * (WALK_SETTLE_MS) and counts one more, so walking alone stops at 9 and
 * never brings the warning up. The smooth position is never more than about
 * 0.75 of a step from its anchor (the diagonal zone at a corner), so it can
 * never run ahead of what is queued: only the queue can, and that is what
 * this caps.
 */
export const FLUID_EASE_FROM = 4
/** See FLUID_EASE_FROM: two under SYNC_WARN_AT (10). */
export const FLUID_HOLD_AT = 8

/** The share of the walking speed allowed `behind` proofs behind: 1 up to FLUID_EASE_FROM, falling by a quarter each, 0 from FLUID_HOLD_AT. */
export function syncSpeedFactor(behind: number): number {
  if (behind <= FLUID_EASE_FROM) return 1
  if (behind >= FLUID_HOLD_AT) return 0
  return Math.max(0.25, 1 - (behind - FLUID_EASE_FROM) * 0.25)
}

/** Three plain numbers by cyberspace axis. */
export interface Vec { x: number; y: number; z: number }

export const AXES: readonly AxisName[] = ['x', 'y', 'z']

/** A zero vector. */
export const zero = (): Vec => ({ x: 0, y: 0, z: 0 })

/** The length of `v`. */
export const len = (v: Vec): number => Math.hypot(v.x, v.y, v.z)

/**
 * `v` laid flat across `up` (the walk's up axis), or zero.
 */
export function flatten(v: Vec, up: AxisName | null): Vec {
  return up ? { ...v, [up]: 0 } : { ...v }
}

/**
 * The way the held keys ask to go, as a vector of length at most 1, in
 * cyberspace axes: `forward` and `right` are the camera's, laid flat across
 * `up` (under GRAVITY the axis of the walker's gravity, else the screen's
 * up), so forward never digs into the floor; `vertical` is the screen's up
 * (gravity off only: under gravity Up and Down are a jump and Down, never a
 * push). Forward with a side is 45 degrees to that side, no faster than
 * forward alone.
 */
export function wishOf(forward: Vec, right: Vec, up: AxisName, fwd: number, strafe: number, vertical: AxisDirection | null, vert: number): Vec {
  const f = unit(flatten(forward, up))
  const r = unit(flatten(right, up))
  const w: Vec = { x: f.x * fwd + r.x * strafe, y: f.y * fwd + r.y * strafe, z: f.z * fwd + r.z * strafe }
  if (vertical && vert !== 0) w[vertical.axis] += vertical.dir * vert
  const n = len(w)
  return n > 1 ? { x: w.x / n, y: w.y / n, z: w.z / n } : w
}

function unit(v: Vec): Vec {
  const n = len(v)
  return n > 1e-9 ? { x: v.x / n, y: v.y / n, z: v.z / n } : zero()
}

/**
 * One frame of the velocity `v` (steps/s), toward `wish` (length up to 1)
 * times `max`, by at most `accel * dt` while something is held, or toward
 * rest by `decel * dt` with nothing held. Over `max` (the speed cap just
 * tightened), it slows at `decel`. In place.
 */
export function accelerate(v: Vec, wish: Vec, max: number, accel: number, decel: number, dt: number): void {
  const held = len(wish) > 1e-9
  const target: Vec = held ? { x: wish.x * max, y: wish.y * max, z: wish.z * max } : zero()
  const speed = len(v)
  // The cap came down under you: slow at the braking rate, not the push.
  const rate = !held || speed > max + 1e-9 ? decel : accel
  const d: Vec = { x: target.x - v.x, y: target.y - v.y, z: target.z - v.z }
  const n = len(d)
  const k = n > rate * dt ? (rate * dt) / n : 1
  v.x += d.x * k
  v.y += d.y * k
  v.z += d.z * k
}

/**
 * Whether the straight hop from `from` to `to` stays within `slack` gibsons
 * of every gibson in `cells` (the ones walked since `from`): then one hop is
 * an honest account of the walk, and the segment can grow to `to`. With
 * `ignore`, that axis is left out (in the air, the arc's height is the
 * fall's, as a press's hop in the air always ignored it).
 */
export function onLine(from: Position, cells: readonly Position[], to: Position, slack = FLUID_LINE_SLACK, ignore: AxisName | null = null): boolean {
  const flat = (p: Position): Vec => ({ x: ignore === 'x' ? 0 : Number(p.x - from.x), y: ignore === 'y' ? 0 : Number(p.y - from.y), z: ignore === 'z' ? 0 : Number(p.z - from.z) })
  const d = flat(to)
  const dd = d.x * d.x + d.y * d.y + d.z * d.z
  for (const c of cells) {
    const w = flat(c)
    const t = dd > 0 ? Math.max(0, Math.min(1, (w.x * d.x + w.y * d.y + w.z * d.z) / dd)) : 0
    const e = Math.hypot(w.x - t * d.x, w.y - t * d.y, w.z - t * d.z)
    if (e > slack) return false
  }
  return true
}

/**
 * Which crossing a smooth position `frac` (steps from its anchor's middle)
 * moving at `v` is due, or null: the axis furthest past the half-step
 * boundary, in the way it is moving (or at rest there), and a second level
 * axis when that one is within FLUID_DIAGONAL_ZONE of its own boundary and
 * moving toward it (one diagonal step). `level` lists the axes a diagonal
 * may use: the two across gravity, or all three with gravity off.
 */
export function dueCrossing(frac: Vec, v: Vec, level: readonly AxisName[]): { main: AxisDirection; side: AxisDirection | null } | null {
  let best: AxisName | null = null
  for (const a of AXES) {
    if (Math.abs(frac[a]) <= 0.5 || frac[a] * v[a] < 0) continue
    if (best === null || Math.abs(frac[a]) > Math.abs(frac[best])) best = a
  }
  if (best === null) return null
  const main: AxisDirection = { axis: best, dir: frac[best] > 0 ? 1 : -1 }
  let side: AxisDirection | null = null
  if (level.includes(best)) {
    for (const b of level) {
      if (b === best) continue
      if (Math.abs(frac[b]) > 0.5 - FLUID_DIAGONAL_ZONE && frac[b] * v[b] > 0 && (side === null || Math.abs(frac[b]) > Math.abs(frac[side.axis]))) side = { axis: b, dir: frac[b] > 0 ? 1 : -1 }
    }
  }
  return { main, side }
}
