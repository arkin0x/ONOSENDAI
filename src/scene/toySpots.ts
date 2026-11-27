/**
 * toySpots.ts - where each prize toy stands this frame, in the TERRAIN
 * field's frame (scene/PrizeToys.tsx writes them), so a tap can pick a toy
 * before it mines (scene/TerrainLayer.tsx) without the blocks' layer
 * loading the toys' drawing.
 */

import { Vector3 } from 'three'

/** The toy's size, in gibsons across. */
export const TOY_SIDE = 0.62

/** Where each toy stands now, in the field's frame, for taps and walking (terrain input asks pickToy). */
export const spots = new Map<string, Vector3>()
/** Each toy's colour and name, for its flight to ITEMS. */
export const looks = new Map<string, { colour: string; name: string }>()
/**
 * The toy a ray (the field's frame) meets first within `before` gibsons, or
 * null: TERRAIN asks this before a tap mines (scene/TerrainLayer.tsx Marks).
 */
export function pickToy(from: Vector3, dir: Vector3, before: number): string | null {
  let best: string | null = null, bestT = before
  const d = dir.clone().normalize()
  const v = new Vector3()
  for (const [key, at] of spots) {
    v.copy(at).sub(from)
    const t = v.dot(d)
    if (t < 0 || t > bestT) continue
    const miss = v.addScaledVector(d, -t).length()
    if (miss <= TOY_SIDE * 0.75) { best = key; bestT = t }
  }
  return best
}

