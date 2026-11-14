/**
 * pacedClock.ts: the paced height β, the shared clock every `anim` runs on
 * (design note anim-block-paced-design-2026-11-10 §2; DECK-0003 in draft).
 *
 * β rises by exactly one for every average block, the average taken over the
 * last COMPLETED difficulty window, end to end. It changes speed once per
 * window, four hours after the window's last block, and never jumps:
 *
 *   window k        heights 2016k .. 2016k + 2015
 *   a_k             header time of height 2016k + 2015 (the window end)
 *   T_k             (a_k − a_(k−1)) / 2016 seconds
 *   s_k             a_k + 14,400 (the switch)
 *   β(t)            β(s_k) + (t − s_k) / T_k   for s_k ≤ t < s_(k+1)
 *   β(s_(k+1))      β(s_k) + (a_(k+1) − a_k) / T_k
 *
 * from a fixed epoch, window 481, whose two ends are constants here (checked
 * against the headers-v1 blob: 969,695 at 1,791,011,720 and 971,711 at
 * 1,792,153,758). Pure: the window ends come from lib/pacedSource.ts.
 *
 * KNOWING β (the owner's rule for this build: hold still, never guess). β at
 * t is EXACT when every window end whose switch is at or before t is known.
 * The ends are known contiguously from the epoch up to window K; the switch
 * of window K + 1 is certainly still ahead when NTH's trusted tip is below
 * that window's end and the tip's header time is recent enough that the end
 * could not have been mined and switched since (TIP_FRESH_S). Otherwise the
 * clock is not known, and every object holds still at phase 0.
 */

/** Blocks a difficulty window spans. */
export const WINDOW = 2016
/** Seconds after a window's end before its pace takes effect. */
export const SWITCH_DELAY_S = 14_400
/** The epoch window and its two ends (§2.2). */
export const EPOCH_WINDOW = 481
export const EPOCH_PREV_END_TIME = 1_791_011_720
export const EPOCH_END_TIME = 1_792_153_758
/** β at the epoch's switch: the first height after the epoch window. */
export const EPOCH_BETA = 971_712
/**
 * How long a trusted tip vouches that the next window has not switched:
 * a later block's header time is at least about two hours behind the tip's
 * at worst (header times may lag; MTP rule), and the switch comes four hours
 * after it, so two hours past the tip's header time is still safe.
 */
export const TIP_FRESH_S = 7_200

/** The height of window k's last block. */
export function windowEndHeight(k: number): number {
  return WINDOW * k + WINDOW - 1
}

/** The window whose last block is at or below `height`, the newest such (−1 for none). */
export function lastClosedWindow(height: number): number {
  return Math.floor((height + 1) / WINDOW) - 1
}

/**
 * Window-end times from the epoch on: `ends[0]` is a_481, `ends[i]` is
 * a_(481 + i). Only a contiguous run counts; the caller trims at the first
 * gap (contiguousEnds).
 */
export type WindowEnds = readonly number[]

/** The constant epoch list, a_481 alone. */
export const EPOCH_ENDS: WindowEnds = Object.freeze([EPOCH_END_TIME])

/** The run of known ends from the epoch: stops at the first window whose end time is unknown. */
export function contiguousEnds(timeOf: (k: number) => number | undefined, upTo: number): number[] {
  const out = [EPOCH_END_TIME]
  for (let k = EPOCH_WINDOW + 1; k <= upTo; k++) {
    const t = timeOf(k)
    // Window ends are two weeks apart; one that does not move forward is not a time to pace by.
    if (t === undefined || !(t > out[out.length - 1])) break
    out.push(t)
  }
  return out
}

/**
 * β at Unix time `t` (seconds, fractional), from the epoch with the ends
 * known. Past the last known switch it continues at the last known pace
 * (extrapolated); pacedKnown says whether that is exact. Before the epoch's
 * switch it runs backward at T_481 (defined everywhere, §2.2).
 */
export function pacedHeight(t: number, ends: WindowEnds): number {
  let prev = EPOCH_PREV_END_TIME
  let beta = EPOCH_BETA
  let k = 0
  // Walk switch to switch while the next switch is at or before t.
  for (;;) {
    const a = ends[k]
    const T = (a - prev) / WINDOW
    const s = a + SWITCH_DELAY_S
    const next = ends[k + 1]
    if (next === undefined || t < next + SWITCH_DELAY_S) return beta + (t - s) / T
    beta += (next - a) / T
    prev = a
    k++
  }
}

/** Seconds per paced block in force at t (T_k). */
export function pacedSecondsPerBlock(t: number, ends: WindowEnds): number {
  let k = 0
  while (ends[k + 1] !== undefined && t >= ends[k + 1] + SWITCH_DELAY_S) k++
  return (ends[k] - (k === 0 ? EPOCH_PREV_END_TIME : ends[k - 1])) / WINDOW
}

/** The trusted tip: NTH's newest verified anchor's height and header time. */
export interface TrustedTip { height: number; time: number }

/**
 * Whether β at t is exact (see the header): the ends are known through the
 * last window the tip has closed, and the window after them cannot have
 * switched yet. Null tip: not known.
 */
export function pacedKnown(t: number, ends: WindowEnds, tip: TrustedTip | null): boolean {
  if (!tip || ends.length === 0) return false
  const K = EPOCH_WINDOW + ends.length - 1
  // The tip has closed a window whose end we do not have.
  if (tip.height >= windowEndHeight(K + 1)) {
    return false
  }
  // The next end is not mined as far as the tip knows; that holds only while the tip is fresh.
  return t < tip.time + TIP_FRESH_S
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
