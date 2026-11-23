/**
 * hopFraming.ts: where the camera goes for the tutorial's camera shots, in
 * render space, with no scene here so a test can hold it (owner, 2026-11-12).
 *
 *   - frameHop: on COMMIT, both ends of the hop in view, seen from the side
 *     nearest the camera's own, a little above, far enough back that the
 *     whole path fits the narrower side of the screen ("pre-position the
 *     camera ... so that the user can tell oh I just moved and this red ball
 *     is me").
 *   - liftSide: after the first hop, the side the camera eases round to:
 *     behind the avatar from the chest, raised a little, so it looks over
 *     the avatar's shoulder toward the chest.
 *   - easeOrbit: one step of a turn and a change of distance together, along
 *     the arc between two directions (never through the target, even for a
 *     half turn).
 */

import { Quaternion, Vector3 } from 'three'

/** Render up: the screen's up in every view (the axes put cyberspace's up axis here). */
const UP = new Vector3(0, 1, 0)

/** How far above the side a framed hop is seen from, as a share of the side (about 19 degrees). */
const FRAME_LIFT = 0.35
/** How far above the avatar the shoulder shot looks from (about 29 degrees). */
const SHOULDER_LIFT = 0.55
/** Room left past each end of a framed hop, in render cells. */
const FRAME_MARGIN = 1.5
/** The share of the screen's narrower half the framed hop may fill. */
const FRAME_FILL = 0.85
/** The nearest and farthest a framed hop is seen from, in render cells. */
export const FRAME_MIN_DISTANCE = 8
export const FRAME_MAX_DISTANCE = 96

/** A camera placement: the direction from the target out to the camera (unit), and how far. */
export interface Orbit { dir: Vector3; distance: number }

/**
 * Where to look at a hop from `a` to `b` (render cells) from: the side of the
 * path nearest `current` (the camera's offset from its target now), lifted a
 * little, at the distance that fits the path, with margins, into the
 * narrower half of a screen of `aspect` (width over height) under a vertical
 * field of view of `fovDeg`. The target is the hop's middle.
 */
export function frameHop(a: readonly number[], b: readonly number[], current: Vector3, fovDeg: number, aspect: number): Orbit {
  const path = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const length = path.length()
  const along = length > 1e-9 ? path.clone().divideScalar(length) : new Vector3(1, 0, 0)
  const side = current.lengthSq() > 1e-12 ? current.clone().normalize() : new Vector3(0, 0, 1)
  side.addScaledVector(along, -side.dot(along))
  // The camera looks down the path: no side is nearer than another, so the
  // one square to it and to up, or to x when the path is vertical.
  if (side.lengthSq() < 0.04) {
    side.crossVectors(UP, along)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
  }
  side.normalize()
  const dir = side.addScaledVector(UP, FRAME_LIFT).normalize()
  const half = Math.tan((fovDeg * Math.PI) / 360) * Math.min(1, Math.max(0.1, aspect))
  const fit = (length / 2 + FRAME_MARGIN) / (half * FRAME_FILL)
  return { dir, distance: Math.min(FRAME_MAX_DISTANCE, Math.max(FRAME_MIN_DISTANCE, fit)) }
}

/**
 * The side `away` (render, from the target out to the camera), level, then
 * raised for an over-the-shoulder look; unit. Level first, so a chest a
 * gibson above or below the avatar still has the camera above its shoulder,
 * not looking up at it from below. A chest straight above or below has no
 * level side: then straight out of the screen.
 */
export function liftSide(away: Vector3): Vector3 {
  const d = away.clone()
  d.y = 0
  if (d.lengthSq() < 1e-12) d.set(0, 0, 1)
  return d.normalize().addScaledVector(UP, SHOULDER_LIFT).normalize()
}

/** How far to the right of the chest's front the chest shot stands, as a share of the front (about 37 degrees round). */
const SHOT_RIGHT = 0.75
/** How far below level it looks from, as a share (looking slightly up, so the loot shows over the lid). */
const SHOT_LOW = 0.3
/** The share of what the HUD leaves uncovered the framed things may fill. */
const SHOT_FILL = 0.8

/**
 * The chest shot's side (owner, 2026-11-23, his screenshot: the camera low
 * and to the right of the chest, looking slightly up at it): from the chest
 * out toward its front (`front`, render, toward the avatar), level, turned
 * toward the camera's right and lowered a little; unit. Seen from there the
 * avatar standing in front of the chest is to its left, clear of it, and the
 * loot hovering over the lid is in the open sky above it.
 */
export function chestShotDir(front: Vector3): Vector3 {
  const f = front.clone()
  f.y = 0
  if (f.lengthSq() < 1e-12) f.set(0, 0, 1)
  f.normalize()
  // Screen right as seen from the front looking at the chest: up x front.
  const right = new Vector3().crossVectors(UP, f)
  return f.addScaledVector(right, SHOT_RIGHT).addScaledVector(UP, -SHOT_LOW).normalize()
}

/**
 * How far back to stand so a sphere of `radius` (render cells) fits the part
 * of a `width` by `height` screen the HUD leaves uncovered (`band`, from
 * lib/coverBand.ts uncoveredBand), under a vertical field of view of
 * `fovDeg`, filling SHOT_FILL of the band's tighter side.
 */
export function fitInBand(radius: number, fovDeg: number, width: number, height: number, band: { left: number; top: number; right: number; bottom: number }): number {
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  const hFrac = Math.max(0.1, (band.bottom - band.top) / Math.max(1, height))
  const wFrac = Math.max(0.1, (band.right - band.left) / Math.max(1, width))
  const aspect = width / Math.max(1, height)
  const half = tan * Math.min(hFrac, aspect * wFrac)
  return Math.min(FRAME_MAX_DISTANCE, Math.max(FRAME_MIN_DISTANCE / 2, radius / (half * SHOT_FILL)))
}

const q = new Quaternion()
const part = new Quaternion()

/**
 * The camera's offset `w` of the way (0 to 1) from orbit `from` to orbit
 * `to`: the direction turned along their arc, the distance between theirs.
 * Written into `out`, which is returned.
 */
export function easeOrbit(from: Orbit, to: Orbit, w: number, out: Vector3): Vector3 {
  const k = Math.min(1, Math.max(0, w))
  q.setFromUnitVectors(from.dir, to.dir)
  out.copy(from.dir).applyQuaternion(part.identity().slerp(q, k)).normalize()
  return out.multiplyScalar(from.distance + (to.distance - from.distance) * k)
}

/** Smooth start and end (smoothstep), for a shot of fixed length. */
export function smooth01(t: number): number {
  const k = Math.min(1, Math.max(0, t))
  return k * k * (3 - 2 * k)
}
