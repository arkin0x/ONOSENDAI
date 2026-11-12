/**
 * seedClock.ts - a seed's clock: the clock height, and its planted height
 * after the clamp, with the headers it needs fetched as it goes.
 *
 * The clock height is NTH's newest anchor this page holds, which is already
 * 6 blocks deep (clockAtAnchor, DECK-0008 §4.1). The effective planted height
 * reads header times (§4.2): the median
 * time past at the clock, then the times around the seed's own `created_at`
 * found by galloping down from the clock and bisecting (sno-core
 * effectivePlantedHeight). Each pass that meets a header this page lacks
 * says which; the headers a pass is about to need are mostly predictable, so
 * they are asked for in one batch first, and what is still missing is asked
 * for a window at a time. A header nobody has leaves the seed pending,
 * "waiting for blocks", and it draws as its axiom until then (§4.2).
 */

import { effectivePlantedHeight, type PlantedHeight } from 'sno-core/seeds'
import type { HeaderBook } from './headerBook'

/**
 * The clock height (DECK-0008 §4.1) from the height of NTH's newest anchor
 * this page holds. §4.1 reads the best chain's tip minus 6, so that the clock
 * block is at least 6 deep. NTH publishes block h only once the tip it reads
 * from mempool.space is at h + 6 or higher (nth src/index.ts, the
 * confirmation gate, NTH_CONFIRMATIONS = 6), so its newest anchor is already
 * the tip minus 6 or deeper: it is the clock block itself. Taking 6 more
 * would plant and grow seeds 12 blocks behind the network.
 *
 * sno-core clockHeight (the tip minus 6) is for a reader that sees the real
 * tip. ONOSENDAI's seeds never do: the trusted tip is NTH's newest verified
 * anchor (HeaderBook top, which counts only headers from NTH-signed anchors,
 * never the blobs), so the clock block's own header is always in the book,
 * and every block up to the clock is one the book can hold. Before NTH has
 * answered, SEED's preview and its hide height fall back to the stop index's
 * tip (bloomReach.ts, SeedCompose), which any key's kind 321 can fill; that
 * only changes the preview's weather, never a planted height or a bloom.
 */
export function clockAtAnchor(anchorHeight: number): number {
  return anchorHeight
}

/** What a pass of the clamp says about a seed's planted height. */
export type PlantedState = PlantedHeight & {
  /** Set when it is pending because a header is missing and could not be found (not merely unsettled yet). */
  waiting?: true
}

/** Fetches the headers at these heights into the book, from wherever this page gets them. */
export type HeaderFetch = (heights: number[]) => Promise<void>

/**
 * The heights a pass of the clamp will read for a seed whose `created_at`
 * lies near height `near`, at `clock`: the median time past window at the
 * clock, the windows of the gallop down from it as far as `near`, and the
 * blocks around `near` where E and F lie. A prediction only: whatever else a
 * pass needs it asks for.
 */
export function predictedHeights(near: number, clock: number): number[] {
  const out = new Set<number>()
  const window = (top: number): void => { for (let h = top - 10; h <= top; h++) if (h >= 0) out.add(h) }
  window(clock)
  for (let step = 1; clock - step >= Math.max(10, near - 300); step *= 2) window(clock - step)
  for (let h = near - 30; h <= Math.min(clock, near + 30); h++) if (h >= 0) out.add(h)
  return [...out].sort((a, b) => a - b)
}

/**
 * About the height whose header time is `t`, from the clock's own header and
 * ten minutes a block. Where E and F will be found (§4.2) depends on the
 * seed's `created_at`, never on the `planted` its planter wrote, so a seed
 * that states an absurd height makes this client fetch nothing for it.
 */
export function heightNear(t: number, clock: number, book: Pick<HeaderBook, 'time'>): number {
  const top = book.time(clock)
  if (top === undefined) return clock
  return Math.max(0, Math.min(clock, clock - Math.round((top - t) / 600)))
}

/** The most fetches one call of `settlePlanted` makes before it leaves the seed pending for now. */
export const SETTLE_ROUNDS = 12

/**
 * The effective planted height of a seed at `clock`, fetching the headers it
 * needs into `book` (at most SETTLE_ROUNDS fetches a clock). A header asked
 * for and not found leaves it `pending` with `waiting` set, unless the seed
 * can be judged below the run of missing headers (settlePlanted).
 */
export async function settlePlanted(stated: number, createdAt: number, clock: number, book: HeaderBook, fetch: HeaderFetch): Promise<PlantedState> {
  let result = await settleAt(stated, createdAt, clock, book, fetch)
  for (let gaps = 0; gaps < GAPS_CROSSED && result.state === 'pending' && result.waiting && result.missingHeader !== undefined; gaps++) {
    const bottom = await gapBottom(result.missingHeader, book, fetch)
    if (bottom === null) return result
    const lower = await settleAt(stated, createdAt, bottom, book, fetch)
    // Settled at the lower clock: its E and F are those of every later clock (§4.2), so they stand.
    if (lower.state !== 'pending') return lower
    // Not settled there: the seed is younger than the gap, and needs the headers in it.
    if (!lower.waiting) return result
    result = lower
  }
  return result
}

/**
 * How many runs of missing headers settlePlanted looks beneath. Blocks
 * 975,227 to 975,255 are one today: the header blobs end at 975,226 and NTH's
 * anchors carry their `header` tag from 975,256 on.
 */
export const GAPS_CROSSED = 3
/** The longest run of missing headers looked across, in blocks. */
export const GAP_SPAN = 400

/**
 * Why a seed can be judged below a gap (§4.2). It is settled at clock `c` once
 * MTP(c) > created_at + 7200; from then on no block above `c` can have a header
 * time at or below created_at + 7200, so E and F found at `c` are the ones a
 * reader holding every header finds at any later clock, the real one
 * included. The headers in the gap are then not needed: nothing in it can be
 * E or F. Judged at the highest clock below the gap that the reader holds,
 * with sno-core's own effectivePlantedHeight, nothing is stepped over.
 */
async function gapBottom(missing: number, book: HeaderBook, fetch: HeaderFetch): Promise<number | null> {
  let h = missing
  for (let i = 0; i < GAP_SPAN && h > 10; i++, h--) {
    if (book.has(h)) return h
    if (book.isAbsent(h)) continue
    const window: number[] = []
    for (let k = Math.max(0, h - 40); k <= h; k++) window.push(k)
    await fetch(window)
    if (book.has(h)) return h
    // Neither held nor known to be absent: no answer either way, so nothing is judged.
    if (!book.isAbsent(h)) return null
  }
  return null
}

async function settleAt(stated: number, createdAt: number, clock: number, book: HeaderBook, fetch: HeaderFetch): Promise<PlantedState> {
  const time = (h: number): number | undefined => book.time(h)
  let result: PlantedState = effectivePlantedHeight(stated, createdAt, clock, time)
  if (result.state !== 'pending' || result.missingHeader === undefined) return result
  // The clock's own window first: it says how far back `created_at` lies.
  await fetch(predictedHeights(clock, clock))
  await fetch(predictedHeights(heightNear(createdAt, clock, book), clock))
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
