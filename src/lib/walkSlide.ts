/**
 * walkSlide.ts: WALK's diagonal steps and wall sliding (arkinox, asked
 * 2026-11-03, rules RULED the same day: "agreed").
 *
 * Two pure functions, kept apart from the walk store so HOP and VIEW can use
 * them too if the owner wants it there (he said it may extend to both):
 *
 * - walkHeading: which way a forward or backward press goes, from the way
 *   you face. Facing snaps to 8 directions in the plane you walk in: within
 *   22.5 degrees of a diagonal (45 between two axes) it is that diagonal,
 *   otherwise the nearest axis, with the side you are angled toward kept for
 *   a slide.
 * - planWalkMove: where that press lands among walls, given only a function
 *   that answers how far a straight step along one axis goes (in WALK,
 *   store/walkStep.ts walkStep, which holds by the shards' constrain rules
 *   and does the step-up and step-down).
 *
 * | Heading | Way ahead | The press |
 * |---|---|---|
 * | straight | open (or open part way) | the straight step, as before |
 * | straight, angled 5 degrees or more to a side | blocked | one step to that side, if it is open: a slide along the wall |
 * | straight on (under 5 degrees) | blocked | nothing, as before |
 * | diagonal | both side cells and the diagonal cell open | ONE step changing two axes: one hop, one chain event |
 * | diagonal | a side cell blocked, or the diagonal cell | a slide along the side that is open (the nearer to your facing first); no corner is ever cut |
 * | diagonal | both sides blocked | nothing |
 *
 * Every move it makes is along an axis your heading leans toward, so a press
 * never takes you backward. Nothing here decides what a wall is.
 */

import type { AxisDirection, AxisName, Position } from './space'

/** A diagonal is within this many degrees of 45 (RULED: +/-22.5). */
export const DIAGONAL_HALF_DEG = 22.5

/**
 * Angled less than this from straight on, a blocked press does not slide:
 * walking straight into a flat wall does nothing (RULED), and a mouse never
 * looks exactly straight. Not ruled: the least surprising default.
 */
export const SLIDE_MIN_DEG = 5

/** A direction in cyberspace axes, as plain numbers. */
export interface Vec3 { x: number; y: number; z: number }

/** Which way a press goes, snapped to 8 directions. */
export interface WalkHeading {
  /** The axis the press steps along: the one nearest the heading (for a diagonal, the nearer of its two; exactly between, the one you face along). */
  main: AxisDirection
  /** A diagonal's second axis: it changes in the same step. Null when straight. */
  side: AxisDirection | null
  /** Straight only: the side the heading is angled toward, where a blocked press slides. Null straight on or diagonal. */
  lean: AxisDirection | null
}

const AXES: readonly AxisName[] = ['x', 'y', 'z']
const sign = (n: number): 1 | -1 => (n < 0 ? -1 : 1)

/** `v` laid flat on the plane across `up`, as a unit vector, or null when nothing is left of it. */
function flat(v: Vec3, up: AxisName): Vec3 | null {
  const f = { ...v, [up]: 0 }
  const n = Math.hypot(f.x, f.y, f.z)
  if (!(n > 1e-6)) return null
  return { x: f.x / n, y: f.y / n, z: f.z / n }
}

/**
 * The heading of a press from the way you face. `forward` and `right` are
 * where the camera looks and its right, in cyberspace axes; `up` is the axis
 * the walk treats as up (cyberspace Y under GRAVITY), and the press is in the
 * plane across it. `fwd` is +1 for forward and -1 for backward, which mirrors
 * everything; `strafe` adds a side key held with it (+1 right, -1 left), so
 * W with D held is 45 degrees right of where you face. Null when the facing
 * is no use: looking straight along `up`, or nothing to go by.
 */
export function walkHeading(forward: Vec3, right: Vec3, up: AxisName, fwd: 1 | -1, strafe: -1 | 0 | 1 = 0): WalkHeading | null {
  const f = flat(forward, up)
  if (!f) return null
  let v: Vec3 = { x: f.x * fwd, y: f.y * fwd, z: f.z * fwd }
  if (strafe !== 0) {
    const r = flat(right, up)
    if (r) v = { x: v.x + r.x * strafe, y: v.y + r.y * strafe, z: v.z + r.z * strafe }
  }
  const [p, q] = AXES.filter((a) => a !== up)
  const a = v[p]
  const b = v[q]
  const big = Math.max(Math.abs(a), Math.abs(b))
  if (!(big > 1e-9)) return null
  // Degrees off the nearest axis, 0 to 45.
  const off = (Math.atan(Math.min(Math.abs(a), Math.abs(b)) / big) * 180) / Math.PI
  // The main axis is the nearer; exactly between (W with D, facing straight), the one you face along.
  const tie = Math.abs(Math.abs(a) - Math.abs(b)) < 1e-9
  const [m, s] = (tie ? Math.abs(f[p]) >= Math.abs(f[q]) : Math.abs(a) >= Math.abs(b)) ? [p, q] : [q, p]
  const main: AxisDirection = { axis: m, dir: sign(v[m]) }
  const other: AxisDirection = { axis: s, dir: sign(v[s]) }
  if (off >= 45 - DIAGONAL_HALF_DEG - 1e-9) return { main, side: other, lean: null }
  return { main, side: null, lean: off >= SLIDE_MIN_DEG - 1e-9 ? other : null }
}

/** A straight step's answer: where it lands, and what held it short, if anything did. */
export interface StepResult<B> { to: Position; by: B | null }

/** How far a straight step of `length` from `at` along one axis goes. */
export type Stepper<B> = (at: Position, axis: AxisName, dir: 1 | -1, length: bigint) => StepResult<B>

/** Where a press lands, and how. */
export interface WalkMove<B> {
  to: Position
  /** What held it, when it went nowhere or only part way. */
  by: B | null
  /** straight: along the heading; diagonal: two axes in one step; slide: to the side, along a wall; held: nowhere. */
  kind: 'straight' | 'diagonal' | 'slide' | 'held'
  /** The axis it moved along (for a diagonal, the main one), or null when held. */
  along: AxisDirection | null
  /** A diagonal's second axis, else null. */
  side: AxisDirection | null
}

const samePlace = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z
/** Whether a step went its whole length along its axis (a climb or a settle on the way is fine). */
const whole = (at: Position, r: StepResult<unknown>, d: AxisDirection, length: bigint): boolean =>
  r.to[d.axis] - at[d.axis] === BigInt(d.dir) * length

/**
 * Where a press of `length` from `from` along `heading` lands, asking `step`
 * how far each straight step goes. The decision is all here; what is a wall,
 * and the stairs, are `step`'s.
 *
 * A diagonal is the two L-shaped ways round its square, each a straight step
 * `step` has cleared: both must go their whole way and meet at one place, so
 * both side cells are open and the corner is never cut, and a stair on the
 * way is climbed the same on both. It is all or nothing; refused, the press
 * slides instead.
 */
export function planWalkMove<B>(from: Position, heading: WalkHeading, length: bigint, step: Stepper<B>): WalkMove<B> {
  const { main, side, lean } = heading
  if (!side) {
    const ahead = step(from, main.axis, main.dir, length)
    if (!samePlace(ahead.to, from)) return { to: ahead.to, by: ahead.by, kind: 'straight', along: main, side: null }
    if (lean) {
      const slid = step(from, lean.axis, lean.dir, length)
      if (!samePlace(slid.to, from)) return { to: slid.to, by: slid.by, kind: 'slide', along: lean, side: null }
    }
    return { to: from, by: ahead.by, kind: 'held', along: null, side: null }
  }
  const a = step(from, main.axis, main.dir, length)
  const b = step(from, side.axis, side.dir, length)
  const aOpen = whole(from, a, main, length)
  const bOpen = whole(from, b, side, length)
  if (aOpen && bOpen) {
    const ab = step(a.to, side.axis, side.dir, length)
    const ba = step(b.to, main.axis, main.dir, length)
    if (whole(a.to, ab, side, length) && whole(b.to, ba, main, length) && samePlace(ab.to, ba.to)) {
      return { to: ab.to, by: null, kind: 'diagonal', along: main, side }
    }
  }
  // No diagonal: along whichever side is open, the nearer first; then one open part way.
  const ways: Array<[StepResult<B>, AxisDirection, boolean]> = [[a, main, aOpen], [b, side, bOpen]]
  const go = ways.find(([, , open]) => open) ?? ways.find(([r]) => !samePlace(r.to, from))
  if (go) return { to: go[0].to, by: go[0].by, kind: 'slide', along: go[1], side: null }
  return { to: from, by: a.by ?? b.by, kind: 'held', along: null, side: null }
}
