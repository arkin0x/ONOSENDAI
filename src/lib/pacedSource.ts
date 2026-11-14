/**
 * pacedSource.ts: feeds the paced clock (lib/pacedClock.ts) on this page, and
 * hands every animated mesh one reading per frame.
 *
 * What it needs, and from where (design note §2, D3 ruled 2026-11-10):
 *
 *   - Window-end header times a_482, a_483, ...: from the trusted NTH
 *     publisher's kind 321 anchors that carry the raw 80-byte `header` tag,
 *     asked by `authors` + `#B` for exactly those heights, never through the
 *     hyperspace stop index (which keeps the first anchor it saw for a height
 *     and never refetches a cached one). A header counts only when it hashes
 *     to the anchor's `H`, meets its own target, and the anchor is signed by
 *     NTH (seeds/headerBook.ts headerOfAnchor). Heights the anchors do not
 *     give are read from the headers-v1 blobs, the backstop, whose chain is
 *     checked against the manifest and embedded checkpoints (seeds/
 *     seedSources.ts fetchSeedHeaders).
 *   - The trusted tip: NTH's newest verified anchor (seedSources
 *     refreshTrustedTip), its height and header time, which say whether the
 *     next window could have switched yet (pacedClock pacedKnown).
 *   - The device clock's skew, from same-origin `Date` headers, applied only
 *     when it is more than 2 s off.
 *
 * Nothing is fetched until the first animated object mounts (startPacedClock),
 * so a page with no `anim` pays nothing. Until β is known, readPaced says so
 * and every object holds still.
 *
 * One reading a frame: readPaced is keyed on the frame (r3f's clock and its
 * elapsed time), so a scene of hundreds of animated pieces reads the clock
 * once and allocates nothing.
 */

import { contiguousEnds, EPOCH_ENDS, EPOCH_WINDOW, lastClosedWindow, pacedHeight, pacedKnown, pacedSecondsPerBlock, skewFrom, windowEndHeight, type SkewSample, type TrustedTip, type WindowEnds } from './pacedClock'
import { fetchAnchorHeaders, HeaderBook } from './seeds/headerBook'
import type { NostrEvent } from './events'

/** What a frame reads. One shared object, rewritten in place. */
export interface PacedReading {
  /** Paced height now (meaningful only when `known`). */
  beta: number
  /** Whether β is exact; when false every object holds still. */
  known: boolean
  /** Seconds per paced block in force now. */
  secondsPerBlock: number
  /** Rises whenever what the clock knows changes (an end, the tip, the skew). */
  version: number
  /** Monotonic seconds (performance.now): what an ease is timed by, so a device clock that jumps never cuts one short. */
  nowS: number
}

let ends: WindowEnds = EPOCH_ENDS
let tip: TrustedTip | null = null
let skewMs = 0
let version = 0

const reading: PacedReading = { beta: 0, known: false, secondsPerBlock: 0, version: 0, nowS: 0 }
let lastKey: unknown = null
let lastStamp = NaN

/** The clock state as it stands (the HUD, tests). */
export function pacedState(): { ends: WindowEnds; tip: TrustedTip | null; skewMs: number; version: number } {
  return { ends, tip, skewMs, version }
}

/** Set what the clock knows; bumps the version when anything changed. Exported for tests and the source below. */
export function feedPaced(next: { ends?: WindowEnds; tip?: TrustedTip | null; skewMs?: number }): void {
  let changed = false
  if (next.ends && (next.ends.length !== ends.length || next.ends.some((v, i) => v !== ends[i]))) { ends = [...next.ends]; changed = true }
  if (next.tip !== undefined && (next.tip?.height !== tip?.height || next.tip?.time !== tip?.time)) { tip = next.tip ? { ...next.tip } : null; changed = true }
  if (next.skewMs !== undefined && next.skewMs !== skewMs) { skewMs = next.skewMs; changed = true }
  if (changed) { version++; lastStamp = NaN }
}

/** Forget everything (tests). */
export function resetPaced(): void {
  ends = EPOCH_ENDS; tip = null; skewMs = 0; version++; lastKey = null; lastStamp = NaN
  started = false
  paceBook = new HeaderBook()
  live = 0
  lastKickMs = -Infinity
}

/**
 * The reading for this frame. `key` and `stamp` name the frame (an r3f
 * clock and its elapsedTime): the first caller in a frame computes, the rest
 * get the same object. `nowMs` is for tests.
 */
export function readPaced(key: unknown, stamp: number, nowMs: number = Date.now(), monoMs: number = performance.now()): PacedReading {
  if (key === lastKey && stamp === lastStamp) return reading
  lastKey = key
  lastStamp = stamp
  const t = (nowMs + skewMs) / 1000
  reading.nowS = monoMs / 1000
  reading.known = pacedKnown(t, ends, tip)
  // Not known while the feed runs (a tip gone stale behind a sleeping tab, a
  // window just closed): look again now rather than at the next poll.
  if (!reading.known && started && monoMs - lastKickMs > KICK_MS) { lastKickMs = monoMs; void refresh(true) }
  reading.beta = reading.known ? pacedHeight(t, ends) : 0
  reading.secondsPerBlock = pacedSecondsPerBlock(t, ends)
  reading.version = version
  return reading
}

// ---- the feed ------------------------------------------------------------------

/** How often the feed looks again for a new tip and window end, while anything moves. */
export const PACED_POLL_MS = 60_000
/** Least time between the looks a not-known reading asks for. */
export const KICK_MS = 15_000

let started = false
let lastKickMs = -Infinity
/** Objects with motion mounted anywhere on the page (scene/animMotion.ts): the poll runs only while there are any. */
let live = 0

/** An animated object mounted (+1) or went (−1). The first one starts the feed. */
export function noteMoving(delta: 1 | -1): void {
  live = Math.max(0, live + delta)
  if (live > 0) startPacedClock()
}
/** Window-end headers from NTH's anchors: a book of its own, so its absences never hold back the seeds clock's. */
let paceBook = new HeaderBook()

/** Begin feeding the clock; idempotent. Called when the first animated object mounts. */
export function startPacedClock(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void measureSkew()
  void refresh()
  setInterval(() => { if (live > 0) void refresh() }, PACED_POLL_MS)
  // Back from a sleep or a background tab: the tip is likely stale, so ask at once.
  const back = (): void => { if (live > 0 && document.visibilityState !== 'hidden') void refresh(true) }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
}

let refreshing: Promise<void> | null = null

/** One look: the trusted tip, then any window end at or below it not yet known. `force` asks NTH for its tip even if it was asked within the last two minutes. */
export function refresh(force = false): Promise<void> {
  refreshing ??= (async () => {
    try {
      // Imported here, not at the top: the seeds sources carry the DNA resolver and
      // its shipped DNAs, which a page with no animated object has no reason to load.
      const seeds = await import('./seeds/seedSources')
      const { query } = await import('./relay')
      const top = await seeds.refreshTrustedTip(null, Date.now(), force)
      const tipTime = top !== null ? seeds.headerBook.time(top) : undefined
      const nextTip = top !== null && tipTime !== undefined ? { height: top, time: tipTime } : null
      const K = nextTip ? lastClosedWindow(nextTip.height) : EPOCH_WINDOW
      const timeOf = (k: number): number | undefined => paceBook.time(windowEndHeight(k)) ?? seeds.headerBook.time(windowEndHeight(k))
      const want: number[] = []
      for (let k = EPOCH_WINDOW + 1; k <= K; k++) if (timeOf(k) === undefined) want.push(windowEndHeight(k))
      if (want.length > 0) {
        await fetchAnchorHeaders(paceBook, want, (filter) => query(filter) as Promise<NostrEvent[]>)
        const missing = want.filter((h) => paceBook.time(h) === undefined && seeds.headerBook.time(h) === undefined)
        // The backstop: heights the blobs cover come out of them (anything past them is the anchors' alone).
        if (missing.length > 0) await seeds.fetchSeedHeaders(missing)
      }
      feedPaced({ ends: contiguousEnds(timeOf, K), tip: nextTip })
    } catch (e) {
      console.warn('[anim] paced clock refresh failed:', e)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Samples of the same-origin `Date` header (§2.4). */
export const SKEW_SAMPLES = 3

async function measureSkew(): Promise<void> {
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return
  const samples: SkewSample[] = []
  for (let i = 0; i < SKEW_SAMPLES; i++) {
    try {
      const sentMs = Date.now()
      const res = await fetch(location.origin + '/', { method: 'HEAD', cache: 'no-store' })
      const gotMs = Date.now()
      const date = res.headers.get('date')
      if (date) samples.push({ sentMs, gotMs, dateMs: Date.parse(date) })
    } catch { /* no sample */ }
  }
  feedPaced({ skewMs: skewFrom(samples) })
}
