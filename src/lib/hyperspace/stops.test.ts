import { describe, expect, it } from 'vitest'
import { LANDFALL_SCALE_MAX, stopsDrawn } from './stops'

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
