/**
 * lattice.ts - the top and bottom grids of cyberspace, as v1 drew them.
 *
 * ONOSENDAI v1 framed the whole cube with two gridHelpers: one on the top face
 * (y = 2^85) and one on the floor (y = 0), eight divisions each, cross lines in
 * light purple and the two centre lines in a colour of their own, deep purple
 * on top and dark plum below in dataspace, sky blue and logo purple in
 * ideaspace. They only mean anything when the whole cube is in view, so they
 * fade in as the scale approaches the top of the ladder and are gone by 2^78.
 *
 * Pure geometry in render cells; the scene component turns it into lines.
 */

import { cellDelta, type Position, type ViewAxes } from './space'

/** Divisions per side, as in v1. */
export const LATTICE_DIVISIONS = 8
/** Fully visible from this scale up. */
export const LATTICE_FULL_EXP = 80
/** Invisible below this scale. */
export const LATTICE_HIDE_EXP = 78

const AXIS = 1n << 85n
const CROSS = 0x682db5          // v1 LIGHT_PURPLE, GRID_CROSS
const TOP_D = 0x3b0097          // v1 top grid centre lines, dataspace
const BOTTOM_D = 0x3a0c40       // v1 bottom grid centre lines, dataspace
const TOP_I = 0x0062cd          // v1 SKY (LOGO_BLUE), ideaspace
const BOTTOM_I = 0x78004e       // v1 GROUND (LOGO_PURPLE), ideaspace

export interface LatticeSegment {
  a: [number, number, number]
  b: [number, number, number]
  color: number
}

/** 0 below LATTICE_HIDE_EXP, 1 from LATTICE_FULL_EXP up, linear between. */
export function latticeOpacity(scaleExp: number): number {
  const t = (scaleExp - LATTICE_HIDE_EXP) / (LATTICE_FULL_EXP - LATTICE_HIDE_EXP)
  return Math.max(0, Math.min(1, t))
}

export function latticeColors(plane: 0 | 1): { top: number; bottom: number; cross: number } {
  return plane === 0 ? { top: TOP_D, bottom: BOTTOM_D, cross: CROSS } : { top: TOP_I, bottom: BOTTOM_I, cross: CROSS }
}

/** A world point (gibsons) in render cells, relative to the aligned origin. */
function toCells(p: Position, origin: Position, scaleExp: number, axes: ViewAxes): [number, number, number] {
  return [axes.right, axes.up, axes.out].map(
    (a) => (cellDelta(p[a.axis], origin[a.axis], scaleExp) - 0.5) * a.dir,
  ) as [number, number, number]
}

/**
 * The two grids as segments. `origin` is the aligned render origin
 * (alignedOrigin(anchor, scaleExp)); lines are world-space, so they follow the
 * cube whatever the view's orientation.
 */
export function latticeSegments(origin: Position, scaleExp: number, axes: ViewAxes, plane: 0 | 1): LatticeSegment[] {
  const colors = latticeColors(plane)
  const step = AXIS / BigInt(LATTICE_DIVISIONS)
  const out: LatticeSegment[] = []
  for (const [y, centre] of [[AXIS, colors.top], [0n, colors.bottom]] as Array<[bigint, number]>) {
    for (let i = 0; i <= LATTICE_DIVISIONS; i++) {
      const v = step * BigInt(i)
      const color = i === LATTICE_DIVISIONS / 2 ? centre : colors.cross
      // Lines of constant x, running along z; and of constant z, running along x.
      out.push({ a: toCells({ x: v, y, z: 0n }, origin, scaleExp, axes), b: toCells({ x: v, y, z: AXIS }, origin, scaleExp, axes), color })
      out.push({ a: toCells({ x: 0n, y, z: v }, origin, scaleExp, axes), b: toCells({ x: AXIS, y, z: v }, origin, scaleExp, axes), color })
    }
  }
  return out
}
