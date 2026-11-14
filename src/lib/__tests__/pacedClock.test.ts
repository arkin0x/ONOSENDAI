/**
 * pacedClock.test.ts: the paced height β against DECK-0003 §1.14's own
 * vectors (spec PR #107, its "The paced height" table, every row), when β
 * counts as known, the skew rule, and the ease's arithmetic.
 */
import { describe, expect, it } from 'vitest'
import {
  contiguousEnds, EPOCH_BETA, EPOCH_END_TIME, EPOCH_ENDS, EPOCH_PREV_END_TIME, lastClosedWindow, pacedHeight, pacedKnown,
  pacedSecondsPerBlock, paceOf, skewFrom, SWITCH_DELAY_S, TIP_FRESH_S, windowEndHeight, wrapHalf, easeSeconds,
} from '../pacedClock'
import { phaseAt } from '../anim'

/** Hypothetical end of window 484 from the spec's table: 600 s a block after the epoch's end. */
const A484 = 1_795_841_983
const WITH_484 = [...EPOCH_ENDS, A484]

describe('the epoch (§1.14)', () => {
  it('is window 483, its ends the header times of 973,727 and 975,743', () => {
    expect(windowEndHeight(482)).toBe(973_727)
    expect(windowEndHeight(483)).toBe(975_743)
    expect(EPOCH_PREV_END_TIME).toBe(1_793_300_370)
    expect(EPOCH_END_TIME).toBe(1_794_632_383)
    expect(EPOCH_BETA).toBe(975_744)
    expect(lastClosedWindow(975_743)).toBe(483)
    expect(lastClosedWindow(975_742)).toBe(482)
  })

  it('T_483 is 1332013 / 2016 seconds and s_483 is 1794646783', () => {
    expect(EPOCH_END_TIME + SWITCH_DELAY_S).toBe(1_794_646_783)
    expect(pacedSecondsPerBlock(1_794_646_783, EPOCH_ENDS)).toBeCloseTo(1_332_013 / 2016, 9)
  })
})

describe('the spec\'s paced height vectors, every row', () => {
  const rows: Array<[number, number[], number, string]> = [
    [1_794_646_783, EPOCH_ENDS as number[], 975744.000000000, 'the epoch\'s switch moment'],
    [1_794_632_383, EPOCH_ENDS as number[], 975722.205618113, 'before the switch, β runs back at the epoch\'s pace'],
    [1_794_733_183, EPOCH_ENDS as number[], 975874.766291320, 'one day after the switch'],
    [1_795_132_800, EPOCH_ENDS as number[], 976479.586118154, '2026-11-20 00:00:00 UTC'],
    [1_795_856_382, WITH_484, 977574.726564981, 'one second before window 484\'s switch'],
    [1_795_856_383, WITH_484, 977574.728078480, 'window 484\'s switch: no jump'],
    [1_795_862_383, WITH_484, 977584.728078480, '6,000 seconds at 600 seconds a block is 10 more'],
    [1_795_862_383, EPOCH_ENDS as number[], 977583.809070932, 'the same moment without 484: still at the epoch\'s pace'],
    [1_794_652_783, [...EPOCH_ENDS, 1_794_631_383], 975784.000000000, 'an end earlier than the epoch\'s: switch held, span clamped'],
  ]
  for (const [t, ends, beta, what] of rows) {
    it(`${what}: β(${t}) = ${beta}`, () => {
      expect(pacedHeight(t, ends)).toBeCloseTo(beta, 6)
    })
  }

  it('a turn of 100 per block stands at 220.253526 degrees at 2026-11-20 00:00:00 UTC', () => {
    expect(phaseAt({ c: 100, b: 1, phi: 0 }, pacedHeight(1_795_132_800, EPOCH_ENDS)) * 360).toBeCloseTo(220.253526, 3)
  })

  it('a span is clamped to a quarter and four times two weeks', () => {
    expect(paceOf(1)).toBe(302_400 / 2016)
    expect(paceOf(10_000_000)).toBe(4_838_400 / 2016)
    expect(paceOf(1_209_600)).toBe(600)
  })
})

describe('when β is known', () => {
  const T = 1_795_132_800
  const tip = { height: 976_480, time: T - 600 }
  it('with every end through the tip\'s last closed window, and a fresh tip', () => {
    expect(pacedKnown(T, EPOCH_ENDS, tip)).toBe(true)
  })
  it('not without a tip', () => {
    expect(pacedKnown(T, EPOCH_ENDS, null)).toBe(false)
  })
  it('not when the tip has closed a window whose end is missing', () => {
    expect(pacedKnown(T, EPOCH_ENDS, { height: windowEndHeight(484), time: T })).toBe(false)
    expect(pacedKnown(T, WITH_484, { height: windowEndHeight(484), time: T })).toBe(true)
  })
  it('not once the tip is too old to vouch the next window has not switched', () => {
    expect(pacedKnown(tip.time + TIP_FRESH_S - 1, EPOCH_ENDS, tip)).toBe(true)
    expect(pacedKnown(tip.time + TIP_FRESH_S, EPOCH_ENDS, tip)).toBe(false)
  })
  it('a run of ends stops at the first gap', () => {
    const times = new Map([[484, A484], [486, A484 + 2_000_000]])
    expect(contiguousEnds((k) => times.get(k), 486)).toEqual(WITH_484)
    expect(contiguousEnds(() => undefined, 485)).toEqual(EPOCH_ENDS)
  })
})

describe('skew', () => {
  it('is ignored within 2 s, and the median beyond it, with half a second for the header\'s truncation', () => {
    const at = (off: number, rtt = 100) => ({ sentMs: 1_000_000, gotMs: 1_000_000 + rtt, dateMs: 1_000_000 + rtt / 2 + off - 500 })
    expect(skewFrom([at(1500), at(1600), at(1400)])).toBe(0)
    expect(skewFrom([at(10_000), at(10_200), at(-50_000)])).toBe(10_000)
    expect(skewFrom([])).toBe(0)
  })
})

describe('the ease', () => {
  it('goes the shortest way round, never more than half a cycle', () => {
    expect(wrapHalf(0.25)).toBeCloseTo(0.25)
    expect(wrapHalf(0.75)).toBeCloseTo(-0.25)
    expect(wrapHalf(-0.9)).toBeCloseTo(0.1)
  })
  it('takes min(3 s, max(0.5 s, |e| × P))', () => {
    expect(easeSeconds(0.1, 2)).toBe(0.5)
    expect(easeSeconds(0.4, 5)).toBe(2)
    expect(easeSeconds(0.5, 60)).toBe(3)
  })
})
