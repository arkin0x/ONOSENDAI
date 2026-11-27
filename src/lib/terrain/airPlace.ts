/**
 * airPlace.ts - placing a block in open air (owner, 2026-11-27: "you cant
 * really place blocks unless they connect to other blocks. we need to make it
 * so you can place blocks in the air", option A: a ghost block at arm's
 * length).
 *
 * When the look (the cross, the mouse) meets no block within CURSOR_REACH, a
 * ghost cube stands a whole number of blocks along it, AIR_DEFAULT unless
 * changed, snapped to the cell the point falls in, and PLACE puts the block
 * there. When it meets a block, PLACE goes on the face it hit as ever and the
 * ghost hides: a hit always comes first.
 *
 * A ghost cell is refused in plain words, and drawn in dim red, when a block
 * is already there or when it is one of the cells your own body takes (the
 * walk's gibson, the eye's, and any between).
 *
 * Frames: the raycast's (raycast.ts), where a block at integer cell (i, j, k)
 * spans [i - 0.5, i + 0.5], and cells are cs offsets from the field's origin.
 *
 * Pure: nothing here reads a store, the clock or three.
 */

import { CURSOR_REACH } from './world'
import type { RayHit } from './raycast'

export type Cell = [number, number, number]

/** How far along the look the ghost stands at first, in blocks. */
export const AIR_DEFAULT = 3
/** The nearest it can stand, in blocks. */
export const AIR_MIN = 1
/** The farthest: as far as the cursor reaches, so the ghost is only ever where no block was met. */
export const AIR_MAX = CURSOR_REACH

/** The plain words when a ghost cell is taken by a block. */
export const AIR_OCCUPIED = "Something's already there"
/** The plain words when a ghost cell is inside your own body. */
export const AIR_TOO_CLOSE = 'Too close to you'

/** A distance as a whole number of blocks from AIR_MIN to AIR_MAX; anything not a number is AIR_DEFAULT. */
export function clampAirDistance(n: number): number {
  if (!Number.isFinite(n)) return AIR_DEFAULT
  return Math.max(AIR_MIN, Math.min(AIR_MAX, Math.round(n)))
}

/**
 * The cell `distance` blocks along a ray from `origin` (the raycast's frame),
 * snapped to the cell that point falls in; null for a ray with no direction.
 * The distance is clamped first (clampAirDistance).
 */
export function airCell(origin: readonly [number, number, number], dir: readonly [number, number, number], distance: number): Cell | null {
  const out: Cell = [0, 0, 0]
  return airCellInto(out, origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], distance) ? out : null
}

/**
 * airCell written into `out`, from plain numbers, for a frame loop that
 * allocates nothing: true when there is a cell (the ray has a direction).
 */
export function airCellInto(out: Cell, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, distance: number): boolean {
  const len = Math.hypot(dx, dy, dz)
  if (!(len > 0)) return false
  const d = clampAirDistance(distance) / len
  // A cell is [n - 0.5, n + 0.5): shifted half a block, its index is a floor (as raycast.ts walks them).
  out[0] = Math.floor(ox + dx * d + 0.5)
  out[1] = Math.floor(oy + dy * d + 0.5)
  out[2] = Math.floor(oz + dz * d + 0.5)
  return true
}

/**
 * The cells your body takes: the walk's gibson (`walker`), the cell the eye
 * is in (`eye`, a point in the raycast's frame), and every cell the line
 * between them crosses, so an eye a block or two over the feet keeps the
 * cells between clear too.
 */
export function bodyCells(walker: readonly [number, number, number], eye: readonly [number, number, number] | null): Cell[] {
  const out: Cell[] = [[walker[0], walker[1], walker[2]]]
  if (!eye) return out
  const add = (c: Cell): void => { if (!out.some((o) => o[0] === c[0] && o[1] === c[1] && o[2] === c[2])) out.push(c) }
  const steps = Math.max(1, Math.ceil(4 * Math.max(Math.abs(eye[0] - walker[0]), Math.abs(eye[1] - walker[1]), Math.abs(eye[2] - walker[2]))))
  for (let n = 1; n <= steps; n++) {
    const t = n / steps
    add([0, 1, 2].map((a) => Math.floor(walker[a] + (eye[a] - walker[a]) * t + 0.5)) as Cell)
  }
  return out
}

/** Why a ghost cell will not take a block, in plain words, or null when it will. */
export function airProblem(cell: readonly [number, number, number], occupied: (c: readonly [number, number, number]) => boolean, body: readonly Cell[]): string | null {
  if (body.some((b) => b[0] === cell[0] && b[1] === cell[1] && b[2] === cell[2])) return AIR_TOO_CLOSE
  if (occupied(cell)) return AIR_OCCUPIED
  return null
}

/**
 * Where PLACE goes: on the face a hit came in through (a hit always comes
 * first, even nearer than the ghost), else the ghost cell, else nowhere. A
 * hit with no face (the look starts inside a block) places nothing.
 */
export function placeTarget(hit: RayHit | null, air: readonly [number, number, number] | null): { kind: 'face'; cell: Cell } | { kind: 'air'; cell: Cell } | null {
  if (hit) {
    if (hit.normal[0] === 0 && hit.normal[1] === 0 && hit.normal[2] === 0) return null
    return { kind: 'face', cell: [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]] }
  }
  return air ? { kind: 'air', cell: [air[0], air[1], air[2]] } : null
}
