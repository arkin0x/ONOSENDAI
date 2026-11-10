/**
 * seedClock.ts - a seed's clock: the clock height, and its planted height
 * after the clamp, with the headers it needs fetched as it goes.
 *
 * The clock height is the tip of ONOSENDAI's Bitcoin line minus 6 (DECK-0008
 * §4.1). The effective planted height reads header times (§4.2): the median
 * time past at the clock, then the times around the seed's own `created_at`
 * found by galloping down from the clock and bisecting (sno-core
 * effectivePlantedHeight). Each pass that meets a header this page lacks
 * says which; the headers a pass is about to need are mostly predictable, so
 * they are asked for in one batch first, and what is still missing is asked
 * for a window at a time. A header nobody has leaves the seed pending,
 * "waiting for blocks", and it draws as its axiom until then (§4.2).
 */

import { clockHeight, effectivePlantedHeight, type PlantedHeight } from 'sno-core/seeds'
import type { HeaderBook } from './headerBook'

export { clockHeight }

/** What a pass of the clamp says about a seed's planted height. */
export type PlantedState = PlantedHeight & {
  /** Set when it is pending because a header is missing and could not be found (not merely unsettled yet). */
  waiting?: true
}

/** Fetches the headers at these heights into the book, from wherever this page gets them. */
export type HeaderFetch = (heights: number[]) => Promise<void>

/**
 * The heights a pass of the clamp will read for a seed planted near
 * `planted`, at `clock`: the median time past window at the clock, the
 * windows of the gallop down from it as far as the planted height, and the
 * blocks around the planted height where E and F lie. A prediction only:
 * whatever else a pass needs it asks for.
 */
export function predictedHeights(planted: number, clock: number): number[] {
  const out = new Set<number>()
  const window = (top: number): void => { for (let h = top - 10; h <= top; h++) if (h >= 0) out.add(h) }
  window(clock)
  for (let step = 1; clock - step >= Math.max(10, planted - 300); step *= 2) window(clock - step)
  for (let h = planted - 30; h <= Math.min(clock, planted + 30); h++) if (h >= 0) out.add(h)
  return [...out].sort((a, b) => a - b)
}

/** The most fetches one call of `settlePlanted` makes before it leaves the seed pending for now. */
export const SETTLE_ROUNDS = 12

/**
 * The effective planted height of a seed at `clock`, fetching the headers it
 * needs into `book` (at most SETTLE_ROUNDS fetches). A header asked for and
 * not found leaves it `pending` with `waiting` set.
 */
export async function settlePlanted(stated: number, createdAt: number, clock: number, book: HeaderBook, fetch: HeaderFetch): Promise<PlantedState> {
  const time = (h: number): number | undefined => book.time(h)
  let result: PlantedState = effectivePlantedHeight(stated, createdAt, clock, time)
  if (result.state !== 'pending' || result.missingHeader === undefined) return result
  await fetch(predictedHeights(stated, clock))
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    result = effectivePlantedHeight(stated, createdAt, clock, time)
    if (result.state !== 'pending' || result.missingHeader === undefined) return result
    const missing = result.missingHeader
    if (book.isAbsent(missing)) return { ...result, waiting: true }
    const window: number[] = []
    for (let h = missing - 20; h <= Math.min(clock, missing + 2); h++) if (h >= 0) window.push(h)
    await fetch(window)
    if (!book.has(missing)) return { ...result, waiting: true }
  }
  return effectivePlantedHeight(stated, createdAt, clock, time)
}
