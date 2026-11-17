/**
 * avatarEye.ts - where the WALK camera sits on your avatar (arkinox,
 * 2026-11-16: "in walk, my eyes are partially clipping through the floor").
 *
 * WALK used to put the camera on the avatar's own 0, 0, 0, the walker's
 * point, which walking along a floor keeps in the floor's plane. An avatar
 * built from its feet up (his Ship is 0.8 to 1.4 gibsons above its origin)
 * then looked out from under itself, through the floor. The eye moves the
 * camera up onto the avatar; the walker stays where it is (DECK-0003 §1.12).
 *
 * The avatar's own `eye`, three whole numbers of ticks in the payload's frame
 * (study: onosendai/avatar-camera/study.md §2), when it has one; otherwise the
 * automatic eye, one eighth of the avatar's height below its top, straight
 * above or below the origin, in exact integers so every client puts it in the
 * same place. A malformed `eye` reads as absent and never refuses the avatar.
 * `[0, 0, 0]` is a choice: the old eye on purpose.
 *
 * The default avatar, the one-cell icosahedron, gets the same rule applied to
 * its own shape: half a cell up less an eighth of a cell, 0.375 cells above
 * its centre. So does a custom avatar while it is drawn as that icosahedron
 * (zoomed far out), since its own eye would be smaller than what is drawn.
 *
 * Written by the workshop's SET EYE (withEye, below). sno-core will carry the
 * same reader and writer; these go when it does.
 */

import { Quaternion, Vector3 } from 'three'
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'
import { AVATAR_MARKER_HALF, MAX_AVATAR_RADIUS, avatarDraw, avatarScale } from './avatar'

/** The payload field. */
export const EYE_FIELD = 'eye'

/** The farthest an eye coordinate may be, in ticks: the 64-unit position bound (DECK-0003 §1.8). */
export const EYE_REACH = 64 * TICKS_PER_UNIT

export type Eye = [number, number, number]

/**
 * An `eye` value as read: exactly three JSON integers, each -7680..7680, in
 * ticks of the object's lattice; anything else (null, a fraction, two or four
 * elements, a string, out of range) is undefined, which means the automatic
 * eye. `-0` is the integer 0.
 */
export function readEye(raw: unknown): Eye | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const out: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < -EYE_REACH || v > EYE_REACH) return undefined
    out.push(v === 0 ? 0 : v)
  }
  return out as Eye
}

/**
 * The automatic eye, in ticks: X and Z on the origin's line, and Y one eighth
 * of the avatar's height below its top, `top - floor((top - bottom) / 8)`,
 * from the lowest and highest Y of its own vertices. At its origin for an
 * avatar with no vertices of its own.
 */
export function autoEye(shard: Pick<ShardModel, 'vertices'>): Eye {
  if (shard.vertices.length === 0) return [0, 0, 0]
  let top = -Infinity
  let bottom = Infinity
  for (const v of shard.vertices) {
    const y = ticksOf(v)[1]
    if (y > top) top = y
    if (y < bottom) bottom = y
  }
  const y = top - Math.floor((top - bottom) / 8)
  return [0, y === 0 ? 0 : y, 0]
}

/** The eye an avatar looks from, in ticks in its payload's frame: its own `eye`, or the automatic one. */
export function eyeOf(shard: Pick<ShardModel, 'vertices' | 'extra'>): Eye {
  return readEye(shard.extra?.[EYE_FIELD]) ?? autoEye(shard)
}

/** Whether an avatar's eye is its own `eye` (CHOSEN) rather than the automatic one. */
export function eyeChosen(shard: Pick<ShardModel, 'extra'>): boolean {
  return readEye(shard.extra?.[EYE_FIELD]) !== undefined
}

/**
 * `s` with its eye set: three integers of ticks in the payload's frame, or
 * removed for the automatic eye when `eye` is undefined. A value that is not
 * a valid eye removes the field too, so a publisher never writes a malformed
 * one; `[0, 0, 0]` is a valid eye and is written. The same semantics as
 * sno-core's `withEye` (sno-core 0.1.31, branch eye-reader, not released):
 * this local copy swaps to sno-core's once that is out.
 */
export function withEye<T extends Pick<ShardModel, 'extra'>>(s: T, eye: Eye | undefined): T {
  const v = eye === undefined ? undefined : readEye(eye)
  const next: Record<string, unknown> = { ...(s.extra ?? {}) }
  if (v === undefined) delete next[EYE_FIELD]
  else next[EYE_FIELD] = v
  const { extra: _old, ...bare } = s
  return (Object.keys(next).length ? { ...bare, extra: next } : bare) as T
}

/**
 * Between the payload's frame (the eye's, +Z toward the viewer) and the
 * workshop's model frame (the vertices', the wire's with Z negated, the frame
 * the bench's handles and MORE's numbers use): Z negated, `0 - z` so a zero
 * stays a zero. Its own inverse.
 */
export const flipEyeZ = (e: Eye): Eye => [e[0], e[1], 0 - e[2]]

/** The eye in the workshop's model frame, in ticks: what the bench draws and its handles move. */
export const benchEye = (shard: Pick<ShardModel, 'vertices' | 'extra'>): Eye => flipEyeZ(eyeOf(shard))

/**
 * CENTER: the middle of the shape's box, in ticks in the payload's frame,
 * each axis rounded to a whole tick. The origin for a shape with no vertices.
 */
export function centerEye(shard: Pick<ShardModel, 'vertices'>): Eye {
  if (shard.vertices.length === 0) return [0, 0, 0]
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const v of shard.vertices) {
    const t = ticksOf(v)
    for (let a = 0; a < 3; a++) { if (t[a] < lo[a]) lo[a] = t[a]; if (t[a] > hi[a]) hi[a] = t[a] }
  }
  const mid = (a: number): number => { const m = Math.round((lo[a] + hi[a]) / 2); return m === 0 ? 0 : m }
  return flipEyeZ([mid(0), mid(1), mid(2)])
}

/**
 * How far from the origin an eye may be on each axis, in ticks of the shard's
 * grid: the avatar size limit, MAX_AVATAR_RADIUS gibsons, at the avatar's true
 * scale (avatarScale), which is as far as WALK carries it (walkEyeLocal brings
 * anything farther in), and never past the 64-unit position bound.
 */
export function eyeReachTicks(shard: ShardModel): number {
  return Math.min(EYE_REACH, Math.floor((MAX_AVATAR_RADIUS * TICKS_PER_UNIT) / avatarScale(shard)))
}

/**
 * The eye as WALK uses it, in whole ticks in the bench's frame: an eye past
 * the size limit (the unit raised, vertices deleted, a far eye pasted in)
 * brought in as a whole along its line, as walkEyeLocal does, each axis
 * rounded toward the origin so it stays inside. The workshop draws, prints
 * and moves this eye, never a place WALK will not use.
 */
export function usedBenchEye(shard: ShardModel): [number, number, number] {
  const e = benchEye(shard)
  const reach = eyeReachTicks(shard)
  const far = Math.max(Math.abs(e[0]), Math.abs(e[1]), Math.abs(e[2]))
  return far > reach ? (e.map((t) => Math.trunc((t * reach) / far) + 0) as [number, number, number]) : e
}

/**
 * Ticks of the shard's grid as gibsons, to two decimals, as the eye row and
 * the eye strip print them: at the avatar's true scale (avatarScale, the
 * shrink of an avatar past the size limit included). Worked in whole
 * hundredths so 159 ticks prints 1.33 as the arithmetic says, never 1.32
 * from a float. Never "-0".
 */
export function gibsonsLabel(ticks: number, shard: ShardModel): string {
  const hundredths = Math.round((ticks * avatarScale(shard) * 100) / TICKS_PER_UNIT)
  return String(hundredths / 100 + 0)
}

/** The eye as the workshop prints it: "0, 1.33, 0", in gibsons in the bench's frame. */
export function eyeLabel(shard: ShardModel): string {
  return usedBenchEye(shard).map((t) => gibsonsLabel(t, shard)).join(', ')
}

/**
 * The default avatar's eye, in cells above its origin: the automatic rule on
 * the icosahedron's own box. Its origin is its lowest point, where it touches
 * the ground (scene/avatarMarker.ts MARKER_LIFT; arkinox, 2026-11-17), so the
 * box runs from 0 to a cell up, and the eye is 1 less an eighth of 1: 0.875.
 * On the shape it is where it always was, 0.375 above the icosahedron's
 * centre.
 */
export const MARKER_EYE = 2 * AVATAR_MARKER_HALF - (2 * AVATAR_MARKER_HALF) / 8

/**
 * The WALK eye in the avatar's own drawn frame, in render cells at zoom
 * 2^scaleExp, before the body turns: render x, y, z are the model's x, y and
 * wire z (the payload's frame is the render frame, +Z toward the viewer), as
 * a vertex is drawn. Scaled as the avatar's mesh is (avatarScale, the zoom),
 * and kept within the avatar size limit, MAX_AVATAR_RADIUS gibsons from the
 * origin on each axis, the reach a shrunk avatar is drawn inside. The marker's
 * eye when the icosahedron is drawn: no avatar, one with no vertices, or a
 * custom one zoomed out to the marker. `spectator` is the marker's shrink at
 * the top of the ladder (lib/avatar spectatorScale).
 */
export function walkEyeLocal(shard: ShardModel | null, scaleExp: number, spectator: number): Eye {
  const draw = shard && shard.vertices.length > 0 ? avatarDraw(shard, scaleExp) : 'marker'
  if (!shard || draw === 'marker') return [0, MARKER_EYE * spectator, 0]
  const e = eyeOf(shard)
  const k = avatarScale(shard) / TICKS_PER_UNIT
  // Gibsons at true scale, then brought inside the size limit as a whole, so
  // an eye far off keeps its direction from the origin.
  const g = [e[0] * k, e[1] * k, e[2] * k]
  const far = Math.max(Math.abs(g[0]), Math.abs(g[1]), Math.abs(g[2]))
  const fit = far > MAX_AVATAR_RADIUS ? MAX_AVATAR_RADIUS / far : 1
  const zoom = 2 ** -scaleExp
  return [g[0] * fit * zoom + 0, g[1] * fit * zoom + 0, g[2] * fit * zoom + 0]
}

/**
 * The heading of a camera looking along `forward` (render space), as a turn
 * about render up only, into `out`: the yaw that takes the model's nose
 * (render -Z) to `forward` laid level. Looking straight up or down there is
 * no heading to read, and `out` is left as it was.
 */
export function yawFromForward(forward: { x: number; y: number; z: number }, out: Quaternion): Quaternion {
  const hx = forward.x, hz = forward.z
  if (hx * hx + hz * hz < 1e-10) return out
  return out.setFromAxisAngle(Y, Math.atan2(-hx, -hz))
}

const fwd = new Vector3()
const upv = new Vector3()
const Y = new Vector3(0, 1, 0)

/**
 * The camera's turn `q` about render up only: the heading, without the look
 * up or down. In WALK the body turns left and right with you and the camera
 * tilts about the eye, so looking at your feet does not tip a ship or swing
 * its eye about the origin. The model's nose (+Z) draws as render -Z, the
 * camera's forward, so the yaw that takes -Z to the camera's level forward.
 * Looking straight down or up, the camera's own up gives the heading.
 */
export function yawOnly(q: Quaternion, out: Quaternion): Quaternion {
  fwd.set(0, 0, -1).applyQuaternion(q)
  let hx = fwd.x, hz = fwd.z
  if (hx * hx + hz * hz < 1e-10) {
    upv.set(0, 1, 0).applyQuaternion(q)
    const s = fwd.y < 0 ? 1 : -1
    hx = upv.x * s
    hz = upv.z * s
  }
  if (hx * hx + hz * hz < 1e-20) return out.identity()
  return out.setFromAxisAngle(Y, Math.atan2(-hx, -hz))
}

