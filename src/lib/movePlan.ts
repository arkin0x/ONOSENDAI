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

export interface PlanStep {
  kind: PlanStepKind
  from: Position
  to: Position
  /** Tallest per-axis LCA height of this step. */
  maxHeight: number
  /** Per-axis LCA heights, for the panel and for the sidestep tags. */
  heights: { x: number; y: number; z: number }
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
 * `cur` is `to`.
 */
export function nextStep(cur: Position, to: Position, ceiling: number): PlanStep | null {
  if (ceiling < 1) throw new Error('ceiling must be at least 1')
  if (cur.x === to.x && cur.y === to.y && cur.z === to.z) return null
  const mx = nextAxisMove(cur.x, to.x, ceiling)
  const my = nextAxisMove(cur.y, to.y, ceiling)
  const mz = nextAxisMove(cur.z, to.z, ceiling)
  const crossing = mx.kind === 'sidestep' || my.kind === 'sidestep' || mz.kind === 'sidestep'
  const pick = (m: AxisMove, v: bigint): { to: bigint; h: number } => {
    if (crossing) return m.kind === 'sidestep' ? { to: m.to, h: m.height } : { to: v, h: 0 }
    return m.kind === 'hop' ? { to: m.to, h: m.height } : { to: v, h: 0 }
  }
  const px = pick(mx, cur.x)
  const py = pick(my, cur.y)
  const pz = pick(mz, cur.z)
  return {
    kind: crossing ? 'sidestep' : 'hop',
    from: cur,
    to: { x: px.to, y: py.to, z: pz.to },
    maxHeight: Math.max(px.h, py.h, pz.h),
    heights: { x: px.h, y: py.h, z: pz.h },
  }
}

/**
 * The whole route as a list. Under the strict rule a route can be very long
 * (one sidestep per block boundary above the ceiling between here and every
 * wall's edge), so the list is capped; `planSummary` counts without building.
 */
export function buildMovePlan(from: Position, to: Position, ceiling: number, cap: number = 10_000): PlanStep[] {
  const steps: PlanStep[] = []
  let cur: Position = { ...from }
  for (let n = 0; n < cap; n++) {
    const step = nextStep(cur, to, ceiling)
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
}

/**
 * How long the route is, without keeping it: the panel shows this before a
 * commit and the plan carries it while running. Walks the same steps the
 * plan will take, so it is exact up to `cap`.
 */
export function planSummary(from: Position, to: Position, ceiling: number, cap: number = 100_000): PlanSummary {
  let hops = 0
  let sidesteps = 0
  let tallestWall = 0
  let cur: Position = { ...from }
  for (let n = 0; n < cap; n++) {
    const step = nextStep(cur, to, ceiling)
    if (!step) return { steps: hops + sidesteps, hops, sidesteps, tallestWall, capped: false }
    if (step.kind === 'hop') hops++
    else {
      sidesteps++
      if (step.maxHeight > tallestWall) tallestWall = step.maxHeight
    }
    cur = step.to
  }
  return { steps: hops + sidesteps, hops, sidesteps, tallestWall, capped: true }
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
