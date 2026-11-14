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
 * resolution. Of a few samples the one with the shortest round trip is kept
 * (the tightest bound, as NTP does).
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
 * Applying. A correction is applied only when the measured offset is beyond
 * both MIN_CORRECTION_MS and the sample's own uncertainty. 250 ms: a device
 * synced to network time is good to tens of milliseconds, so below a quarter
 * second the device is likely the better clock; and a quarter second is
 * about 4.5 degrees of a platform turning three times a minute, the size of
 * disagreement two players standing on it would just about notice. A whole
 * second `Date` header can only ever justify a correction of more than about
 * half a second plus half the round trip, and that is what it is used for.
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

/** Corrections smaller than this are left to the device clock (see the header). */
export const MIN_CORRECTION_MS = 250
/** How often the clock is measured again while anything moves. */
export const REMEASURE_MS = 10 * 60_000
/** Samples taken in one measurement. */
export const SAMPLES = 3
/** The server time header the relay may send, Unix milliseconds. */
export const SERVER_TIME_HEADER = 'x-server-time'

let offsetMs = 0
let version = 0

const reading: ClockReading = { t: 0, version: 0, nowS: 0, chosen: false }
let lastKey: unknown = null
let lastStamp = NaN

/** Unix seconds now, corrected. */
export function worldNow(nowMs: number = Date.now()): number {
  return (nowMs + offsetMs) / 1000
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
 * rest get the same object. `nowMs` and `monoMs` are for tests.
 */
export function readClock(key: unknown, stamp: number, nowMs: number = Date.now(), monoMs: number = performance.now()): ClockReading {
  if (key === lastKey && stamp === lastStamp) return reading
  lastKey = key
  lastStamp = stamp
  reading.t = (nowMs + offsetMs) / 1000
  reading.version = version
  reading.nowS = monoMs / 1000
  return reading
}

// ---- measuring --------------------------------------------------------------------

/** One request's times: sent and answered (device ms), and the server's time with its resolution (ms). */
export interface ClockSample { sentMs: number; gotMs: number; serverMs: number; resolutionMs: number }

/**
 * The offset the samples show, and how sure it is: from the sample with the
 * shortest round trip, offset = server + resolution / 2 − midpoint (a time
 * truncated to whole seconds sits on average half a second before the true
 * one), uncertainty = RTT / 2 + resolution / 2. Null without a usable sample.
 */
export function offsetFrom(samples: readonly ClockSample[]): { offsetMs: number; uncertaintyMs: number } | null {
  let best: ClockSample | null = null
  for (const s of samples) {
    if (!Number.isFinite(s.serverMs) || !Number.isFinite(s.sentMs) || !(s.gotMs >= s.sentMs)) continue
    if (!best || s.gotMs - s.sentMs < best.gotMs - best.sentMs) best = s
  }
  if (!best) return null
  const rtt = best.gotMs - best.sentMs
  return { offsetMs: best.serverMs + best.resolutionMs / 2 - (best.sentMs + best.gotMs) / 2, uncertaintyMs: rtt / 2 + best.resolutionMs / 2 }
}

/**
 * The correction to use after a measurement: the measured offset when it is
 * beyond both MIN_CORRECTION_MS and its own uncertainty, else none (the
 * device clock is trusted). Null samples (nothing usable) keep `current`.
 */
export function correctionFor(samples: readonly ClockSample[], current: number): number {
  const m = offsetFrom(samples)
  if (!m) return current
  return Math.abs(m.offsetMs) > Math.max(MIN_CORRECTION_MS, m.uncertaintyMs) ? m.offsetMs : 0
}

/** The relay asked for the time: the ONOSENDAI relay's NIP-11 document, over https. */
export const RELAY_TIME_URL = 'https://relay.onosendai.tech/'

/** A server time from a response's headers: X-Server-Time (ms) if readable, else Date (whole seconds); null for neither. */
export function serverTimeOf(headers: Pick<Headers, 'get'>): { serverMs: number; resolutionMs: number } | null {
  const ms = Number(headers.get(SERVER_TIME_HEADER))
  if (headers.get(SERVER_TIME_HEADER) !== null && Number.isFinite(ms) && ms > 0) return { serverMs: ms, resolutionMs: 1 }
  const date = headers.get('date')
  const parsed = date ? Date.parse(date) : NaN
  return Number.isFinite(parsed) ? { serverMs: parsed, resolutionMs: 1000 } : null
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ headers: Pick<Headers, 'get'> }>

/** A few samples from one source; empty when the source gives no readable time. */
export async function sampleFrom(url: string, init: RequestInit, fetcher: Fetcher, now: () => number = Date.now): Promise<ClockSample[]> {
  const out: ClockSample[] = []
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const sentMs = now()
      const res = await fetcher(url, { ...init, cache: 'no-store' })
      const gotMs = now()
      const time = serverTimeOf(res.headers)
      if (!time) return out
      out.push({ sentMs, gotMs, ...time })
    } catch { return out }
  }
  return out
}

/** Measure: the relay first, the page's own origin when the relay gives no readable time. Never throws. */
export async function measure(fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<void> {
  let samples = await sampleFrom(RELAY_TIME_URL, { headers: { Accept: 'application/nostr+json' } }, fetcher)
  if (samples.length === 0 && typeof location !== 'undefined') samples = await sampleFrom(location.origin + '/', { method: 'HEAD' }, fetcher)
  setClockOffset(correctionFor(samples, offsetMs))
}

let started = false
let live = 0

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
  setInterval(() => { if (live > 0) void measure() }, REMEASURE_MS)
  const back = (): void => { if (live > 0 && document.visibilityState !== 'hidden') void measure() }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
}

/** Forget everything (tests). */
export function resetWorldClock(): void {
  offsetMs = 0; version++; lastKey = null; lastStamp = NaN; started = false; live = 0
}
