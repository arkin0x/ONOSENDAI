/**
 * waveform.test.ts: hidden audio drawn as its sound (direction 7, Voice
 * line): peaks of the samples, the scrubber's arithmetic, the stand-in shape
 * before a file is opened, and the clock.
 */
import { describe, expect, it } from 'vitest'
import { WAVE_FLOOR, clockWords, hashWave, peaksOf, playedBars, scrubFraction, scrubTime, shrinkPeaks } from '../waveform'

describe('the waveform', () => {
  it('is the loudest moment in each slice, the loudest full height, silence a thin line', () => {
    const left = new Float32Array(400)
    for (let i = 0; i < 400; i++) left[i] = i < 100 ? 0.1 : i < 200 ? -0.5 : i < 300 ? 0.25 : 0
    const peaks = peaksOf([left], 4)
    ;[0.2, 1, 0.5, WAVE_FLOOR].forEach((want, i) => expect(peaks[i]).toBeCloseTo(want, 6))
    expect(peaksOf([new Float32Array(100)], 5)).toEqual(new Array(5).fill(WAVE_FLOOR))
    expect(peaksOf([], 3)).toEqual(new Array(3).fill(WAVE_FLOOR))
  })

  it('takes every channel', () => {
    const a = new Float32Array([0.1, 0.1, 0.1, 0.1])
    const b = new Float32Array([0, 0, 0.8, 0])
    const p = peaksOf([a, b], 2)
    expect(p[0]).toBeCloseTo(0.125, 6)
    expect(p[1]).toBe(1)
  })

  it('a stand-in from the file’s hash: the same every time, in range, different for another file', () => {
    const w = hashWave('ab'.repeat(32), 72)
    expect(w).toHaveLength(72)
    expect(hashWave('ab'.repeat(32), 72)).toEqual(w)
    expect(hashWave('cd'.repeat(32), 72)).not.toEqual(w)
    for (const v of w) { expect(v).toBeGreaterThanOrEqual(WAVE_FLOOR); expect(v).toBeLessThanOrEqual(1) }
  })

  it('shrinks to a thumbnail keeping each part’s loudest', () => {
    expect(shrinkPeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3])
  })

  it('a tap or a drag lands on its share of the way across, clamped, and lights the bars played', () => {
    expect(scrubFraction(150, 100, 200)).toBe(0.25)
    expect(scrubFraction(50, 100, 200)).toBe(0)
    expect(scrubFraction(400, 100, 200)).toBe(1)
    expect(scrubFraction(10, 0, 0)).toBe(0)
    expect(scrubTime(0.25, 120)).toBe(30)
    expect(scrubTime(2, 120)).toBe(120)
    expect(scrubTime(0.5, 0)).toBe(0)
    expect(playedBars(30, 120, 72)).toBe(18)
    expect(playedBars(30, 0, 72)).toBe(0)
  })

  it('reads its time as a clock', () => {
    expect(clockWords(41)).toBe('0:41')
    expect(clockWords(118.9)).toBe('1:58')
    expect(clockWords(3725)).toBe('1:02:05')
    expect(clockWords(null)).toBe('-:--')
    expect(clockWords(Number.NaN)).toBe('-:--')
  })
})
