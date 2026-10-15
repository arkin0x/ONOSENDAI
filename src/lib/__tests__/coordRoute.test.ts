/**
 * coordRoute.test.ts - /C/<hex>: what a path parses to, the region a prefix
 * fixes, and finding a block by its merkle root or hash.
 */
import { describe, expect, it } from 'vitest'
import { coordToXyz, xyzToCoord } from 'cyberspace-core'
import { coordLink, coordPlace, frameScale, parseCoordRoute, placeHex, prefixRegion } from '../coordRoute'
import { appendStops, createStopIndex, rowByRootOrHash } from '../hyperspace/compactIndex'
import { hexToBytes } from '../events'
import type { Stop } from '../hyperspace/stops'

const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9f'

describe('parseCoordRoute', () => {
  it('is null away from /C/', () => {
    expect(parseCoordRoute('/')).toBeNull()
    expect(parseCoordRoute('/Cx/abc')).toBeNull()
  })
  it('reads a full coordinate, case-insensitive, with or without 0x, either /C/ or /c/', () => {
    expect(parseCoordRoute(`/C/${FULL}`)).toEqual({ kind: 'full', hex: FULL })
    expect(parseCoordRoute(`/c/0x${FULL.toUpperCase()}/`)).toEqual({ kind: 'full', hex: FULL })
  })
  it('reads 1 to 63 characters as a prefix', () => {
    expect(parseCoordRoute('/C/A')).toEqual({ kind: 'prefix', hex: 'a' })
    expect(parseCoordRoute(`/C/${FULL.slice(0, 63)}`)).toEqual({ kind: 'prefix', hex: FULL.slice(0, 63) })
  })
  it('refuses what is not hex, empty, or too long', () => {
    expect(parseCoordRoute('/C/xyz')).toEqual({ kind: 'invalid', raw: 'xyz' })
    expect(parseCoordRoute('/C/')).toEqual({ kind: 'invalid', raw: '' })
    expect(parseCoordRoute(`/C/${FULL}0`)?.kind).toBe('invalid')
  })
})

describe('prefixRegion', () => {
  it('one character fixes x84 y84 z84 x83: the cube halved on each axis, x quartered', () => {
    const r = prefixRegion('f')
    expect(r.heights).toEqual({ x: 83, y: 84, z: 84 })
    expect(r.base).toEqual({ x: 3n << 83n, y: 1n << 84n, z: 1n << 84n })
    expect(r.maxHeight).toBe(84)
  })
  it('63 characters leave one gibson per axis free and the plane bit open', () => {
    expect(prefixRegion(FULL.slice(0, 63)).heights).toEqual({ x: 1, y: 1, z: 1 })
  })
  it('the heights fall by one bit per axis in the interleaving order', () => {
    // 4n fixed bits, 3 per axis level: x leads, then y, then z.
    for (let n = 1; n <= 63; n++) {
      const { heights } = prefixRegion(FULL.slice(0, n))
      const fixed = 4 * n
      const level = (offset: number): number => {
        let h = 0
        for (let i = 0; i < 85; i++) if (offset + 3 * i < 256 - fixed) h++
        return h
      }
      expect(heights).toEqual({ x: level(3), y: level(2), z: level(1) })
    }
  })
  it('every coordinate starting with the prefix lies inside its box, and only those', () => {
    const { x, y, z } = coordToXyz(BigInt('0x' + FULL))
    for (const n of [1, 2, 7, 16, 21, 40, 63]) {
      const r = prefixRegion(FULL.slice(0, n))
      for (const [v, base, h] of [[x, r.base.x, r.heights.x], [y, r.base.y, r.heights.y], [z, r.base.z, r.heights.z]] as const) {
        expect(v >= base && v < base + (1n << BigInt(h))).toBe(true)
      }
      // The box's corner and center encode back to the same prefix.
      expect(placeHex(r.base, 0).slice(0, n)).toBe(FULL.slice(0, n))
      expect(placeHex(r.center, 0).slice(0, n)).toBe(FULL.slice(0, n))
    }
  })
  it('refuses a full coordinate: 64 characters are a single gibson, not a region', () => {
    expect(() => prefixRegion(FULL)).toThrow()
  })
})

describe('a full coordinate', () => {
  it('is one gibson, in the plane its last bit names', () => {
    const p = coordPlace(FULL)
    expect(p.plane).toBe(1)
    expect(placeHex(p.position, p.plane)).toBe(FULL)
    expect(coordPlace(FULL.slice(0, 63) + 'e').plane).toBe(0)
  })
  it('round-trips random 256-bit values', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      const p = coordPlace(hex)
      expect(xyzToCoord(p.position.x, p.position.y, p.position.z, p.plane).toString(16).padStart(64, '0')).toBe(hex)
    }
  })
})

describe('links and framing', () => {
  it('builds the link on the serving origin', () => {
    expect(coordLink('https://www.onosendai.tech/', FULL)).toBe(`https://www.onosendai.tech/C/${FULL}`)
  })
  it('frames a box about eight cells across, clamped to the ladder', () => {
    expect(frameScale(84, 84)).toBe(81)
    expect(frameScale(2, 84)).toBe(0)
  })
})

describe('rowByRootOrHash', () => {
  const stop = (height: number, root: string, hash: string | null, port: boolean): Stop => ({
    height, kind: port ? 'port' : 'landfall', merkleRoot: root, blockHash: hash,
    coordExact: port ? BigInt('0x' + root) : null, coordApprox: BigInt('0x' + root),
  })
  it('finds a block by its merkle root or its hash, and nothing else', () => {
    const index = createStopIndex()
    const a = '11'.repeat(31) + '13'
    const b = '22'.repeat(31) + '24'
    const hb = '33'.repeat(32)
    appendStops(index, [stop(5, a, null, true), stop(6, b, hb, false)])
    expect(rowByRootOrHash(index, hexToBytes(a))).toBeGreaterThanOrEqual(0)
    expect(index.heights[rowByRootOrHash(index, hexToBytes(b))]).toBe(6)
    expect(index.heights[rowByRootOrHash(index, hexToBytes(hb))]).toBe(6)
    expect(rowByRootOrHash(index, hexToBytes('44'.repeat(32)))).toBe(-1)
  })
})
