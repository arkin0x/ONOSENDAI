/**
 * viewFly.ts - VIEW's free fly (arkinox, 2026-11-02): "in view mode, a
 * two-finger touch free-flies in the direction the camera faces; the cursor
 * stays in the same position relative to the camera and snaps to whatever
 * gibson is nearest. A three-finger touch goes in reverse." Two buttons above
 * the menu button do the same, forward and back, for as long as they are
 * held (hud/ViewFlyButtons.tsx).
 *
 * The pure parts live here: which way a touch says to fly (FlyGesture), how
 * fast at a zoom (flySpeed), and one frame of flight (flyStep). The scene's
 * rig runs a frame of it before it frames the cursor (tickViewFly), so the
 * camera, which follows the cursor, keeps its place behind it.
 *
 * The speed is in cells of the zoom, not gibsons: FLY_CELLS_PER_SECOND cells a
 * second at 2^0 and at 2^80 alike, so a fly feels the same at every scale.
 * The cursor is whole gibsons, so each frame's travel is added to what the
 * frames before left over and the cursor goes to the nearest gibson; the
 * remainder waits for the next frame, so a slow fly at 2^0 is not lost to
 * rounding.
 */

import { create } from 'zustand'
import { clampAxis, type AxisName, type Position, type ViewAxes } from './space'

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
 * How often a fly writes the cursor to the store, in ms: 20 a second. Every
 * write re-renders whatever reads the cursor (the pad, the proof panel, the
 * cursor box, the rooms), and at a zoom where each frame reaches a new gibson
 * that was every frame. The camera eases toward the cursor (FOLLOW_TAU), so
 * a step every 50 ms still reads as a glide.
 */
export const FLY_WRITE_MS = 50

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

/** Gibsons not yet flown on each axis: what rounding to the nearest gibson left over. */
export type FlyCarry = Record<AxisName, number>
export const NO_CARRY: Readonly<FlyCarry> = { x: 0, y: 0, z: 0 }

/**
 * One frame of flight: `along` (a unit vector in cyberspace components) times
 * the speed at `scaleExp` for `dt` seconds, `sign` forward or back, added to
 * the carry, and the cursor moved to the nearest gibson of where that puts
 * it. An axis at the edge of space stops there and drops its carry. `moved`
 * is false when the cursor is where it was, so nothing need be written.
 */
export function flyStep(
  cursor: Position, carry: Readonly<FlyCarry>, along: Readonly<Record<AxisName, number>>, sign: 1 | -1, dt: number, scaleExp: number,
): { cursor: Position; carry: FlyCarry; moved: boolean } {
  const travel = flySpeed(scaleExp) * Math.min(Math.max(dt, 0), FLY_MAX_DT) * sign
  const next: Position = { ...cursor }
  const left: FlyCarry = { x: 0, y: 0, z: 0 }
  let moved = false
  for (const axis of ['x', 'y', 'z'] as const) {
    const want = carry[axis] + along[axis] * travel
    const whole = Math.round(want)
    if (whole === 0) { left[axis] = want; continue }
    const to = clampAxis(cursor[axis] + BigInt(whole))
    // Against the wall: the axis stops, and what was owed with it.
    if (to - cursor[axis] !== BigInt(whole)) { next[axis] = to; moved ||= to !== cursor[axis]; continue }
    next[axis] = to
    left[axis] = want - whole
    moved = true
  }
  return { cursor: next, carry: left, moved }
}

/**
 * What a touch on the scene says about flying: two fingers at rest fly
 * forward, three fly back, after FLY_HOLD_MS. Two fingers that spread or
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
    return this.base.count === 2 ? 1 : -1
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
 * Who is asking to fly, and which way: the buttons, and a touch on the
 * scene. A held button wins over the scene, though a hand doing both is rare.
 */
interface ViewFlyState {
  button: FlyDir
  touch: FlyDir
  setButton: (dir: FlyDir) => void
  setTouch: (dir: FlyDir) => void
}

export const useViewFly = create<ViewFlyState>((set, get) => ({
  button: 0,
  touch: 0,
  setButton: (button) => { if (get().button !== button) set({ button }) },
  setTouch: (touch) => { if (get().touch !== touch) set({ touch }) },
}))

/** The way being flown now, from whichever asks. */
export function flyDir(s: Pick<ViewFlyState, 'button' | 'touch'> = useViewFly.getState()): FlyDir {
  return s.button !== 0 ? s.button : s.touch
}

/**
 * Whether the rig's camera follows the cursor (locked) across a fly. A fly
 * locks it, so the cursor keeps its place in front of the camera; when the
 * fly ends the camera goes back to what it was doing before (review of #592):
 * following the cursor, or standing where an orbit left it and only turning
 * to it.
 *
 * "Before" is read while no finger is on the scene: the first finger of a
 * touch is the orbit's, which unlocks the camera the moment it lands
 * (OrbitControls onStart), and a two-finger fly would otherwise hand back an
 * unlock the user never asked for. Unless that finger did orbit before the
 * fly began: then the unlock is the user's, and the fly hands it back.
 */
export class FlyFollow {
  private flying = false
  private was = true
  private steady = true

  /**
   * This frame's lock, given the rig's lock, whether a fly is under way and
   * whether a finger is on the scene. `orbited`: the touch under way turned the
   * camera with one finger before the fly began (FlyGesture.orbited), so the
   * camera goes back to standing, as that orbit left it, not to the follow from
   * before the touch. `viewOpen`: a fly may still go on (canFly). A fly that
   * ended with the view (RETURN, BUILD) hands back nothing: that change framed
   * the camera and set its follow itself, and the "before" was a view now gone.
   */
  frame(locked: boolean, flying: boolean, fingersDown: boolean, orbited = false, viewOpen = true): boolean {
    if (flying) {
      if (!this.flying) { this.flying = true; this.was = orbited ? false : this.steady }
      return true
    }
    let out = locked
    if (this.flying) { this.flying = false; if (viewOpen) out = this.was }
    if (!fingersDown) this.steady = out
    return out
  }
}
