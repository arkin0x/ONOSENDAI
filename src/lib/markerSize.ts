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
