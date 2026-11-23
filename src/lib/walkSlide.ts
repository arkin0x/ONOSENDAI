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
 * | diagonal | the diagonal cell reachable round at least one side of its square, gibson by gibson | ONE step changing two axes: one hop, one chain event |
 * | diagonal | a side cell blocked by a wall, the other open | still the diagonal, round the open side (arkinox, 2026-11-10: a diagonal must not turn into steps along the grid) |
 * | diagonal | under GRAVITY, no floor under a side cell | still the diagonal: only where you land matters, so a 1-wide diagonal bridge is walked |
 * | diagonal | under GRAVITY, a floor 1 or 2 down where it lands | it steps down onto it, as a straight step does |
 * | diagonal | under GRAVITY, no floor where it lands | a straight step that lands on a floor instead (the side nearer your facing first), so facing a little outward on a straight walkway walks along it; if neither does, the diagonal, and the fall (edge safety, coordinator's ruling of 2026-11-10, the owner's to confirm) |
 * | diagonal | both side cells walls (a diagonal crack), or the diagonal cell a wall | no diagonal: a slide along a side that is open (the nearer to your facing first), else nothing |
 * | diagonal, a press longer than 16 gibsons | any | no diagonal: the straight step, or the slide |
 * | any slide, under GRAVITY, a press of 16 gibsons or less | the side has no floor | not taken: a slide never walks you off a ledge sideways |
 * | any slide, under GRAVITY, a press longer than 16 | any | taken as before: a coarse step does no step-down, so it rarely lands standing, and checking would make it do nothing |
 *
 * Every move it makes is along an axis your heading leans toward, so a press
 * never takes you backward. Nothing here decides what a wall is.
 *
 * The corner rule (arkinox's play test, 2026-11-10: "when i face diagonal
 * across the grid of gibsons my movement tended to snap to adjacent gibsons
 * instead of actually moving diagonally, which made me fall a few times").
 * Until then a diagonal needed both side cells open, and under GRAVITY both
 * standing (RULED 2026-11-03, review of #594); anything else became a
 * straight step, which next to a rail or a pillar zigzagged along the grid,
 * one hop a step, and on a narrow or diagonal walkway stepped off the edge.
 * Now a diagonal needs one clear way round its square and a place to land;
 * it is refused only by a wall on both sides, which is too narrow a gap to
 * squeeze through, or by a wall in the diagonal cell itself.
 */

import type { AxisDirection, AxisName, Position } from './space'
import { WORLD_DOWN } from './walkDown'

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
 * the walk treats as up (under GRAVITY the axis of the walker's gravity,
 * lib/walkDown.ts; else the screen's up), and the press is in the
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
 * The longest press walked as a diagonal, in gibsons: one Maze Kit tile, as
 * store/walkStep.ts STEP_SUBSTEP_MAX substeps a straight press. Past it a
 * press is never a diagonal (review of #594): it is the straight step, or
 * the slide.
 */
export const DIAGONAL_MAX = 16n

/**
 * Under GRAVITY, how far a diagonal settles down onto a floor where it lands,
 * in gibsons: store/walkStep.ts STEP_DOWN_MAX, so a diagonal steps down a
 * stair as a straight step does (lib may not import the store).
 */
export const DIAGONAL_SETTLE_MAX = 2n

/** What the planner may also ask of the world. */
export interface WalkPlanOptions {
  /**
   * Under GRAVITY: whether you stand at a point (store/walkStep.ts standing).
   * A diagonal then ends on the first gibson past an edge, where the fall
   * starts; the side cells it passes need no floor (a diagonal bridge). A
   * slide, which is not the way you face, is taken only onto a floor.
   */
  stands?: (at: Position) => boolean
  /** Under GRAVITY, which way is down (lib/walkDown.ts): a settle goes that way. Cyberspace -Y when absent. */
  down?: AxisDirection
}

/**
 * Where a press of `length` from `from` along `heading` lands, asking `step`
 * how far each straight step goes. The decision is all here; what is a wall,
 * and the stairs, are `step`'s.
 *
 * A diagonal is walked one gibson at a time (review of #594: a whole press's
 * square left its inside untested, so a pillar in the middle of a coarse
 * step was walked through). Each one-gibson diagonal is the two L-shaped ways
 * round its square, each two straight steps `step` has cleared: one way that
 * goes both its gibsons is enough (main axis first when both do; under
 * GRAVITY the one that lands on a floor first). Both ways shut is a wall on
 * both sides or in the diagonal cell, and no diagonal. What `step` cannot see
 * is a wall inside one gibson's square that neither way round touches: a
 * post in the middle, or the corner of a wall that fills the shut side cell
 * and pokes into the square. The way taken clears it, but the straight line
 * the step is drawn along can run through it: measured, up to about 0.7
 * gibson into the corner (1/sqrt 2: a corner almost at the square's far
 * edge, the way taken just clear of it). The walls are asked along axes
 * only.
 *
 * Under GRAVITY a way round that ends in the air settles onto a floor up to
 * DIAGONAL_SETTLE_MAX below, as a straight step's step-down does, and a
 * diagonal that would still land with no floor gives way, on its first
 * gibson, to a straight step that lands on one (main axis first); later in a
 * coarse press it stops on the last gibson that stood. Only when no straight
 * step lands on a floor does the diagonal go on, and the fall starts.
 *
 * Held part way, the diagonal stops on the last gibson it reached. Held on
 * its first gibson, or longer than DIAGONAL_MAX, it is no diagonal: the
 * straight step if it goes its whole way, else the slide along the side,
 * else whichever goes at all; under GRAVITY, for a press of up to 16
 * gibsons, only one that lands on a floor.
 */
export function planWalkMove<B>(from: Position, heading: WalkHeading, length: bigint, step: Stepper<B>, options: WalkPlanOptions = {}): WalkMove<B> {
  const { main, side, lean } = heading
  const { stands } = options
  const down = options.down ?? WORLD_DOWN
  /**
   * Under GRAVITY a slide lands on a floor or is not taken: it is not the way
   * you face, so it never walks you off a ledge. A press longer than
   * DIAGONAL_MAX is not checked: walkStep does no step-down for it, so it
   * seldom lands standing, and a check would make coarse presses do nothing.
   */
  const landsOk = (to: Position): boolean => !stands || length > DIAGONAL_MAX || stands(to)
  if (!side) {
    const ahead = step(from, main.axis, main.dir, length)
    if (!samePlace(ahead.to, from)) return { to: ahead.to, by: ahead.by, kind: 'straight', along: main, side: null }
    if (lean) {
      const slid = step(from, lean.axis, lean.dir, length)
      if (!samePlace(slid.to, from) && landsOk(slid.to)) return { to: slid.to, by: slid.by, kind: 'slide', along: lean, side: null }
    }
    return { to: from, by: ahead.by, kind: 'held', along: null, side: null }
  }
  /** One way round a gibson's square from `at`: `first` then `second`, each a whole gibson, or what held it. */
  const roundBy = (at: Position, first: AxisDirection, second: AxisDirection): { to: Position } | { by: B | null } => {
    const one = step(at, first.axis, first.dir, 1n)
    if (!whole(at, one, first, 1n)) return { by: one.by }
    const two = step(one.to, second.axis, second.dir, 1n)
    if (!whole(one.to, two, second, 1n)) return { by: two.by }
    return { to: settle(two.to) }
  }
  /**
   * Under GRAVITY, `at` in the air settled onto a floor up to
   * DIAGONAL_SETTLE_MAX below, by a straight step down `step` has cleared:
   * a second leg from a side cell over a gap does no step-down of its own.
   */
  const settle = (at: Position): Position => {
    if (!stands || stands(at)) return at
    for (let k = 1n; k <= DIAGONAL_SETTLE_MAX; k++) {
      const lower = step(at, down.axis, down.dir, k)
      if (lower.to[down.axis] !== at[down.axis] + BigInt(down.dir) * k) break
      if (stands(lower.to)) return lower.to
    }
    return at
  }
  /** One gibson diagonally from `at`, round whichever side is open, or what held it. */
  const oneGibson = (at: Position): { to: Position } | { by: B | null } => {
    const ways = [roundBy(at, main, side), roundBy(at, side, main)]
    const open = ways.flatMap((w) => ('to' in w ? [w.to] : []))
    if (open.length === 0) return { by: ways.map((w) => ('by' in w ? w.by : null)).find((b) => b !== null) ?? null }
    return { to: (stands && open.find(stands)) || open[0] }
  }
  /** No diagonal: straight if that goes its whole way, else along the side; then whichever goes part way. Null when none goes (that lands, under GRAVITY). */
  const straight = (): WalkMove<B> | null => {
    const a = step(from, main.axis, main.dir, length)
    const b = step(from, side.axis, side.dir, length)
    const ways: Array<[StepResult<B>, AxisDirection, boolean]> = [[a, main, whole(from, a, main, length)], [b, side, whole(from, b, side, length)]]
    const go = ways.find(([r, , open]) => open && landsOk(r.to)) ?? ways.find(([r]) => !samePlace(r.to, from) && landsOk(r.to))
    return go ? { to: go[0].to, by: go[0].by, kind: 'slide', along: go[1], side: null } : null
  }
  if (length <= DIAGONAL_MAX) {
    let at = from
    let by: B | null = null
    for (let n = 0n; n < length; n++) {
      const next = oneGibson(at)
      if (!('to' in next)) { by = next.by; break }
      // Off an edge under gravity (edge safety): on the first gibson, a
      // straight step that lands on a floor instead, if one does; later, the
      // press stops on the last gibson that stood. Else on off the edge, and
      // the fall starts there.
      if (stands && !stands(next.to)) {
        if (n > 0n) break
        const safe = straight()
        if (safe) return safe
        at = next.to
        break
      }
      at = next.to
    }
    if (!samePlace(at, from)) return { to: at, by, kind: 'diagonal', along: main, side }
  }
  const go = straight()
  if (go) return go
  const a = step(from, main.axis, main.dir, length)
  return { to: from, by: a.by ?? step(from, side.axis, side.dir, length).by, kind: 'held', along: null, side: null }
}
