/**
 * broadcast.test.ts: /tv?broadcast=1 is the 24/7 stream's page and nothing
 * else is; on it, each TV frame and each lost WebGL context is counted for
 * the encoder's watchdog, and a context that does not come back reloads the
 * page. Off it, none of that happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_WAIT_MS, RELOAD_MAX_WAIT_MS, RELOADS_FREE, countTvFrame, isBroadcast, markBroadcastPage, parseBroadcast, recoverLostContext, reloadBroadcast, reloadWait, setBroadcastForTest } from '../broadcast'

type Win = { location: { pathname: string; search: string }; __tvFrames?: number; __tvCtxLost?: number }
let win: Win

beforeEach(() => {
  vi.useFakeTimers()
  win = { location: { pathname: '/tv', search: '?broadcast=1' } }
  vi.stubGlobal('window', win)
  setBroadcastForTest(null)
})
afterEach(() => {
  setBroadcastForTest(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the broadcast flag', () => {
  it('is /tv with broadcast=1, and nothing else', () => {
    expect(parseBroadcast('/tv', '?broadcast=1')).toBe(true)
    expect(parseBroadcast('/tv/', '?x=2&broadcast=1')).toBe(true)
    expect(parseBroadcast('/TV', '?broadcast=1')).toBe(true)
    expect(parseBroadcast('/tv', '')).toBe(false)
    expect(parseBroadcast('/tv', '?broadcast=0')).toBe(false)
    expect(parseBroadcast('/tv', '?broadcast=true')).toBe(false)
    expect(parseBroadcast('/', '?broadcast=1')).toBe(false)
    expect(parseBroadcast('/demo', '?broadcast=1')).toBe(false)
    expect(parseBroadcast('/tvx', '?broadcast=1')).toBe(false)
  })

  it('is read from the address once: a later history write does not switch it', () => {
    expect(isBroadcast()).toBe(true)
    win.location = { pathname: '/', search: '' }
    expect(isBroadcast()).toBe(true)
    setBroadcastForTest(null)
    expect(isBroadcast()).toBe(false)
  })

  it('is off with no window (a test, a worker)', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('window', undefined)
    setBroadcastForTest(null)
    expect(isBroadcast()).toBe(false)
  })
})

describe('the frame heartbeat', () => {
  it('counts each TV frame on the stream', () => {
    countTvFrame()
    countTvFrame()
    countTvFrame()
    expect(win.__tvFrames).toBe(3)
  })

  it('leaves a viewer\'s page alone', () => {
    win.location = { pathname: '/tv', search: '' }
    setBroadcastForTest(null)
    countTvFrame()
    expect(win.__tvFrames).toBeUndefined()
  })
})

describe('a lost WebGL context', () => {
  const lose = (c: EventTarget): void => { c.dispatchEvent(new Event('webglcontextlost')) }
  const restore = (c: EventTarget): void => { c.dispatchEvent(new Event('webglcontextrestored')) }

  it('on the stream, reloads the page when it is not back in time, and counts the loss', () => {
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const reload = vi.fn()
    recoverLostContext(canvas, CONTEXT_WAIT_MS, reload)
    lose(canvas)
    expect(win.__tvCtxLost).toBe(1)
    vi.advanceTimersByTime(CONTEXT_WAIT_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    // A second loss inside the wait does not start the wait again.
    lose(canvas)
    expect(win.__tvCtxLost).toBe(2)
    vi.advanceTimersByTime(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when the context comes back within the wait', () => {
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const reload = vi.fn()
    recoverLostContext(canvas, 1000, reload)
    lose(canvas)
    vi.advanceTimersByTime(900)
    restore(canvas)
    vi.advanceTimersByTime(5000)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stops watching when told, a wait under way included', () => {
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const reload = vi.fn()
    const stop = recoverLostContext(canvas, 1000, reload)
    lose(canvas)
    stop()
    vi.advanceTimersByTime(5000)
    lose(canvas)
    vi.advanceTimersByTime(5000)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads a viewer\'s page', () => {
    win.location = { pathname: '/tv', search: '' }
    setBroadcastForTest(null)
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const reload = vi.fn()
    recoverLostContext(canvas, 1000, reload)
    lose(canvas)
    vi.advanceTimersByTime(60_000)
    expect(reload).not.toHaveBeenCalled()
    expect(win.__tvCtxLost).toBeUndefined()
  })
})

describe('the page', () => {
  it('is marked for the stylesheet on the stream only', () => {
    const classes = new Set<string>()
    vi.stubGlobal('document', { documentElement: { classList: { add: (c: string) => classes.add(c) } } })
    markBroadcastPage()
    expect(classes.has('tv-broadcast')).toBe(true)
    classes.clear()
    setBroadcastForTest(false)
    markBroadcastPage()
    expect(classes.size).toBe(0)
  })
})

describe('the broadcast\'s reload', () => {
  let kept: Map<string, string>
  beforeEach(() => {
    kept = new Map()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v) } })
  })

  it('goes to the address the page loaded on, even after TV wrote another', () => {
    win.location = { pathname: '/tv', search: '?broadcast=1&x=2' }
    setBroadcastForTest(null)
    expect(isBroadcast()).toBe(true)
    win.location = { pathname: '/', search: '' }
    const go = vi.fn()
    reloadBroadcast(go, 1_000_000)
    vi.advanceTimersByTime(0)
    expect(go).toHaveBeenCalledWith('/tv?broadcast=1&x=2')
    // Once per load.
    reloadBroadcast(go, 1_000_000)
    vi.advanceTimersByTime(0)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('backs off when it keeps reloading, up to its longest wait', () => {
    expect(reloadWait(0)).toBe(0)
    expect(reloadWait(RELOADS_FREE - 1)).toBe(0)
    expect(reloadWait(RELOADS_FREE)).toBe(CONTEXT_WAIT_MS)
    expect(reloadWait(RELOADS_FREE + 1)).toBe(CONTEXT_WAIT_MS * 2)
    expect(reloadWait(50)).toBe(RELOAD_MAX_WAIT_MS)
    // Three reloads a minute ago, kept across the loads: the fourth waits.
    const now = 10_000_000
    kept.set('onosendai:tvBroadcastReloads', JSON.stringify([now - 60_000, now - 50_000, now - 40_000, now - 11 * 60_000]))
    const go = vi.fn()
    reloadBroadcast(go, now)
    vi.advanceTimersByTime(CONTEXT_WAIT_MS - 1)
    expect(go).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(go).toHaveBeenCalledTimes(1)
    // The one older than the window was let go.
    expect(JSON.parse(kept.get('onosendai:tvBroadcastReloads')!)).toHaveLength(4)
  })

  it('never reloads a viewer\'s page', () => {
    setBroadcastForTest(false)
    const go = vi.fn()
    reloadBroadcast(go)
    vi.advanceTimersByTime(RELOAD_MAX_WAIT_MS)
    expect(go).not.toHaveBeenCalled()
  })
})
