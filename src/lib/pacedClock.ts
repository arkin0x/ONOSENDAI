/**
 * pacedClock.ts: the paced height β, the shared clock every `anim` runs on
 * (DECK-0003 §1.14, spec PR #107; design note anim-block-paced-design-2026-11-10 §2).
 *
 * β rises by exactly one for every average block, the average taken over the
 * last COMPLETED difficulty window, end to end. It changes speed once per
 * window, four hours after the window's last block, and never jumps:
 *
 *   window k        heights 2016k .. 2016k + 2015
 *   a_k             header time of height 2016k + 2015 (the window end)
 *   D_k             a_k − a_(k−1), clamped to 302,400 .. 4,838,400
 *   T_k             D_k / 2016 seconds
 *   s_k             max(a_k + 14,400, s_(k−1)) (the switch)
 *   β(t)            β(s_k) + (t − s_k) / T_k   for s_k ≤ t < s_(k+1)
 *   β(s_(k+1))      β(s_k) + (s_(k+1) − s_k) / T_k
 *
 * from a fixed epoch, window 483, whose two ends are constants here, as in
 * DECK-0003 §1.14 (973,727 at 1,793,300,370 and 975,743 at 1,794,632,383).
 * A span is clamped to Bitcoin's own retarget bounds, and a switch never
 * comes before the one before it, so β is defined, rising and continuous for
 * any header times. Pure: the window ends come from lib/pacedSource.ts.
 *
 * KNOWING β (owner rulings 2026-11-14: never guess, and stay known while the
 * window cannot have ended). β at t is EXACT when every window end whose
 * switch is at or before t is known. The ends are known contiguously from
 * the epoch up to window K. The window after them, K + 1, cannot have
 * switched yet when NTH's trusted tip is below its end and either
 *   - the tip's header time is under TIP_FRESH_S old, so even an end mined
 *     at once and stamped low switches later than now; or
 *   - its end block cannot have been mined yet at all (earliestWindowEnd),
 *     however quiet the publisher has been.
 * Otherwise the clock is not known, and every object holds at its shape as
 * written. DECK-0003 §1.14 lets a reader run on at the last pace it knows
 * instead; ONOSENDAI only runs on while that pace is certainly still the one
 * in force, and holds still past that.
 */

/** Blocks a difficulty window spans. */
export const WINDOW = 2016
/** Seconds after a window's end before its pace takes effect. */
export const SWITCH_DELAY_S = 14_400
/** A window's span is clamped to a quarter and four times two weeks, as Bitcoin clamps its retarget (DECK-0003 §1.14). */
export const MIN_SPAN_S = 302_400
export const MAX_SPAN_S = 4_838_400
/** The epoch window (DECK-0003 §1.14) and the two ends every reader carries. */
export const EPOCH_WINDOW = 483
/** a_482, the header time of block 973,727. */
export const EPOCH_PREV_END_TIME = 1_793_300_370
/** a_483, the header time of block 975,743. */
export const EPOCH_END_TIME = 1_794_632_383
/** β at the epoch's switch: the first height after the epoch window. */
export const EPOCH_BETA = 975_744
/**
 * How long a trusted tip vouches that the next window has not switched. In
 * practice a later block's header time is no more than about two hours
 * behind the tip's (header times may lag the clock, bounded by the median
 * time past), and the switch comes four hours after the window end, so two
 * hours past the tip's header time is still before any switch. Practical,
 * not guaranteed: a tip stamped up to two hours fast narrows the margin.
 */
export const TIP_FRESH_S = 7_200

/**
 * The earliest real moment a later block can have been mined, from a tip
 * (height and header time), for earliestWindowEnd:
 *   - HEADER_AHEAD_S: a node rejects a header stamped more than two hours
 *     ahead of its clock, so the tip was mined no earlier than two hours
 *     before its header time.
 *   - MIN_BLOCK_S and BURST_BLOCKS: blocks then come no faster than one a
 *     minute, after a free burst of six. One a minute is ten times the
 *     target, and over two and a half times faster than four times today's
 *     hashrate (the most Bitcoin's own retarget clamp contemplates in one
 *     window) would give on average. At four times the hashrate (150 s a
 *     block on average) the chance of n + 6 blocks within 60 n seconds is
 *     at most about 10^-5 (near n = 5) and vanishes as n grows (Poisson
 *     tail); at today's hashrate (600 s) it is under 10^-10. The two hours
 *     taken off the tip's header time add margin on top.
 */
export const HEADER_AHEAD_S = 7_200
export const MIN_BLOCK_S = 60
export const BURST_BLOCKS = 6

/** The earliest Unix moment block `height` can have been mined, given the trusted tip. */
export function earliestBlockAt(tip: TrustedTip, height: number): number {
  return tip.time - HEADER_AHEAD_S + Math.max(0, height - tip.height - BURST_BLOCKS) * MIN_BLOCK_S
}

/** The height of window k's last block. */
export function windowEndHeight(k: number): number {
  return WINDOW * k + WINDOW - 1
}

/** The window whose last block is at or below `height`, the newest such (−1 for none). */
export function lastClosedWindow(height: number): number {
  return Math.floor((height + 1) / WINDOW) - 1
}

/**
 * Window-end times from the window before the epoch on: `ends[0]` is a_482,
 * `ends[1]` a_483, `ends[i]` a_(482 + i). Only a run with no gap counts (a
 * reader uses window ends in order, §1.14); see contiguousEnds.
 */
export type WindowEnds = readonly number[]

/** The constant epoch list: a_482 and a_483. */
export const EPOCH_ENDS: WindowEnds = Object.freeze([EPOCH_PREV_END_TIME, EPOCH_END_TIME])

/** The window that `ends[i]` closes. */
export function windowOfEnd(i: number): number {
  return EPOCH_WINDOW - 1 + i
}

/** The run of known ends from the epoch: stops at the first window whose end time is unknown. */
export function contiguousEnds(timeOf: (k: number) => number | undefined, upTo: number): number[] {
  const out = [...EPOCH_ENDS]
  for (let k = EPOCH_WINDOW + 1; k <= upTo; k++) {
    const t = timeOf(k)
    if (t === undefined || !Number.isSafeInteger(t)) break
    out.push(t)
  }
  return out
}

/** T_k: seconds per paced block for a window whose ends are `span` apart, the span clamped (§1.14). */
export function paceOf(span: number): number {
  return Math.min(Math.max(span, MIN_SPAN_S), MAX_SPAN_S) / WINDOW
}

/**
 * β at Unix time `t` (seconds, fractional), as DECK-0003 §1.14 and its
 * reference (sno-reference.py paced_height) work it: from the epoch's switch,
 * each later switch at max(a_k + 14,400, the switch before it), the pace of
 * each window from its clamped span. Past the last known switch it continues
 * at the last known pace; pacedKnown says whether that is exact. Before the
 * epoch's switch it runs backward at T_483.
 */
export function pacedHeight(t: number, ends: WindowEnds): number {
  let s = ends[1] + SWITCH_DELAY_S
  let beta = EPOCH_BETA
  let pace = paceOf(ends[1] - ends[0])
  for (let i = 2; i < ends.length; i++) {
    const next = Math.max(ends[i] + SWITCH_DELAY_S, s)
    if (t < next) break
    beta += (next - s) / pace
    s = next
    pace = paceOf(ends[i] - ends[i - 1])
  }
  return beta + (t - s) / pace
}

/** Seconds per paced block in force at t (T_k). */
export function pacedSecondsPerBlock(t: number, ends: WindowEnds): number {
  let s = ends[1] + SWITCH_DELAY_S
  let pace = paceOf(ends[1] - ends[0])
  for (let i = 2; i < ends.length; i++) {
    const next = Math.max(ends[i] + SWITCH_DELAY_S, s)
    if (t < next) break
    s = next
    pace = paceOf(ends[i] - ends[i - 1])
  }
  return pace
}

/** The trusted tip: NTH's newest verified anchor's height and header time. */
export interface TrustedTip { height: number; time: number }

/**
 * Whether β at t is exact (see the header): the ends are known through the
 * last window the tip has closed, and the window after them cannot have
 * switched yet. No tip (none verified yet): not known.
 */
export function pacedKnown(t: number, ends: WindowEnds, tip: TrustedTip | null): boolean {
  if (!tip || ends.length < 2) return false
  const K = windowOfEnd(ends.length - 1)
  const end = windowEndHeight(K + 1)
  // The tip has closed a window whose end we do not have.
  if (tip.height >= end) return false
  // A fresh tip: an end mined since switches four hours after a time no more than two hours behind the tip's.
  if (t < tip.time + TIP_FRESH_S) return true
  // A quiet publisher: still known while the window's last block cannot have been mined yet.
  return t < earliestBlockAt(tip, end)
}

// ---- skew ------------------------------------------------------------------

/** Skew below this is the device's own error and ignored (§2.4). */
export const SKEW_MIN_MS = 2_000

/** One sample of a same-origin `Date` header: when it was asked, answered, and what it said. */
export interface SkewSample { sentMs: number; gotMs: number; dateMs: number }

/**
 * The correction to add to the device clock, in ms, from a few samples: the
 * median of (server time − local midpoint), where the server time is the
 * `Date` header plus half a second (it is truncated to whole seconds). Zero
 * unless it exceeds SKEW_MIN_MS.
 */
export function skewFrom(samples: readonly SkewSample[]): number {
  const offs = samples
    .filter((s) => Number.isFinite(s.dateMs) && s.gotMs >= s.sentMs)
    .map((s) => s.dateMs + 500 - (s.sentMs + s.gotMs) / 2)
    .sort((a, b) => a - b)
  if (offs.length === 0) return 0
  const mid = offs.length >> 1
  const median = offs.length % 2 ? offs[mid] : (offs[mid - 1] + offs[mid]) / 2
  return Math.abs(median) > SKEW_MIN_MS ? Math.round(median) : 0
}

// ---- the ease ----------------------------------------------------------------

/** The phase error wrapped into [−0.5, 0.5): the shortest way round a cycle. */
export function wrapHalf(e: number): number {
  const w = e - Math.floor(e + 0.5)
  return w
}

/** How long an ease of `err` cycles takes on a cycle of `period` seconds: min(3, max(0.5, |e| × P)) (§2.4). */
export function easeSeconds(err: number, period: number): number {
  const p = Number.isFinite(period) && period > 0 ? period : 0
  return Math.min(3, Math.max(0.5, Math.abs(err) * p))
}
