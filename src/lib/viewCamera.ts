/**
 * viewCamera.ts - the camera's own offset from its orbit about the cursor
 * (arkinox, 2026-11-09):
 *
 *   "I want the cursor to instead stay where it is until you stop moving for
 *   2 seconds and then have the cursor box LERP to the nearest cell, but only
 *   when you are stopped. [...] Two finger drag should drag the camera as one
 *   would expect; I'd actually like two finger panning to work in any 3rd
 *   person mode (not WALK). When you pan, the view stays where you move it
 *   until you move the cursor, at which point the camera smoothly does back
 *   to spectating the cursor. The cursor should not change position due to a
 *   pan. A pan only moves the camera away from its typical orbit."
 *
 * The rig (Scene.tsx, through scene/ViewFly.ts) frames what it orbits plus
 * one offset, in render cells, made of three parts:
 *
 * - FLOWN: VIEW's fly (lib/viewFly.ts). Held, the view glides along its line
 *   of sight, linear and frame-rate independent; the cursor waits. After
 *   LAND_IDLE_MS with nothing moving, the cursor box glides (LAND_LERP_MS) to
 *   where the view now centres, and only when it gets there does the cursor
 *   itself (what BUILD, DEPLOY and the coordinates read) move.
 * - PANNED: a two-finger drag (PanGesture), or a right or Shift drag of the
 *   mouse. It never moves the cursor and never lands.
 * - EASING: what is left of the other two once the cursor has moved, eased
 *   to nothing over EASE_BACK_MS, so the camera goes back to its orbit about
 *   the cursor smoothly rather than jumping.
 *
 * Any move of the cursor (a pad press, a tap, a jump, the fly's own landing,
 * a hop) turns the whole offset into EASING, re-expressed against the moved
 * cursor so the camera does not jump on the frame it moves (rebase). A new
 * fly folds a pan into EASING too: FAR and NEAR count as moving the cursor
 * (the brief), so a fly starts back on the line through the cursor.
 *
 * Plain numbers, no three.js, nothing allocated per frame; the scene feeds it
 * render-space vectors and reads the sum back (offset).
 */

import { create } from 'zustand'
import { FLY_CELLS_PER_SECOND, FLY_MAX_DT, PINCH_SLOP_PX, PINCH_SLOP_SHARE } from './viewFly'
import type { Position } from './space'

/** How long nothing must move after a fly before the cursor goes to where the view now is, in ms. */
export const LAND_IDLE_MS = 2000
/** How long the cursor box takes to glide there, in ms. */
export const LAND_LERP_MS = 300
/** How long the camera takes to ease back onto its orbit about the cursor once the cursor moves, in ms. */
export const EASE_BACK_MS = 400
/** Smaller than this, in render cells, an offset is none. */
export const OFFSET_EPS = 1e-6
/** How far two fingers' midpoint must travel, in CSS pixels, before their drag is a pan and not yet a pinch. */
export const PAN_SLOP_PX = 10

/** Smooth in and out over 0..1 (zero slope at both ends). */
export function ease(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t
  return u * u * (3 - 2 * u)
}

/** What a frame of the offset asks of the scene. */
export type OffsetEvent = 'none' | 'glide-start' | 'land'

/** A render-space vector to write into, so nothing is allocated. */
export interface Vec3Out { x: number; y: number; z: number }

export class ViewOffset {
  /** FLOWN: the fly's travel from the cursor, render cells. */
  fx = 0; fy = 0; fz = 0
  /** PANNED. */
  px = 0; py = 0; pz = 0
  /** EASING: the offset left when the cursor moved, scaled down to nothing over EASE_BACK_MS. */
  rx = 0; ry = 0; rz = 0
  private easeMs = EASE_BACK_MS
  /** Since anything last moved the view, in ms. */
  private idleMs = 0
  /** The cursor box's glide: how far along (0..1) and which way it is heading (1 to the landing, 0 back). */
  private glideAt = 0
  private glideTo: 0 | 1 = 0
  private flying = false

  /** Whether the view has flown from the cursor and not yet landed. */
  get flown(): boolean {
    return Math.abs(this.fx) > OFFSET_EPS || Math.abs(this.fy) > OFFSET_EPS || Math.abs(this.fz) > OFFSET_EPS
  }

  /** Whether a fly or a pan holds the camera off its orbit (not merely easing back). */
  get held(): boolean {
    return this.flown || Math.abs(this.px) > OFFSET_EPS || Math.abs(this.py) > OFFSET_EPS || Math.abs(this.pz) > OFFSET_EPS
  }

  /** Whether the camera is off its orbit at all, or still easing back onto it. */
  get active(): boolean {
    if (this.flown) return true
    if (Math.abs(this.px) > OFFSET_EPS || Math.abs(this.py) > OFFSET_EPS || Math.abs(this.pz) > OFFSET_EPS) return true
    return this.easeMs < EASE_BACK_MS && (Math.abs(this.rx) > OFFSET_EPS || Math.abs(this.ry) > OFFSET_EPS || Math.abs(this.rz) > OFFSET_EPS)
  }

  /** The cursor box's glide toward the landing, eased, 0..1. */
  get glide(): number {
    return ease(this.glideAt)
  }

  /**
   * One frame of flight: `(ux, uy, uz)` the unit line of sight in render
   * space, `sign` forward or back, `dt` seconds (at most FLY_MAX_DT).
   * FLY_CELLS_PER_SECOND render cells a second, which is the same number of
   * the zoom's cells at every zoom: 2^scaleExp times as many gibsons.
   */
  fly(ux: number, uy: number, uz: number, sign: 1 | -1, dt: number): void {
    if (!this.flying) {
      this.flying = true
      // FAR and NEAR count as moving the cursor: a pan eases out as the fly begins.
      this.foldPan()
    }
    const d = FLY_CELLS_PER_SECOND * Math.min(Math.max(dt, 0), FLY_MAX_DT) * sign
    this.fx += ux * d
    this.fy += uy * d
    this.fz += uz * d
    this.moved()
  }

  /** A frame with no fly asked for: the next fly is a new one. */
  rest(): void {
    this.flying = false
  }

  /** A pan by `(dx, dy, dz)` render cells. A pan under way stops an ease where it is and goes on from there. */
  pan(dx: number, dy: number, dz: number): void {
    this.bakeEasing()
    this.px += dx
    this.py += dy
    this.pz += dz
    this.moved()
  }

  /**
   * The cursor moved by `(dx, dy, dz)` in render space: the whole offset,
   * less that move, eases out from here, so the camera starts exactly where
   * it is and goes back to its orbit about the moved cursor. The landing it
   * might have made is moot.
   */
  rebase(dx: number, dy: number, dz: number): void {
    const t = this.share()
    this.rx = this.fx + this.px + this.rx * t - dx
    this.ry = this.fy + this.py + this.ry * t - dy
    this.rz = this.fz + this.pz + this.rz * t - dz
    this.fx = this.fy = this.fz = 0
    this.px = this.py = this.pz = 0
    this.easeMs = 0
    this.glideAt = 0
    this.glideTo = 0
  }

  /** Ease the whole offset back from where it is (WALK began, the fly's landing, a fly that may no longer land). */
  release(): void {
    this.rebase(0, 0, 0)
  }

  /** Back on the orbit at once: the rig framed the camera itself (a cut, a re-frame, a zoom). */
  clear(): void {
    this.fx = this.fy = this.fz = 0
    this.px = this.py = this.pz = 0
    this.rx = this.ry = this.rz = 0
    this.easeMs = EASE_BACK_MS
    this.idleMs = 0
    this.glideAt = 0
    this.glideTo = 0
    this.flying = false
  }

  /** A landing the scene cannot make now (the view is no longer one that flies): the box goes back. */
  cancelGlide(): void {
    this.glideTo = 0
  }

  /**
   * Time passes, `dtMs`. Says when the cursor box should start for the
   * landing (LAND_IDLE_MS after anything last moved, only if the view has
   * flown) and when it has got there (LAND_LERP_MS later). A glide that new
   * movement called off goes back the way it came.
   */
  step(dtMs: number): OffsetEvent {
    const dt = Math.max(0, dtMs)
    this.easeMs = Math.min(EASE_BACK_MS, this.easeMs + dt)
    // A frame that flew is not rest, however long it took.
    if (!this.flying) this.idleMs += dt
    if (this.glideTo === 1) {
      this.glideAt = Math.min(1, this.glideAt + dt / LAND_LERP_MS)
      return this.glideAt >= 1 ? 'land' : 'none'
    }
    if (this.glideAt > 0) {
      this.glideAt = Math.max(0, this.glideAt - dt / LAND_LERP_MS)
      return 'none'
    }
    if (this.flown && !this.flying && this.idleMs >= LAND_IDLE_MS) {
      this.glideTo = 1
      return 'glide-start'
    }
    return 'none'
  }

  /** The offset to frame now, written into `out`. */
  offset(out: Vec3Out): Vec3Out {
    const t = this.share()
    out.x = this.fx + this.px + this.rx * t
    out.y = this.fy + this.py + this.ry * t
    out.z = this.fz + this.pz + this.rz * t
    return out
  }

  /** How much of EASING is still owed. */
  private share(): number {
    return 1 - ease(this.easeMs / EASE_BACK_MS)
  }

  private moved(): void {
    this.idleMs = 0
    this.glideTo = 0
  }

  private bakeEasing(): void {
    if (this.easeMs >= EASE_BACK_MS) return
    const t = this.share()
    this.px += this.rx * t
    this.py += this.ry * t
    this.pz += this.rz * t
    this.rx = this.ry = this.rz = 0
    this.easeMs = EASE_BACK_MS
  }

  private foldPan(): void {
    this.bakeEasing()
    if (Math.abs(this.px) <= OFFSET_EPS && Math.abs(this.py) <= OFFSET_EPS && Math.abs(this.pz) <= OFFSET_EPS) return
    this.rx = this.px
    this.ry = this.py
    this.rz = this.pz
    this.px = this.py = this.pz = 0
    this.easeMs = 0
  }
}

/**
 * The cursor box's glide to a fly's landing, as the scene's cursor reads it
 * every frame (Cursor.tsx): while the store's cursor is still `from`, the box
 * is drawn `share` of the way along `(dx, dy, dz)` render cells (the landing
 * cell less the cursor's cell). Once the cursor is anything else, which is
 * the landing, or a move that called the landing off, the box is the
 * cursor's own: the same frame the cursor lands, the box stops being pushed,
 * whichever of the two frame callbacks runs first.
 */
export const cursorGlide: { from: Position | null; dx: number; dy: number; dz: number; share: number } = {
  from: null, dx: 0, dy: 0, dz: 0, share: 0,
}

/**
 * How far the view centres off the cursor, in whole render cells: the
 * terrain window follows the view, not the cursor, while it is flown or
 * panned away (hooks/useViewWindow.ts). Written only when a whole cell
 * changes, so nothing hears it every frame.
 */
interface ViewCentreState { right: number; up: number; out: number }
export const useViewCentre = create<ViewCentreState>(() => ({ right: 0, up: 0, out: 0 }))
export function setViewCentre(right: number, up: number, out: number): void {
  const r = Math.round(right) + 0
  const u = Math.round(up) + 0
  const o = Math.round(out) + 0
  const s = useViewCentre.getState()
  if (s.right !== r || s.up !== u || s.out !== o) useViewCentre.setState({ right: r, up: u, out: o })
}

/**
 * Two fingers on the scene: a pinch (their spread changes) is the camera's
 * zoom, which OrbitControls already does; a drag (their midpoint moves) is
 * a pan. Which one is decided by whichever shows itself first, past
 * PINCH_SLOP_PX (or PINCH_SLOP_SHARE of the spread) or PAN_SLOP_PX, and holds
 * for the rest of that pair's touch, so a pan's fingers drifting apart never
 * zoom and a pinch's midpoint drifting never pans. One finger is the orbit,
 * three or more are nothing. A mouse drags a pan too (`drag`), with the right
 * button or with Shift held.
 *
 * The drag gathers in CSS pixels until the rig takes it (take), once a frame.
 */
export class PanGesture {
  private points = new Map<number, { x: number; y: number }>()
  private mode: 'idle' | 'open' | 'pan' | 'pinch' = 'idle'
  private spread0 = 0
  private cx0 = 0
  private cy0 = 0
  private cx = 0
  private cy = 0
  private dx = 0
  private dy = 0
  private mouse = false
  /** The finger that has moved since the pair was last judged, if one has. */
  private fresh: number | null = null

  down(id: number, x: number, y: number): void {
    this.points.set(id, { x, y })
    this.reopen()
  }

  move(id: number, x: number, y: number): void {
    const p = this.points.get(id)
    if (!p) return
    p.x = x
    p.y = y
    if (this.points.size !== 2 || this.mode === 'idle' || this.mode === 'pinch') return
    // A frame's moves come one finger at a time: judge the pair once both
    // have moved (or one twice, the other standing still), so a fast swipe's
    // first finger, a frame ahead of the second, is not read as a spread.
    if (this.fresh === null) { this.fresh = id; return }
    this.fresh = null
    const [a, b] = this.pair()
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if (this.mode === 'open') {
      const spread = Math.hypot(a.x - b.x, a.y - b.y)
      if (Math.abs(spread - this.spread0) > Math.max(PINCH_SLOP_PX, this.spread0 * PINCH_SLOP_SHARE)) { this.mode = 'pinch'; return }
      if (Math.hypot(mx - this.cx0, my - this.cy0) <= PAN_SLOP_PX) return
      // A pan from where the fingers landed: the slop is not lost, so the
      // world stays under them.
      this.mode = 'pan'
      this.cx = this.cx0
      this.cy = this.cy0
    }
    this.dx += mx - this.cx
    this.dy += my - this.cy
    this.cx = mx
    this.cy = my
  }

  up(id: number): void {
    if (!this.points.delete(id)) return
    this.reopen()
  }

  /** Every finger gone at once (the page lost focus, a lost lift). */
  clear(): void {
    this.points.clear()
    this.mode = 'idle'
    this.dx = this.dy = 0
    this.mouse = false
  }

  /** The page says this many fingers are still down after a lift: fewer than counted means a lift was lost. */
  touchesLeft(onScreen: number): void {
    if (onScreen < this.points.size) this.clear()
  }

  /** A mouse pan begins (right button, or Shift with the left) or ends. */
  setMouse(on: boolean): void {
    this.mouse = on
  }

  /** A mouse pan's movement, in CSS pixels. */
  drag(dx: number, dy: number): void {
    if (!this.mouse) return
    this.dx += dx
    this.dy += dy
  }

  /** Two fingers decided on a pan, or the mouse is panning: the zoom stands aside. */
  get panning(): boolean {
    return this.mode === 'pan' || this.mouse
  }

  /** Fingers on the scene now. */
  get fingers(): number {
    return this.points.size
  }

  /** Two fingers decided on a pinch. */
  get pinching(): boolean {
    return this.mode === 'pinch'
  }

  /** The pan gathered since the last take, in CSS pixels, into `out`; true if there was any. */
  take(out: { x: number; y: number }): boolean {
    out.x = this.dx
    out.y = this.dy
    this.dx = this.dy = 0
    return out.x !== 0 || out.y !== 0
  }

  /** A pair landing (or what is left after a lift) starts undecided; anything but two fingers is nothing. */
  private reopen(): void {
    this.fresh = null
    if (this.points.size !== 2) { this.mode = 'idle'; return }
    const [a, b] = this.pair()
    this.spread0 = Math.hypot(a.x - b.x, a.y - b.y)
    this.cx0 = (a.x + b.x) / 2
    this.cy0 = (a.y + b.y) / 2
    this.mode = 'open'
  }

  private pair(): [{ x: number; y: number }, { x: number; y: number }] {
    const it = this.points.values()
    return [it.next().value!, it.next().value!]
  }
}
