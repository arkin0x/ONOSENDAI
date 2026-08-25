import { describe, expect, it } from 'vitest'
import { axesToLatLon } from './hyperspace/landfall'
import {
  earthRadiusCells,
  graticuleStep,
  latLonToCsMetres,
  originCsMetres,
  surfaceDetailOpacity,
  WGS84_A_M,
  WGS84_B_M,
  GIBSONS_PER_M,
} from './earthSurface'

const CENTRE = 1n << 84n

describe('latLonToCsMetres', () => {
  it('puts the reference points where WGS84 puts them', () => {
    // Equator at the prime meridian: +X_ecef = +X_cs, one semi-major out.
    const eq = latLonToCsMetres(0, 0)
    expect(eq.x).toBeCloseTo(WGS84_A_M, 6)
    expect(eq.y).toBeCloseTo(0, 6)
    expect(eq.z).toBeCloseTo(0, 6)
    // North pole: +Z_ecef, which the §9.4 permutation makes +Y_cs.
    const np = latLonToCsMetres(90, 0)
    expect(np.y).toBeCloseTo(WGS84_B_M, 3)
    expect(Math.abs(np.x)).toBeLessThan(1e-3)
    expect(Math.abs(np.z)).toBeLessThan(1e-3)
    // Equator at 90E: +Y_ecef, which is +Z_cs.
    const e90 = latLonToCsMetres(0, 90)
    expect(e90.z).toBeCloseTo(WGS84_A_M, 6)
    expect(Math.abs(e90.x)).toBeLessThan(1e-3)
  })

  it('round-trips through the landfall inverse', () => {
    for (const [lat, lon, alt] of [
      [31.6, -98.8, 0],
      [-45.2, 12.9, 0],
      [89, 170, 0],
      [0.001, 0.001, 5000],
    ]) {
      const m = latLonToCsMetres(lat, lon, alt)
      const u = (v: number): bigint => CENTRE + BigInt(Math.round(v * GIBSONS_PER_M))
      const back = axesToLatLon(u(m.x), u(m.y), u(m.z))
      expect(back.lat).toBeCloseTo(lat, 6)
      expect(back.lon).toBeCloseTo(lon, 6)
      expect(back.altM).toBeCloseTo(alt, 2)
    }
  })
})

describe('originCsMetres', () => {
  it('is exact at the mapping centre and metre-true nearby', () => {
    const at = originCsMetres({ x: CENTRE, y: CENTRE, z: CENTRE })
    expect(at).toEqual({ x: 0, y: 0, z: 0 })
    const oneKm = originCsMetres({ x: CENTRE + BigInt(1000 * GIBSONS_PER_M), y: CENTRE, z: CENTRE })
    expect(oneKm.x).toBeCloseTo(1000, 6)
  })
})

describe('earthRadiusCells', () => {
  it('crosses the 96-cell globe gate between 2^49 and 2^50', () => {
    // The globe draws while its diameter fits GRID_RADIUS * 8 = 192 cells;
    // the patch owns everything below. 2^49 is exactly where the user
    // watched the old wire sphere disappear.
    expect(earthRadiusCells(49) * 2).toBeGreaterThan(192)
    expect(earthRadiusCells(50) * 2).toBeLessThan(192)
  })
})

describe('graticuleStep', () => {
  it('picks chart-like rulings', () => {
    expect(graticuleStep(60)).toBe(10)
    expect(graticuleStep(6)).toBe(1)
    expect(graticuleStep(0.06)).toBe(0.01)
    expect(graticuleStep(0.8)).toBe(0.1)
  })

  it('never returns more than the window over the line count', () => {
    for (const w of [179, 43, 7.7, 1.3, 0.21, 0.033, 0.0041]) {
      expect(graticuleStep(w)).toBeLessThanOrEqual(w / 6)
      expect(graticuleStep(w)).toBeGreaterThan(0)
    }
  })
})

describe('surfaceDetailOpacity', () => {
  it('is full at human scale, gone below metre scale', () => {
    expect(surfaceDetailOpacity(49)).toBe(1)
    expect(surfaceDetailOpacity(34)).toBe(1)
    expect(surfaceDetailOpacity(33)).toBeCloseTo(2 / 3, 5)
    expect(surfaceDetailOpacity(31)).toBe(0)
    expect(surfaceDetailOpacity(0)).toBe(0)
  })
})
