/**
 * coverBand.ts - where the scene can still be seen past the HUD, and the lens
 * shift that frames the orbit's focus in the middle of it.
 *
 * In BUILD the camera orbits the build cursor, which a perspective camera puts
 * at the middle of the screen. On a phone the deploy bar and the pad cover the
 * bottom half, so the cursor sat on the bar's top edge and everything below it
 * was hidden (arkinox, 2026-10-25: "we should set the center of the orbit to
 * the center of the vertical portion of the screen not covered by any menu").
 *
 * The fix moves the picture, not the camera. A lens shift (three.js
 * setViewOffset with a window the size of the canvas) slides the image across
 * the screen by a fixed number of pixels: the camera stands where it stood,
 * looks where it looked, orbits and dollies about the same point, and the
 * projection's scale is untouched, so every size worked out from the field of
 * view (a cell's pixels, a label's size, a tap target's) is still right. The
 * picking ray and every projected label go through the same matrix, so they
 * follow the shift by themselves.
 *
 * Covers are measured from the DOM (hooks/useCover.ts): each overlay that
 * takes part says which edge it covers from. Pure functions here, so the
 * numbers can be asserted without a browser.
 */

import type { PerspectiveCamera } from 'three'

/** The edge of the screen an overlay covers the scene from. */
export type CoverEdge = 'top' | 'bottom' | 'left' | 'right'

/** A box in CSS pixels, from the canvas's top left. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** One overlay over the scene: the edge it stands on and the box it takes. */
export interface Cover { edge: CoverEdge; box: Box }

/**
 * The share of the uncovered width, about its middle, that the focus needs
 * clear on a landscape screen. A bar or pad counts toward the top or bottom
 * there only when it reaches into this column, so on a wide desktop a pad in
 * the corner leaves the picture where it was.
 *
 * A portrait screen (a phone held upright) counts every top and bottom cover
 * whatever its width. The column was a cliff there: the pad stands at a fixed
 * width in the right corner, so it reached the column on a phone up to about
 * 446 px wide and missed it on a wider one, and BUILD's framing jumped by half
 * the pad's height (about 128 px) between two phones a few pixels apart
 * (review of #505). On a phone the bars and the pad run across most of the
 * width anyway, which is the owner's "vertical portion of the screen not
 * covered by any menu".
 */
export const FOCUS_COLUMN = 0.4

/**
 * The smallest band worth framing in, as a share of the screen on that axis.
 * Below it the overlays are the thing being used (a menu over the whole
 * screen) and the picture stays centred.
 */
export const MIN_BAND = 0.3

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

/**
 * The part of a `width` by `height` screen the scene can be seen in past the
 * covers: left and right insets from the side covers that reach the middle of
 * the screen's height, then top and bottom insets from the covers that reach
 * the middle of what is left of its width (FOCUS_COLUMN), or from every top
 * and bottom cover on a portrait screen. The whole screen when nothing covers
 * it, or when what is left is too small to frame in.
 */
export function uncoveredBand(width: number, height: number, covers: readonly Cover[]): Box {
  const whole: Box = { left: 0, top: 0, right: width, bottom: height }
  if (!(width > 0 && height > 0)) return whole
  const midY0 = height * (0.5 - FOCUS_COLUMN / 2)
  const midY1 = height * (0.5 + FOCUS_COLUMN / 2)
  let left = 0
  let right = width
  for (const { edge, box } of covers) {
    if (!overlaps(box.top, box.bottom, midY0, midY1)) continue
    if (edge === 'left') left = Math.max(left, Math.min(width, box.right))
    else if (edge === 'right') right = Math.min(right, Math.max(0, box.left))
  }
  if (right - left < width * MIN_BAND) return whole
  const span = right - left
  const colX0 = left + span * (0.5 - FOCUS_COLUMN / 2)
  const colX1 = left + span * (0.5 + FOCUS_COLUMN / 2)
  const portrait = height >= width
  let top = 0
  let bottom = height
  for (const { edge, box } of covers) {
    if (!portrait && !overlaps(box.left, box.right, colX0, colX1)) continue
    if (edge === 'top') top = Math.max(top, Math.min(height, box.bottom))
    else if (edge === 'bottom') bottom = Math.min(bottom, Math.max(0, box.top))
  }
  if (bottom - top < height * MIN_BAND) return whole
  return { left, top, right, bottom }
}

/**
 * The lens shift that puts the middle of the screen's picture at the middle
 * of `band`, in CSS pixels: the offset of setViewOffset's window. Positive y
 * moves the picture up, positive x moves it left.
 */
export function lensShift(width: number, height: number, band: Box): { x: number; y: number } {
  return {
    x: width / 2 - (band.left + band.right) / 2,
    y: height / 2 - (band.top + band.bottom) / 2,
  }
}

/** Below this many pixels a shift is no shift: the projection goes back to centred. */
export const SHIFT_EPSILON = 0.5

/**
 * One frame of the shift's glide toward `target`, written into `shift`: an
 * exponential ease with time constant `tau` seconds over `dt`, landing
 * exactly once within SHIFT_EPSILON. While `held` (a finger or the mouse is
 * dragging the scene) it does not move at all, whatever the target, so the
 * picture never slides under a drag; it glides to wherever the target is by
 * then once the drag lets go.
 */
export function stepShift(shift: { x: number; y: number }, target: { x: number; y: number }, dt: number, tau: number, held: boolean): void {
  if (held) return
  const k = 1 - Math.exp(-dt / tau)
  shift.x += (target.x - shift.x) * k
  shift.y += (target.y - shift.y) * k
  if (Math.abs(target.x - shift.x) < SHIFT_EPSILON) shift.x = target.x
  if (Math.abs(target.y - shift.y) < SHIFT_EPSILON) shift.y = target.y
}

/**
 * Sets `camera`'s lens shift to `shift` on a `width` by `height` canvas, or
 * clears it when there is none. The window is the canvas itself, moved: the
 * aspect and the scale stay what they were. True when the projection changed.
 */
export function applyLensShift(camera: PerspectiveCamera, width: number, height: number, shift: { x: number; y: number }): boolean {
  const none = Math.abs(shift.x) < SHIFT_EPSILON && Math.abs(shift.y) < SHIFT_EPSILON
  const v = camera.view
  if (none) {
    if (!v || !v.enabled) return false
    camera.clearViewOffset()
    return true
  }
  if (v && v.enabled && v.fullWidth === width && v.fullHeight === height && v.width === width && v.height === height && v.offsetX === shift.x && v.offsetY === shift.y) return false
  camera.setViewOffset(width, height, shift.x, shift.y, width, height)
  return true
}

/**
 * Where the camera's line of sight crosses the screen, in normalised device
 * coordinates: (0, 0) for a centred projection, the shifted middle otherwise.
 * Read off the projection itself (the frustum's off-centre terms), so it is
 * right whoever set the shift. Written into `out` when given, so a frame loop
 * allocates nothing.
 */
export function viewAxisNdc(projection: { elements: ArrayLike<number> }, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const e = projection.elements
  // ndc = (P0 x + P8 z) / -z: on the axis x = 0, so ndc = -P8 at any depth.
  // Adding zero folds the -0 a centred projection gives.
  out.x = -e[8] + 0
  out.y = -e[9] + 0
  return out
}
