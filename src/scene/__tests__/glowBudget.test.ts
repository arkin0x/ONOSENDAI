/**
 * The glow budget (scene/glowBudget.ts): trusted first, nearest first, a
 * stranger's object capped, the strangers' share capped, the screen area
 * capped, and hysteresis so two objects at about one distance do not trade.
 */
import { describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import { GLOW_HYSTERESIS_DOUBLINGS, GLOW_LIMITS, allocateGlow, clearGlowPools, haloKey, joinGlow, spendGlow, type GlowDemand, type GlowLimits, type HaloEntry } from '../glowBudget'

const LIMITS: GlowLimits = { halos: 1000, strangerShare: 0.3, strangerObject: 200, screens: 100, largestHalo: 0.25, smallestHaloPx: 2, pointMinPx: 1.5, pointMaxPx: 64 }
const d = (key: number, over: Partial<GlowDemand> = {}): GlowDemand => ({ key, trusted: true, count: 400, distance: 1, area: 0, ...over })

describe('spending order', () => {
  it('trusted before strangers, whatever the distance', () => {
    const got = allocateGlow([d(1, { trusted: false, distance: 0 }), d(2, { distance: 9 }), d(3, { distance: 8 }), d(4, { distance: 7 })], { ...LIMITS, halos: 1000 })
    expect(got.get(4)).toBe(400)
    expect(got.get(3)).toBe(400)
    expect(got.get(2)).toBe(200)
    expect(got.get(1)).toBe(0)
  })
  it('nearest first within a trust', () => {
    const got = allocateGlow([d(1, { distance: 5 }), d(2, { distance: 1 }), d(3, { distance: 3 })], { ...LIMITS, halos: 600 })
    expect([got.get(2), got.get(3), got.get(1)]).toEqual([400, 200, 0])
  })
})

describe('caps', () => {
  it('a stranger\'s object draws at most strangerObject', () => {
    expect(allocateGlow([d(1, { trusted: false })], LIMITS).get(1)).toBe(200)
  })
  it('strangers together draw at most their share', () => {
    const got = allocateGlow([d(1, { trusted: false, distance: 1 }), d(2, { trusted: false, distance: 2 })], LIMITS)
    expect(got.get(1)! + got.get(2)!).toBe(300)
  })
  it('the screen area is spent nearest first', () => {
    // Each halo covers a tenth of a screen; 3 screens is 30 halos.
    const got = allocateGlow([d(1, { area: 0.1, distance: 2 }), d(2, { area: 0.1, distance: 1, count: 20 })], { ...LIMITS, screens: 3 })
    expect(got.get(2)).toBe(20)
    expect(got.get(1)).toBe(10)
  })
  it('halos too small to see cost no area', () => {
    expect(allocateGlow([d(1, { area: 0 })], { ...LIMITS, screens: 0 }).get(1)).toBe(400)
  })
  it('defaults for phone are tighter than desktop', () => {
    expect(GLOW_LIMITS.phone.halos).toBeLessThan(GLOW_LIMITS.desktop.halos)
    expect(GLOW_LIMITS.phone.screens).toBeLessThan(GLOW_LIMITS.desktop.screens)
    expect(GLOW_LIMITS.phone.largestHalo).toBeLessThan(GLOW_LIMITS.desktop.largestHalo)
    expect(GLOW_LIMITS.phone.pointMaxPx).toBeLessThan(GLOW_LIMITS.desktop.pointMaxPx)
  })
})

describe('hysteresis', () => {
  it('an object already drawing keeps its halos against one a little nearer', () => {
    const a = d(1, { distance: 4 }), b = d(2, { distance: 4 - GLOW_HYSTERESIS_DOUBLINGS / 2 })
    const fresh = allocateGlow([a, b], { ...LIMITS, halos: 400 })
    expect(fresh.get(2)).toBe(400)
    const held = allocateGlow([a, b], { ...LIMITS, halos: 400 }, new Map([[1, 400], [2, 0]]))
    expect(held.get(1)).toBe(400)
    expect(held.get(2)).toBe(0)
  })
  it('but not against one well nearer', () => {
    const got = allocateGlow([d(1, { distance: 4 }), d(2, { distance: 1 })], { ...LIMITS, halos: 400 }, new Map([[1, 400]]))
    expect(got.get(2)).toBe(400)
  })
})

describe('spendGlow, once a frame per canvas', () => {
  it('measures each object from the camera and writes what it may keep', () => {
    const canvas = {}
    const camera = new PerspectiveCamera(55, 1, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const entry = (z: number, trusted = true): HaloEntry => {
      const object = new Object3D()
      object.position.set(0, 0, z)
      object.updateMatrixWorld()
      return { key: haloKey(), trusted, count: 100, radius: 1, centre: new Vector3(), reach: 1, object, kept: -1 }
    }
    const near = entry(0), far = entry(-50)
    const leaveNear = joinGlow(canvas, near)
    joinGlow(canvas, far)
    // Halos about a fifth of the screen wide near, so the area runs out on the near object.
    spendGlow(canvas, 1, camera, 400, 400, { ...LIMITS, screens: 2 })
    expect(near.kept).toBeGreaterThan(0)
    expect(near.kept).toBeLessThan(100)
    expect(far.kept).toBeLessThan(100)
    // The same frame again does nothing.
    near.kept = -5
    spendGlow(canvas, 1, camera, 400, 400, { ...LIMITS, screens: 2 })
    expect(near.kept).toBe(-5)
    leaveNear()
    spendGlow(canvas, 2, camera, 400, 400, { ...LIMITS, screens: 2 })
    expect(far.kept).toBe(100)
    clearGlowPools(canvas)
  })
})
