/**
 * destination.ts: setting and clearing the ride destination, said the same
 * way from everywhere (arkinox, 2026-10-15).
 *
 * A destination is set once and stays until it is cleared: scrubbing to, or
 * viewing, another block changes nothing, and a second SET is refused with
 * the block that is set. Every path that sets one (the scrubber's SET
 * DESTINATION, the spectated station's, GOAL's SET, a tap on a stop in the
 * scene) goes through setRideDestination, so each confirms with the same
 * toast.
 */

import { useHyperspace } from './useHyperspace'
import { BRIEF_TOAST_MS, useToast } from './useToast'

/** What the confirmation says under its title. */
export const DESTINATION_SET_META = 'Board and RIDE in the HYPERSPACE panel.'

/**
 * Make `height` the ride destination, when none is set, and say so. Returns
 * whether it is now the destination (true also when it already was). A
 * different destination already set is kept, and the toast says to clear it
 * first, unless `quiet` (a scene tap, which only flies to the stop then).
 */
export function setRideDestination(height: number, opts: { meta?: string; quiet?: boolean } = {}): boolean {
  const current = useHyperspace.getState().destination
  if (current === height) {
    if (!opts.quiet) announce(height, opts.meta)
    return true
  }
  if (current !== null) {
    if (!opts.quiet) {
      useToast.getState().show({ label: `Destination is block ${current}`, meta: 'Clear it first to set another.', mark: 'goal', ms: BRIEF_TOAST_MS })
    }
    return false
  }
  useHyperspace.getState().setDestination(height)
  announce(height, opts.meta)
  return true
}

/** CLEAR DESTINATION. */
export function clearRideDestination(): void {
  useHyperspace.getState().setDestination(null)
}

function announce(height: number, meta?: string): void {
  useToast.getState().show({ label: `Destination: block ${height}`, meta: meta ?? DESTINATION_SET_META, mark: 'goal', ms: BRIEF_TOAST_MS })
}
