/**
 * walkGate.ts: how strongly something drawn near the WALK camera may show.
 *
 * In WALK the camera is inside your avatar, and two things are drawn at your
 * chain's real head while it catches up: the outline of you standing there
 * (lib/walkGhost.ts) and the box lit round it (scene/CrossingFlash.tsx). A
 * step lands one cell away and the walk's eye glides through that cell, so
 * for a few milliseconds after a press, and again as the chain catches up,
 * either one was right in front of the eye or around it (arkinox,
 * 2026-10-13). Gated on distance from the eye, they are never seen there:
 *
 * | Distance from the eye, in render cells | Shown |
 * |---|---|
 * | under GATE_HIDE (0.6) | not at all |
 * | GATE_HIDE to GATE_FULL (1.0) | eased in |
 * | GATE_FULL and beyond | fully |
 *
 * A box is measured to its nearest point, so the eye inside one is at 0.
 */

/** Closer than this to the eye, in render cells, nothing gated is drawn. */
export const GATE_HIDE = 0.6
/** From this far out it is drawn at full strength. */
export const GATE_FULL = 1.0

/** The gate's strength, 0 to 1, at `distance` render cells from the eye. */
export function nearGate(distance: number): number {
  if (!(distance > GATE_HIDE)) return 0
  if (distance >= GATE_FULL) return 1
  const t = (distance - GATE_HIDE) / (GATE_FULL - GATE_HIDE)
  return t * t * (3 - 2 * t)
}

type Vec3 = readonly [number, number, number]

/** Distance from `p` to the nearest point of the box `centre` ± `size` / 2; 0 inside it. */
export function boxDistance(p: Vec3, centre: Vec3, size: Vec3): number {
  let sum = 0
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(p[i] - centre[i]) - size[i] / 2
    if (d > 0) sum += d * d
  }
  return Math.sqrt(sum)
}
