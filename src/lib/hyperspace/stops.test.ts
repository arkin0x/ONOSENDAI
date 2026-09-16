import { describe, expect, it } from 'vitest'
import { LANDFALL_DETAIL_SCALE_MAX, LANDFALL_SCALE_MAX, stopsDrawn } from './stops'

describe('stopsDrawn', () => {
  it('draws ports in ideaspace at every zoom', () => {
    for (const k of [0, 34, 60, 61, 82, 85]) expect(stopsDrawn(1, k)).toBe(true)
  })
  it('draws landfalls in dataspace only at 2^60 and below', () => {
    expect(LANDFALL_SCALE_MAX).toBe(60)
    for (const k of [0, 34, 59, 60]) expect(stopsDrawn(0, k)).toBe(true)
    for (const k of [61, 70, 82, 85]) expect(stopsDrawn(0, k)).toBe(false)
  })
})

describe('LANDFALL_DETAIL_SCALE_MAX', () => {
  it('sits inside the band where landfalls are drawn at all', () => {
    // A detail threshold above LANDFALL_SCALE_MAX would never be reached, and
    // one at it would leave no band of fine dots. 54 through 60 is the band.
    expect(LANDFALL_DETAIL_SCALE_MAX).toBeLessThan(LANDFALL_SCALE_MAX)
    expect(LANDFALL_DETAIL_SCALE_MAX).toBe(53)
    const fine = []
    for (let k = 0; k <= LANDFALL_SCALE_MAX; k++) if (k > LANDFALL_DETAIL_SCALE_MAX) fine.push(k)
    expect(fine).toEqual([54, 55, 56, 57, 58, 59, 60])
  })

  it('leaves every zoom a landfall can be aimed at below it', () => {
    // At or below the threshold the dots keep their world size, which is what
    // makes them large enough to select.
    for (const k of [0, 33, 52, LANDFALL_DETAIL_SCALE_MAX]) {
      expect(k > LANDFALL_DETAIL_SCALE_MAX).toBe(false)
      expect(stopsDrawn(0, k)).toBe(true)
    }
  })

  it('still draws the dots across the whole fine band', () => {
    // Small is not gone: the point of the band is that hyperjumps stay visible.
    for (const k of [54, 57, 60]) expect(stopsDrawn(0, k)).toBe(true)
    expect(stopsDrawn(0, 61)).toBe(false)
  })
})
