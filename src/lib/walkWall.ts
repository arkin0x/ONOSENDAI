/**
 * walkWall.ts: which one of WALK's striped boxes is drawn.
 *
 * You stand inside every box of the nest at once, so striping all of them
 * put three sets of walls on top of each other (arkinox, 2026-10-13). Only
 * one is drawn: the one most relevant to where you are walking.
 *
 * | Rule | Box |
 * |---|---|
 * | A box's nearest face is within WALL_NEAR_CELLS of the eye | the highest such box: the hardest wall you are about to meet |
 * | None is | the second smallest, or the only one when one is drawn; the smallest hugs you at every step and says nothing |
 *
 * Hysteresis keeps it from flickering as you walk along a face: the box on
 * show stays until its nearest face is beyond WALL_KEEP_CELLS, and a higher
 * box takes over as soon as it qualifies, since a harder wall coming up is
 * the reason to switch at all.
 *
 * Distances are in render cells, in the frame the boxes and the eye share.
 */

/** A box as drawn: its height, its lowest corner and its size, in render cells. */
export interface WallBox {
  height: number
  min: readonly [number, number, number]
  size: readonly [number, number, number]
}

/** A box qualifies while its nearest face is this close to the eye, in cells. */
export const WALL_NEAR_CELLS = 10
/** The box on show is kept until its nearest face is farther than this. */
export const WALL_KEEP_CELLS = 12

/**
 * How far the eye is from the box's nearest face. Inside, the distance to the
 * closest of the six faces; outside, the straight distance to the box.
 */
export function nearestFace(box: WallBox, eye: readonly [number, number, number]): number {
  let inside = true
  let inner = Infinity
  let outer = 0
  for (let i = 0; i < 3; i++) {
    const lo = box.min[i], hi = box.min[i] + box.size[i], p = eye[i]
    if (p < lo || p > hi) {
      inside = false
      const d = p < lo ? lo - p : p - hi
      outer += d * d
    } else {
      inner = Math.min(inner, p - lo, hi - p)
    }
  }
  return inside ? inner : Math.sqrt(outer)
}

/**
 * The height of the box to draw, or null when there are none. `current` is
 * the height on show last frame, for the hysteresis.
 */
export function pickWall(boxes: readonly WallBox[], eye: readonly [number, number, number], current: number | null): number | null {
  if (boxes.length === 0) return null
  const byHeight = [...boxes].sort((a, b) => a.height - b.height)
  let best: WallBox | null = null
  for (const b of byHeight) if (nearestFace(b, eye) <= WALL_NEAR_CELLS) best = b
  const shown = current === null ? undefined : byHeight.find((b) => b.height === current)
  // A harder wall coming within reach takes over at once.
  if (best && (!shown || best.height > shown.height)) return best.height
  // The one on show holds until it is well out of reach.
  if (shown && nearestFace(shown, eye) <= WALL_KEEP_CELLS) return shown.height
  if (best) return best.height
  return (byHeight[1] ?? byHeight[0]).height
}
