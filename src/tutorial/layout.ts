/**
 * layout.ts: where the first-arrival tutorial puts its things, from the
 * player's spawn (first-arrival tutorial design, 2026-11-10, T11).
 *
 * Pure: the same spawn always gives the same layout, so a reload and a
 * RESTART stage the same places.
 *
 * The blue box is the nearest height-3 region (an aligned 8x8x8-gibson cube)
 * ahead of the spawn: the next one along +Z, into the screen from the
 * starting view, at the spawn's own X and Y cube. Everything else is laid out
 * in the box's frame: `f` forward (away from the spawn), `r` to one side, `u`
 * up, in gibsons from the box's near corner, inside a fixed footprint
 * (FOOTPRINT) that the later steps (the dirt plot, the course) fill.
 *
 * Spec §7.6: every item lies inside its bag's region, and the blue box is
 * seen before it is entered only if a bag covering the spawn holds it. So
 * the covering region is the smallest aligned cube, height COVER_MIN to
 * COVER_MAX, that holds the spawn and the whole footprint. Near a big
 * boundary ahead or to the side the footprint flips (behind, or the other
 * side), and near one above or below it moves up or down a cube; at
 * COVER_MAX one of the choices always fits, since a 4,096-gibson cube has at
 * least 2,048 gibsons on one side of any point along each axis, and the
 * footprint reaches only one way along X and Z.
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'

/** The blue box's height: an 8-gibson cube. */
export const BOX_HEIGHT = 3
/** The smallest covering region tried: the footprint is 96 deep, more than a height-6 cube holds. */
export const COVER_MIN = 7
/** The largest: within the discovery scan's heights (useShards SCAN_MAX_HEIGHT 12). */
export const COVER_MAX = 12

/**
 * What the tutorial may use, in the box's frame (gibsons, the box at f, r and
 * u 0 to 7): forward from the box's near face, to one side only, and from a
 * little below the box to a little above it. Fixed, so the covering region
 * does not change as later steps add things inside it.
 */
export const FOOTPRINT = { f: [0, 96], r: [0, 40], u: [-12, 16] } as const

/** The box's frame: where `f`, `r`, `u` land in the world. */
export interface Frame {
  /** +1 forward is +Z, -1 is -Z. */
  fwd: 1 | -1
  /** +1 to the side is +X, -1 is -X. */
  side: 1 | -1
  /** The blue box's aligned base (its lowest corner), in the world. */
  boxBase: Position
}

export interface TutorialLayout {
  plane: Plane
  spawn: Position
  frame: Frame
  /** The covering region: height and aligned base. */
  cover: { height: number; base: Position }
}

const aligned = (v: bigint, h: number): bigint => (v >> BigInt(h)) << BigInt(h)

/** A point of the box's frame in the world. `f`, `r` and `u` may be fractional only where a caller rounds them. */
export function toWorld(frame: Frame, f: number, r: number, u: number): Position {
  const b = frame.boxBase
  return {
    x: frame.side === 1 ? b.x + BigInt(r) : b.x + 7n - BigInt(r),
    y: b.y + BigInt(u),
    z: frame.fwd === 1 ? b.z + BigInt(f) : b.z + 7n - BigInt(f),
  }
}

/** The world box a frame's footprint covers, lowest and highest gibson, inclusive. */
function footprintBounds(frame: Frame): { lo: Position; hi: Position } {
  const a = toWorld(frame, FOOTPRINT.f[0], FOOTPRINT.r[0], FOOTPRINT.u[0])
  const b = toWorld(frame, FOOTPRINT.f[1] - 1, FOOTPRINT.r[1] - 1, FOOTPRINT.u[1] - 1)
  const lo = { x: a.x < b.x ? a.x : b.x, y: a.y < b.y ? a.y : b.y, z: a.z < b.z ? a.z : b.z }
  const hi = { x: a.x > b.x ? a.x : b.x, y: a.y > b.y ? a.y : b.y, z: a.z > b.z ? a.z : b.z }
  return { lo, hi }
}

/** Whether a world box lies inside the aligned cube of height `h` at `base`. */
function inside(lo: Position, hi: Position, base: Position, h: number): boolean {
  const size = 1n << BigInt(h)
  for (const k of ['x', 'y', 'z'] as const) if (lo[k] < base[k] || hi[k] >= base[k] + size) return false
  return true
}

/** Whether a point lies in the aligned cube of height `h` at `base`. */
export function inRegion(p: Position, base: Position, h: number): boolean {
  return inside(p, p, base, h)
}

/** The aligned base of the height-`h` region a point is in. */
export function regionBase(p: Position, h: number): Position {
  return { x: aligned(p.x, h), y: aligned(p.y, h), z: aligned(p.z, h) }
}

/** Whole cubes up or down the box may move, nearest first, for a spawn near a boundary above or below. */
const LIFTS = [0, 1, -1, 2, -2] as const

/** Where the tutorial goes for a player spawning at `spawn` in `plane`. */
export function tutorialLayout(spawn: Position, plane: Plane): TutorialLayout {
  const own = regionBase(spawn, BOX_HEIGHT)
  const cube = 1n << BigInt(BOX_HEIGHT)
  // Ahead first, then level with the spawn, at any cover up to COVER_MAX:
  // the box is meant to be seen from the starting view. Then the smallest
  // cover, then the side.
  for (const fwd of [1, -1] as const) {
    for (const lift of LIFTS) {
      // The next cube along the forward axis, at the spawn's own X, and Y moved by `lift` cubes.
      const boxBase = { x: own.x, y: own.y + BigInt(lift) * cube, z: own.z + BigInt(fwd) * cube }
      for (let h = COVER_MIN; h <= COVER_MAX; h++) {
        const coverBase = regionBase(spawn, h)
        for (const side of [1, -1] as const) {
          const frame: Frame = { fwd, side, boxBase }
          const { lo, hi } = footprintBounds(frame)
          if (inside(lo, hi, coverBase, h)) return { plane, spawn, frame, cover: { height: h, base: coverBase } }
        }
      }
    }
  }
  // Unreachable (see the header), but never nothing: the plainest layout in the largest cover.
  const frame: Frame = { fwd: 1, side: 1, boxBase: { x: own.x, y: own.y, z: own.z + cube } }
  return { plane, spawn, frame, cover: { height: COVER_MAX, base: regionBase(spawn, COVER_MAX) } }
}
