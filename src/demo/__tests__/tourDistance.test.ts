/**
 * tourDistance.test.ts - a tour step's own camera distance, and the one from
 * before coming back after it (arkinox, 2026-10-27: step 2 "zoomed out too far").
 */
import { describe, expect, it } from 'vitest'
import { TourCameraState, atOwnPlace, tourDistance } from '../tourDistance'

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

describe('the rig\'s tour camera (review of #523)', () => {
  const BLOCK = { x: 5n, y: 6n, z: 7n }
  const ELSEWHERE = { x: 9n, y: 9n, z: 9n }
  const landfall = { distance: 20, dir: [0, 1, 0] as [number, number, number], at: BLOCK }
  const cube = { distance: 12, dir: null, at: null }

  it('own place: the same point, or no view for a step at your head', () => {
    expect(atOwnPlace(BLOCK, { ...BLOCK })).toBe(true)
    expect(atOwnPlace(BLOCK, ELSEWHERE)).toBe(false)
    expect(atOwnPlace(BLOCK, null)).toBe(false)
    expect(atOwnPlace(null, null)).toBe(true)
    expect(atOwnPlace(null, BLOCK)).toBe(false)
  })

  it('L1: a reframe gives the step\'s camera back only when the view has just arrived at its own place', () => {
    const t = new TourCameraState()
    t.step(landfall, 26)
    expect(t.take(true)).toEqual({ distance: 20, dir: [0, 1, 0] })
    // Block 1 landing late: arrived, at its place.
    t.reframed(true, { ...BLOCK })
    expect(t.take(true)).toEqual({ distance: 20, dir: [0, 1, 0] })
    // A stop tapped on the far side of Earth: arrived, somewhere else.
    t.reframed(true, ELSEWHERE)
    expect(t.take(true)).toBeNull()
    // A reframe while the view was already at block 1 (a far hop, a chain step): the pinch stays.
    t.reframed(false, { ...BLOCK })
    expect(t.take(true)).toBeNull()
  })

  it('L1: a step at your head takes its camera back on coming home, and not on a reframe already there', () => {
    const t = new TourCameraState()
    t.step(cube, 26)
    t.take(true)
    t.reframed(false, null)
    expect(t.take(true)).toBeNull()
    t.reframed(true, BLOCK)
    expect(t.take(true)).toBeNull()
    t.reframed(true, null)
    expect(t.take(true)).toEqual({ distance: 12, dir: null })
  })

  it('L3: a move that cannot be made yet (WALK, the eye gliding out) waits, and is made once it can be', () => {
    const t = new TourCameraState()
    t.step(cube, 26)
    t.take(true)
    // The next step has no camera: 26 is owed back, but WALK is on.
    t.step(null, 12)
    expect(t.take(false)).toBeNull()
    expect(t.take(false)).toBeNull()
    expect(t.take(true)).toEqual({ distance: 26, dir: null })
    expect(t.take(true)).toBeNull()
  })

  it('outside the tour nothing is owed and nothing moves', () => {
    const t = new TourCameraState()
    t.step(null, 40)
    t.reframed(true, null)
    expect(t.take(true)).toBeNull()
  })
})
