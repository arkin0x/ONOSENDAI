import { describe, expect, it } from 'vitest'
import { hexToRgb, rgbToHex } from './shards'
import { hsvToRgb, rgbToHsv } from './hsv'

describe('hsv', () => {
  it('names the corners of the cube', () => {
    expect(rgbToHsv([1, 0, 0])).toEqual([0, 100, 100])
    expect(rgbToHsv([0, 1, 0])).toEqual([120, 100, 100])
    expect(rgbToHsv([0, 0, 1])).toEqual([240, 100, 100])
    expect(rgbToHsv([1, 1, 1])).toEqual([0, 0, 100])
    expect(rgbToHsv([0, 0, 0])).toEqual([0, 0, 0])
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual([0, 0, 50])
  })
  it('round-trips every palette colour through hex', () => {
    for (const hex of ['#00e5ff', '#ff3b6b', '#52e39f', '#ffb020', '#c07dff', '#f7931a', '#ffffff', '#000000', '#123456', '#abcdef']) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))))).toBe(hex)
    }
  })
  it('keeps hue continuous across the red seam', () => {
    expect(rgbToHsv(hsvToRgb([359, 80, 80]))[0]).toBeCloseTo(359, 5)
    expect(rgbToHsv(hsvToRgb([1, 80, 80]))[0]).toBeCloseTo(1, 5)
  })
})
