/**
 * gridSize.ts: stepping GRID SIZE (arkinox, 2026-10-31: "the extent seems to be limited at 64
 * but I don't see any reason for that").
 *
 * The grid can reach MAX_EXTENT units a side (4,096 since 2026-11-23, sno-core,
 * DECK-0003 §1.8), and one
 * unit a press would take far too long. So the stepper counts in ones to 64, as
 * it always has, and past that in sixteenths of the current power of two: 64,
 * 68, 72 ... 128, 136 ... Holding the key runs from 64 to the top in seconds,
 * every stop is a round number you can step back to, and the whole hold is one
 * undo step (store setExtent). What the bench's camera needs to see a grid
 * that size is benchReach.ts (gridSphere).
 */
import { MAX_EXTENT, MIN_EXTENT } from 'sno-core/shards'

/** Below this the stepper counts in ones, as it always has. */
const ONES_UP_TO = 64
/** Stops per doubling past that. */
const STOPS_PER_DOUBLING = 16

/** The size of one step for a grid of `extent`. */
function stepAt(extent: number): number {
  if (extent < ONES_UP_TO) return 1
  return 2 ** Math.floor(Math.log2(extent)) / STOPS_PER_DOUBLING
}

/** The next GRID SIZE, larger for +1 and smaller for -1, on the stops and held at the ends. */
export function stepExtent(extent: number, dir: 1 | -1): number {
  // Going down, the step is the one for the stop below: from 128 that is 124, not 120.
  const step = stepAt(dir > 0 ? extent : extent - 1)
  const next = dir > 0 ? (Math.floor(extent / step) + 1) * step : (Math.ceil(extent / step) - 1) * step
  return Math.max(MIN_EXTENT, Math.min(MAX_EXTENT, next))
}
