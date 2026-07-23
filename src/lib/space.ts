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
 * Signed distance from `origin` to `value` along an axis, in cells at this
 * scale.
 *
 * Uses fixed-point bigint division: `Number(diff) / Number(step)` would lose
 * the difference entirely once step exceeds 2^53.
 */
export function cellDelta(value: bigint, origin: bigint, scaleExp: number): number {
  const step = stepFor(scaleExp)
  return Number(((value - origin) * 10_000n) / step) / 10_000
}

/**
 * Sub-cell position along an axis as a 0..1 fraction.
 */
export function subCellFraction(value: bigint, scaleExp: number): number {
  return cellDelta(value, alignTo(value, scaleExp), scaleExp)
}

/**
 * Screen offset, in cells, of an absolute axis value, where the avatar's
 * aligned cell spans [-0.5, +0.5]. Mirrors when the axis points left or down
 * on screen, matching how BoundaryGrid lays cells out along a flipped axis.
 */
export function cellOffset(
  value: bigint,
  origin: bigint,
  scaleExp: number,
  dir: number,
): number {
  const delta = cellDelta(value, origin, scaleExp)
  return dir === 1 ? delta - 0.5 : 0.5 - delta
}

// ---------- View orientation ----------

/**
 * Build a quaternion from an explicit render-space camera basis.
 *
 * The basis must be right-handed (right x up === back). A left-handed triple
 * does not describe a rotation, and Quaternion.setFromRotationMatrix would
 * silently return a wrong result rather than fail.
 */
function basisQuaternion(right: Vector3, up: Vector3, back: Vector3): Quaternion {
  const m = new Matrix4().makeBasis(right, up, back)
  return new Quaternion().setFromRotationMatrix(m)
}

/**
 * Cyberspace is a LEFT-handed coordinate system.
 *
 * Section 9.4 defines it as ECEF with two axes swapped: X_cs = X_ecef,
 * Y_cs = Z_ecef, Z_cs = Y_ecef. ECEF is right-handed, and swapping two axes
 * inverts handedness. That is why section 11.1's convention (+X screen-right,
 * +Y up, +Z forward *into* the screen) is self-consistent for the protocol but
 * impossible to reproduce in three.js, which is right-handed, by camera
 * placement alone.
 *
 * Section 11.4 requires resolving this with a render-space transform rather
 * than by mirroring or re-labelling axes. We do it in exactly one place:
 * negating Z converts between the two handednesses. The map is its own inverse.
 *
 * Skipping this does not produce an obviously broken picture. It produces a
 * mirrored one, which looks fine in isolation and silently disagrees with every
 * other viewer about which way is left.
 */
export function flipHandedness(v: Vector3): Vector3 {
  return new Vector3(v.x, v.y, -v.z)
}

/**
 * The canonical view required by CYBERSPACE_V2.md section 11.3, "facing the
 * black sun": view direction +Z_cs, up +Y_cs, screen-right +X_cs.
 *
 * This is the orientation the spec's left/right/above/below/ahead/behind
 * language is defined against, so it is the reference every viewer must agree
 * on. Section 11.1 binds the axis semantics only when oriented this way.
 */
export function canonicalQuaternion(): Quaternion {
  // Once handedness is converted, this is simply three.js's default camera
  // orientation: +X screen-right, +Y up, looking along render -Z, which is
  // cyberspace +Z. That it comes out as the identity is a good sign the
  // transform is placed correctly.
  return basisQuaternion(
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  )
}

/**
 * The map view: top-down, looking along -Y at the X/Z ground plane.
 *
 * Y_cs is the vertical axis (it is Z_ecef, the north pole, per section 9.4), so
 * looking along -Y is a true overhead map. With handedness converted this comes
 * out as the intuitive map orientation: +X to the right and +Z, the forward /
 * black sun direction, up the screen.
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
 * Derive which *cyberspace* axes are currently mapped to screen directions.
 *
 * The quaternion lives in render space, so each camera basis vector is
 * converted back through flipHandedness before being named. Everything
 * downstream (movement, terrain sampling, the HUD readout) consumes cyberspace
 * axes, so this is the boundary where render space stops.
 */
export function viewAxes(q: Quaternion): ViewAxes {
  const toCs = (v: Vector3) => snapToAxis(flipHandedness(v.applyQuaternion(q)))
  return {
    right: toCs(new Vector3(1, 0, 0)),
    up: toCs(new Vector3(0, 1, 0)),
    out: toCs(new Vector3(0, 0, 1)),
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
