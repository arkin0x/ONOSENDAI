/**
 * gridSize.ts: stepping GRID SIZE, and what the bench's camera needs to see a
 * grid that size (arkinox, 2026-10-31: "the extent seems to be limited at 64
 * but I don't see any reason for that").
 *
 * The grid can reach MAX_EXTENT units a side (sno-core, DECK-0003 §1.8), and one
 * unit a press would take far too long. So the stepper counts in ones to 64, as
 * it always has, and past that in sixteenths of the current power of two: 64,
 * 68, 72 ... 128, 136 ... Holding the key runs from 64 to the top in seconds,
 * every stop is a round number you can step back to, and the whole hold is one
 * undo step (store setExtent).
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

/** What the bench camera allowed before the grid could grow past it: never less than this, so small work feels the same. */
const MAX_DISTANCE_MIN = 60
const FAR_MIN = 200
/** The nearest the bench draws, in units: 0.05 of a gibson, for close work. */
export const BENCH_NEAR = 0.05
/**
 * Near plane to camera distance. A depth buffer has 24 bits, spent mostly near
 * the near plane, so at 0.05 a camera 100,000 units out cannot tell faces 10,000
 * units apart. Within 200 units this leaves the near plane exactly where it was.
 */
const NEAR_FRACTION = 1 / 4000

/**
 * How far the bench's orbit may dolly and how far it draws, for a grid of
 * `extent`. The whole grid fits the view at the far end: its corner on the floor
 * is extent x sqrt 2 from the centre, and at fifty degrees of field that wants
 * 3.35 times the extent; 3.5 leaves a little room. Below an extent of 18 this
 * is the 60 and the 200 the bench has always had.
 */
export function benchReach(extent: number): { maxDistance: number; far: number } {
  const maxDistance = Math.max(MAX_DISTANCE_MIN, Math.ceil(extent * 3.5))
  return { maxDistance, far: Math.max(FAR_MIN, Math.ceil(maxDistance + 2 * Math.sqrt(3) * extent)) }
}

/** The near plane for a camera this far from what it orbits. */
export function benchNear(distance: number): number {
  return Math.max(BENCH_NEAR, distance * NEAR_FRACTION)
}

/** True when moving the near plane from `from` to `to` is worth a new projection: under a tenth of a change is left alone, so a zoom does not rebuild it every frame. */
export function nearMoved(from: number, to: number): boolean {
  return Math.abs(to - from) > from * 0.1
}
