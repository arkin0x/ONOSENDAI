/**
 * markerClear.ts - where an off-screen target's chevron stands, clear of the
 * menu and the other overlays over the scene.
 *
 * A chevron slides from the middle of the picture along the target's true
 * bearing until it meets the screen's inset edge (hud/Targets.tsx). With the
 * menu open beside the scene that edge is under the panels, and the markers
 * drew over the TARGETS rows and the buttons (owner, 2026-11-23: "can we make
 * these target markers not go over the menus?"). So the slide also stops at
 * the first overlay it would run into: the chevron keeps its bearing and
 * stands just outside the panel, in the part of the screen the HUD leaves
 * uncovered. A left column that covers only the top of the left edge stops
 * the markers heading up and left at its side or its foot; one heading down
 * and left passes under it to the screen's edge. An edge covered from end to
 * end puts every marker heading that way along the panel's inner side.
 *
 * The overlays are the ones BUILD's framing measures (hooks/useCover.ts:
 * the menu's columns beside the scene, the tour card, the BUILD bar), so
 * the markers and the framing agree on what is covered; all but the pad and
 * the deploy bar docked beside it, which fold or narrow with every tap on
 * the scene and would make the markers jump (hooks/useCover CoverOptions). A marker's whole
 * drawing is kept clear, the name and distance as well as the chevron: the
 * cover is grown by how far the drawing reaches from the marker's point, and
 * the point is kept out of the grown box. Pure functions, so the geometry
 * can be asserted without a browser.
 */

import type { Box } from './coverBand'

/**
 * How far a marker's drawing reaches from its point, in CSS pixels: left and
 * top are zero or negative, right and bottom zero or positive.
 */
export interface Reach { left: number; top: number; right: number; bottom: number }

/** The box a marker with `reach` takes with its point at (x, y). */
export function markerBox(x: number, y: number, reach: Reach): Box {
  return { left: x + reach.left, top: y + reach.top, right: x + reach.right, bottom: y + reach.bottom }
}

/** Whether two boxes share any area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** Whether (x, y) is strictly inside `b`. */
function inside(x: number, y: number, b: Box): boolean {
  return x > b.left && x < b.right && y > b.top && y < b.bottom
}

/**
 * Whether the picture's middle (x, y) is inside `b` or on its edge: a ray
 * from a point on the edge enters at once, so the marker would stand on the
 * middle of the picture.
 */
function holds(x: number, y: number, b: Box): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

/**
 * Where a marker's point may not stand without its drawing (`reach` about
 * the point) touching `cover`: the cover grown by the reach.
 */
export function keepOut(cover: Box, reach: Reach): Box {
  return { left: cover.left - reach.right, top: cover.top - reach.bottom, right: cover.right - reach.left, bottom: cover.bottom - reach.top }
}

/**
 * How far along the ray from (x0, y0) by (dx, dy) it first enters `b`, as a
 * multiple of (dx, dy); Infinity when it never does. Only for a ray that
 * starts outside `b`.
 */
function entry(x0: number, y0: number, dx: number, dy: number, b: Box): number {
  let t0 = 0
  let t1 = Infinity
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o > lo && o < hi
    let a = (lo - o) / d
    let z = (hi - o) / d
    if (a > z) { const s = a; a = z; z = s }
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, z)
    return t0 < t1
  }
  if (!slab(x0, dx, b.left, b.right)) return Infinity
  if (!slab(y0, dy, b.top, b.bottom)) return Infinity
  return t0
}

/** How far short of a cover the chevron stops, in pixels, so it never touches. */
export const COVER_GAP = 0.5

/** One marker's placement: where its point stands and which way its chevron turns. */
export interface EdgePlace { x: number; y: number; angle: number }

/**
 * Where an off-screen marker stands on a `width` by `height` screen: from the
 * picture's middle (cx, cy) toward the target's screen point (x, y), as far
 * as the frame `inset` in from the edge, or as far as the first of `covers`
 * the marker's drawing (`reach`) would touch, whichever comes first.
 *
 * A cover whose grown box already holds the picture's middle cannot be kept
 * clear along any bearing with the whole drawing; it is tried again with the
 * chevron alone (`chevron`), so the arrow still stands beside it and only
 * the name runs under, and left out when even that cannot be clear. Those
 * markers are under the overlay, which draws over them (styles.css).
 *
 * Also for a target on screen whose point is under a cover (hiddenByCover): the
 * slide meets that cover's side before it reaches the point, so the marker
 * stands at the panel's edge, pointing in at what it hides.
 */
export function edgePlace(
  width: number, height: number,
  cx: number, cy: number,
  x: number, y: number,
  inset: number,
  covers: readonly Box[],
  reach: Reach,
  chevron: Reach,
): EdgePlace {
  const dx = x - cx
  const dy = y - cy
  const angle = Math.atan2(dy, dx)
  // How far the frame's inset edge is from the middle, the way the line goes.
  const reachX = dx >= 0 ? width - inset - cx : cx - inset
  const reachY = dy >= 0 ? height - inset - cy : cy - inset
  let t = Math.max(0, Math.min(
    reachX / Math.max(Math.abs(dx), 1e-6),
    reachY / Math.max(Math.abs(dy), 1e-6),
  ))
  const len = Math.hypot(dx, dy)
  if (len > 1e-6) {
    for (const cover of covers) {
      let out = keepOut(cover, reach)
      if (holds(cx, cy, out)) out = keepOut(cover, chevron)
      if (holds(cx, cy, out)) continue
      const at = entry(cx, cy, dx, dy, out)
      if (at < t) t = Math.max(0, at - COVER_GAP / len)
    }
  }
  return { x: cx + dx * t, y: cy + dy * t, angle }
}

/**
 * Whether a target on screen at (x, y) is hidden by one of `covers` that a
 * chevron can stand beside: under it, with the picture's middle (cx, cy)
 * outside the box the chevron (`chevron`) must keep out of. Such a target is
 * pointed at from the cover's edge (edgePlace) rather than drawn under it.
 * `margin` grows each cover for the test, so a target already pointed at
 * from a panel stays so until it is that far clear of it.
 */
export function hiddenByCover(x: number, y: number, cx: number, cy: number, covers: readonly Box[], chevron: Reach, margin = 0): boolean {
  for (const c of covers) {
    const under = x > c.left - margin && x < c.right + margin && y > c.top - margin && y < c.bottom + margin
    if (under && !holds(cx, cy, keepOut(c, chevron))) return true
  }
  return false
}
