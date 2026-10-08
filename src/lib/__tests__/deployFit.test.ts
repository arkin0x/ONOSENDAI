/**
 * deployFit.test.ts: the default hiding height holds the whole model
 * (arkinox, 2026-10-01).
 */

import { describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT } from 'sno-core/shards'
import { fitCause, fitHeight, fitsAt, reachGibsons, reachTicks, sizeHeight } from '../deployFit'
import { deployPoint, type Position } from '../space'

const T = TICKS_PER_UNIT
const cube = (n: number) => ({ vertices: [[0, 0, 0], [n, 0, 0], [0, n, 0], [n, n, n]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })), parts: undefined })
const at = (x: bigint, y = 1000n, z = 1000n): Position => ({ x, y, z })

describe('reach', () => {
  it('is the farthest vertex from the origin, in ticks and in gibsons at a scale', () => {
    expect(reachTicks(cube(3))).toBe(Math.ceil(Math.sqrt(3) * 3 * T))
    // One unit = 2^unit gibsons: a unit-4 model reaches 16 times as far.
    expect(reachGibsons(cube(3), 4)).toBe(BigInt(Math.ceil((Math.ceil(Math.sqrt(3) * 3 * T) * 16) / T)))
  })

  it('counts placed objects at their anchors', () => {
    expect(reachTicks({ vertices: [], parts: [{ ref: 0, at: [10 * T, 0, 0], turn: [0, 0, 0], step: 0 }] as never })).toBe(10 * T)
  })
})

describe('fitHeight', () => {
  it('is the smallest height whose region, around the point it would hide at, holds the whole reach', () => {
    for (const x of [1000n, 1023n, 1024n, 4095n, 70000n]) {
      const h = fitHeight(cube(2), 0, at(x), 0, 0, 40)!
      const r = reachGibsons(cube(2), 0)
      expect(fitsAt(deployPoint(at(x), 0, h), r, h)).toBe(true)
      // And no smaller height would do.
      for (let lower = 0; lower < h; lower++) expect(fitsAt(deployPoint(at(x), 0, lower), r, lower)).toBe(false)
    }
  })

  it('grows with the deploy scale, and the region is always at least twice the reach', () => {
    // An unaligned point well inside cyberspace. (A point on a big power-of-two
    // boundary needs a big region even for a small model, which is correct:
    // the model straddles the boundary.)
    const mid: Position = { x: 123456789012n, y: 98765432109n, z: 55555555555n }
    const small = fitHeight(cube(2), 0, mid, 0, 0, 60)!
    const big = fitHeight(cube(2), 10, mid, 0, 0, 60)!
    expect(big).toBeGreaterThanOrEqual(small)
    expect(1n << BigInt(big)).toBeGreaterThanOrEqual(2n * reachGibsons(cube(2), 10))
  })

  it('is null when no height up to the ceiling holds the model', () => {
    expect(fitHeight(cube(8), 20, at(1000n), 0, 0, 12)).toBeNull()
  })

  it('a region can never reach below zero on an axis', () => {
    expect(fitsAt(at(3n), 5n, 10)).toBe(false)
  })
})

describe('fitCause: size or place', () => {
  // About 2^10 across: reach is sqrt(3) * 4 units of 2^7 gibsons, 887 gibsons.
  const model = cube(4)
  const unit = 7
  const inside = (3n << 20n) + (1n << 10n)

  it('the size alone asks for a small height', () => {
    expect(sizeHeight(model, unit)).toBe(11)
    expect(sizeHeight({ vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }], parts: undefined }, 0)).toBe(0)
    const h = fitHeight(model, unit, at(inside, inside, inside), 0, 0, 40)
    expect(h).toBe(11)
    expect(fitCause(model, unit, h, 40)).toBe('size')
  })

  it('one gibson past a 2^30 boundary the fit jumps to 31, and the cause is the edge, not the size', () => {
    const h = fitHeight(model, unit, at((1n << 30n) + 1n, inside, inside), 0, 0, 40)
    expect(h).toBe(31)
    expect(fitCause(model, unit, h, 40)).toBe('edge')
  })

  it('next to coordinate 0 nothing fits, and that is the place too', () => {
    const h = fitHeight(model, unit, at(3n, inside, inside), 0, 0, 40)
    expect(h).toBeNull()
    expect(fitCause(model, unit, h, 40)).toBe('edge')
  })

  it('a model larger than any region up to the ceiling is the size', () => {
    expect(fitCause(cube(8), 20, fitHeight(cube(8), 20, at(1000n), 0, 0, 12), 12)).toBe('size')
  })
})
