/**
 * fluidWishFree.test.ts - with gravity off, fluid WALK's forward and back go
 * along the whole look, pitch included (arkinox, 2026-11-27: "facing up,
 * forward only goes straight Y+ only"); the sides stay level; under gravity
 * forward stays laid flat on the ground, as before (lib/fluidWalk.ts wishOf).
 */

import { describe, expect, it } from 'vitest'
import { len, wishOf, type Vec } from '../fluidWalk'

// Looking 60 degrees up from facing -Z, +Y the view's up.
const pitch = Math.PI / 3
const forward: Vec = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) }
const right: Vec = { x: 1, y: 0, z: 0 }

describe('forward with gravity off follows the look', () => {
  it('free: forward is the look itself, up and on, at full length', () => {
    const w = wishOf(forward, right, 'y', 1, 0, null, 0, true)
    expect(w.y).toBeCloseTo(Math.sin(pitch))
    expect(w.z).toBeCloseTo(-Math.cos(pitch))
    expect(len(w)).toBeCloseTo(1)
  })

  it('free: back is the reverse of the look', () => {
    const w = wishOf(forward, right, 'y', -1, 0, null, 0, true)
    expect(w.y).toBeCloseTo(-Math.sin(pitch))
    expect(w.z).toBeCloseTo(Math.cos(pitch))
  })

  it('free: the sides stay level, across the look', () => {
    const tilted: Vec = { x: 0.98, y: 0.2, z: 0 }
    const w = wishOf(forward, tilted, 'y', 0, 1, null, 0, true)
    expect(w.y).toBe(0)
    expect(w.x).toBeCloseTo(1)
  })

  it('looking almost straight up, forward is almost straight up, not snapped to an axis plane', () => {
    const up: Vec = { x: 0, y: 0.995, z: -0.0998 }
    const w = wishOf(up, right, 'z', 1, 0, null, 0, true)
    expect(w.y).toBeGreaterThan(0.99)
    expect(w.z).toBeLessThan(0)
  })

  it('not free (gravity on): forward lies flat on the ground, as before', () => {
    const w = wishOf(forward, right, 'y', 1, 0, null, 0)
    expect(w.y).toBe(0)
    expect(w.z).toBeCloseTo(-1)
  })
})
