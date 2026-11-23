/**
 * regionCovering.test.ts - the covering-prefix math region mode grows a
 * selection with (lib/coordRoute.ts coveringPrefix, coveringRegion,
 * cellCorners). It reuses prefixRegion, so a region picked here is the same
 * box relay.onosendai.tech/C/<hex> serves (regionPrefixVectors.test.ts owns
 * that the box matches the relay).
 */

import { describe, expect, it } from 'vitest'
import { cellCorners, coveringPrefix, coveringRegion, placeHex, prefixRegion } from '../coordRoute'
import type { Position } from '../space'

/** Whether `p` lies in the box a prefix region fixes. */
function inRegion(p: Position, prefix: string): boolean {
  const r = prefixRegion(prefix)
  return (['x', 'y', 'z'] as const).every((a) => p[a] >= r.base[a] && p[a] < r.base[a] + (1n << BigInt(r.heights[a])))
}

const P = (x: bigint, y: bigint, z: bigint): Position => ({ x, y, z })

describe('cellCorners', () => {
  it('is the whole aligned cell: low corner floored, high corner one short of the next cell', () => {
    const [lo, hi] = cellCorners(P(37n, 100n, 5n), 4)
    // 2^4 = 16: 37 floors to 32, 100 to 96, 5 to 0; each high corner is +15.
    expect(lo).toEqual(P(32n, 96n, 0n))
    expect(hi).toEqual(P(47n, 111n, 15n))
  })
  it('at zoom 0 a cell is one gibson: low and high are the point', () => {
    const [lo, hi] = cellCorners(P(9n, 9n, 9n), 0)
    expect(lo).toEqual(P(9n, 9n, 9n))
    expect(hi).toEqual(P(9n, 9n, 9n))
  })
})

describe('coveringPrefix', () => {
  it('a single point gives a 63-hex prefix (the finest region) that holds it', () => {
    const p = P(123456789n, 987654321n, 555n)
    const got = coveringPrefix([p], 0)
    expect(got).not.toBeNull()
    expect(got!.prefix.length).toBe(63)
    expect(got!.prefix).toBe(placeHex(p, 0).slice(0, 63))
    expect(inRegion(p, got!.prefix)).toBe(true)
  })

  it('two points give their longest shared hex run, and the box holds both', () => {
    const a = P(100n, 200n, 300n)
    const b = P(100n, 200n, 8_000_000n)
    const got = coveringPrefix([a, b], 0)!
    const shared = commonHex(placeHex(a, 0), placeHex(b, 0))
    expect(got.prefix).toBe(shared)
    expect(inRegion(a, got.prefix)).toBe(true)
    expect(inRegion(b, got.prefix)).toBe(true)
  })

  it('points with no shared top hex have no region (the whole space is not one)', () => {
    // Differ in the very top bits of x: x bit is near the top of the coord.
    const a = P(0n, 0n, 0n)
    const b = P((1n << 84n), 0n, 0n)
    expect(coveringPrefix([a, b], 0)).toBeNull()
  })

  it('the plane passed does not change the prefix (a region of <=63 hex never fixes the plane)', () => {
    const pts = [P(10n, 20n, 30n), P(10n, 20n, 90n)]
    expect(coveringPrefix(pts, 0)!.prefix).toBe(coveringPrefix(pts, 1)!.prefix)
  })
})

describe('coveringRegion grows to hold whole cells', () => {
  it('two adjacent cells share a short prefix; two far cells need a shorter one (a bigger region)', () => {
    const near = coveringRegion([P(0n, 0n, 0n), P(16n, 0n, 0n)], 4, 0)!
    const far = coveringRegion([P(0n, 0n, 0n), P(1n << 40n, 0n, 0n)], 4, 0)!
    // Both hold both cells.
    expect(inRegion(P(0n, 0n, 0n), near.prefix)).toBe(true)
    expect(inRegion(P(16n, 0n, 0n), near.prefix)).toBe(true)
    expect(inRegion(P((1n << 40n), 0n, 0n), far.prefix)).toBe(true)
    // The far pair's region is coarser: a shorter prefix.
    expect(far.prefix.length).toBeLessThan(near.prefix.length)
  })

  it('a cell contributes both its corners, so the region holds the whole cell, not just the cursor gibson', () => {
    const got = coveringRegion([P(40n, 40n, 40n)], 6, 0)!
    const [lo, hi] = cellCorners(P(40n, 40n, 40n), 6)
    expect(inRegion(lo, got.prefix)).toBe(true)
    expect(inRegion(hi, got.prefix)).toBe(true)
  })
})

/** The leading hex two coords share. */
function commonHex(a: string, b: string): string {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(0, i)
}
