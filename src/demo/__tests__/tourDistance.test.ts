/**
 * tourDistance.test.ts - a tour step's own camera distance, and the one from
 * before coming back after it (arkinox, 2026-10-27: step 2 "zoomed out too far").
 */
import { describe, expect, it } from 'vitest'
import { tourDistance } from '../tourDistance'

describe('a step with a camera distance', () => {
  it('moves the camera to it and keeps the distance it had', () => {
    expect(tourDistance(12, 26, null)).toEqual({ set: 12, saved: 26 })
  })

  it('gives the kept distance back on the first step without one, once', () => {
    const into = tourDistance(12, 26, null)
    const out = tourDistance(undefined, 12, into.saved)
    expect(out).toEqual({ set: 26, saved: null })
    expect(tourDistance(undefined, 26, out.saved)).toEqual({ set: null, saved: null })
  })

  it('keeps the first distance across a run of steps that each have one', () => {
    const a = tourDistance(12, 26, null)
    const b = tourDistance(8, 12, a.saved)
    expect(b).toEqual({ set: 8, saved: 26 })
    expect(tourDistance(undefined, 8, b.saved).set).toBe(26)
  })

  it('leaves the camera alone between steps that have none', () => {
    expect(tourDistance(undefined, 40, null)).toEqual({ set: null, saved: null })
  })
})
