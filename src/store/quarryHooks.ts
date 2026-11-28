/**
 * quarryHooks.ts - where TERRAIN (store/useTerrain.ts) hands a Quarry Charge
 * to its store (store/useQuarry.ts), which sets these. A module of its own
 * with nothing imported, so the two stores load in either order: useTerrain
 * never imports useQuarry, and neither waits on the other to exist.
 *
 * `arm` arms one in a cell (cs offsets) and says whether it did; `chargeAt`
 * says whether one is armed there; `fieldReady` hears each field once what
 * it kept is read (its owner and database).
 */

import type { TerrainSession } from './useTerrain'

export const quarryHooks: {
  arm: ((cell: readonly [number, number, number]) => boolean) | null
  chargeAt: ((cell: readonly [number, number, number]) => boolean) | null
  fieldReady: Array<(s: TerrainSession) => void>
} = { arm: null, chargeAt: null, fieldReady: [] }
