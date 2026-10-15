/**
 * syncChipLabel.test.ts - the hyperspace chip never says 100% before the
 * line is ready, and an error is not worded as a sync (2026-10-15: a chip
 * read SYNCING 100% for good on the /demo preview).
 */
import { describe, expect, it } from 'vitest'
import { syncChipLabel, syncPercentOf } from '../LineScrubber'

describe('the hyperspace chip label', () => {
  it('holds at 99% until ready: 99.5% loaded used to round to 100%', () => {
    expect(syncChipLabel('syncing', 971_000, 971_400, false, null)).toBe('HYPERSPACE SYNCING 99%')
    expect(syncChipLabel('syncing', 971_400, 971_400, false, null)).toBe('HYPERSPACE SYNCING 99%')
    expect(syncChipLabel('loading-cache', 950_000, 950_000, false, null)).toBe('HYPERSPACE LOADING 99%')
    expect(syncChipLabel('syncing', 485_000, 971_400, false, null)).toBe('HYPERSPACE SYNCING 49%')
  })

  it('says READY (or the destination) once ready', () => {
    expect(syncChipLabel('ready', 971_400, 971_400, true, null)).toBe('HYPERSPACE READY')
    expect(syncChipLabel('ready', 971_400, 971_400, true, 900_001)).toBe('HYPERSPACE 900001')
  })

  it('says RETRYING while the pipeline waits out an error, not a frozen SYNCING n%', () => {
    expect(syncChipLabel('error', 971_000, 971_400, false, null)).toBe('HYPERSPACE RETRYING')
  })

  it('shows every whole percent as itself: (29 / 100) * 100 floored to 28 (review, 2026-10-15)', () => {
    for (let p = 0; p <= 99; p++) {
      expect(syncPercentOf(p, 100)).toBe(p)
      // The scrubber hands the label a percent already taken, out of 100.
      expect(syncChipLabel('syncing', syncPercentOf(p, 100), 100, false, null)).toBe(`HYPERSPACE SYNCING ${p}%`)
    }
    expect(syncPercentOf(281_706, 971_400)).toBe(29)
  })

  it('reads 0% with no total yet', () => {
    expect(syncChipLabel('idle', 0, 0, false, null)).toBe('HYPERSPACE SYNCING 0%')
  })
})
