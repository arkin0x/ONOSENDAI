/**
 * glitch.test.ts: each of TV's glitches comes on its own random clock and
 * lasts as long as asked, an aberration swells to "a very high amount" and
 * comes back, they may land together, and none starts over a cut.
 */
import { describe, expect, it } from 'vitest'
import { CALM, GLITCH_TIMING, GlitchDirector, PEAK_ABERRATION, envelope, type GlitchKind } from '../glitch'

/** Every glitch that starts over `ms`, sampled every 50 ms: its kind, when, and how long it ran. */
function run(d: GlitchDirector, ms: number, held: (t: number) => boolean = () => false): Array<{ kind: GlitchKind; at: number; ms: number }> {
  const seen: Array<{ kind: GlitchKind; at: number; ms: number }> = []
  const open = new Map<GlitchKind, number>()
  for (let t = 0; t <= ms; t += 50) {
    d.levels(t, held(t))
    const on = new Set(d.current)
    for (const k of on) if (!open.has(k)) open.set(k, t)
    for (const [k, at] of open) if (!on.has(k)) { seen.push({ kind: k, at, ms: t - at }); open.delete(k) }
  }
  return seen
}

describe('TV glitches', () => {
  it('each comes first within its own window, and lasts as long as asked', () => {
    for (const r of [0, 0.5, 0.999]) {
      const seen = run(new GlitchDirector(0, () => r), 400_000)
      for (const kind of ['aberration', 'tear', 'dropout'] as const) {
        const first = seen.find((s) => s.kind === kind)!
        const [lo, hi] = GLITCH_TIMING[kind].gap
        expect(first.at).toBeGreaterThanOrEqual(lo * 1000)
        expect(first.at).toBeLessThanOrEqual(hi * 1000 + 50)
        const [shortest, longest] = GLITCH_TIMING[kind].length
        expect(first.ms).toBeGreaterThanOrEqual(shortest * 1000 - 50)
        expect(first.ms).toBeLessThanOrEqual(longest * 1000 + 50)
      }
    }
  })

  it('pulls the colours far apart and brings them back', () => {
    // Due at 25 s, lasting 4 s.
    let calls = 0
    const d = new GlitchDirector(0, () => (calls++ === 0 ? 0 : 0.5))
    let peak = 1
    for (let t = 25_000; t <= 29_100; t += 20) peak = Math.max(peak, d.levels(t, false).aberration)
    expect(peak).toBeGreaterThan(PEAK_ABERRATION * 0.8)
    expect(d.levels(29_200, false).aberration).toBe(1)
  })

  it('runs each on its own clock, so they can land together', () => {
    // Every clock due at once (the shortest gaps) and the longest lengths.
    let calls = 0
    const d = new GlitchDirector(0, () => (calls++ < 3 ? 0 : 0.999))
    d.levels(120_000, false)
    d.levels(120_100, false)
    expect(d.current.sort()).toEqual(['aberration', 'dropout', 'tear'])
  })

  it('waits out a cut: none starts while held, and one due starts after', () => {
    const d = new GlitchDirector(0, () => 0)
    const held = (t: number) => t >= 20_000 && t < 40_000
    const seen = run(d, 45_000, held)
    expect(seen.every((s) => !held(s.at))).toBe(true)
    expect(seen.find((s) => s.kind === 'aberration')?.at).toBe(40_000)
  })

  it('is calm between glitches', () => {
    const d = new GlitchDirector(0, () => 0.5)
    expect(d.levels(1_000, false)).toEqual(CALM)
  })

  it('eases up and down, and is nothing outside the glitch', () => {
    const timing = { rise: 0.6, fall: 1 }
    expect(envelope(0, 4, timing)).toBe(0)
    expect(envelope(0.3, 4, timing)).toBeCloseTo(0.5, 5)
    expect(envelope(2, 4, timing)).toBe(1)
    expect(envelope(4, 4, timing)).toBe(0)
    // A short one rises and falls in proportion.
    expect(envelope(0.5, 1, timing)).toBe(1)
  })
})
