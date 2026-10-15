/**
 * avatarLabel.ts: where the name and picture under another avatar go
 * (arkinox, 2026-10-11: "I want it centered exactly under the lowest point of
 * the avatar's bounds").
 *
 * The HUD marker used to hang off the person's raw coordinate, which at the
 * cell scales is a corner of the cell the avatar stands in, not the avatar:
 * the label sat at the cube's bottom edge whatever was drawn there. Now the
 * scene measures the avatar as drawn (its world bounding box, after the shard
 * scale, the spectator shrink and the view's turn), projects the box's eight
 * corners, and the label is centered on the box's middle across the screen
 * and placed under its lowest corner on the screen. A tall shard pushes the
 * label down, a flat one lets it sit close, and the dodecahedron gets the
 * same rule, so nothing special is needed for a default avatar.
 */

/** A box in world space: its two opposite corners. */
export interface Bounds { min: readonly [number, number, number]; max: readonly [number, number, number] }

/** Normalized device coordinates (+y up), or null for a point at or behind the camera. */
export type Project = (p: [number, number, number]) => [number, number] | null

/** Where the label hangs, in normalized device coordinates (+y up). */
export interface LabelAnchor {
  /** The middle of the drawn avatar across the screen. */
  x: number
  /** The middle of the drawn avatar up the screen, where the marker's ring sits. */
  y: number
  /** The lowest point of the drawn avatar on the screen: the label goes just under this. */
  bottom: number
}

/** The eight corners of a box. */
export function boxCorners(b: Bounds): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < 8; i++) {
    out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]])
  }
  return out
}

/**
 * The label's anchor for an avatar drawn inside `b`, from the screen outline
 * of the box's corners; null when the box is empty or any corner is at or
 * behind the camera (the outline then wraps round the view, and the HUD keeps
 * the plain marker).
 */
export function labelAnchor(b: Bounds, project: Project): LabelAnchor | null {
  if (!(b.max[0] >= b.min[0] && b.max[1] >= b.min[1] && b.max[2] >= b.min[2])) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of boxCorners(b)) {
    const p = project(c)
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1])
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, bottom: minY }
}

/** Space between the avatar's lowest point and the top of its label, in pixels. */
export const UNDER_GAP_PX = 4

/**
 * How far below the marker's center (the avatar's middle) the label's top
 * goes, in pixels on a screen `height` tall: just under the avatar's lowest
 * point, and never inside `minPx` (the smallest reticle's radius), so a
 * speck-sized avatar's label does not sit on its ring.
 */
export function labelDrop(a: { y: number; bottom: number }, height: number, minPx = 0): number {
  const below = ((a.y - a.bottom) / 2) * height
  return Math.max(below, minPx) + UNDER_GAP_PX
}
