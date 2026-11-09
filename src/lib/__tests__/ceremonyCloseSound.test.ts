/**
 * ceremonyCloseSound.test.ts: CLOSE on a door sounds a soft lock tick and the
 * door's short buzz (arkinox, 2026-11-09), synthesised through the one audio
 * context, through the same once-per-10-s gates as every opening: a close right
 * after an opening is quiet, and an opening right after a close too. The audio
 * context is a recording fake; nothing plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('../audioContext', () => ({ audioContext: () => audio.ctx }))

import { afterClose, afterReopen } from '../ceremony'
import { CEREMONY_BUZZ, CEREMONY_GAP_MS, CLOSE_TICK, ceremonyFeedback, closeFeedback, resetCeremonySound } from '../ceremonySound'

/** A fake audio context that records each voice it starts and stops, and each gain peak. */
function fakeContext(): { ctx: unknown; voices: Array<{ kind: string; start?: number; stop?: number }>; peaks: number[]; bands: number[] } {
  const voices: Array<{ kind: string; start?: number; stop?: number }> = []
  const peaks: number[] = []
  const bands: number[] = []
  const param = (onSet?: (v: number) => void) => ({
    setValueAtTime: (v: number) => { onSet?.(v) },
    exponentialRampToValueAtTime: (v: number) => { onSet?.(v) },
    linearRampToValueAtTime: () => undefined,
  })
  const node = () => ({ connect: () => undefined })
  const voice = (kind: string) => {
    const v: { kind: string; start?: number; stop?: number } = { kind }
    voices.push(v)
    return { ...node(), buffer: null, loop: false, type: '', frequency: param(), start: (t: number) => { v.start = t }, stop: (t: number) => { v.stop = t } }
  }
  const ctx = {
    state: 'running',
    currentTime: 100,
    sampleRate: 8000,
    destination: {},
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => voice('noise'),
    createOscillator: () => voice('osc'),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param((v) => bands.push(v)), Q: param() }),
    createGain: () => ({ ...node(), gain: param((v) => peaks.push(v)) }),
    resume: async () => undefined,
  }
  return { ctx, voices, peaks, bands }
}

beforeEach(() => { resetCeremonySound(); audio.ctx = null })
afterEach(() => { vi.unstubAllGlobals() })

describe('what CLOSE does', () => {
  it('as a re-open, and the tick and buzz are offered; the re-open itself offers none', () => {
    expect(afterClose(true)).toEqual({ yieldCards: true, ceremony: true, feedback: true })
    expect(afterClose(false)).toEqual({ yieldCards: false, ceremony: false, feedback: true })
    expect(afterReopen(true).feedback).toBe(false)
    expect(afterReopen(false).feedback).toBe(false)
  })
})

describe('the close tick', () => {
  it('is one soft tick, over in under a tenth of a second, softer and lower than the opening tick', () => {
    const f = fakeContext()
    audio.ctx = f.ctx
    vi.stubGlobal('navigator', { vibrate: vi.fn() })
    expect(closeFeedback(1_000_000).sound).toBe(true)
    // One noise burst and one click, nothing looping and nothing after.
    expect(f.voices.map((v) => v.kind).sort()).toEqual(['noise', 'osc'])
    for (const v of f.voices) {
      expect(v.start).toBe(100)
      expect(v.stop! - v.start!).toBeLessThan(0.1)
    }
    expect(Math.max(...f.peaks)).toBeLessThanOrEqual(Math.max(CLOSE_TICK.noisePeak, CLOSE_TICK.clickPeak))
    expect(Math.max(...f.peaks)).toBeLessThan(0.12)
    expect(f.bands).toContain(CLOSE_TICK.band)
    expect(CLOSE_TICK.band).toBeLessThan(2600)
  })

  it('buzzes the door’s short buzz, and is silent where there is no audio', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    expect(closeFeedback(1_500_000)).toEqual({ sound: true, buzz: true })
    expect(vibrate).toHaveBeenCalledWith(CEREMONY_BUZZ.door)
  })

  it('shares the opening’s 10 s gate: an OPEN then a CLOSE 3 s later sounds and buzzes once, and the other way round', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const t = 2_000_000
    expect(ceremonyFeedback('door', t)).toEqual({ sound: true, buzz: true })
    expect(closeFeedback(t + 3000)).toEqual({ sound: false, buzz: false })
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(closeFeedback(t + CEREMONY_GAP_MS)).toEqual({ sound: true, buzz: true })
    expect(ceremonyFeedback('chest', t + CEREMONY_GAP_MS + 3000)).toEqual({ sound: false, buzz: false })
    expect(closeFeedback(t + CEREMONY_GAP_MS + 5000)).toEqual({ sound: false, buzz: false })
    expect(vibrate).toHaveBeenCalledTimes(2)
  })
})
