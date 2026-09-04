/**
 * movePlan.ts - the route from the avatar to the cursor as a list of steps.
 *
 * One commit used to be one event. That was wrong whenever a wall stood in the
 * way: a sidestep is the smallest move across a wall (CYBERSPACE_V2 6.3), so
 * the avatar has to be standing on the leaf touching the wall before it
 * sidesteps, and everything between here and there is ordinary hops. This
 * module turns "go to the cursor" into that sequence: hops within the ceiling
 * up to the wall, one sidestep of exactly 1 gibson across it, hops onward,
 * repeated for every wall on the way. Each step becomes its own signed event.
 *
 * Pure functions over bigint axis values; the store executes the plan.
 */

import { findLcaHeight } from 'cyberspace-core'

export interface Position {
  x: bigint
  y: bigint
  z: bigint
}

export type PlanStepKind = 'hop' | 'sidestep'

/** Who does the work: this machine, HOSAKA, or nobody can. */
export type StepSource = 'local' | 'cloud' | 'infeasible'

export interface PlanStep {
  kind: PlanStepKind
  from: Position
  to: Position
  /** Tallest per-axis LCA height of this step. */
  maxHeight: number
  /** Per-axis LCA heights, for the panel and for the sidestep tags. */
  heights: { x: number; y: number; z: number }
  source: StepSource
}

/**
 * What each primitive can reach, here and in the cloud. Cloud values are 0
 * when the cloud is off or its limits are not known yet. A step is this
 * machine's whenever this machine can take it, however long the walk that
 * makes; HOSAKA takes a step only where no local step exists, which is a
 * boundary above the local sidestep ceiling. Its step is then planned with
 * its own caps: a paid hop across the boundary, landing at the cursor when
 * the cursor is within its hop cap, else a paid sidestep of one gibson. A
 * boundary above both sidestep ceilings makes the route infeasible there.
 */
export interface Ceilings {
  hop: number
  sidestep: number
  cloudHop: number
  cloudSidestep: number
}

export function localOnly(hop: number, sidestep: number = hop): Ceilings {
  return { hop, sidestep, cloudHop: 0, cloudSidestep: 0 }
}

function asCeilings(c: number | Ceilings): Ceilings {
  return typeof c === 'number' ? localOnly(c, Number.MAX_SAFE_INTEGER) : c
}

function sourceOf(kind: PlanStepKind, h: number, c: Ceilings): StepSource {
  if (kind === 'hop') return h <= c.hop ? 'local' : h <= c.cloudHop ? 'cloud' : 'infeasible'
  return h <= c.sidestep ? 'local' : h <= c.cloudSidestep ? 'cloud' : 'infeasible'
}

/**
 * Whether anyone in `c` can take the whole route, in constant time. The
 * tallest boundary the route crosses on an axis is the LCA height of that
 * axis, crossed once; every other boundary on the way is lower. So the route
 * is feasible exactly when its tallest boundary fits a hop ceiling or a
 * sidestep ceiling. `planSummary` walks the same route and agrees, but a
 * long walk costs a step per block boundary and this is asked on every
 * cursor move.
 */
export function routeFeasible(from: Position, to: Position, ceilings: number | Ceilings): boolean {
  const c = asCeilings(ceilings)
  const h = Math.max(findLcaHeight(from.x, to.x), findLcaHeight(from.y, to.y), findLcaHeight(from.z, to.z))
  return h <= Math.max(c.hop, c.cloudHop) || h <= Math.max(c.sidestep, c.cloudSidestep)
}

export type AxisMove =
  | { kind: 'none' }
  | { kind: 'hop'; to: bigint; height: number }
  | { kind: 'sidestep'; to: bigint; height: number }

/**
 * The leaf touching the wall on the source side, for the wall at height `h`
 * between `current` and `target`: all bits below h-1 set going up, cleared
 * going down (spec 6.3).
 */
export function wallSource(current: bigint, target: bigint, h: number): bigint {
  const hb = BigInt(h)
  const base = (current >> hb) << hb
  const half = 1n << BigInt(h - 1)
  return target > current ? base + half - 1n : base + half
}

/** Whether a single-axis move from `v1` to `v2` is a spec 6.3 sidestep. */
export function isSpecSidestep(v1: bigint, v2: bigint): boolean {
  if (v1 === v2) return false
  const h = findLcaHeight(v1, v2)
  if (h === 0) return false
  return v1 === wallSource(v1, v2, h) && (v2 === v1 + 1n || v2 === v1 - 1n)
}

/** Whether a 3D move is a valid sidestep: every moving axis is a 6.3 crossing. */
export function isSpecSidestepMove(from: Position, to: Position): boolean {
  const axes: Array<[bigint, bigint]> = [[from.x, to.x], [from.y, to.y], [from.z, to.z]]
  const moving = axes.filter(([a, b]) => a !== b)
  return moving.length > 0 && moving.every(([a, b]) => isSpecSidestep(a, b))
}

/**
 * The next move on one axis toward `target` with hops capped at `ceiling`.
 *
 * If the tallest boundary between here and the target fits the ceiling, one
 * hop reaches the target. Otherwise that boundary is a wall: if we stand on
 * the leaf touching it, the move is the sidestep across; if not, the move is
 * whatever brings us toward that leaf, which is the same question asked again
 * with the wall leaf as the target (the recursion bottoms out because each
 * wall leaf is nearer and its own walls are lower).
 */
export function nextAxisMove(current: bigint, target: bigint, ceiling: number): AxisMove {
  if (current === target) return { kind: 'none' }
  const h = findLcaHeight(current, target)
  if (h <= ceiling) return { kind: 'hop', to: target, height: h }
  const wall = wallSource(current, target, h)
  if (current === wall) {
    return { kind: 'sidestep', to: target > current ? current + 1n : current - 1n, height: h }
  }
  return nextAxisMove(current, wall, ceiling)
}

/**
 * The next step of the route from `cur` to `to`. Hops move every axis that
 * can move at once; a sidestep moves exactly the axes that are standing at
 * their walls (spec 6.9) and holds the others until it is done. Null when
 * `cur` is `to`. With cloud ceilings the step is this machine's whenever it
 * has one, and HOSAKA's only at a wall this machine cannot cross.
 */
export function nextStep(cur: Position, to: Position, ceilings: number | Ceilings): PlanStep | null {
  const c = asCeilings(ceilings)
  // Local first, per step: the cloud plans a step only when this machine has
  // none, so a walk this machine can make is never a paid hop.
  if (c.cloudHop > 0 || c.cloudSidestep > 0) {
    const mine = nextStep(cur, to, localOnly(c.hop, c.sidestep))
    if (mine === null || mine.source === 'local') return mine
  }
  const walk = Math.max(c.hop, c.cloudHop)
  if (walk < 1) throw new Error('ceiling must be at least 1')
  if (cur.x === to.x && cur.y === to.y && cur.z === to.z) return null
  const mx = nextAxisMove(cur.x, to.x, walk)
  const my = nextAxisMove(cur.y, to.y, walk)
  const mz = nextAxisMove(cur.z, to.z, walk)
  const crossing = mx.kind === 'sidestep' || my.kind === 'sidestep' || mz.kind === 'sidestep'
  const pick = (m: AxisMove, v: bigint): { to: bigint; h: number } => {
    if (crossing) return m.kind === 'sidestep' ? { to: m.to, h: m.height } : { to: v, h: 0 }
    return m.kind === 'hop' ? { to: m.to, h: m.height } : { to: v, h: 0 }
  }
  const px = pick(mx, cur.x)
  const py = pick(my, cur.y)
  const pz = pick(mz, cur.z)
  const kind: PlanStepKind = crossing ? 'sidestep' : 'hop'
  const maxHeight = Math.max(px.h, py.h, pz.h)
  return {
    kind,
    from: cur,
    to: { x: px.to, y: py.to, z: pz.to },
    maxHeight,
    heights: { x: px.h, y: py.h, z: pz.h },
    source: sourceOf(kind, maxHeight, c),
  }
}

/**
 * The whole route as a list. Under the strict rule a route can be very long
 * (one sidestep per block boundary above the ceiling between here and every
 * wall's edge), so the list is capped; `planSummary` counts without building.
 */
export function buildMovePlan(from: Position, to: Position, ceilings: number | Ceilings, cap: number = 10_000): PlanStep[] {
  const steps: PlanStep[] = []
  let cur: Position = { ...from }
  for (let n = 0; n < cap; n++) {
    const step = nextStep(cur, to, ceilings)
    if (!step) return steps
    steps.push(step)
    cur = step.to
  }
  throw new Error(`move plan longer than ${cap} steps`)
}

export interface PlanSummary {
  steps: number
  hops: number
  sidesteps: number
  tallestWall: number
  /** True when counting stopped at `cap`; `steps` is then a floor. */
  capped: boolean
  /** Steps HOSAKA would do, and the first step nobody can do (null when the whole route is feasible). */
  cloudSteps: number
  infeasibleAt: number | null
}

/**
 * How long the route is, without keeping it: the panel shows this before a
 * commit and the plan carries it while running. Walks the same steps the
 * plan will take, so it is exact up to `cap`.
 */
export function planSummary(from: Position, to: Position, ceilings: number | Ceilings, cap: number = 100_000): PlanSummary {
  let hops = 0
  let sidesteps = 0
  let tallestWall = 0
  let cloudSteps = 0
  let infeasibleAt: number | null = null
  let cur: Position = { ...from }
  for (let n = 0; n < cap; n++) {
    const step = nextStep(cur, to, ceilings)
    if (!step) return { steps: hops + sidesteps, hops, sidesteps, tallestWall, capped: false, cloudSteps, infeasibleAt }
    if (step.kind === 'hop') hops++
    else {
      sidesteps++
      if (step.maxHeight > tallestWall) tallestWall = step.maxHeight
    }
    if (step.source === 'cloud') cloudSteps++
    if (step.source === 'infeasible' && infeasibleAt === null) infeasibleAt = n
    cur = step.to
  }
  return { steps: hops + sidesteps, hops, sidesteps, tallestWall, capped: true, cloudSteps, infeasibleAt }
}

/** Counts for a one-line summary: "3 hops, 1 sidestep". */
export function summarizePlan(steps: PlanStep[]): { hops: number; sidesteps: number; tallestWall: number } {
  let hops = 0
  let sidesteps = 0
  let tallestWall = 0
  for (const s of steps) {
    if (s.kind === 'hop') hops++
    else {
      sidesteps++
      tallestWall = Math.max(tallestWall, s.maxHeight)
    }
  }
  return { hops, sidesteps, tallestWall }
}
