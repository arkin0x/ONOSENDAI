/**
 * viewFly.ts - VIEW's free fly (arkinox, 2026-11-02, reworked 2026-11-09).
 *
 * 2026-11-02: "in view mode, a two-finger touch free-flies in the direction
 * the camera faces". Two buttons above the menu button do the same, forward
 * and back, for as long as they are held (hud/ViewFlyButtons.tsx).
 *
 * 2026-11-09: "when using the move forward and backward functions in VIEW
 * mode, I want the movement to be smooth and not tied to the nearest cursor
 * block. I want the cursor to instead stay where it is until you stop moving
 * for 2 seconds and then have the cursor box LERP to the nearest cell, but
 * only when you are stopped. The movement should be smooth and linear. [...]
 * Two-fingers to go forward can be turned off for now. Turn off three-finger
 * reverse for now too."
 *
 * So a fly moves the camera, not the cursor: the viewpoint glides along the
 * line it looks down, FLY_CELLS_PER_SECOND cells of the zoom a second, and
 * the cursor waits (lib/viewCamera.ts holds the offset and the timing). Held
 * from the fly buttons, the pad's FAR and NEAR, or R and F, all in VIEW.
 *
 * The pure parts live here: which way a touch says to fly (FlyGesture, off
 * for now behind TOUCH_FLY_FORWARD and TOUCH_FLY_REVERSE), how fast at a zoom
 * (flySpeed), who is asking to fly (useViewFly), and where a fly lands the
 * cursor once it comes to rest (landingOf).
 */

import { create } from 'zustand'
import { alignTo, clampAxis, CONTINUOUS_SCALE_MIN, type AxisName, type Position, type ViewAxes } from './space'

/** Cells of the current zoom flown per second: a held pad key steps about nine a second (useRepeatable). */
export const FLY_CELLS_PER_SECOND = 8
/** The longest frame flown at once, in seconds: a tab coming back from the background is not a leap. */
export const FLY_MAX_DT = 0.1
/** How long two or three fingers must rest before they fly, in ms: a pinch shows itself sooner. */
export const FLY_HOLD_MS = 160
/** How far two fingers may spread or close and still be a fly, in CSS pixels, or this share of their spread if more. */
export const PINCH_SLOP_PX = 8
export const PINCH_SLOP_SHARE = 0.04

/**
 * The touch flies, kept so they can come back (arkinox, 2026-11-09: "Two-
 * fingers to go forward can be turned off for now. Turn off three-finger
 * reverse for now too."). Two fingers that drag are the camera's pan now
 * (lib/viewCamera.ts PanGesture); two at rest do nothing.
 */
export const TOUCH_FLY_FORWARD = false
export const TOUCH_FLY_REVERSE = false

/** Forward, back, or not flying. */
export type FlyDir = 1 | -1 | 0

/**
 * Whether the view can fly: a free view is up (VIEW, or a place looked at
 * with the cursor brought along: the VIEWING chip's views), not your history,
 * and not BUILD or WALK, which move by their own controls.
 */
export function canFly(s: { focus: { drive?: boolean } | null; exploreIndex: number | null; walking: boolean }, building: boolean): boolean {
  return s.focus?.drive === true && s.exploreIndex === null && !s.walking && !building
}

/** Gibsons a second at `scaleExp`. */
export function flySpeed(scaleExp: number): number {
  return FLY_CELLS_PER_SECOND * 2 ** scaleExp
}

/**
 * A direction in the render frame (the camera's) as cyberspace components.
 * Render x, y and z are the view's right, up and out axes (lib/space.ts
 * viewAxes), each a cyberspace axis with a sign, so this is that signed
 * permutation turned round.
 */
export function renderToCyber(dir: readonly [number, number, number], axes: ViewAxes): Record<AxisName, number> {
  const out: Record<AxisName, number> = { x: 0, y: 0, z: 0 }
  out[axes.right.axis] += dir[0] * axes.right.dir
  out[axes.up.axis] += dir[1] * axes.up.dir
  out[axes.out.axis] += dir[2] * axes.out.dir
  return out
}

/**
 * What a touch on the scene says about flying: two fingers at rest fly
 * forward, three fly back, after FLY_HOLD_MS, each only while it is on
 * (TOUCH_FLY_FORWARD, TOUCH_FLY_REVERSE; both off since 2026-11-09). Two fingers that spread or
 * close past the slop are a pinch, the camera's zoom, and do not fly for the
 * rest of that touch, even if they come to rest; a fly already under way
 * stops when they do. One finger is the camera's orbit and never flies, and
 * neither do four. A finger landing starts the count again; a finger
 * lifting stops any fly and starts none, so lifting three fingers one at a
 * time never flies forward on the way down, and neither does a touch whose
 * other lift was never heard (review of #592, F3).
 *
 * The page also says how many fingers are still on the screen after each
 * lift (touchesLeft). Fewer than are counted means a lift went unheard: the
 * count starts again from nothing.
 * Fed pointer events by the scene (only touches that began on it) and asked
 * for its direction every frame with the time; it keeps no timers.
 */
export class FlyGesture {
  /** Which touch flies are on: two fingers forward, three back (TOUCH_FLY_FORWARD, TOUCH_FLY_REVERSE). */
  constructor(private readonly on: { forward: boolean; reverse: boolean } = { forward: TOUCH_FLY_FORWARD, reverse: TOUCH_FLY_REVERSE }) {}

  private points = new Map<number, { x: number; y: number }>()
  private base: { count: number; spread: number; at: number } | null = null
  private mode: 'idle' | 'wait' | 'fly' | 'pinch' = 'idle'
  /** Where the touch's first finger landed, while it is the only one down. */
  private lone: { x: number; y: number } | null = null
  private dragged = false

  down(id: number, x: number, y: number, now: number): void {
    if (this.points.size === 0) { this.lone = { x, y }; this.dragged = false } else this.lone = null
    this.points.set(id, { x, y })
    this.restart(now, true)
  }

  move(id: number, x: number, y: number): void {
    const p = this.points.get(id)
    if (!p) return
    p.x = x
    p.y = y
    if (this.lone && this.points.size === 1 && Math.hypot(x - this.lone.x, y - this.lone.y) > PINCH_SLOP_PX) this.dragged = true
    if (this.base?.count !== 2 || this.mode === 'pinch' || this.mode === 'idle') return
    const change = Math.abs(this.spread() - this.base.spread)
    if (change > Math.max(PINCH_SLOP_PX, this.base.spread * PINCH_SLOP_SHARE)) this.mode = 'pinch'
  }

  up(id: number, now: number): void {
    if (!this.points.delete(id)) return
    // The touch is over: its orbit is not the next fly's (a HUD button's, or the next touch's).
    if (this.points.size === 0) { this.lone = null; this.dragged = false }
    this.restart(now, false)
  }

  /** The page's own count of fingers still down, after a lift: fewer than counted here means a lift was lost. */
  touchesLeft(onScreen: number): void {
    if (onScreen < this.points.size) this.clear()
  }

  /** Every finger gone at once (the page lost focus, the mode ended). */
  clear(): void {
    this.points.clear()
    this.base = null
    this.mode = 'idle'
    this.lone = null
    this.dragged = false
  }

  /**
   * Whether this touch orbited before any other finger landed: its one finger
   * dragged past the slop, which is OrbitControls turning the camera. Its
   * unlock is one the user asked for (FlyFollow).
   */
  get orbited(): boolean {
    return this.dragged
  }

  /** Which way to fly now. */
  dir(now: number): FlyDir {
    if (this.mode === 'wait' && this.base && now - this.base.at >= FLY_HOLD_MS) this.mode = 'fly'
    if (this.mode !== 'fly' || !this.base) return 0
    if (this.base.count === 2) return this.on.forward ? 1 : 0
    return this.on.reverse ? -1 : 0
  }

  /** The fingers on the scene now. */
  get count(): number {
    return this.points.size
  }

  private restart(now: number, landing: boolean): void {
    const count = this.points.size
    this.base = landing && (count === 2 || count === 3) ? { count, spread: this.spread(), at: now } : null
    this.mode = this.base ? 'wait' : 'idle'
  }

  /** The two fingers' distance apart (only asked with two down). */
  private spread(): number {
    const [a, b] = [...this.points.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
}

/**
 * Who is asking to fly, and which way: the fly buttons, the pad's FAR and
 * NEAR held in VIEW, R and F held in VIEW, and a touch on the scene. The
 * first that asks wins, in that order; a hand doing two at once is rare.
 */
interface ViewFlyState {
  button: FlyDir
  pad: FlyDir
  key: FlyDir
  touch: FlyDir
  setButton: (dir: FlyDir) => void
  setPad: (dir: FlyDir) => void
  setKey: (dir: FlyDir) => void
  setTouch: (dir: FlyDir) => void
}

export const useViewFly = create<ViewFlyState>((set, get) => ({
  button: 0,
  pad: 0,
  key: 0,
  touch: 0,
  setButton: (button) => { if (get().button !== button) set({ button }) },
  setPad: (pad) => { if (get().pad !== pad) set({ pad }) },
  setKey: (key) => { if (get().key !== key) set({ key }) },
  setTouch: (touch) => { if (get().touch !== touch) set({ touch }) },
}))

/** The way being flown now, from whichever asks. */
export function flyDir(s: Pick<ViewFlyState, 'button' | 'touch'> & Partial<Pick<ViewFlyState, 'pad' | 'key'>> = useViewFly.getState()): FlyDir {
  return s.button || s.pad || s.key || s.touch || 0
}

/**
 * Where a fly lands the cursor: the gibson nearest the point the view now
 * centres on. `flown` is how far the view has flown from the cursor, in
 * cyberspace components and cells of `scaleExp` (render cells mapped through
 * the view's axes, renderToCyber). The view centred on the cursor as it is
 * drawn: its cell's centre below CONTINUOUS_SCALE_MIN, its true place from
 * there up (space.ts placeCentre), so the flight is added to that, and the
 * cursor lands in the cell the view centres on, not one off from it by the
 * cursor's place inside its old cell. At 2^0 this is the cursor plus the
 * flight to the nearest gibson, exactly as the fly snapped before. An axis
 * that ends in the cursor's own cell keeps the cursor's coordinate, so a fly
 * too short to leave the cell changes nothing. An axis at the edge of space
 * stops there.
 */
export function landingOf(cursor: Position, flown: Readonly<Record<AxisName, number>>, scaleExp: number): Position {
  const out: Position = { ...cursor }
  const cell = 2 ** scaleExp
  for (const axis of ['x', 'y', 'z'] as const) {
    // The gibson the cursor is drawn at (its cell's centre gibson below the
    // continuous range), then the flight to the nearest whole gibson.
    const drawn = scaleExp === 0 || scaleExp >= CONTINUOUS_SCALE_MIN ? cursor[axis] : alignTo(cursor[axis], scaleExp) + (1n << BigInt(scaleExp - 1))
    const to = clampAxis(drawn + BigInt(Math.round(flown[axis] * cell)))
    // Still in the cursor's own cell: the cursor stays exactly where it was.
    out[axis] = alignTo(to, scaleExp) === alignTo(cursor[axis], scaleExp) && scaleExp < CONTINUOUS_SCALE_MIN ? cursor[axis] : to
  }
  return out
}

/**
 * Where an unlanded fly would put the cursor right now, asked by the store's
 * pad move (useCyberspace moveCursor): a press within the two seconds before
 * a fly lands steps from where the view has flown, not from where the cursor
 * still waits, so the camera is not pulled back the whole way. The scene's
 * fly registers the answer (scene/ViewFly.ts); null when nothing is flown.
 */
let landingSource: (() => Position | null) | null = null
export function setFlyLanding(source: (() => Position | null) | null): void {
  landingSource = source
}
export function flyLanding(): Position | null {
  return landingSource ? landingSource() : null
}
