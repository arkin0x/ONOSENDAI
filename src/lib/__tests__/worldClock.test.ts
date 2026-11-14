/**
 * worldClock.test.ts: the world clock (lib/worldClock.ts). A sample's offset
 * is the server's time against the midpoint of the round trip (RTT / 2
 * compensation), the median of a few is taken, a correction is applied only
 * beyond 2 s (DECK-0003 §1.14) and kept up to date, a step in the device
 * clock is taken as a correction, the relay is asked
 * first (its X-Server-Time, else its Date) and the page's own origin after,
 * and with no network at all the device clock runs as it is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('takes the median of the samples (the method §1.14 describes); broken samples are passed over', () => {
    const m = offsetFrom([
      { sentMs: 0, gotMs: 900, serverMs: 9000, resolutionMs: 1 },
      { sentMs: 1000, gotMs: 1040, serverMs: 4020, resolutionMs: 1 },
      { sentMs: 2000, gotMs: 2040, serverMs: 5020, resolutionMs: 1 },
      { sentMs: 2000, gotMs: 1990, serverMs: 0, resolutionMs: 1 },
      { sentMs: 0, gotMs: 10, serverMs: NaN, resolutionMs: 1 },
    ])!
    expect(m.offsetMs).toBeCloseTo(3000.5, 6)
    expect(offsetFrom([])).toBeNull()
  })
})

describe('applying a correction (§1.14: more than 2 seconds, kept up to date, dropped at 2 s or less)', () => {
  const at = (offset: number, rtt = 40, resolutionMs = 1): ClockSample => ({ sentMs: 10_000, gotMs: 10_000 + rtt, serverMs: 10_000 + rtt / 2 + offset - resolutionMs / 2, resolutionMs })
  it('not at 2 seconds or less: the device clock is the better one', () => {
    expect(MIN_CORRECTION_MS).toBe(2000)
    expect(correctionFor([at(1900)], 0)).toBe(0)
    expect(correctionFor([at(-2000)], 0)).toBe(0)
  })
  it('more than 2 seconds: applied', () => {
    expect(Math.round(correctionFor([at(2500)], 0))).toBe(2500)
    expect(Math.round(correctionFor([at(-3000)], 0))).toBe(-3000)
  })
  it('kept up to date by later measurements, a change within the measurement\'s own doubt kept as it was (no wobble)', () => {
    expect(correctionFor([at(3400, 40, 1000)], 3000)).toBe(3000)
    expect(Math.round(correctionFor([at(5000, 40, 1000)], 3000))).toBe(5000)
  })
  it('dropped when a later measurement falls to 2 seconds or less', () => {
    expect(correctionFor([at(1000)], 3000)).toBe(0)
  })
  it('nothing usable keeps the correction there is; an offset past a day is a broken source', () => {
    expect(correctionFor([], 1234)).toBe(1234)
    expect(correctionFor([at(2 * 86_400_000)], 0)).toBe(0)
  })
})

describe('the server\'s time', () => {
  it('a cache\'s Age is added to the Date it kept', () => {
    expect(serverTimeOf(headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT', age: '30' }))).toEqual({ serverMs: 1795132830000, resolutionMs: 1000 })
  })
  it('a request that fails part way keeps the samples before it', async () => {
    let n = 0
    const samples = await sampleFrom(RELAY_TIME_URL, {}, async () => { if (++n === 2) throw new Error('reset'); return { headers: headers({ 'x-server-time': '5000' }) } }, () => 1000)
    expect(samples).toHaveLength(1)
  })
  it('X-Server-Time (ms) first, then Date (whole seconds), else none', () => {
    expect(serverTimeOf(headers({ 'x-server-time': '1795132800123', date: 'Fri, 20 Nov 2026 00:00:00 GMT' }))).toEqual({ serverMs: 1795132800123, resolutionMs: 1 })
    expect(serverTimeOf(headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT' }))).toEqual({ serverMs: 1795132800000, resolutionMs: 1000 })
    expect(serverTimeOf(headers({}))).toBeNull()
  })
  it('asks the relay first; a relay whose headers a browser cannot read gives way to the page\'s own origin', async () => {
    ;(globalThis as { location?: unknown }).location = { origin: 'https://onosendai.tech' }
    const asked: string[] = []
    const methods: Array<string | undefined> = []
    let now = 1_000_000
    const fetcher = async (url: string, init: RequestInit) => {
      asked.push(url)
      methods.push(init.method)
      now += 40
      // The relay without exposed headers reads as none; the page's origin sends Date, 5 s ahead.
      return { headers: url === RELAY_TIME_URL ? headers({}) : headers({ date: new Date(Math.floor((now + 5000) / 1000) * 1000).toUTCString() }) }
    }
    const realNow = Date.now
    Date.now = () => now
    try { await measure(fetcher) } finally { Date.now = realNow; delete (globalThis as { location?: unknown }).location }
    expect(asked[0]).toBe(RELAY_TIME_URL)
    expect(asked.slice(1).every((u) => u === 'https://onosendai.tech/')).toBe(true)
    expect(methods.slice(1).every((m) => m === 'HEAD')).toBe(true)
    // Each sample: sent at N, answered at N + 40 with a Date 5 s ahead truncated to the second, read +500 ms.
    expect(clockOffset()).toBeGreaterThan(4400)
    expect(clockOffset()).toBeLessThan(5600)
  })
  it('with the relay\'s X-Server-Time readable, it is used', async () => {
    let now = 2_000_000
    const samples = await sampleFrom(RELAY_TIME_URL, {}, async () => { now += 30; return { headers: headers({ 'x-server-time': String(now + 900) }) } }, () => now)
    expect(samples).toHaveLength(3)
    // The server read 900 ms past the answer; the answer came 30 ms after the ask: 900 + 15 + half a millisecond.
    expect(offsetFrom(samples)!.offsetMs).toBeCloseTo(915.5, 6)
    // Under 2 s: the device keeps its own clock.
    expect(correctionFor(samples, 0)).toBe(0)
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

describe('when it measures', () => {
  it('starts once, measures on start, on a return to the page (at most every 30 s), and its timer only while anything moves', async () => {
    const { noteMoving, REMEASURE_MS, RETURN_GAP_MS } = await import('../worldClock')
    const listeners: Record<string, () => void> = {}
    const target = { addEventListener: (k: string, f: () => void) => { listeners[k] = f }, removeEventListener: (k: string) => { delete listeners[k] } }
    let calls = 0
    vi.useFakeTimers()
    vi.stubGlobal('window', target)
    vi.stubGlobal('document', { ...target, visibilityState: 'visible' })
    vi.stubGlobal('fetch', async () => { calls++; return { headers: headers({}) } })
    try {
      noteMoving(1)
      noteMoving(1)
      await vi.advanceTimersByTimeAsync(0)
      const first = calls
      expect(first).toBeGreaterThan(0)
      // A return to the page: focus and visibility both fire; one measurement.
      vi.setSystemTime(Date.now() + RETURN_GAP_MS + 1)
      vi.spyOn(performance, 'now').mockReturnValue(1e9)
      listeners.focus()
      listeners.visibilitychange()
      await vi.advanceTimersByTimeAsync(0)
      const afterReturn = calls
      expect(afterReturn).toBeGreaterThan(first)
      // Nothing moves: the timer measures no more.
      noteMoving(-1)
      noteMoving(-1)
      await vi.advanceTimersByTimeAsync(REMEASURE_MS + 1)
      expect(calls).toBe(afterReturn)
      // Reset takes the listeners away.
      resetWorldClock()
      expect(Object.keys(listeners)).toEqual([])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})

describe('a step in the device clock', () => {
  it('is taken as a correction: the steady clock follows it and the version rises (every moving object eases)', () => {
    resetWorldClock()
    const realNow = Date.now
    let wall = 1_795_132_800_000
    let steady = 1000
    Date.now = () => wall
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => steady)
    try {
      resetWorldClock()
      const r0 = readClock('k', 1, undefined, steady)
      const v0 = r0.version
      expect(r0.t).toBeCloseTo(1_795_132_800, 6)
      // 16 ms later on both clocks: smooth, no step.
      wall += 16; steady += 16
      expect(readClock('k', 2, undefined, steady).version).toBe(v0)
      // The user sets the clock 90 s ahead; the steady clock only moved 16 ms.
      wall += 90_016; steady += 16
      const r2 = readClock('k', 3, undefined, steady)
      expect(r2.version).toBeGreaterThan(v0)
      expect(r2.t).toBeCloseTo(1_795_132_890.032, 6)
    } finally { Date.now = realNow; spy.mockRestore() }
  })
})
