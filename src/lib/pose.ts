/**
 * pose.ts — how a shard stands on the Earth.
 *
 * A shard's vertices are in cyberspace axes, and cyberspace Y is the planet's
 * polar axis: the canonical mapping (landfall.ts) puts ECEF Z on cyberspace Y
 * and ECEF Y on cyberspace Z. So a shard built upright on the bench stands
 * upright only at the poles; at the equator it lies on its side, and at any
 * other latitude it leans by that latitude. The pose stands it up: a frame at
 * the bag's position that every client derives from the position alone, so a
 * finder sees the shard exactly as the hider placed it.
 *
 *   shard +X  ->  local east
 *   shard +Y  ->  local up, the geodetic normal. The bench's up, so the
 *                 shard's low Y face is its bottom, and the bottom is to Earth.
 *   shard +Z  ->  local north
 *
 * Why north, and why this frame is right handed. In ECEF, (east, up, north)
 * is a left-handed triple: east x up = -north. The mapping into cyberspace
 * axes swaps ECEF Y and Z, and swapping two axes is a mirror, so the same
 * three vectors written in cyberspace axes are right handed: their
 * determinant is +1 (pose.test.ts checks it at four places). Cyberspace's own
 * convention is that +Z points into the screen, toward the black sun, the
 * reverse of three.js; carried into the local frame, +Z is the way the shard
 * faces, and at spin 0 that is north.
 *
 * Spin is a compass bearing: the direction the shard's +Z faces, in whole
 * degrees 0..359, clockwise from north seen from above. 0 north, 90 east,
 * 180 south, 270 west. It turns the frame about local up and nothing else.
 *
 * Everything here is unit vectors in cyberspace axes. The render mapping
 * (flipHandedness: x, y, -z) is applied after, by the drawer, as for any
 * shard; nothing here knows about the screen.
 */

import type { Plane } from 'cyberspace-core'
import type { Position, ViewAxes } from './space'
import { axesToLatLon } from './hyperspace/landfall'

export type V3 = [number, number, number]

/** The local frame at a point on the planet, unit vectors in cyberspace axes. */
export interface Frame { east: V3; up: V3; north: V3 }

/**
 * A pose as nine numbers: the three frame vectors the shard's own axes land
 * on, +X then +Y then +Z, each in cyberspace axes. Applying it to a vertex
 * (x, y, z) gives x * pose[0..2] + y * pose[3..5] + z * pose[6..8].
 */
export type Pose = readonly [number, number, number, number, number, number, number, number, number]

/**
 * The smallest deploy height that offers the snap. arkinox: 27 is about as
 * small as a shard can be while still having a chance of being visible in AR;
 * on the ground 2^27 gibsons is about 1.5 cm (a gibson is 2^-33 m), so below
 * this nothing a camera could show has an orientation worth setting.
 */
export const SNAP_MIN_HEIGHT = 27

/** Whether the deploy modal offers SNAP TO EARTH: dataspace only, and tall enough to matter. */
export function snapOffered(plane: Plane, height: number): boolean {
  return plane === 0 && height >= SNAP_MIN_HEIGHT
}

/** A spin as the wire carries it: a whole number of degrees, 0..359. */
export function wrapSpin(spin: number): number {
  const n = Math.round(spin) % 360
  return n < 0 ? n + 360 : n
}

/** ECEF (x, y, z) written in cyberspace axes: X stays, Y and Z swap. */
function csOf(x: number, y: number, z: number): V3 {
  return [x, z, y]
}

/** The frame at a latitude and longitude, in degrees. */
export function frameAt(latDeg: number, lonDeg: number): Frame {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const sLat = Math.sin(lat), cLat = Math.cos(lat), sLon = Math.sin(lon), cLon = Math.cos(lon)
  return {
    east: csOf(-sLon, cLon, 0),
    up: csOf(cLat * cLon, cLat * sLon, sLat),
    north: csOf(-sLat * cLon, -sLat * sLon, cLat),
  }
}

/** The frame at a dataspace position. Altitude is ignored: a shard floating above a place still stands up. */
export function frameOf(position: Position): Frame {
  const { lat, lon } = axesToLatLon(position.x, position.y, position.z)
  return frameAt(lat, lon)
}

/** The frame turned to a spin: +X to the right of the facing, +Y up, +Z along the facing. */
export function poseMatrix(frame: Frame, spin: number): Pose {
  const s = (wrapSpin(spin) * Math.PI) / 180
  const c = Math.cos(s), k = Math.sin(s)
  const { east: e, up: u, north: n } = frame
  // Facing f = cos(s) north + sin(s) east; right r = cos(s) east - sin(s) north.
  const r: V3 = [c * e[0] - k * n[0], c * e[1] - k * n[1], c * e[2] - k * n[2]]
  const f: V3 = [c * n[0] + k * e[0], c * n[1] + k * e[1], c * n[2] + k * e[2]]
  return [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]]
}

/** The pose of a shard hidden at a position with a spin. */
export function poseAt(position: Position, spin: number): Pose {
  return poseMatrix(frameOf(position), spin)
}

/** A vertex (in any linear unit) carried into the pose. */
export function applyPose(pose: Pose, v: V3): V3 {
  const [x, y, z] = v
  return [
    x * pose[0] + y * pose[3] + z * pose[6],
    x * pose[1] + y * pose[4] + z * pose[7],
    x * pose[2] + y * pose[5] + z * pose[8],
  ]
}

/**
 * The compass bearing of a direction at a frame: its part along the ground,
 * clockwise from north, as a whole number of degrees 0..359. Null when the
 * direction is straight up or down and has no bearing.
 */
export function bearingOf(frame: Frame, dir: V3): number | null {
  const { east: e, up: u, north: n } = frame
  const along = dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2]
  const t: V3 = [dir[0] - along * u[0], dir[1] - along * u[1], dir[2] - along * u[2]]
  const x = t[0] * e[0] + t[1] * e[1] + t[2] * e[2]
  const y = t[0] * n[0] + t[1] * n[1] + t[2] * n[2]
  if (Math.hypot(x, y) < 1e-9) return null
  return wrapSpin((Math.atan2(x, y) * 180) / Math.PI)
}

/**
 * Two poses as one: `b` first, then `a`. The image of a model axis under the
 * pair is `a` applied to its image under `b`.
 */
export function composePose(a: Pose, b: Pose): Pose {
  const x = applyPose(a, [b[0], b[1], b[2]])
  const y = applyPose(a, [b[3], b[4], b[5]])
  const z = applyPose(a, [b[6], b[7], b[8]])
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]
}

/**
 * Cyberspace axes into the frame a shard's own vertices are read in.
 *
 * A shard's vertices reach the screen through `toRender` (shards.ts), which is
 * the fixed flip (x, y, -z): the model's +Z is into the screen, the black sun
 * direction. Everything placed in the world instead goes through `axes`, the
 * view frame, which names the cyberspace axis and sign on each screen
 * direction and is a signed permutation. So for a posed shard to stand up
 * against the world it is placed in, the pose has to land in the view frame
 * and not in cyberspace: this is that signed permutation with the flip already
 * folded in, so that `toRender` of a posed vertex is where the world would put
 * that direction.
 *
 * In the default view frame (screen right on cyberspace +X, screen up on +Y,
 * out of the screen on -Z, which is the flip itself) this is the identity, and
 * a pose passes through as it was written in cyberspace axes.
 */
export function viewPose(axes: ViewAxes): Pose {
  // The third screen direction points out of the screen, toward the viewer,
  // and the flip sends it to -Z, hence the sign.
  const rows: Array<[keyof Position, number]> = [
    [axes.right.axis, axes.right.dir],
    [axes.up.axis, axes.up.dir],
    [axes.out.axis, -axes.out.dir],
  ]
  const column = (axis: keyof Position): V3 => rows.map(([a, dir]) => (a === axis ? dir : 0)) as V3
  const [x, y, z] = [column('x'), column('y'), column('z')]
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]
}

/**
 * The pose a drawer hands to ShardMesh: standing on the Earth at `position`
 * facing `spin`, written in the view frame `axes` so `toRender` finishes it.
 */
export function drawPoseAt(position: Position, spin: number, axes: ViewAxes): Pose {
  return composePose(viewPose(axes), poseAt(position, spin))
}

/**
 * A direction in render coordinates read back into cyberspace axes: the view
 * frame's own permutation, undone. Each screen direction carries one cyberspace
 * axis with a sign, and a sign is its own inverse, so this is the transpose.
 */
export function csDirection(axes: ViewAxes, render: V3): V3 {
  const out: Record<string, number> = { x: 0, y: 0, z: 0 }
  out[axes.right.axis] = render[0] * axes.right.dir
  out[axes.up.axis] = render[1] * axes.up.dir
  out[axes.out.axis] = render[2] * axes.out.dir
  return [out.x, out.y, out.z]
}

/** The determinant of a frame's three vectors, in the order (east, up, north). */
export function frameDeterminant(frame: Frame): number {
  const [a, b, c] = frame.east, [d, e, f] = frame.up, [g, h, i] = frame.north
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}
