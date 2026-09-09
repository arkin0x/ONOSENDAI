import { describe, expect, it } from 'vitest'
import { contains, sizeLabel } from './SecretRegions'
import type { HeldKey } from '../store/useSecrets'

const key = (over: Partial<HeldKey>): HeldKey => ({
  lookupId: Math.random().toString(36), keyHex: 'aa', height: 4,
  base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'hop', at: 1, ...over,
})

describe('nesting', () => {
  it('a block inside a bigger one at the same corner is contained', () => {
    expect(contains(key({ height: 8 }), key({ height: 4 }))).toBe(true)
  })

  it('a block is not inside itself', () => {
    const k = key({ height: 8 })
    expect(contains(k, k)).toBe(false)
  })

  it('a bigger block is not inside a smaller one', () => {
    expect(contains(key({ height: 4 }), key({ height: 8 }))).toBe(false)
  })

  it('a block elsewhere is not contained, however small', () => {
    expect(contains(key({ height: 8 }), key({ height: 2, base: { x: '4096', y: '0', z: '0' } }))).toBe(false)
  })

  it('a bar inside a cube is contained', () => {
    const cube = key({ height: 8, heights: { x: 8, y: 8, z: 8 } })
    const bar = key({ height: 5, heights: { x: 5, y: 0, z: 0 } })
    expect(contains(cube, bar)).toBe(true)
  })

  it('a bar poking out of a cube on one axis is not', () => {
    const cube = key({ height: 4, heights: { x: 4, y: 4, z: 4 } })
    const bar = key({ height: 9, heights: { x: 9, y: 0, z: 0 } })
    expect(contains(cube, bar)).toBe(false)
  })

  it('the other plane is another world', () => {
    expect(contains(key({ height: 8 }), key({ height: 4, plane: 1 }))).toBe(false)
  })
})

describe('the size label', () => {
  it('says one number for a cube', () => {
    expect(sizeLabel(key({ height: 12 }))).toBe('2^12')
    expect(sizeLabel(key({ height: 12, heights: { x: 12, y: 12, z: 12 } }))).toBe('2^12')
  })

  it('says three for a box, because a box is three sizes', () => {
    expect(sizeLabel(key({ height: 7, heights: { x: 7, y: 0, z: 0 } }))).toBe('2^7×2^0×2^0')
  })
})
