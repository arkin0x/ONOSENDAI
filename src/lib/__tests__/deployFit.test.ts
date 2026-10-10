/**
 * deployFit.test.ts: the default hiding height holds the whole model
 * (arkinox, 2026-10-01).
 */

import { describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT } from 'sno-core/shards'
import { fitCause, fitHeight, fitHeightAll, fitsAllAt, fitsAt, outsideAt, reachGibsons, reachTicks, sizeHeight, type FitPoint } from '../deployFit'
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

/**
 * A chest with shards aimed inside (arkinox, 2026-10-10): the height must
 * hold the chest's own point and every aimed point, each with its reach, in
 * one region, since a content stands at its own point only inside the
 * chest's region (chests.ts revealedIn).
 */
describe('fitHeightAll: one region for several points', () => {
  // Points of the same 2^12 cube that no 2^8 cube holds together.
  const base = (5n << 40n) + (3n << 20n)
  const chestAt: Position = { x: base + 7n, y: base + 7n, z: base + 7n }
  const near: FitPoint = { at: { x: base + 100n, y: base + 7n, z: base + 7n }, reach: 0n }
  const far: FitPoint = { at: { x: base + 2000n, y: base + 7n, z: base + 7n }, reach: 0n }

  it('with no extra points is exactly the single-shard fit', () => {
    for (const x of [1000n, 1023n, 1024n, 4095n, 70000n]) {
      const r = reachGibsons(cube(2), 0)
      expect(fitHeightAll(r, [], at(x), 0, 0, 40)).toBe(fitHeight(cube(2), 0, at(x), 0, 0, 40))
    }
    expect(fitHeightAll(reachGibsons(cube(8), 20), [], at(1000n), 0, 0, 12)).toBeNull()
  })

  it('is the smallest height whose region, around the deploy point, holds every point', () => {
    const h = fitHeightAll(0n, [near, far], chestAt, 0, 0, 40)!
    expect(h).toBe(11)
    expect(fitsAllAt(deployPoint(chestAt, 0, h), h, [near, far])).toBe(true)
    for (let lower = 0; lower < h; lower++) expect(fitsAllAt(deployPoint(chestAt, 0, lower), lower, [near, far])).toBe(false)
    // The near point alone asks for less.
    expect(fitHeightAll(0n, [near], chestAt, 0, 0, 40)).toBe(7)
  })

  it('a point with reach must fit whole: the same point raises the height when something big stands there', () => {
    const small = fitHeightAll(0n, [near], chestAt, 0, 0, 40)!
    const big = fitHeightAll(0n, [{ ...near, reach: 1000n }], chestAt, 0, 0, 40)!
    expect(big).toBeGreaterThan(small)
    expect(fitsAt(near.at, 1000n, big)).toBe(true)
  })

  it('two points in different cubes of a height do not fit it even when each fits its own', () => {
    const h = 9
    const a: FitPoint = { at: { x: (base >> 9n << 9n) + 10n, y: base, z: base }, reach: 0n }
    const b: FitPoint = { at: { x: (base >> 9n << 9n) + 600n, y: base, z: base }, reach: 0n }
    expect(fitsAt(a.at, 0n, h) && fitsAt(b.at, 0n, h)).toBe(true)
    expect(fitsAllAt(a.at, h, [b])).toBe(false)
  })

  it('is null when no height up to the ceiling holds them all', () => {
    expect(fitHeightAll(0n, [far], chestAt, 0, 0, 8)).toBeNull()
  })

  it('outsideAt counts the points the region at a height leaves out, which stand at the chest', () => {
    const h = fitHeightAll(0n, [near, far], chestAt, 0, 0, 40)!
    expect(outsideAt(deployPoint(chestAt, 0, h), h, [near, far])).toBe(0)
    expect(outsideAt(deployPoint(chestAt, 0, 8), 8, [near, far])).toBe(1)
    expect(outsideAt(deployPoint(chestAt, 0, 0), 0, [near, far])).toBe(2)
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
