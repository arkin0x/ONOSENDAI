/**
 * standby.test.ts: the stream that cannot draw stands by (lib/tv/standby):
 * WebGL refused is told from any other crash; asking for WebGL lets the
 * context go at once; refused, the page reloads the moment WebGL is given
 * again, not before; any other crash reloads at once; and the watchdog can
 * read that it is standing by, and why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STANDBY_PROBE_MS, isWebglRefused, standBy, webglAvailable, type Standby } from '../standby'

type Win = { __tvStandby?: Standby }
let win: Win

beforeEach(() => {
  vi.useFakeTimers()
  win = {}
  vi.stubGlobal('window', win)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('WebGL refused', () => {
  it('is three\'s error for a canvas that gave no context, or the browser\'s own words; nothing else is', () => {
    expect(isWebglRefused(new Error('Error creating WebGL context.'))).toBe(true)
    expect(isWebglRefused('Web page caused context loss and was blocked')).toBe(true)
    expect(isWebglRefused(new Error('WebGL is not supported'))).toBe(true)
    expect(isWebglRefused(new Error('Cannot read properties of undefined (reading \'x\')'))).toBe(false)
    expect(isWebglRefused(null)).toBe(false)
  })
})

describe('asking for WebGL', () => {
  /** A canvas that gives `gl` (or null), and what was asked of it. */
  function canvas(gl: unknown): { make: () => HTMLCanvasElement; asked: string[] } {
    const asked: string[] = []
    return { asked, make: () => ({ getContext: (t: string) => { asked.push(t); return gl } }) as unknown as HTMLCanvasElement }
  }

  it('is yes for a context, which is let go of at once: the page\'s own letting go, which Chromium does not hold against the domain', () => {
    const loseContext = vi.fn()
    const c = canvas({ getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext } : null) })
    expect(webglAvailable(c.make)).toBe(true)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('is no when both WebGL 2 and 1 give nothing (a blocked domain), or the asking throws', () => {
    const c = canvas(null)
    expect(webglAvailable(c.make)).toBe(false)
    expect(c.asked).toEqual(['webgl2', 'webgl'])
    expect(webglAvailable(() => { throw new Error('no canvas') })).toBe(false)
  })
})

describe('standing by', () => {
  it('with WebGL refused, says so to the watchdog and reloads only once WebGL is given again', () => {
    const reload = vi.fn()
    let given = false
    standBy(new Error('Error creating WebGL context.'), reload, () => given, STANDBY_PROBE_MS, 1234)
    expect(win.__tvStandby).toEqual({ reason: 'webgl', since: 1234, message: 'Error creating WebGL context.' })
    // Two minutes refused: no reload into another refusal.
    vi.advanceTimersByTime(120_000)
    expect(reload).not.toHaveBeenCalled()
    given = true
    vi.advanceTimersByTime(STANDBY_PROBE_MS)
    expect(reload).toHaveBeenCalledTimes(1)
    // And once only: the asking stops.
    vi.advanceTimersByTime(STANDBY_PROBE_MS * 10)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('asks again every STANDBY_PROBE_MS, a few seconds, so it is back within seconds of the refusal ending', () => {
    expect(STANDBY_PROBE_MS).toBeLessThanOrEqual(5_000)
    const probe = vi.fn(() => false)
    standBy(new Error('Error creating WebGL context.'), vi.fn(), probe)
    vi.advanceTimersByTime(STANDBY_PROBE_MS * 3)
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('with any other crash, reloads at once (reloadBroadcast keeps the backoff), and says why', () => {
    const reload = vi.fn()
    const probe = vi.fn(() => true)
    standBy(new TypeError('x is undefined'), reload, probe)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(probe).not.toHaveBeenCalled()
    expect(win.__tvStandby?.reason).toBe('crash')
    expect(win.__tvStandby?.message).toBe('x is undefined')
  })

  it('stops asking when stopped', () => {
    const reload = vi.fn()
    const stop = standBy(new Error('Error creating WebGL context.'), reload, () => true)
    stop()
    vi.advanceTimersByTime(STANDBY_PROBE_MS * 3)
    expect(reload).not.toHaveBeenCalled()
  })
})
