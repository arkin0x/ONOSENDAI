import { describe, expect, it } from 'vitest'
import { MESSAGE_SCALE_MAX, coinKind, itemDrawAs, madeBy, markShown, type CoinState } from '../worldMarks'

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

describe('itemDrawAs (arkinox, 2026-11-06)', () => {
  it('draws an item you made and hold as your own: the half model in the box at half, never the solid box', () => {
    expect(itemDrawAs(true, true, true)).toBe('own')
  })
  it('draws an item taken from someone else as taken: the half model, no box', () => {
    expect(itemDrawAs(true, true, false)).toBe('taken')
  })
  it('draws an item not held, yours placed and not picked up or deleted from ITEMS included, as itself', () => {
    expect(itemDrawAs(false, true, true)).toBe('item')
    expect(itemDrawAs(false, true, false)).toBe('item')
  })
  it('until ITEMS is read, draws it as held, so a reload never shows a held item whole for a moment', () => {
    expect(itemDrawAs(false, false, true)).toBe('own')
    expect(itemDrawAs(false, false, false)).toBe('taken')
    expect(itemDrawAs(true, false, true)).toBe('own')
  })
})

describe('madeBy', () => {
  it('is the signed-in identity’s own event, and nothing when nobody is signed in', () => {
    expect(madeBy('aa', 'aa')).toBe(true)
    expect(madeBy('bb', 'aa')).toBe(false)
    expect(madeBy(undefined, 'aa')).toBe(false)
    expect(madeBy('', '')).toBe(false)
  })
})
