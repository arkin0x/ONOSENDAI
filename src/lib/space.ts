/**
 * space.ts — pure helpers bridging the u85 protocol space and the render space.
 *
 * The protocol works in 85-bit unsigned integers. Three.js works in float32.
 * Nothing here ever converts an absolute coordinate to a float: positions are
 * always rendered as integer *offsets* from the avatar's aligned cell, so
 * precision is exact no matter how deep into the axis you are.
 */

import { Matrix4, Quaternion, Vector3 } from 'three'
import { AXIS_MAX, findLcaHeight } from 'cyberspace-core'

export type AxisName = 'x' | 'y' | 'z'

export interface Position {
  x: bigint
  y: bigint
  z: bigint
}

/** Largest usable scale exponent. A step of 2^84 spans half the axis. */
export const MAX_SCALE_EXP = 84

/** Grid radius in cells. The view shows (2 * GRID_RADIUS + 1)^2 cells. */
export const GRID_RADIUS = 24

/**
 * Count trailing zero bits of a positive bigint.
 */
export function trailingZeros(v: bigint): number {
  if (v === 0n) return 0
  let count = 0
  let n = v
  while ((n & 1n) === 0n) {
    n >>= 1n
    count++
  }
  return count
}

/**
 * The step size, in gibsons, for a given logarithmic scale exponent.
 */
export function stepFor(scaleExp: number): bigint {
  return 1n << BigInt(scaleExp)
}

/**
 * Align a value down to the containing cell at this scale.
 */
export function alignTo(v: bigint, scaleExp: number): bigint {
  const s = BigInt(scaleExp)
  return (v >> s) << s
}

/**
 * Clamp an axis value into [0, 2^85 - 1].
 */
export function clampAxis(v: bigint): bigint {
  if (v < 0n) return 0n
  if (v > AXIS_MAX) return AXIS_MAX
  return v
}

/**
 * The LCA height paid to cross the boundary at absolute coordinate `c`,
 * arriving from the cell below it at this scale.
 *
 * This is the number the whole visualization exists to make visible: it is not
 * a function of how far you travel, only of which power-of-two boundary you
 * cross. Crossing into 2^34 costs height 34 even as a single-gibson step.
 */
export function boundaryHeight(c: bigint, scaleExp: number): number {
  if (c <= 0n) return 0
  return findLcaHeight(c - stepFor(scaleExp), c)
}

/**
 * World coordinate of the boundary sitting at local grid index `i` along an axis.
 *
 * Cell `i` starts at `origin + i * step * dir`. The boundary between cells
 * `i - 1` and `i` is whichever of those two starts is larger, which holds for
 * either sign of `dir`.
 */
export function boundaryCoord(
  originValue: bigint,
  i: number,
  step: bigint,
  dir: number,
): bigint {
  const here = originValue + BigInt(i) * step * BigInt(dir)
  const before = originValue + BigInt(i - 1) * step * BigInt(dir)
  return here > before ? here : before
}

/**
 * Sub-cell position along an axis as a 0..1 fraction.
 *
 * Uses fixed-point bigint division: `Number(offset) / Number(step)` would lose
 * the offset entirely once step exceeds 2^53.
 */
export function subCellFraction(value: bigint, scaleExp: number): number {
  const step = stepFor(scaleExp)
  if (step === 1n) return 0
  const offset = value - alignTo(value, scaleExp)
  return Number((offset * 10_000n) / step) / 10_000
}

// ---------- View orientation ----------

/**
 * Build a quaternion from an explicit world-space camera basis.
 */
function basisQuaternion(right: Vector3, up: Vector3, back: Vector3): Quaternion {
  const m = new Matrix4().makeBasis(right, up, back)
  return new Quaternion().setFromRotationMatrix(m)
}

/**
 * The default view: top-down, looking along -Y at the X/Z plane.
 * Screen right is +X, screen up is -Z, so W travels "away" along -Z.
 */
export function topDownQuaternion(): Quaternion {
  return basisQuaternion(
    new Vector3(1, 0, 0), // local +X -> world +X
    new Vector3(0, 0, -1), // local +Y -> world -Z
    new Vector3(0, 1, 0), // local +Z -> world +Y (camera looks along -Z, i.e. down)
  )
}

const AXES: Array<{ axis: AxisName; dir: 1 | -1; vec: Vector3 }> = [
  { axis: 'x', dir: 1, vec: new Vector3(1, 0, 0) },
  { axis: 'x', dir: -1, vec: new Vector3(-1, 0, 0) },
  { axis: 'y', dir: 1, vec: new Vector3(0, 1, 0) },
  { axis: 'y', dir: -1, vec: new Vector3(0, -1, 0) },
  { axis: 'z', dir: 1, vec: new Vector3(0, 0, 1) },
  { axis: 'z', dir: -1, vec: new Vector3(0, 0, -1) },
]

export interface AxisDirection {
  axis: AxisName
  dir: 1 | -1
}

/**
 * Snap an arbitrary direction to the nearest signed world axis. Views are
 * always axis-aligned, so this is exact in practice, but snapping keeps the
 * mapping stable through the animated rotation.
 */
export function snapToAxis(v: Vector3): AxisDirection {
  let best = AXES[0]
  let bestDot = -Infinity
  for (const candidate of AXES) {
    const d = v.dot(candidate.vec)
    if (d > bestDot) {
      bestDot = d
      best = candidate
    }
  }
  return { axis: best.axis, dir: best.dir }
}

export interface ViewAxes {
  /** World axis that points right on screen. */
  right: AxisDirection
  /** World axis that points up on screen. */
  up: AxisDirection
  /** World axis that points out of the screen toward the viewer. */
  out: AxisDirection
}

/**
 * Derive which world axes are currently mapped to screen directions.
 */
export function viewAxes(q: Quaternion): ViewAxes {
  return {
    right: snapToAxis(new Vector3(1, 0, 0).applyQuaternion(q)),
    up: snapToAxis(new Vector3(0, 1, 0).applyQuaternion(q)),
    out: snapToAxis(new Vector3(0, 0, 1).applyQuaternion(q)),
  }
}

export type RotateDirection = 'left' | 'right' | 'up' | 'down'

/**
 * Rotate a view quaternion by 90 degrees in camera-local space, which keeps
 * every reachable orientation axis-aligned.
 */
export function rotateView(q: Quaternion, dir: RotateDirection): Quaternion {
  const half = Math.PI / 2
  const delta = new Quaternion()
  switch (dir) {
    case 'right':
      delta.setFromAxisAngle(new Vector3(0, 1, 0), -half)
      break
    case 'left':
      delta.setFromAxisAngle(new Vector3(0, 1, 0), half)
      break
    case 'up':
      delta.setFromAxisAngle(new Vector3(1, 0, 0), half)
      break
    case 'down':
      delta.setFromAxisAngle(new Vector3(1, 0, 0), -half)
      break
  }
  return q.clone().multiply(delta)
}

// ---------- Formatting ----------

/**
 * Render a bigint with digit grouping.
 */
export function formatBig(v: bigint): string {
  return v.toLocaleString('en-US')
}

/**
 * Compact scale label, e.g. "1 G", "1.02 KG", "2^40 G".
 */
export function formatStep(scaleExp: number): string {
  if (scaleExp === 0) return '1 G'
  if (scaleExp < 20) return `${formatBig(stepFor(scaleExp))} G`
  return `2^${scaleExp} G`
}

/**
 * Human-readable duration.
 */
export function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/**
 * Compact large integers for the ops readout.
 */
export function formatOps(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}K`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`
  return `${(n / 1e9).toFixed(2)}B`
}
