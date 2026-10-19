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
  it('one already on ends as the HOSAKA spot or the tunnel comes in, and none starts under it', () => {
    // random 0: the aberration is due at 25 s and lasts 1 s; the others are minutes off.
    const d = new GlitchDirector(0, () => 0)
    for (let t = 0; t <= 25_300; t += 50) d.levels(t, false)
    expect(d.current).toEqual(['aberration'])
    expect(d.levels(25_350, true, true)).toEqual(CALM)
    expect(d.current).toEqual([])
    for (let t = 25_400; t <= 60_000; t += 50) expect(d.levels(t, true, true)).toEqual(CALM)
  })

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
    for (let t = 0; t <= 29_100; t += 20) peak = Math.max(peak, d.levels(t, false).aberration)
    expect(peak).toBeGreaterThan(PEAK_ABERRATION * 0.8)
    expect(d.levels(29_120, false).aberration).toBe(1)
  })

  it('runs each on its own clock, so they land together now and then, never all at once on cue', () => {
    // Six hours of watching, seeded: the clocks are independent, so some
    // glitches overlap, but no two start on the same frame.
    let seed = 7
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const seen = run(new GlitchDirector(0, random), 6 * 3600_000)
    const overlaps = seen.filter((a, i) => seen.some((b, k) => k !== i && a.kind !== b.kind && a.at < b.at + b.ms && b.at < a.at + a.ms))
    expect(overlaps.length).toBeGreaterThan(0)
    const starts = seen.map((x) => x.at)
    expect(new Set(starts).size).toBe(starts.length)
  })

  it('starts its clocks again when TV comes on, so time away is no backlog', () => {
    // Made when the page opened; TV comes on ten minutes later.
    const d = new GlitchDirector(0, () => 0)
    d.reset(600_000)
    for (let t = 600_000; t < 624_900; t += 50) d.levels(t, false)
    expect(d.current).toEqual([])
    for (let t = 624_900; t <= 625_100; t += 50) d.levels(t, false)
    expect(d.current).toEqual(['aberration'])
  })

  it('starts again after a stall in the frames, as a hidden tab makes', () => {
    const d = new GlitchDirector(0, () => 0)
    d.levels(1_000, false)
    // Back eight minutes later: everything was due long ago, and nothing fires.
    d.levels(481_000, false)
    expect(d.current).toEqual([])
  })

  it('puts off one due during a cut a few seconds past it, so it is not part of the cut', () => {
    const d = new GlitchDirector(0, () => 0)
    const held = (t: number) => t >= 20_000 && t < 40_000
    const seen = run(d, 45_000, held)
    expect(seen.every((x) => !held(x.at))).toBe(true)
    // Not on the cut's end, where it would read as part of the cut.
    expect(seen.find((x) => x.kind === 'aberration')!.at).toBeGreaterThan(40_000 + 500)
  })

  it('holds each pattern of a tear\'s bands a third of a second at least: under three changes a second', () => {
    // The tear due at 120 s (its gap the shortest), lasting its longest.
    let calls = 0
    const d = new GlitchDirector(0, () => (calls++ === 1 ? 0 : 0.999))
    const changedAt: number[] = []
    let last = -1
    for (let t = 0; t < 121_600; t += 10) {
      const l = d.levels(t, false)
      if (l.tear > 0 && last >= 0 && l.tearSeed !== last) changedAt.push(t)
      if (l.tear > 0) last = l.tearSeed
    }
    expect(changedAt.length).toBeGreaterThan(0)
    for (let k = 1; k < changedAt.length; k++) expect(changedAt[k] - changedAt[k - 1]).toBeGreaterThanOrEqual(340)
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
