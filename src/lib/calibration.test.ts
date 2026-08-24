/**
 * calibration.test.ts - the quiet benchmark's math, pinned down.
 *
 * Everything here fails silently in production: a fitted growth ratio below
 * the floor projects h19/h20 as affordable on a machine that dies at h18 (the
 * tab just stalls, no error anywhere), a stale or foreign cache serves
 * another machine's ceilings, an unmeasured gap projected upward from a cheap
 * low reading underquotes a height the data already showed to be expensive,
 * and a sidestep ceiling outside [20, 40] either promises hour-long hashes or
 * refuses walls the machine crosses in seconds. None of these throw; they
 * only recommend the wrong number.
 */

import { describe, expect, it } from 'vitest'
import {
  CACHE_TTL_MS,
  DEFAULT_HOP_HEIGHT,
  DEFAULT_SIDESTEP_HEIGHT,
  cacheValid,
  calibrationState,
  hopCeiling,
  projectCantorMs,
  recommendedHopHeight,
  recommendedSidestepHeight,
  sidestepCeiling,
  startCalibration,
  type CalibrationCacheEntry,
} from './calibration'

describe('projectCantorMs', () => {
  it('returns measured heights untouched', () => {
    expect(projectCantorMs({ 12: 10, 14: 40 }, 14)).toBe(40)
    expect(projectCantorMs({ 12: 10, 14: 40 }, 12)).toBe(10)
  })

  it('extrapolates upward at the fitted ratio when it is steeper than the floor', () => {
    // 100 -> 900 over two heights is 3x per height; 3 > 2.5 so the fit wins.
    expect(projectCantorMs({ 14: 100, 16: 900 }, 17)).toBeCloseTo(2700, 6)
    expect(projectCantorMs({ 14: 100, 16: 900 }, 18)).toBeCloseTo(8100, 6)
  })

  it('floors a too-flat fitted ratio at 2.5x per height', () => {
    // 100 -> 121 fits 1.1x per height, which no real machine exhibits; the
    // floor keeps the projection honest.
    expect(projectCantorMs({ 14: 100, 16: 121 }, 17)).toBeCloseTo(121 * 2.5, 6)
    expect(projectCantorMs({ 14: 100, 16: 121 }, 18)).toBeCloseTo(121 * 2.5 * 2.5, 6)
  })

  it('projects an unmeasured gap down from the measurement above it', () => {
    expect(projectCantorMs({ 14: 100, 16: 900 }, 15)).toBeCloseTo(300, 6)
  })

  it('uses the floor with a single measurement, and NaN with none', () => {
    expect(projectCantorMs({ 16: 100 }, 18)).toBeCloseTo(625, 6)
    expect(projectCantorMs({}, 16)).toBeNaN()
  })
})

describe('hopCeiling', () => {
  it('lets a fast machine keep h20', () => {
    // Fitted 2x floors to 2.5x: h20 projects to 4687.5 ms, inside 5000.
    expect(hopCeiling({ 12: 8, 14: 30, 16: 120 })).toBe(20)
  })

  it('caps a decent machine at h19', () => {
    // Same shape, 2.5x slower: h19 fits at 4687.5 ms, h20 busts at 11718.75.
    expect(hopCeiling({ 12: 19, 14: 75, 16: 300 })).toBe(19)
  })

  it('caps a slow machine at its last affordable measurement', () => {
    // h16 measured just inside budget; every projection above it busts.
    expect(hopCeiling({ 12: 75, 14: 600, 16: 4800 })).toBe(16)
  })

  it('drops below the measurements when even they bust the budget', () => {
    // h16 measured 9600 > 5000; h15 projects to 9600 / sqrt(8) ~ 3394.
    expect(hopCeiling({ 12: 150, 14: 1200, 16: 9600 })).toBe(15)
  })

  it('clamps to the floor when nothing fits, without underquoting the gaps', () => {
    // h13 projected upward from the cheap h12 would look affordable; it must
    // project down from the measured h14 instead and bust like everything else.
    expect(hopCeiling({ 12: 6000, 14: 20000, 16: 70000 })).toBe(12)
  })

  it('falls back to the default with nothing measured', () => {
    expect(hopCeiling({})).toBe(DEFAULT_HOP_HEIGHT)
  })
})

describe('sidestepCeiling', () => {
  it('derives the largest wall 2^(h+1) hashes fit in the budget', () => {
    // 1.5M hashes/s for 60 s affords 9e7 hashes: 2^26 fits, 2^27 does not.
    expect(sidestepCeiling(1_500_000)).toBe(25)
  })

  it('clamps both ends of the range', () => {
    expect(sidestepCeiling(1000)).toBe(20)
    expect(sidestepCeiling(1e12)).toBe(40)
  })

  it('falls back to the default on a junk rate', () => {
    expect(sidestepCeiling(0)).toBe(DEFAULT_SIDESTEP_HEIGHT)
    expect(sidestepCeiling(-5)).toBe(DEFAULT_SIDESTEP_HEIGHT)
    expect(sidestepCeiling(Number.NaN)).toBe(DEFAULT_SIDESTEP_HEIGHT)
  })
})

describe('cacheValid', () => {
  const entry: CalibrationCacheEntry = {
    version: 1,
    at: 1_000_000,
    fingerprint: '8:Mozilla/. (X; Linux x_)',
    cantorMsByHeight: { 12: 8, 14: 30, 16: 120 },
    sha256PerSec: 500_000,
  }

  it('accepts a fresh entry from the same machine', () => {
    expect(cacheValid(entry, entry.at + 1, entry.fingerprint)).toBe(true)
    expect(cacheValid(entry, entry.at + CACHE_TTL_MS - 1, entry.fingerprint)).toBe(true)
  })

  it('expires at the TTL', () => {
    expect(cacheValid(entry, entry.at + CACHE_TTL_MS, entry.fingerprint)).toBe(false)
  })

  it('rejects a timestamp from the future (the clock moved)', () => {
    expect(cacheValid(entry, entry.at - 1, entry.fingerprint)).toBe(false)
  })

  it('rejects another machine\'s fingerprint', () => {
    expect(cacheValid(entry, entry.at + 1, '4:Mozilla/. (M; Intel Mac OS X __)')).toBe(false)
  })

  it('rejects malformed or foreign shapes', () => {
    expect(cacheValid(null, 1, entry.fingerprint)).toBe(false)
    expect(cacheValid('junk', 1, entry.fingerprint)).toBe(false)
    expect(cacheValid({ ...entry, version: 2 }, entry.at + 1, entry.fingerprint)).toBe(false)
    expect(cacheValid({ ...entry, cantorMsByHeight: {} }, entry.at + 1, entry.fingerprint)).toBe(false)
    expect(cacheValid({ ...entry, sha256PerSec: 0 }, entry.at + 1, entry.fingerprint)).toBe(false)
    expect(cacheValid({ ...entry, cantorMsByHeight: { 12: 'fast' } }, entry.at + 1, entry.fingerprint)).toBe(false)
  })
})

describe('singleton under node', () => {
  it('serves the conservative defaults and stays pending without a Worker', () => {
    expect(calibrationState()).toBe('pending')
    expect(recommendedHopHeight()).toBe(DEFAULT_HOP_HEIGHT)
    expect(recommendedSidestepHeight()).toBe(DEFAULT_SIDESTEP_HEIGHT)
    // No Worker in node: startCalibration must no-op, not throw or spin.
    startCalibration()
    expect(calibrationState()).toBe('pending')
    expect(recommendedHopHeight()).toBe(DEFAULT_HOP_HEIGHT)
  })
})
