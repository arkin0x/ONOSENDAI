/**
 * markerSize.ts: markers held at a size on SCREEN, the way WorldLabel holds
 * text at a pixel height (arkinox, 2026-10-15).
 *
 * A hyperjump cube used to be floored at a fixed number of render cells so a
 * stop never shrank to a subpixel. A cell is a different thing on screen at
 * every zoom: at 2^84 the whole of ideaspace is two cells across, the camera
 * sits close to frame it, and the floor drew the selected block and its
 * neighbours as slabs filling the view. The floor is in pixels now: a marker
 * is its true size (one gibson) when that is larger, and otherwise exactly
 * this many pixels, at every zoom and camera distance.
 *
 * Labels are lifted by the same rule, so the gap between a marker and its
 * name is a few pixels whatever the zoom, instead of a constant in cells that
 * read as a gulf at 2^84 and a squeeze at 2^0.
 */

/** Pixels per render unit at one unit of depth, for a perspective camera. */
export function projScaleOf(viewportHeight: number, fovDegrees: number): number {
  return viewportHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360))
}

/** Render units that span `px` CSS pixels at `depth` units from the camera. */
export function cellsForPixels(px: number, depth: number, projScale: number): number {
  return (px * Math.max(depth, 1e-6)) / projScale
}

/** CSS pixels that `cells` render units span at `depth` units from the camera. */
export function pixelsForCells(cells: number, depth: number, projScale: number): number {
  return (cells * projScale) / Math.max(depth, 1e-6)
}

/** A marker's edge in render units: its true size, never smaller on screen than `minPx`. */
export function markerSide(trueSide: number, minPx: number, depth: number, projScale: number): number {
  return Math.max(trueSide, cellsForPixels(minPx, depth, projScale))
}

/**
 * How far above a cube's centre its top can reach on screen, as a fraction of
 * its edge: half the space diagonal, √3/2, for a cube turned any way. A label
 * lifted this far never sits on the cube however it spins or is viewed.
 */
export const CUBE_REACH = Math.sqrt(3) / 2

/** On-screen edge of a fleet (nearby) stop cube and of the NEAREST cube, in CSS pixels. */
export const FLEET_CUBE_PX = 10
/** On-screen edge of the viewed or destination stop cube: larger, never dominant. */
export const DEST_CUBE_PX = 16
/** Gap between the top of a marker and the bottom of its label, in CSS pixels. */
export const LABEL_GAP_PX = 4

/**
 * How far above a marker's centre its label's centre sits, in CSS pixels: the
 * marker's on-screen reach plus a gap plus half the label's own height.
 */
export function labelLiftPx(trueSide: number, minPx: number, depth: number, projScale: number, labelPx: number): number {
  const sidePx = Math.max(pixelsForCells(trueSide, depth, projScale), minPx)
  return sidePx * CUBE_REACH + LABEL_GAP_PX + labelPx / 2
}

/**
 * How large a hidden item's mark is drawn at `depth` from the camera, as a
 * share of its full size (arkinox, 2026-10-25: "the chest marker does not
 * scale with distance. it needs to. its too large at large distances").
 *
 * A mark held at a constant pixel size reads the same at your feet and at the
 * far end of a corridor in WALK, so a chest twenty gibsons off stood as large
 * as one in reach and said nothing about where it was. Out to `reach` the
 * mark is its full size; past it the mark keeps its perspective, shrinking as
 * reach over depth, down to `floor`, so it never vanishes.
 *
 * `reach` is the headlamp's (scene/headlamp.ts): the camera's distance from
 * what it orbits, in render cells, held between 8 and the orbit's limit. It
 * is in cells at the current 2^N, so the rule keeps its shape at every zoom:
 * in orbit everything about the focus is at full size and only what stands
 * behind it recedes; in WALK, whose eye is on the avatar, the reach is 8
 * cells and a mark further down the hall shrinks as the walls do.
 */
export function recedeShare(depth: number, reach: number, floor: number): number {
  if (!(depth > reach) || !(reach > 0)) return 1
  return Math.max(floor, Math.min(1, reach / depth))
}

/**
 * The least share a mark (the cube, a model's floor, the music note) recedes
 * to: the note's 24.5 px cube stands about 10 px far off, the size of a fleet
 * stop cube (FLEET_CUBE_PX), still a box and still something to look at.
 */
export const MARK_RECEDE_FLOOR = 0.4

/**
 * How much of a mark's label is shown at `depth`, from 1 to 0: whole out to
 * `from` times the reach, gone at `to` times it, eased between (smoothstep).
 *
 * A label never shrinks with its mark: text much under its size stops being
 * text, and a hall of hidden things became a hall of smudges (review of
 * #518). It holds its size while it is shown and fades out far off instead,
 * the credit line first (CREDIT_FADE), then the name (NAME_FADE), so a far
 * chest is its small mark alone and the words are one step closer.
 */
export function fadeShare(depth: number, reach: number, from: number, to: number): number {
  if (!(reach > 0) || !(depth > reach * from)) return 1
  if (depth >= reach * to) return 0
  const t = (depth - reach * from) / (reach * (to - from))
  return 1 - t * t * (3 - 2 * t)
}

/** A credit line ("who left it") fades between these multiples of the reach: gone past twice it. */
export const CREDIT_FADE = [1.5, 2] as const

/** A mark's name fades between these multiples of the reach: gone past three times it, after its credit. */
export const NAME_FADE = [2.25, 3] as const
