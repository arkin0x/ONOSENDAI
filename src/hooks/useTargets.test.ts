import { describe, expect, it } from 'vitest'
import { onEarth } from './useTargets'

const C = 1n << 84n
const R = 6371n * 1000n * (1n << 33n)

describe('onEarth', () => {
  it('is the centre, a point on the surface, and a landfall, and nothing else', () => {
    expect(onEarth({ position: { x: C, y: C, z: C }, plane: 0 })).toBe(true)
    expect(onEarth({ position: { x: C + R, y: C, z: C }, plane: 0 })).toBe(true)
    expect(onEarth({ position: { x: C - R / 2n, y: C + R / 2n, z: C }, plane: 0 })).toBe(true)
    // The same coordinates in ideaspace are not a planet.
    expect(onEarth({ position: { x: C, y: C, z: C }, plane: 1 })).toBe(false)
    // A spawn, some 10^8 radii away.
    expect(onEarth({ position: { x: 1n, y: 1n, z: 1n }, plane: 0 })).toBe(false)
    expect(onEarth(null)).toBe(false)
  })
})
