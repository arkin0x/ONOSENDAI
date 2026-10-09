import { describe, expect, it } from 'vitest'
import { MESSAGE_SCALE_MAX, coinKind, markShown, type CoinState } from '../worldMarks'

describe('coinKind', () => {
  it('only a redeemed token makes a spent coin', () => {
    expect(coinKind('redeemed')).toBe('spent')
    for (const state of ['unclaimed', 'pending', 'unknown', 'checking', 'unreadable'] as CoinState[]) {
      expect(coinKind(state)).toBe('coin')
    }
  })
})

describe('markShown', () => {
  it('a live coin is drawn at every zoom', () => {
    for (let scaleExp = 0; scaleExp <= 85; scaleExp++) expect(markShown('coin', scaleExp)).toBe(true)
  })

  it('notes and spent coins are drawn at 2^1 and below, and not beyond', () => {
    expect(MESSAGE_SCALE_MAX).toBe(1)
    for (const kind of ['note', 'spent'] as const) {
      expect(markShown(kind, 0)).toBe(true)
      expect(markShown(kind, 1)).toBe(true)
      expect(markShown(kind, 2)).toBe(false)
      expect(markShown(kind, 33)).toBe(false)
    }
  })
})
