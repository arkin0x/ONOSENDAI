/**
 * tvLayer.test.ts: a spawning avatar grows from a point to its size.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { framingDirection, grownAt } from '../TvLayer'

describe('grownAt', () => {
  it('is whole for an avatar that did not spawn on screen', () => {
    expect(grownAt(undefined, 5)).toBe(1)
  })
  it('is nothing before the spawn, grows, and is whole after', () => {
    expect(grownAt(Infinity, 1000)).toBe(0)
    expect(grownAt(1000, 1000)).toBe(0)
    const half = grownAt(1000, 1450)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
    expect(grownAt(1000, 5000)).toBe(1)
  })
})

describe('framingDirection', () => {
  const sun = new Vector3(0.3, 0.2, 0.93).normalize()
  const base = { from: 13, to: 10, polar: 0.7, name: 'medium' as const, view: 'above' as const, spin: 1 as const }

  it('stands a sun shot on the far side of the subject from the sun, at any point of its sway', () => {
    for (const theta of [0, 0.4, 1.3, 2.9]) {
      const d = framingDirection({ ...base, sun: true }, theta, sun, new Vector3())
      // The camera looks along -d: toward the sun.
      expect(d.clone().negate().dot(sun)).toBeGreaterThan(0.7)
    }
  })

  it('circles an ordinary shot at its angle from overhead', () => {
    const d = framingDirection({ ...base, sun: false }, 1, sun, new Vector3())
    expect(d.y).toBeCloseTo(Math.cos(0.7))
    expect(d.length()).toBeCloseTo(1)
  })

  it('looks up at the sun from below on a below shot', () => {
    const d = framingDirection({ ...base, view: 'below', sun: true }, 0, sun, new Vector3())
    expect(d.y).toBeLessThan(0)
  })
})
