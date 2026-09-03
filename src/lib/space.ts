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
 * Where a cyberspace position sits in render space, at its cell's centre.
 *
 * The one definition the cursor, the avatar, the trail, the room boxes and the
 * travel animation all share, so nothing can drift half a cell from anything
 * else. Note it aligns first: a coordinate names a whole cell, and the cell's
 * centre is what gets drawn.
 */
export function cellCentre(
  p: Position, origin: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return [axes.right, axes.up, axes.out].map((a) =>
    cellDelta(alignTo(p[a.axis], scaleExp), origin[a.axis], scaleExp) * a.dir,
  ) as [number, number, number]
}

/**
 * Continuous placement for point-like markers (hyperspace stops, bursts).
 *
 * cellCentre floor-snaps to the aligned cell, which is right for everything
 * that lives on the movement grid but puts a marker up to a whole cell
 * toward negative on every axis. At planetary zoom that half-cell average
 * bias is hundreds of kilometres: the landfall cloud sat visibly sunk into
 * the +X+Y+Z octant of the globe and floated off the -X-Y-Z one. Markers
 * keep their sub-cell position instead, the same continuous math the Earth
 * sphere's own centre uses, so the shell hugs the wireframe exactly.
 *
 * The half-cell shift is the render convention made consistent: a cell cube
 * drawn at integer index i spans [i - 0.5, i + 0.5], representing the
 * points [i * 2^s, (i + 1) * 2^s). A raw fractional delta would therefore
 * draw a point with axis fraction above one half inside the NEXT cell's
 * cube: standing exactly on a stop, the stop rendered outside your own
 * sector cage. Shifted, a point at its cell's corner sits on the cube's
 * face and a point mid-cell sits at the cube's centre, which is where the
 * things the cell convention draws (the avatar, the cursor, the cage) say
 * they are.
 */
export function pointCentre(
  p: Position, origin: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return [axes.right, axes.up, axes.out].map((a) =>
    (cellDelta(p[a.axis], origin[a.axis], scaleExp) - 0.5) * a.dir,
  ) as [number, number, number]
}

/**
 * Above this scale a stop marker is part of a distribution and renders as a
 * continuous point (pointCentre); at or below it (cells of about a metre
 * and finer) a stop is a place an avatar stands, so its marker snaps to its
 * cell exactly the way the avatar does. Without the snap, a marker at a
 * coordinate is drawn on the corner FACE of its cell cube, which at gibson
 * zoom reads as belonging to no cell at all, least of all the one the
 * avatar standing on it occupies.
 */
export const OCCUPANCY_SCALE_MAX = 33

/** Placement for stop markers: the cell when you could stand there, the
 * point when it is one of half a million. */
export function markerCentre(
  p: Position, origin: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return scaleExp <= OCCUPANCY_SCALE_MAX
    ? cellCentre(p, origin, scaleExp, axes)
    : pointCentre(p, origin, scaleExp, axes)
}

/**
 * How far every render coordinate moves when the render origin is re-anchored
 * from `prev` to `next`, per screen axis, in cells.
 *
 * A commit re-anchors render space to the avatar's new aligned cell, so the
 * whole scene shifts at once. That is a change of frame, not motion: the camera
 * has to add exactly this to its own position and to what it is looking at, in
 * the same frame, or the world lurches by the move distance and back.
 *
 * It is the negative of what cellCentre does to a fixed world point, which is
 * the property that makes the two cancel: same helper, same fixed-point
 * division, same per-axis sign, so no rounding can survive the subtraction.
 */
export function originShift(
  prev: Position, next: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return [axes.right, axes.up, axes.out].map(
    (a) => cellDelta(prev[a.axis], next[a.axis], scaleExp) * a.dir,
  ) as [number, number, number]
}

/**
 * Sub-cell position along an axis as a 0..1 fraction.
 */
export function subCellFraction(value: bigint, scaleExp: number): number {
  return cellDelta(value, alignTo(value, scaleExp), scaleExp)
}

/**
 * Screen offset, in cells, of the gibson at an absolute axis value, where the
 * avatar's aligned cell spans [-0.5, +0.5]. A coordinate names a whole unit
 * gibson, not its low corner, so the marker sits at the gibson's centre:
 * exactly mid-cell at scale 2^0, and vanishingly close to the lattice point at
 * larger scales. Mirrors when the axis points left or down on screen, matching
 * how the lattice lays cells out along a flipped axis.
 */
export function cellOffset(
  value: bigint,
  origin: bigint,
  scaleExp: number,
  dir: number,
): number {
  // Number(step) overflows to Infinity past 2^1023, driving the shift to 0,
  // which is the right limit: a single gibson has no visible width there.
  const delta = cellDelta(value, origin, scaleExp) + 0.5 / Number(stepFor(scaleExp))
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

/**
 * The render-space unit vector pointing along the POSITIVE direction of a given
 * cyberspace axis.
 *
 * `viewAxes` answers "which cyberspace axis is on screen-right"; this is the
 * inverse question, "where on screen has cyberspace +Z gone". Needed by anything
 * anchored to an absolute direction rather than to a coordinate, which so far is
 * the black sun.
 *
 * The render basis is exactly (right, up, out), so the answer is a signed unit
 * vector on whichever of the three claimed this axis. `viewAxes` always returns
 * a permutation, so exactly one does.
 */
export function renderDirection(axes: ViewAxes, axis: AxisName): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const basis = [axes.right, axes.up, axes.out]
  for (let i = 0; i < 3; i++) {
    if (basis[i].axis === axis) {
      out[i] = basis[i].dir
      return out
    }
  }
  return out
}

/**
 * Bind the camera's three basis vectors to the three cyberspace axes of the
 * view frame, as a permutation.
 *
 * `local` names which cyberspace axis each of the scene's local x/y/z is, which
 * is meaningful only because the world group carries no rotation. The basis
 * vectors arrive in that same local frame, so a vector's component index IS the
 * index into `local`.
 *
 * The axes are claimed one at a time, strongest remaining component first,
 * rather than each vector being snapped independently. Independent snapping does
 * not have to yield three DIFFERENT axes: around 45 degrees two basis vectors
 * round to the same one, and then a whole cyberspace axis has no key bound to
 * it, R/F aliases onto W/S, and the cursor cannot leave the screen plane at all.
 * Measured through an orbit sweep, 4 frames in 24 were degenerate. Claiming
 * makes the result a permutation by construction, for any input whatsoever,
 * including a zero vector or three identical ones.
 */
export function claimScreenAxes(
  right: Vector3, up: Vector3, out: Vector3, local: ViewAxes,
): ViewAxes {
  const slots = [local.right, local.up, local.out]
  const taken = [false, false, false]
  const claim = (v: Vector3): AxisDirection => {
    const c = [v.x, v.y, v.z]
    let i = -1
    for (let k = 0; k < 3; k++) {
      if (taken[k]) continue
      if (i === -1 || Math.abs(c[k]) > Math.abs(c[i])) i = k
    }
    taken[i] = true
    const dir = (slots[i].dir * (c[i] >= 0 ? 1 : -1)) as 1 | -1
    return { axis: slots[i].axis, dir }
  }
  // Claimed in this order, so screen-right gets first pick of the three.
  const r = claim(right)
  const u = claim(up)
  const o = claim(out)
  return { right: r, up: u, out: o }
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
 * The step at a scale, in gibsons: "1 gibson", "1,024 gibsons", "2^40 gibsons".
 */
export function formatStep(scaleExp: number): string {
  if (scaleExp === 0) return '1 gibson'
  if (scaleExp < 20) return `${formatBig(stepFor(scaleExp))} gibsons`
  return `2^${scaleExp} gibsons`
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
const OPS_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y']

export function formatOps(n: number): string {
  if (!Number.isFinite(n)) return '\u221e'
  if (n < 1000) return String(Math.round(n))

  // It used to stop at billions, which was fine while this only ever showed the
  // cost of a move you could actually afford. The lattice quotes 2^(h+1) - 1 for
  // its own walls, and h runs to 85, so the top of the range printed
  // 77371252455336272.00B. Every prefix through yotta is needed and, since the
  // largest tree in the protocol is 2^86 leaves at about 7.7e25, they are also
  // enough: nothing here can outrun Y.
  let v = n
  let i = 0
  while (v >= 1000 && i < OPS_UNITS.length - 1) {
    v /= 1000
    i++
  }
  return `${parseFloat(v.toPrecision(3))}${OPS_UNITS[i]}`
}
