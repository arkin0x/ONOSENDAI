/**
 * worldClock.ts: the one clock every `anim` runs on, Unix time (DECK-0003
 * §1.14 as revised; owner ruling 2026-11-14: "the world clock, Unix time,
 * will be just fine to keep things roughly in sync between players ... the
 * Onosendai Relay response timestamps as a way to kind of keep in sync").
 *
 * The device clock, corrected by an offset measured against the ONOSENDAI
 * relay's response time, and only when the device is clearly off. Nothing
 * waits on the network: before any measurement, offline, or when every
 * measurement fails, the device clock is used as it is, so motion always runs.
 *
 * Measuring. A sample is one request: the device time it was sent, the device
 * time the answer came, and the server's time in the answer. The server's
 * moment is taken as the midpoint of the round trip, so the offset is
 * server − (sent + got) / 2, good to ± RTT / 2 plus the server time's own
 * resolution; a time given in whole seconds is cut down, not rounded, so half
 * a second is added to it. Of a few samples the median is taken (the
 * method DECK-0003 §1.14 describes for ONOSENDAI).
 *
 * Where the server's time comes from, in order:
 *   1. The relay (relay.onosendai.tech, its NIP-11 GET): an `X-Server-Time`
 *      header in Unix milliseconds, or its `Date` header (whole seconds).
 *      A browser can read either only if the relay names it in
 *      `Access-Control-Expose-Headers`; the live relay does not yet
 *      (2026-11-14), and a relay PR adds both.
 *   2. Until then, the page's own origin: the `Date` header of a same-origin
 *      HEAD, which a browser can always read (whole seconds).
 *
 * Applying (DECK-0003 §1.14, "The moment t"). A correction is applied only
 * when the measured offset is more than 2 seconds (MIN_CORRECTION_MS): below
 * that the device's own clock is usually the better one, since most sources
 * report whole seconds while a synced device is good to a fraction of one.
 * Once applied it is kept up to date from later measurements (a change within
 * a measurement's own doubt is noise and kept as it was), and dropped when a
 * later measurement falls to 2 seconds or less.
 *
 * A steady clock. Frames are timed from performance.now(), which never
 * steps, plus an offset to Unix time; a step in the device clock (a time
 * sync, or its user setting the clock) is taken as a correction: the offset
 * follows it and every moving object eases to the new time (§1.14).
 *
 * Re-measured when the page regains focus or visibility, and every ten
 * minutes while anything moves. One reading per frame (readClock).
 */

/** What a frame reads. One shared object, rewritten in place. */
export interface ClockReading {
  /** Unix seconds now, corrected: what every motion's phase is worked from. */
  t: number
  /** Rises whenever the correction changes, so motions ease into the new time rather than jump. */
  version: number
  /** Monotonic seconds (performance.now): what an ease is timed by. */
  nowS: number
  /** A time the viewer chose by hand (the workshop's scrub): drawn even under reduced motion, never eased. */
  chosen: boolean
}

/** Corrections of this or less are left to the device clock (§1.14: "more than 2 seconds"). */
export const MIN_CORRECTION_MS = 2000
/** A jump between the device clock and the steady one larger than this is a step in the device clock, taken as a correction. */
export const STEP_MS = 1000
/** How often the clock is measured again while anything moves. */
export const REMEASURE_MS = 10 * 60_000
/** Samples taken in one measurement. */
export const SAMPLES = 3
/** The server time header the relay may send, Unix milliseconds. */
export const SERVER_TIME_HEADER = 'x-server-time'

let offsetMs = 0
let version = 0
const mono = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** Unix ms minus steady ms: the device clock as the steady clock carries it, moved only by a step. */
let base = Date.now() - mono()

/** Unix ms now by the steady clock, following a step in the device clock (and counting it as a correction). */
function deviceNow(monoMs: number): number {
  const steady = monoMs + base
  const real = Date.now()
  if (Math.abs(real - steady) > STEP_MS) {
    base += real - steady
    version++
    lastStamp = NaN
    return real
  }
  return steady
}

const reading: ClockReading = { t: 0, version: 0, nowS: 0, chosen: false }
let lastKey: unknown = null
let lastStamp = NaN

/** Unix seconds now, corrected. `nowMs` (tests) stands in for the device clock. */
export function worldNow(nowMs?: number): number {
  return ((nowMs ?? deviceNow(mono())) + offsetMs) / 1000
}

/** The correction in force, ms (0 for none). */
export function clockOffset(): number {
  return offsetMs
}

/** Set the correction; bumps the version when it changes. Exported for tests and the measurement below. */
export function setClockOffset(ms: number): void {
  const next = Math.round(ms)
  if (next === offsetMs) return
  offsetMs = next
  version++
  lastStamp = NaN
}

/**
 * The reading for this frame. `key` and `stamp` name the frame (an r3f
 * clock and its elapsedTime): the first caller in a frame works it out, the
 * rest get the same object. `nowMs` (tests) stands in for the device clock;
 * by default it is the steady clock (deviceNow).
 */
export function readClock(key: unknown, stamp: number, nowMs?: number, monoMs: number = mono()): ClockReading {
  if (key === lastKey && stamp === lastStamp) return reading
  const wall = nowMs ?? deviceNow(monoMs)
  lastKey = key
  lastStamp = stamp
  reading.t = (wall + offsetMs) / 1000
  reading.version = version
  reading.nowS = monoMs / 1000
  return reading
}

// ---- measuring --------------------------------------------------------------------

/** One request's times: sent and answered (device ms), and the server's time with its resolution (ms). */
export interface ClockSample { sentMs: number; gotMs: number; serverMs: number; resolutionMs: number }

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * The offset the samples show, and how sure it is: the median over the
 * usable samples of server + resolution / 2 − midpoint (a time truncated to
 * whole seconds sits on average half a second before the true one), and the
 * median of RTT / 2 + resolution / 2. Null without a usable sample.
 */
export function offsetFrom(samples: readonly ClockSample[]): { offsetMs: number; uncertaintyMs: number } | null {
  const ok = samples.filter((s) => Number.isFinite(s.serverMs) && Number.isFinite(s.sentMs) && s.gotMs >= s.sentMs)
  if (ok.length === 0) return null
  return {
    offsetMs: median(ok.map((s) => s.serverMs + s.resolutionMs / 2 - (s.sentMs + s.gotMs) / 2)),
    uncertaintyMs: median(ok.map((s) => (s.gotMs - s.sentMs) / 2 + s.resolutionMs / 2)),
  }
}

/** An offset this large is no clock error but a broken source (a stale cached response): ignored. */
export const SANE_OFFSET_MS = 24 * 3600_000

/**
 * The correction to use after a measurement, against the one in force
 * (§1.14):
 *   - none (0), when the measured offset is 2 seconds or less: the device is
 *     the better clock, and a correction in force is dropped;
 *   - kept, when one is in force and the new measurement agrees with it
 *     within the measurement's own doubt: noise, so the clock (and every
 *     moving object with it) does not wobble;
 *   - the measured offset otherwise (kept up to date).
 * Nothing usable, or an offset past SANE_OFFSET_MS, keeps `current`.
 */
export function correctionFor(samples: readonly ClockSample[], current: number): number {
  const m = offsetFrom(samples)
  if (!m || Math.abs(m.offsetMs) > SANE_OFFSET_MS) return current
  if (Math.abs(m.offsetMs) <= MIN_CORRECTION_MS) return 0
  if (current !== 0 && Math.abs(m.offsetMs - current) <= m.uncertaintyMs) return current
  return m.offsetMs
}

/** The relay asked for the time: the ONOSENDAI relay's NIP-11 document, over https. */
export const RELAY_TIME_URL = 'https://relay.onosendai.tech/'

/**
 * A server time from a response's headers: X-Server-Time (ms) if readable,
 * else Date (whole seconds) plus any Age (a cache in between that kept the
 * upstream Date says how long it held the response); null for neither.
 */
export function serverTimeOf(headers: Pick<Headers, 'get'>): { serverMs: number; resolutionMs: number } | null {
  const ms = Number(headers.get(SERVER_TIME_HEADER))
  if (headers.get(SERVER_TIME_HEADER) !== null && Number.isFinite(ms) && ms > 0) return { serverMs: ms, resolutionMs: 1 }
  const date = headers.get('date')
  const parsed = date ? Date.parse(date) : NaN
  if (!Number.isFinite(parsed)) return null
  const age = Number(headers.get('age'))
  return { serverMs: parsed + (Number.isFinite(age) && age > 0 ? age * 1000 : 0), resolutionMs: 1000 }
}

/** How long one request may take before it is given up (a hung source must not stall the fallback). */
export const REQUEST_TIMEOUT_MS = 4000

type Fetcher = (url: string, init: RequestInit) => Promise<{ headers: Pick<Headers, 'get'>; body?: { cancel?: () => Promise<void> } | null }>

/** A few samples from one source; empty when the source gives no readable time. */
export async function sampleFrom(url: string, init: RequestInit, fetcher: Fetcher, now: () => number = Date.now): Promise<ClockSample[]> {
  const out: ClockSample[] = []
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const sentMs = now()
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
      const res = await fetcher(url, { ...init, cache: 'no-store', ...(signal ? { signal } : {}) })
      const gotMs = now()
      // Only the headers matter: let the body go, so it holds no connection.
      res.body?.cancel?.().catch(() => {})
      const time = serverTimeOf(res.headers)
      if (!time) return out
      out.push({ sentMs, gotMs, ...time })
    } catch { return out }
  }
  return out
}

let measuring: Promise<void> | null = null

/** Measure: the relay first, the page's own origin when the relay gives no readable time. One at a time; never throws. */
export function measure(fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<void> {
  measuring ??= (async () => {
    try {
      let samples = await sampleFrom(RELAY_TIME_URL, { headers: { Accept: 'application/nostr+json' } }, fetcher)
      if (samples.length === 0 && typeof location !== 'undefined') samples = await sampleFrom(location.origin + '/', { method: 'HEAD' }, fetcher)
      setClockOffset(correctionFor(samples, offsetMs))
    } finally { measuring = null }
  })()
  return measuring
}

/** Least time between the measurements a return to the page asks for (focus and visibility both fire). */
export const RETURN_GAP_MS = 30_000

let started = false
let live = 0
let lastReturn = -Infinity
let stopWatching: (() => void) | null = null

/** An animated object mounted (+1) or went (−1). The first one starts the measuring. */
export function noteMoving(delta: 1 | -1): void {
  live = Math.max(0, live + delta)
  if (live > 0) startWorldClock()
}

/** Begin measuring; idempotent. */
export function startWorldClock(): void {
  if (started || typeof window === 'undefined' || typeof fetch === 'undefined') return
  started = true
  void measure()
  const timer = setInterval(() => { if (live > 0) void measure() }, REMEASURE_MS)
  const back = (): void => {
    if (live === 0 || document.visibilityState === 'hidden') return
    const now = performance.now()
    if (now - lastReturn < RETURN_GAP_MS) return
    lastReturn = now
    void measure()
  }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
  stopWatching = () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', back)
    window.removeEventListener('focus', back)
  }
}

/** Forget everything, the interval and listeners included (tests, a hot reload). */
export function resetWorldClock(): void {
  stopWatching?.()
  stopWatching = null
  offsetMs = 0; version++; lastKey = null; lastStamp = NaN; started = false; live = 0; lastReturn = -Infinity; measuring = null
  base = Date.now() - mono()
}
