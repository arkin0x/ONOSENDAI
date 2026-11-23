/**
 * pointGlow.test.ts - the arithmetic behind POINT SIZE, RADIUS and GLOW
 * STRENGTH in the SHARD sheet: rails, steps, gibsons at a scale, typed values
 * and the LIGHT or FOG pre-pick.
 */
import { describe, expect, it } from 'vitest'
import { GLOW_REACH } from 'sno-core/glow'
import {
  POINT_AUTO, POINT_AUTO_SPAN, POINT_RAIL_MAX, RADIUS_RAIL_MAX, gibsonsText, meanPointColor, pointSizeAt, pointSizeFraction, radiusAt, radiusFraction,
  stepLadder, stepPointSize, stepRadius, stepStrength, strengthAt, strengthFraction, suggestedGlowStyle, typedStrength, typedTicks, maxGibsonsTyped,
} from '../pointGlow'

describe('POINT SIZE rail', () => {
  it('reads AUTO at the left end, then 0 to 2 units, squared', () => {
    expect(pointSizeAt(0)).toBe(POINT_AUTO)
    expect(pointSizeAt(POINT_AUTO_SPAN / 2)).toBe(POINT_AUTO)
    expect(pointSizeAt(POINT_AUTO_SPAN)).toBe(0)
    expect(pointSizeAt(1)).toBe(POINT_RAIL_MAX)
    expect(pointSizeAt(POINT_AUTO_SPAN + (1 - POINT_AUTO_SPAN) / 2)).toBe(POINT_RAIL_MAX / 4)
    expect(pointSizeAt(2)).toBe(POINT_RAIL_MAX)
    expect(pointSizeAt(Number.NaN)).toBe(POINT_AUTO)
  })

  it('puts a value back where the rail reads it, and holds past the rail at the right end', () => {
    expect(pointSizeFraction(POINT_AUTO)).toBe(0)
    expect(pointSizeFraction(0)).toBeCloseTo(POINT_AUTO_SPAN)
    for (const v of [6, 36, 60, 120, 240]) expect(pointSizeAt(pointSizeFraction(v))).toBe(v)
    expect(pointSizeFraction(GLOW_REACH)).toBe(1)
  })

  it('steps AUTO, 0, then round sizes to the cap', () => {
    expect(stepPointSize(POINT_AUTO, 1)).toBe(0)
    expect(stepPointSize(POINT_AUTO, -1)).toBe(POINT_AUTO)
    expect(stepPointSize(0, -1)).toBe(POINT_AUTO)
    expect(stepPointSize(0, 1)).toBe(6)
    expect(stepPointSize(36, 1)).toBe(48)
    expect(stepPointSize(40, -1)).toBe(36)
    expect(stepPointSize(GLOW_REACH, 1)).toBe(GLOW_REACH)
    // Past 64 units the steps double to the cap of 4,096 (DECK-0003 §1.8).
    expect(stepPointSize(6000, 1)).toBe(7680)
    expect(stepPointSize(7680, 1)).toBe(15360)
    expect(stepPointSize(245760, 1)).toBe(GLOW_REACH)
    expect(stepPointSize(GLOW_REACH, -1)).toBe(245760)
  })
})

describe('RADIUS and GLOW STRENGTH rails', () => {
  it('RADIUS runs 1 tick to 8 units across the rail, squared, with 2 units in the middle', () => {
    expect(radiusAt(0)).toBe(1)
    expect(radiusAt(1)).toBe(RADIUS_RAIL_MAX)
    expect(radiusAt(0.5)).toBe(240)
    expect(radiusAt(radiusFraction(120))).toBe(120)
    expect(radiusFraction(GLOW_REACH)).toBe(1)
    expect(stepRadius(1, -1)).toBe(1)
    expect(stepRadius(120, 1)).toBe(180)
    expect(stepRadius(GLOW_REACH, 1)).toBe(GLOW_REACH)
    expect(stepRadius(6000, 1)).toBe(7680)
    expect(stepRadius(GLOW_REACH, -1)).toBe(245760)
  })

  it('GLOW STRENGTH runs 1 to 100, steps 1 then fives', () => {
    expect(strengthAt(0)).toBe(1)
    expect(strengthAt(1)).toBe(100)
    expect(strengthFraction(1)).toBe(0)
    expect(strengthFraction(100)).toBe(1)
    expect(stepStrength(1, 1)).toBe(5)
    expect(stepStrength(5, -1)).toBe(1)
    expect(stepStrength(33, 1)).toBe(35)
    expect(stepStrength(100, 1)).toBe(100)
    expect(typedStrength('40')).toBe(40)
    expect(typedStrength('0')).toBe(1)
    expect(typedStrength('500')).toBe(100)
    expect(typedStrength('4.5')).toBeNull()
    expect(typedStrength('')).toBeNull()
  })

  it('a ladder steps from a value off it to the next one in the direction asked', () => {
    expect(stepLadder([1, 5, 10], 7, 1)).toBe(10)
    expect(stepLadder([1, 5, 10], 7, -1)).toBe(5)
    expect(stepLadder([1, 5, 10], 0, -1)).toBe(1)
  })
})

describe('gibsons at the object\'s scale', () => {
  it('at unit 0 a unit is one gibson, 120 ticks', () => {
    expect(gibsonsText(36, 0)).toEqual({ figure: '0.3', word: 'GIBSONS' })
    expect(gibsonsText(120, 0)).toEqual({ figure: '1', word: 'GIBSON' })
    expect(gibsonsText(0, 0)).toEqual({ figure: '0', word: 'GIBSONS' })
    expect(gibsonsText(GLOW_REACH, 0).figure).toBe('4096')
  })

  it('at a larger unit the same ticks are more gibsons, a power of two past a million', () => {
    expect(gibsonsText(36, 4)).toEqual({ figure: '4.8', word: 'GIBSONS' })
    expect(gibsonsText(120, 8).figure).toBe('256')
    expect(gibsonsText(120, 10).figure).toBe('1024')
    expect(gibsonsText(120, 20).figure).toBe('2^20')
    expect(gibsonsText(120, 60).figure).toBe('2^60')
  })

  it('reads typed gibsons as whole ticks at the scale, held to the cap', () => {
    expect(typedTicks('0.3', 0, 0)).toBe(36)
    expect(typedTicks('1', 0, 0)).toBe(120)
    expect(typedTicks('.5', 0, 0)).toBe(60)
    expect(typedTicks('1024', 10, 0)).toBe(120)
    expect(typedTicks('0', 0, 1)).toBe(1)
    expect(typedTicks('99999', 0, 0)).toBe(GLOW_REACH)
    expect(typedTicks('100', 0, 0)).toBe(12000)
    expect(typedTicks('0.001', 0, 0)).toBe(1)
    expect(typedTicks('3', 20, 0)).toBe(1)
    expect(typedTicks('0', 20, 0)).toBe(0)
    expect(typedTicks('', 0, 0)).toBeNull()
    expect(typedTicks('1.2.3', 0, 0)).toBeNull()
  })
})

describe('the most # takes', () => {
  it('is 4,096 units as plain digits the field can hold, and typing it back gives the cap', () => {
    expect(maxGibsonsTyped(0)).toBe('4096')
    expect(maxGibsonsTyped(20)).toBe('4294967296')
    expect(maxGibsonsTyped(80)).toMatch(/^\d+$/)
    for (const u of [0, 10, 20, 40, 80]) expect(typedTicks(maxGibsonsTyped(u), u, 0)).toBe(GLOW_REACH)
  })
})

describe('the LIGHT or FOG pre-pick', () => {
  const pts = (...cs: Array<[number, number, number]>) => ({ vertices: cs.map((c) => ({ p: [0, 0, 0] as [number, number, number], c })) })

  it('suggests LIGHT for bright points and FOG for dark ones', () => {
    expect(suggestedGlowStyle(pts([1, 0.9, 0.4], [1, 1, 0.8]), [0, 0, 0])).toBe('light')
    expect(suggestedGlowStyle(pts([0.2, 0.25, 0.2], [0.1, 0.15, 0.1]), [1, 1, 1])).toBe('fog')
  })

  it('reads the mean of the points, and the color in hand when there are none', () => {
    expect(meanPointColor(pts([1, 0, 0], [0, 1, 0]), [0, 0, 0])).toEqual([0.5, 0.5, 0])
    expect(suggestedGlowStyle(pts(), [1, 1, 1])).toBe('light')
    expect(suggestedGlowStyle(pts(), [0.05, 0.05, 0.05])).toBe('fog')
  })
})
