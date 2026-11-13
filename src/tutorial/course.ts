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
 * as in the kit's own course. A walker stands on a piece's cells from its
 * middle -n to +n (a square 6 has 7, a square 4 has 5), and a gap is counted
 * as the kit counts it, edge to edge: the presses from the last cell of one
 * to the first of the next (tutorial/__tests__/courseWalk.test.ts measures
 * every one with the real WALK code).
 *
 *   START    a square 6 at y 0, and the start line butted to its forward
 *            edge, as the kit butts its lines (never laid on a platform)
 *   GAP 2    EASY, level, onto a square 4
 *   GAP 3    EASY, level, onto a second square 4
 *   GAP 3    EASY, level, onto a square 6 with the trampoline on it
 *            (bounce 12: a walker on it stands at y 2)
 *   BOOST    the finish deck at y 9 (stand at y 10): up 8 from the
 *            trampoline, out of reach of a jump and its double jump (7),
 *            so only the trampoline gets you there
 *   FINISH   two checkered flags on the deck; the finish chest in the
 *            deck's own height-3 region
 *   FLOOR    a catch floor under it all (stand at y -2), and a step behind
 *            the start (stand at y 0): risers of 2 and 1, the stair rule,
 *            so a fall is never more than a walk back
 *
 * The course's z 0 is the box frame's f 20 and its x 0 is r 20, so the
 * finish deck (z 28 to 34, x -3 to 3, standing y 10) lies in one aligned
 * height-3 region whichever way the layout faces: f 48 to 55, r 16 to 23,
 * u 8 to 15, since the box's base is aligned to 8 on every axis.
 */

import type { Frame } from './layout'
import { toFrame, toWorld } from './layout'
import type { Position } from '../lib/space'

/** The course's origin in the box frame. */
export const COURSE_F = 20
export const COURSE_R = 20

/** A piece of the course, by its file under tutorial/pieces, at a point of the course frame. */
export interface CoursePart {
  piece: 'plat-square-6' | 'plat-square-4' | 'line-start-4x2' | 'trampoline-4' | 'flag-checkered' | 'catch-floor' | 'back-step'
  at: [number, number, number]
}

export const COURSE: CoursePart[] = [
  // START: the square (cells z -3 to 3) and the line butted to it (z 4 to 6)
  { piece: 'plat-square-6', at: [0, 0, 0] },
  { piece: 'line-start-4x2', at: [0, 0, 5] },
  // GAP 2 (6 to 8), GAP 3 (12 to 15), GAP 3 (19 to 22)
  { piece: 'plat-square-4', at: [0, 0, 10] },
  { piece: 'plat-square-4', at: [0, 0, 17] },
  { piece: 'plat-square-6', at: [0, 0, 25] },
  { piece: 'trampoline-4', at: [0, 0, 25] },
  // BOOST onto the finish deck (cells z 28 to 34)
  { piece: 'plat-square-6', at: [0, 9, 31] },
  { piece: 'flag-checkered', at: [-3, 9, 34] },
  { piece: 'flag-checkered', at: [3, 9, 34] },
  // FLOOR
  { piece: 'catch-floor', at: [0, -3, 13] },
  { piece: 'back-step', at: [0, -1, -5] },
]

/** Where a walker stands at the start: the middle of the start square. */
export const START_STAND: [number, number, number] = [0, 1, 0]
/** The start square, where a walker counts as at the start: cells and standing heights. */
export const START_ZONE = { x: [-3, 3], y: [1, 4], z: [-3, 3] } as const
/**
 * The hop target (owner, 2026-11-13): over the middle of the start square,
 * 2 above where a walker stands on it. The course step has the player move
 * the cursor here with CONTROLS and HOP to it; once GRAVITY is on they fall
 * the 2 onto the start square, and the target is then over their head, out
 * of a forward view. Inside START_ZONE, so landing on it is at the start.
 */
export const TARGET: [number, number, number] = [START_STAND[0], START_STAND[1] + 2, START_STAND[2]]
/** The finish deck, where a walker counts as finished: cells and standing heights. */
export const DECK_ZONE = { x: [-3, 3], y: [10, 13], z: [28, 34] } as const
/** The finish chest: on the deck, near its far edge. */
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

/** Whether a world point is in a zone of the course frame. */
function inZone(frame: Frame, zone: { x: readonly [number, number]; y: readonly [number, number]; z: readonly [number, number] }, at: Position): boolean {
  const a = courseToWorld(frame, [zone.x[0], zone.y[0], zone.z[0]])
  const b = courseToWorld(frame, [zone.x[1], zone.y[1], zone.z[1]])
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = a[k] < b[k] ? a[k] : b[k]
    const hi = a[k] > b[k] ? a[k] : b[k]
    if (at[k] < lo || at[k] > hi) return false
  }
  return true
}

/** Whether a world point is on the start square (START_ZONE). */
export function atStart(frame: Frame, at: Position): boolean {
  return inZone(frame, START_ZONE, at)
}

/** Where the hop target is in the world (TARGET). */
export function targetAt(frame: Frame): Position {
  return courseToWorld(frame, TARGET)
}

/** Whether a world point is the hop target's cell. */
export function onTarget(frame: Frame, at: Position): boolean {
  const t = targetAt(frame)
  return at.x === t.x && at.y === t.y && at.z === t.z
}

/**
 * The hop target's look: a glowing beacon in the tutorial's cyan (palette
 * 226, the coach's own accent), drawn around the target's gibson. Two
 * upright rings at right angles, so it reads as a ball from any side, and a
 * wider white ring level round its middle. Radius 1 and 1.5 gibsons: from the
 * start square below, its lowest point is a gibson over the walker's head.
 * LINES with no faces and constrain OFF: it glows under the bloom as lines
 * do, and nothing a walker or a hop bumps into. One line through its points,
 * as LINES without faces draws (stage.ts boxModel), retracing a quarter ring
 * to get from one ring to the next. Positions are whole units plus ticks
 * (120 to a unit), from the gibson's centre.
 */
export function targetPayload(): Record<string, unknown> {
  const N = 24
  const pts: Array<{ p: [number, number, number]; c: number }> = []
  const at = (x: number, y: number, z: number, c: number): void => { pts.push({ p: [x, y, z], c }) }
  const R = 1, H = 1.5, CYAN = 226, WHITE = 225
  // The ring facing Z, from the top round to the top again.
  for (let i = 0; i <= N; i++) { const a = (2 * Math.PI * i) / N; at(R * Math.sin(a), R * Math.cos(a), 0, CYAN) }
  // The ring facing X, from the top round to the top again.
  for (let i = 1; i <= N; i++) { const a = (2 * Math.PI * i) / N; at(0, R * Math.cos(a), R * Math.sin(a), CYAN) }
  // Down the first ring a quarter to its side, out to the white ring, and round it.
  for (let i = 1; i <= N / 4; i++) { const a = (2 * Math.PI * i) / N; at(R * Math.sin(a), R * Math.cos(a), 0, CYAN) }
  for (let i = 0; i <= N; i++) { const a = (2 * Math.PI * i) / N; at(H * Math.cos(a), 0, H * Math.sin(a), WHITE) }
  const whole = (v: number): number => Math.floor(Math.round(v * 120) / 120)
  const tick = (v: number): number => Math.round(v * 120) - whole(v) * 120
  return {
    v: 2,
    name: 'Target',
    unit: 0,
    extent: 8,
    mode: 'lines',
    vertices: pts.map(({ p }) => p.map(whole)),
    ticks: pts.map(({ p }) => p.map(tick)),
    colors: pts.map(({ c }) => c),
    faces: [],
    constrain: 'off',
  }
}

/** Whether a world point is on the finish deck (DECK_ZONE). */
export function onDeck(frame: Frame, at: Position): boolean {
  return inZone(frame, DECK_ZONE, at)
}

/**
 * A plain slab, for the catch floor and the back step: corners `hx` and `hz`
 * each way from its origin, so it lands the same whichever way the layout
 * faces (a shard's model z runs against the world's), its top at the
 * origin's y and one gibson thick, as a kit platform is; solid to a walker.
 */
export function slabPayload(name: string, hx: number, hz: number, color: number): Record<string, unknown> {
  const x = [-hx, hx]
  const z = [-hz, hz]
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
 * way from the box and away from the course (a walker stands on box frame
 * f 12 to 16, r 2 to 6, the slab's corners -2 and +2 about its middle
 * counting as cells too, the same whichever way the layout faces).
 */
export const PLOT_AT = { f: 14, r: 4, u: 0 } as const
/** Where a player stands on the plot: one cell above the dirt's own. */
export const PLOT_STAND = { f: 14, r: 4, u: 1 } as const
export const PLOT = slabPayload('Dirt', 2, 2, 121)
/**
 * Where a seed planted on the plot sits: in the dirt, at the dirt's own
 * height, one gibson below where the player stands (owner, 2026-11-13: "the
 * cursor needs to be 1g lower so the seed is in the dirt"). The dirt is a
 * slab whose top is at its origin's y (slabPayload), and a seed's bloom grows
 * up from the seed's own point, drawn through the same placement as any shard
 * (scene/WorldSeeds, WorldShards placeShard): at the dirt's height the bloom
 * stands on the dirt's top, the bead it shows before it blooms half in the
 * dirt. A cell up, where the player stands, it stood a whole gibson above it.
 */
export const PLOT_SEED_U = PLOT_AT.u

/** Whether a world point lies over the plot's 5 by 5 cells, from `u0` to `u1` in the box's frame (inclusive). */
function overPlot(frame: Frame, at: Position, u0: number, u1: number): boolean {
  const a = toWorld(frame, PLOT_AT.f - 2, PLOT_AT.r - 2, u0)
  const b = toWorld(frame, PLOT_AT.f + 2, PLOT_AT.r + 2, u1)
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = a[k] < b[k] ? a[k] : b[k]
    const hi = a[k] > b[k] ? a[k] : b[k]
    if (at[k] < lo || at[k] > hi) return false
  }
  return true
}

/** Whether a world point is standing on the plot: one cell above its top, or two (the at-plot wait). */
export function onPlot(frame: Frame, at: Position): boolean {
  return overPlot(frame, at, PLOT_STAND.u, PLOT_STAND.u + 1)
}

/**
 * Whether a world point is on the plot as a seed may be: in the dirt
 * (PLOT_SEED_U), where PLANT THE SEED puts it, or one or two cells above it,
 * where a player standing there might nudge it. What PLANT THE SEED accepts
 * for the cursor it lines up; the plant wait itself is wider (director.ts
 * tutorialTreePlanted: anywhere in the tutorial's region).
 */
export function inPlot(frame: Frame, at: Position): boolean {
  return overPlot(frame, at, PLOT_SEED_U, PLOT_STAND.u + 1)
}

/**
 * Where the plant step puts the build cursor (tutorial feedback 2026-11-12,
 * item 6): in the dirt, beside the player rather than on or under them. The
 * cell to one side of where they stand, else to the other, else ahead or
 * behind: the first of those over the plot, at the dirt's own height
 * (PLOT_SEED_U, one gibson below where they stand; owner, 2026-11-13: "the
 * cursor needs to be 1g lower so the seed is in the dirt"). A side first,
 * because the view looks along the forward axis (the layout's forward is the
 * starting view's +Z), and a cell ahead would sit right behind the avatar on
 * screen. Null when the player is not on the plot.
 */
export function plantCell(frame: Frame, at: Position): Position | null {
  if (!onPlot(frame, at)) return null
  const p = toFrame(frame, at)
  for (const [df, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const cell = toWorld(frame, p.f + df, p.r + dr, PLOT_SEED_U)
    if (inPlot(frame, cell)) return cell
  }
  return null
}

/** The catch floor: x -7 to 7 and z -12 to 37 of the course (cells), its origin at course z 13, reaching behind the step. */
export const CATCH_FLOOR = slabPayload('Catch floor', 7, 25, 200)
/** The step up from the catch floor to the start square's back edge (course z -7 to -3). */
export const BACK_STEP = slabPayload('Step', 3, 2, 211)
