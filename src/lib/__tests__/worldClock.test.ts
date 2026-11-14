/**
 * worldClock.test.ts: the world clock (lib/worldClock.ts). A sample's offset
 * is the server's time against the midpoint of the round trip (RTT / 2
 * compensation), the shortest round trip wins, a correction is applied only
 * beyond 250 ms and beyond the sample's own uncertainty, the relay is asked
 * first (its X-Server-Time, else its Date) and the page's own origin after,
 * and with no network at all the device clock runs as it is.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clockOffset, correctionFor, measure, MIN_CORRECTION_MS, offsetFrom, readClock, RELAY_TIME_URL, resetWorldClock, sampleFrom, serverTimeOf,
  setClockOffset, worldNow, type ClockSample,
} from '../worldClock'

afterEach(() => resetWorldClock())

const headers = (h: Record<string, string>): Pick<Headers, 'get'> => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('a sample', () => {
  it('compensates half the round trip: the server\'s moment is the midpoint', () => {
    // Sent at 1000, answered at 1200 (RTT 200): the server said 6100 ms, a millisecond clock.
    const s: ClockSample = { sentMs: 1000, gotMs: 1200, serverMs: 6100, resolutionMs: 1 }
    const m = offsetFrom([s])!
    expect(m.offsetMs).toBeCloseTo(6100 + 0.5 - 1100, 6)
    expect(m.uncertaintyMs).toBeCloseTo(100.5, 6)
  })
  it('a whole-second Date counts half a second on, and half a second of doubt', () => {
    const m = offsetFrom([{ sentMs: 0, gotMs: 100, serverMs: 5000, resolutionMs: 1000 }])!
    expect(m.offsetMs).toBe(5000 + 500 - 50)
    expect(m.uncertaintyMs).toBe(550)
  })
  it('the shortest round trip wins (the tightest bound); broken samples are passed over', () => {
    const m = offsetFrom([
      { sentMs: 0, gotMs: 900, serverMs: 9000, resolutionMs: 1 },
      { sentMs: 1000, gotMs: 1040, serverMs: 4020, resolutionMs: 1 },
      { sentMs: 2000, gotMs: 1990, serverMs: 0, resolutionMs: 1 },
      { sentMs: 0, gotMs: 10, serverMs: NaN, resolutionMs: 1 },
    ])!
    expect(m.offsetMs).toBeCloseTo(3000.5, 6)
    expect(offsetFrom([])).toBeNull()
  })
})

describe('applying a correction', () => {
  const at = (offset: number, rtt = 40, resolutionMs = 1): ClockSample => ({ sentMs: 10_000, gotMs: 10_000 + rtt, serverMs: 10_000 + rtt / 2 + offset - resolutionMs / 2, resolutionMs })
  it('not within 250 ms: the device clock is the better one', () => {
    expect(MIN_CORRECTION_MS).toBe(250)
    expect(correctionFor([at(200)], 0)).toBe(0)
    expect(correctionFor([at(-240)], 0)).toBe(0)
  })
  it('beyond 250 ms and beyond the sample\'s doubt: applied', () => {
    expect(Math.round(correctionFor([at(800)], 0))).toBe(800)
    expect(Math.round(correctionFor([at(-3000)], 0))).toBe(-3000)
  })
  it('not when the round trip leaves more doubt than the offset', () => {
    expect(correctionFor([at(400, 1000)], 0)).toBe(0)
    // A whole-second Date: half a second of doubt plus half the round trip.
    expect(correctionFor([at(500, 40, 1000)], 0)).toBe(0)
    expect(Math.round(correctionFor([at(2000, 40, 1000)], 0))).toBe(2000)
  })
  it('nothing usable keeps the correction there is', () => {
    expect(correctionFor([], 1234)).toBe(1234)
  })
})

describe('the server\'s time', () => {
  it('X-Server-Time (ms) first, then Date (whole seconds), else none', () => {
    expect(serverTimeOf(headers({ 'x-server-time': '1795132800123', date: 'Fri, 20 Nov 2026 00:00:00 GMT' }))).toEqual({ serverMs: 1795132800123, resolutionMs: 1 })
    expect(serverTimeOf(headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT' }))).toEqual({ serverMs: 1795132800000, resolutionMs: 1000 })
    expect(serverTimeOf(headers({}))).toBeNull()
  })
  it('asks the relay first; a relay whose headers a browser cannot read gives way to the page\'s own origin', async () => {
    ;(globalThis as { location?: unknown }).location = { origin: 'https://onosendai.tech' }
    const asked: string[] = []
    let now = 1_000_000
    const fetcher = async (url: string) => {
      asked.push(url)
      now += 40
      // The relay without exposed headers reads as none; the page's origin sends Date, 5 s ahead.
      return { headers: url === RELAY_TIME_URL ? headers({}) : headers({ date: new Date(Math.floor((now + 5000) / 1000) * 1000).toUTCString() }) }
    }
    const realNow = Date.now
    Date.now = () => now
    try { await measure(fetcher) } finally { Date.now = realNow; delete (globalThis as { location?: unknown }).location }
    expect(asked[0]).toBe(RELAY_TIME_URL)
    expect(asked.slice(1).every((u) => u === 'https://onosendai.tech/')).toBe(true)
    expect(Math.abs(clockOffset() - 5000)).toBeLessThan(1100)
  })
  it('with the relay\'s X-Server-Time readable, it is used', async () => {
    let now = 2_000_000
    const samples = await sampleFrom(RELAY_TIME_URL, {}, async () => { now += 30; return { headers: headers({ 'x-server-time': String(now + 900) }) } }, () => now)
    expect(samples).toHaveLength(3)
    // The server read 900 ms past the answer; the answer came 30 ms after the ask: 900 + 15 + half a millisecond.
    expect(correctionFor(samples, 0)).toBeCloseTo(915.5, 6)
  })
})

describe('offline', () => {
  it('no network at all: the device clock as it is, and motion still has a time', async () => {
    await measure(async () => { throw new TypeError('Failed to fetch') })
    expect(clockOffset()).toBe(0)
    const r = readClock('frame', 1, 1_795_132_800_000, 5)
    expect(r.t).toBe(1_795_132_800)
  })
})

describe('the reading', () => {
  it('is the device time plus the correction, one object a frame, its version rising with each correction', () => {
    const a = readClock('clock', 1, 1_000_000, 1)
    expect(a.t).toBe(1000)
    const v = a.version
    expect(readClock('clock', 1, 9_999_999, 2)).toBe(a)
    expect(a.t).toBe(1000)
    setClockOffset(2500)
    const b = readClock('clock', 2, 1_000_000, 3)
    expect(b.t).toBe(1002.5)
    expect(b.version).toBeGreaterThan(v)
    expect(worldNow(1_000_000)).toBe(1002.5)
  })
})
