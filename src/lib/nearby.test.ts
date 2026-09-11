import { describe, expect, it } from 'vitest'
import { foundLabel, itemNearby, nearbyItems, regionContains } from './nearby'

const anchor = { x: 1000n, y: 2000n, z: 3000n }

describe('a region holds a point', () => {
  it('when the point aligns to the region\'s base on every axis', () => {
    const base = { x: 1000n >> 4n << 4n, y: 2000n >> 4n << 4n, z: 3000n >> 4n << 4n }
    expect(regionContains({ base, heights: { x: 4, y: 4, z: 4 } }, anchor)).toBe(true)
    expect(regionContains({ base: { ...base, x: base.x + 16n }, heights: { x: 4, y: 4, z: 4 } }, anchor)).toBe(false)
  })

  it('takes a box with a height per axis, as a hop\'s key has', () => {
    const base = { x: '0', y: String(2000n >> 1n << 1n), z: '3000' }
    expect(regionContains({ base, heights: { x: 12, y: 1, z: 0 } }, anchor)).toBe(true)
    expect(regionContains({ base, heights: { x: 9, y: 1, z: 0 } }, anchor)).toBe(false)
  })
})

describe('an item is nearby', () => {
  it('when its own cube holds the anchor, in the same plane', () => {
    expect(itemNearby({ at: { x: 1007n, y: 2015n, z: 3001n }, height: 4, plane: 0 }, anchor, 0)).toBe(true)
    expect(itemNearby({ at: { x: 1007n, y: 2015n, z: 3001n }, height: 4, plane: 1 }, anchor, 0)).toBe(false)
    expect(itemNearby({ at: { x: 1040n, y: 2000n, z: 3000n }, height: 4, plane: 0 }, anchor, 0)).toBe(false)
  })

  it('at height 0 only on the exact point', () => {
    expect(itemNearby({ at: anchor, height: 0, plane: 0 }, anchor, 0)).toBe(true)
    expect(itemNearby({ at: { ...anchor, x: 1001n }, height: 0, plane: 0 }, anchor, 0)).toBe(false)
  })
})

describe('the nearby list', () => {
  const near = { key: 'near', at: { x: 1002n, y: 2001n, z: 3000n }, plane: 0 as const, height: 3 }
  const nearer = { key: 'nearer', at: { x: 1000n, y: 2000n, z: 3001n }, plane: 0 as const, height: 3 }
  const far = { key: 'far', at: { x: 5000n, y: 2000n, z: 3000n }, plane: 0 as const, height: 3 }
  const filed = { key: 'filed', at: { x: 9000n, y: 9000n, z: 9000n }, plane: 0 as const, height: 2, lookupId: 'ff'.repeat(32) }

  it('holds what the anchor\'s cubes hold, nearest first, and leaves the rest out', () => {
    const out = nearbyItems([near, far, nearer], [], anchor, 0)
    expect(out.map((x) => x.key)).toEqual(['nearer', 'near'])
    expect(out[0].distance).toBe(1n)
    expect(out[1].distance).toBe(2n)
  })

  it('includes an item filed under a held key whose region holds the anchor', () => {
    const keys = [{ lookupId: 'ff'.repeat(32), plane: 0 as const, height: 20, base: { x: '0', y: '0', z: '0' } }]
    expect(nearbyItems([filed], keys, anchor, 0).map((x) => x.key)).toEqual(['filed'])
    const elsewhere = [{ lookupId: 'ff'.repeat(32), plane: 0 as const, height: 4, base: { x: '9000', y: '9000', z: '9000' } }]
    expect(nearbyItems([filed], elsewhere, anchor, 0)).toHaveLength(0)
  })
})

describe('the toast', () => {
  it('says how many', () => {
    expect(foundLabel(1)).toBe('1 FOUND HERE')
    expect(foundLabel(3)).toBe('3 FOUND HERE')
  })
})
