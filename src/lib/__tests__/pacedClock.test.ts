/**
 * pacedClock.test.ts: the paced height β against the design note's own
 * numbers (anim-block-paced-design-2026-11-10 §2.2, real header times), when
 * β counts as known, the skew rule, and the ease's arithmetic.
 */
import { describe, expect, it } from 'vitest'
import {
  contiguousEnds, EPOCH_BETA, EPOCH_END_TIME, EPOCH_ENDS, EPOCH_PREV_END_TIME, lastClosedWindow, pacedHeight, pacedKnown,
  pacedSecondsPerBlock, skewFrom, SWITCH_DELAY_S, TIP_FRESH_S, windowEndHeight, wrapHalf, easeSeconds,
} from '../pacedClock'

/** Header time of 973,727, the end of window 482 (headers-v1 blob and NTH's backfilled anchor). */
const A482 = 1_793_300_370
const ENDS = [EPOCH_END_TIME, A482]
/** 2026-11-10 04:11:02 UTC, the note's worked example. */
const NOTE_T = Date.UTC(2026, 10, 10, 4, 11, 2) / 1000

describe('the epoch', () => {
  it('is window 481, its ends the header times of 969,695 and 971,711', () => {
    expect(windowEndHeight(480)).toBe(969_695)
    expect(windowEndHeight(481)).toBe(971_711)
    expect(EPOCH_PREV_END_TIME).toBe(1_791_011_720)
    expect(EPOCH_END_TIME).toBe(1_792_153_758)
    expect(lastClosedWindow(971_711)).toBe(481)
    expect(lastClosedWindow(971_710)).toBe(480)
    expect(lastClosedWindow(975_741)).toBe(482)
  })

  it('β is 971,712 at the epoch switch, and T_481 is 566.487 s', () => {
    const s481 = EPOCH_END_TIME + SWITCH_DELAY_S
    expect(s481).toBe(1_792_168_158)
    expect(pacedHeight(s481, EPOCH_ENDS)).toBe(EPOCH_BETA)
    expect(pacedSecondsPerBlock(s481, EPOCH_ENDS)).toBeCloseTo(566.487, 3)
    // Defined before it too, running backward at T_481.
    expect(pacedHeight(s481 - 566.4871031746031, EPOCH_ENDS)).toBeCloseTo(EPOCH_BETA - 1, 9)
  })
})

describe('the note\'s worked example (§2.2)', () => {
  it('β(s_482) = 973,736.074 and T_482 = 568.756 s', () => {
    const s482 = A482 + SWITCH_DELAY_S
    expect(pacedHeight(s482, ENDS)).toBeCloseTo(973_736.0743232712, 6)
    expect(pacedSecondsPerBlock(s482, ENDS)).toBeCloseTo(568.756, 3)
    // Continuous across the switch: only the slope changes.
    expect(pacedHeight(s482 - 1e-3, ENDS)).toBeCloseTo(pacedHeight(s482, ENDS), 4)
  })

  it('β at 2026-11-10 04:11:02 UTC is 975,439.955', () => {
    expect(pacedHeight(NOTE_T, ENDS)).toBeCloseTo(975_439.9545129081, 6)
  })

  it('before 482 is known, the same moment continues at T_481 (extrapolated, never shown)', () => {
    const b = pacedHeight(NOTE_T, EPOCH_ENDS)
    expect(b).toBeCloseTo(EPOCH_BETA + (NOTE_T - (EPOCH_END_TIME + SWITCH_DELAY_S)) / (1_142_038 / 2016), 6)
    expect(Math.abs(b - 975_439.955)).toBeGreaterThan(1)
  })
})

describe('when β is known', () => {
  const tip = { height: 975_741, time: NOTE_T - 600 }
  it('with every end through the tip\'s last closed window, and a fresh tip', () => {
    expect(pacedKnown(NOTE_T, ENDS, tip)).toBe(true)
  })
  it('not without a tip', () => {
    expect(pacedKnown(NOTE_T, ENDS, null)).toBe(false)
  })
  it('not when the tip has closed a window whose end is missing', () => {
    expect(pacedKnown(NOTE_T, EPOCH_ENDS, tip)).toBe(false)
    expect(pacedKnown(NOTE_T, ENDS, { height: 975_743, time: NOTE_T })).toBe(false)
  })
  it('not once the tip is too old to vouch the next window has not switched', () => {
    expect(pacedKnown(tip.time + TIP_FRESH_S - 1, ENDS, tip)).toBe(true)
    expect(pacedKnown(tip.time + TIP_FRESH_S, ENDS, tip)).toBe(false)
  })
  it('a run of ends stops at the first gap, and at an end that does not move forward', () => {
    const times = new Map([[482, A482], [484, A482 + 2_000_000]])
    expect(contiguousEnds((k) => times.get(k), 484)).toEqual([EPOCH_END_TIME, A482])
    expect(contiguousEnds(() => EPOCH_END_TIME - 5, 483)).toEqual([EPOCH_END_TIME])
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
