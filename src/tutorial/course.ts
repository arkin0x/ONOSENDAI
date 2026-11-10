/**
 * course.ts: the tutorial's bounce course, laid out in the box's frame
 * (first-arrival tutorial design, 2026-11-10, steps 7 and 8, T7, T8).
 *
 * Built from AeroCarnival pieces (maze-kit main c34c9d9, tutorial/pieces/,
 * renamed plainly) to the measured WALK envelope with gravity on (maze-kit
 * docs/aerocarnival/README.md: a jump of 5, a double jump of 3, step-ups of
 * 1 or 2, a level gap of 3 EASY at three presses a second). Pure numbers,
 * so a test can walk the plan.
 *
 * The course frame: `x` to the side, `y` up, `z` forward, whole gibsons. A
 * piece placed at y Y has its top at Y and a walker on it stands at Y + 1,
 * as in the kit's own course. A piece's cells run from its middle -n to +n
 * (a square 6 covers 7 cells, a square 4 covers 5).
 *
 *   START    a square 6 at y 0, the start line at its forward edge
 *   GAP 2    EASY, level, onto a square 4
 *   GAP 3    EASY, level, onto a second square 4
 *   GAP 3    EASY, level, onto a square 6 with the trampoline on it
 *            (bounce 12: a walker on it stands at y 2)
 *   BOOST    the finish deck at y 9 (stand at y 10): up 8 from the
 *            trampoline, out of reach of a jump and its double jump (7),
 *            so only the trampoline gets you there
 *   FINISH   the finish line and two checkered flags on the deck; the
 *            finish chest in the deck's own height-3 region
 *   FLOOR    a catch floor under it all at y -4, and a step at the start's
 *            back edge (rises of 2, the stair rule), so a fall is never
 *            more than a walk back
 *
 * The course's z 0 is the box frame's f 20 and its x 0 is r 20, so the
 * finish deck (z 28 to 34, x -3 to 3, standing y 10) lies in one aligned
 * height-3 region whichever way the layout faces: f 48 to 55, r 16 to 23,
 * u 8 to 15, since the box's base is aligned to 8 on every axis.
 */

import type { Frame } from './layout'
import { toWorld } from './layout'
import type { Position } from '../lib/space'

/** The course's origin in the box frame. */
export const COURSE_F = 20
export const COURSE_R = 20

/** A piece of the course, by its file under tutorial/pieces, at a point of the course frame. */
export interface CoursePart {
  piece: 'plat-square-6' | 'plat-square-4' | 'line-start-4x2' | 'line-finish-8x2' | 'trampoline-4' | 'flag-checkered' | 'catch-floor' | 'back-step'
  at: [number, number, number]
}

export const COURSE: CoursePart[] = [
  // START
  { piece: 'plat-square-6', at: [0, 0, 0] },
  { piece: 'line-start-4x2', at: [0, 0, 2] },
  // GAP 2 (cells 4 and 5 open), GAP 3 (11 to 13), GAP 3 (19 to 21)
  { piece: 'plat-square-4', at: [0, 0, 8] },
  { piece: 'plat-square-4', at: [0, 0, 16] },
  { piece: 'plat-square-6', at: [0, 0, 25] },
  { piece: 'trampoline-4', at: [0, 0, 25] },
  // BOOST onto the finish deck
  { piece: 'plat-square-6', at: [0, 9, 31] },
  { piece: 'line-finish-8x2', at: [0, 9, 32] },
  { piece: 'flag-checkered', at: [-3, 9, 34] },
  { piece: 'flag-checkered', at: [3, 9, 34] },
  // FLOOR
  { piece: 'catch-floor', at: [0, -4, 16] },
  { piece: 'back-step', at: [0, -2, -5] },
]

/** Where a walker stands at the start: the middle of the start square. */
export const START_STAND: [number, number, number] = [0, 1, 0]
/** The start square, where a walker counts as at the start: cells and standing heights. */
export const START_ZONE = { x: [-3, 3], y: [1, 4], z: [-3, 3] } as const
/** The finish chest: on the deck, past the finish line. */
export const FINISH_CHEST: [number, number, number] = [0, 10, 33]

/** A course point in the box frame. */
export function courseToFrame(p: readonly [number, number, number]): { f: number; r: number; u: number } {
  return { f: COURSE_F + p[2], r: COURSE_R + p[0], u: p[1] }
}

/** A course point in the world. */
export function courseToWorld(frame: Frame, p: readonly [number, number, number]): Position {
  const { f, r, u } = courseToFrame(p)
  return toWorld(frame, f, r, u)
}

/** Whether a world point is on the start square (START_ZONE). */
export function atStart(frame: Frame, at: Position): boolean {
  const a = courseToWorld(frame, [START_ZONE.x[0], START_ZONE.y[0], START_ZONE.z[0]])
  const b = courseToWorld(frame, [START_ZONE.x[1], START_ZONE.y[1], START_ZONE.z[1]])
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = a[k] < b[k] ? a[k] : b[k]
    const hi = a[k] > b[k] ? a[k] : b[k]
    if (at[k] < lo || at[k] > hi) return false
  }
  return true
}

/**
 * A plain slab, for the catch floor and the back step: whole-gibson corners
 * (x0..x1, z0..z1 from its origin), its top at the origin's y and one gibson
 * thick, as a kit platform is; solid to a walker.
 */
export function slabPayload(name: string, x: [number, number], z: [number, number], color: number): Record<string, unknown> {
  const v: Array<[number, number, number]> = [
    [x[0], -1, z[0]], [x[1], -1, z[0]], [x[1], -1, z[1]], [x[0], -1, z[1]],
    [x[0], 0, z[0]], [x[1], 0, z[0]], [x[1], 0, z[1]], [x[0], 0, z[1]],
  ]
  const extent = Math.max(8, ...v.flat().map((n) => Math.abs(n)))
  return {
    v: 2,
    name,
    unit: 0,
    extent,
    mode: 'solid',
    vertices: v,
    colors: v.map(() => color),
    faces: [[4, 7, 6], [4, 6, 5], [0, 1, 2], [0, 2, 3], [3, 2, 6], [3, 6, 7], [1, 0, 4], [1, 4, 5], [2, 1, 5], [2, 5, 6], [0, 3, 7], [0, 7, 4]],
    constrain: 'all',
  }
}

/**
 * The dirt plot (A5): a 5 by 5 patch, its top at the box's floor, a little
 * way from the box and away from the course (box frame f 12 to 16, r 2 to
 * 6). Symmetric about its middle, so it lands the same whichever way the
 * layout faces.
 */
export const PLOT_AT = { f: 14, r: 4, u: 0 } as const
/** Where a player stands on the plot, and where a seed planted there sits. */
export const PLOT_STAND = { f: 14, r: 4, u: 1 } as const
export const PLOT = slabPayload('Dirt', [-2, 3], [-2, 3], 121)

/** Whether a world point is on the plot, standing or planted (one cell above its top, or two). */
export function onPlot(frame: Frame, at: Position): boolean {
  const a = toWorld(frame, PLOT_AT.f - 2, PLOT_AT.r - 2, 1)
  const b = toWorld(frame, PLOT_AT.f + 2, PLOT_AT.r + 2, 2)
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = a[k] < b[k] ? a[k] : b[k]
    const hi = a[k] > b[k] ? a[k] : b[k]
    if (at[k] < lo || at[k] > hi) return false
  }
  return true
}

/** The catch floor: x -6 to 6 and z -6 to 37 of the course, its origin at course z 16. */
export const CATCH_FLOOR = slabPayload('Catch floor', [-6, 7], [-22, 22], 200)
/** The step up from the catch floor to the start square's back edge (course z -5 and -4). */
export const BACK_STEP = slabPayload('Step', [-2, 3], [0, 2], 211)
