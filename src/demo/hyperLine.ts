/**
 * hyperLine.ts: the line the /demo hyperspace chapter draws (arkinox,
 * 2026-10-15). From a random block it runs station to station, block after
 * block, and turns around at block 0 or the newest block it knows.
 *
 * Only the stations of the plane on show are visited, as the stop field
 * draws only that plane's stops (StopField's plane filter): in the
 * ideaspace view these are the ports, and a landfall between two ports is
 * passed over. Positions come from the stops themselves (stopFromAnchor,
 * stopPosition); nothing here recomputes station math.
 *
 * The blocks are the line the app has synced, when it has; otherwise the
 * 200 real blocks bundled in tourBlocks.ts, so the chapter works offline.
 */

import type { Stop } from '../lib/hyperspace/stops'
import { stopFromAnchor } from '../lib/hyperspace/stops'
import { getStopByHeight, getStopIndex, useHyperspace } from '../store/useHyperspace'
import { TOUR_BLOCKS } from './tourBlocks'

/** Where the line is and which way it runs. */
export interface LineWalk {
  height: number
  dir: 1 | -1
}

/** One block on, turning around at `lo` or `hi` (both inclusive). */
export function stepLine(walk: LineWalk, lo: number, hi: number): LineWalk {
  if (hi <= lo) return { height: lo, dir: walk.dir }
  let dir = walk.dir
  let next = walk.height + dir
  if (next > hi || next < lo) {
    dir = dir === 1 ? -1 : 1
    next = walk.height + dir
  }
  return { height: next, dir }
}

/**
 * The next block from `walk` whose station is in the plane on show
 * (`isStation`), stepping and turning as stepLine does, never the station
 * it starts from; null when no other block in the range qualifies. Gives
 * up after one full lap of the range.
 */
export function nextStation(walk: LineWalk, lo: number, hi: number, isStation: (height: number) => boolean): LineWalk | null {
  let w = walk
  const lap = 2 * Math.max(1, hi - lo + 1)
  for (let i = 0; i < lap; i++) {
    w = stepLine(w, lo, hi)
    // Turning around past the last station leads back to it: go on to the one after.
    if (w.height !== walk.height && isStation(w.height)) return w
  }
  return null
}

/** The blocks the line runs over. */
export interface LineSource {
  lo: number
  hi: number
  stop: (height: number) => Stop | undefined
  /** Whether these are the app's synced line or the bundled blocks. */
  bundled: boolean
}

let bundledStops: Map<number, Stop> | null = null

/** The bundled blocks as stops, through the anchor parser (C = merkle root, H = block hash). */
function bundled(): Map<number, Stop> {
  if (bundledStops) return bundledStops
  bundledStops = new Map()
  for (const [height, merkle, hash] of TOUR_BLOCKS) {
    const stop = stopFromAnchor({ kind: 321, tags: [['B', String(height)], ['C', merkle], ['H', hash]] })
    if (stop) bundledStops.set(height, stop)
  }
  return bundledStops
}

/** The synced line when the app has finished syncing it, else the bundled blocks. */
export function lineSource(): LineSource {
  const hs = useHyperspace.getState()
  if (hs.sync.status === 'ready' && hs.tipHeight !== null && getStopIndex().permCount > 0) {
    return { lo: 0, hi: hs.tipHeight, stop: getStopByHeight, bundled: false }
  }
  const map = bundled()
  return { lo: TOUR_BLOCKS[0][0], hi: TOUR_BLOCKS[TOUR_BLOCKS.length - 1][0], stop: (h) => map.get(h), bundled: true }
}
