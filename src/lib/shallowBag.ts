/**
 * shallowBag.ts: a bag any view finds on its own (arkinox, 2026-10-19: "i
 * think when hiding a bag we need a clear warning if the depth is <13").
 *
 * Discovery computes every height from 0 to SCAN_MAX_HEIGHT where a view's
 * anchor stops (hooks/useDiscovery.ts): standing there, a spectated action or
 * a chain stop, VIEW, a pin or a shared link, and soon every avatar Cyberspace
 * TV shows. A bag at those heights is found by whoever's view stops inside its
 * region; a chest in it is found, and still opens only to its key or person.
 * Past SCAN_MAX_HEIGHT only someone who computes the region finds it. The
 * warning warns and never blocks: a shallow bag can be the point.
 *
 * The UI calls the setting height (DeployBar, HIDE AT HEIGHT), so this does.
 */

import { SCAN_MAX_HEIGHT } from '../store/useShards'

/** Whether discovery finds a bag hidden at this height without being asked. */
export function shallowBag(height: number): boolean {
  return height <= SCAN_MAX_HEIGHT
}

/** The warning's line: short, in view, wherever a shallow bag is decided. */
export const SHALLOW_WARN = '⚠ ANYONE VIEWING HERE CAN FIND THIS'

/**
 * Its explanation, the tooltip. `localMax` is the highest key this machine
 * computes itself (DeployBar inputs.localMax): when that is a height discovery
 * already reaches, going deeper means HOSAKA, and the advice says so.
 */
export function shallowExplain(localMax: number): string {
  const deeper = `Hide at height ${SCAN_MAX_HEIGHT + 1} or more to keep it from them${localMax <= SCAN_MAX_HEIGHT ? '; on this device that needs HOSAKA' : ''}.`
  return `At height ${SCAN_MAX_HEIGHT} or less, any view that stops inside its region finds it: standing there, spectating or walking a chain, VIEW, or Cyberspace TV. ${deeper}`
}
