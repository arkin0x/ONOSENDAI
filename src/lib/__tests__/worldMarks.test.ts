import { describe, expect, it } from 'vitest'
import { MESSAGE_SCALE_MAX, coinKind, itemDrawAs, markShown, type CoinState } from '../worldMarks'

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

describe('itemDrawAs', () => {
  it('draws a held item as the box, not the model', () => {
    expect(itemDrawAs(true, true, false)).toBe('box')
  })
  it('after a reload, no replay: held and read with nothing playing is the box, and so is anything until ITEMS is read', () => {
    expect(itemDrawAs(true, true, false)).toBe('box')
    expect(itemDrawAs(false, false, false)).toBe('box')
    expect(itemDrawAs(true, false, false)).toBe('box')
  })
  it('fades only on a TAKE playing now', () => {
    expect(itemDrawAs(true, true, true)).toBe('vanishing')
  })
  it('draws an item not held, one deleted from ITEMS included, as itself', () => {
    expect(itemDrawAs(false, true, false)).toBe('item')
    expect(itemDrawAs(false, true, true)).toBe('item')
  })
})
