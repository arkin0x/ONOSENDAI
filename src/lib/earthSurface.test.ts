import { describe, expect, it } from 'vitest'
import { axesToLatLon } from './hyperspace/landfall'
import {
  csMetresToLatLon,
  earthRadiusCells,
  formatLatLonDeg,
  graticuleStep,
  latLonToCsMetres,
  originCsMetres,
  sphereRing,
  surfaceDetailOpacity,
  surfaceHit,
  surfacePosition,
  WGS84_A_M,
  WGS84_B_M,
  GIBSONS_PER_M,
} from './earthSurface'
import type { ViewAxes } from './space'

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
  it('is exact at the mapping centre and meter-true nearby', () => {
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
  it('is full at human scale, gone below meter scale', () => {
    expect(surfaceDetailOpacity(49)).toBe(1)
    expect(surfaceDetailOpacity(34)).toBe(1)
    // The ground holds to 2^32, the last height the planet is drawn at.
    expect(surfaceDetailOpacity(32)).toBe(1)
    expect(surfaceDetailOpacity(31)).toBeCloseTo(1 / 2, 5)
    expect(surfaceDetailOpacity(30)).toBe(0)
    expect(surfaceDetailOpacity(0)).toBe(0)
  })
})

describe('csMetresToLatLon', () => {
  it('reads the poles off the axis', () => {
    expect(csMetresToLatLon({ x: 0, y: WGS84_B_M, z: 0 })).toEqual({ lat: 90, lon: 0, altM: 0 })
    const south = csMetresToLatLon({ x: 0, y: -(WGS84_B_M + 100), z: 0 })
    expect(south.lat).toBe(-90)
    expect(south.altM).toBeCloseTo(100, 6)
  })
})

const IDENTITY: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const TURNED: ViewAxes = { right: { axis: 'z', dir: -1 }, up: { axis: 'x', dir: 1 }, out: { axis: 'y', dir: -1 } }

/** The globe's forward placement of a surface point: cells from the planet's centre per screen axis. */
function forward(lat: number, lon: number, scaleExp: number, axes: ViewAxes, quantize: (v: number) => number): [number, number, number] {
  const m = latLonToCsMetres(lat, lon, 0)
  const cellM = 2 ** (scaleExp - 33)
  return [axes.right, axes.up, axes.out].map((a) => quantize((m[a.axis] / cellM) * a.dir)) as [number, number, number]
}

const PLACES: Array<[number, number]> = [[31.6, -98.8], [-45.2, 12.9], [0, 0], [89.9, 170], [-89.5, -30], [51.5, 0.1]]

describe('surfaceHit', () => {
  it('round-trips a place through render units and back, on the ellipsoid, within a meter', () => {
    for (const [lat, lon] of PLACES) {
      const want = latLonToCsMetres(lat, lon, 0)
      for (const scaleExp of [50, 53, 56]) {
        for (const axes of [IDENTITY, TURNED]) {
          // The hit as the raycaster hands it over: float64 from float32
          // vertices. Quantizing the cells to float32 is the honest floor;
          // at 2^50 a cell is 131 km and float32 resolves it to about a
          // meter, and the click itself is coarser than that by far.
          const exact = surfaceHit(forward(lat, lon, scaleExp, axes, (v) => v), scaleExp, axes)
          const got = originCsMetres(exact.position)
          expect(Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z)).toBeLessThan(1e-6)
          expect(exact.lat).toBeCloseTo(lat, 8)
          expect(exact.lon).toBeCloseTo(lon, 8)
          expect(Math.abs(axesToLatLon(exact.position.x, exact.position.y, exact.position.z).altM)).toBeLessThan(1e-6)
        }
      }
      const f32 = surfaceHit(forward(lat, lon, 50, IDENTITY, Math.fround), 50, IDENTITY)
      const got = originCsMetres(f32.position)
      expect(Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z)).toBeLessThan(1)
    }
  })

  it('snaps a hit on the mean-radius sphere onto the ellipsoid', () => {
    // The click lands on a sphere of radius 6371 km, which is inside the
    // ellipsoid at the equator and outside it at the poles; the focus is
    // the geodetic foot of that hit, on the ground.
    for (const [lat, lon] of PLACES) {
      const dir = latLonToCsMetres(lat, lon, 0)
      const len = Math.hypot(dir.x, dir.y, dir.z)
      const cellM = 2 ** (50 - 33)
      const k = (6371_000 / len) / cellM
      const hit = surfaceHit([dir.x * k, dir.y * k, dir.z * k], 50, IDENTITY)
      expect(Math.abs(axesToLatLon(hit.position.x, hit.position.y, hit.position.z).altM)).toBeLessThan(1e-6)
      expect(hit.lat).toBeCloseTo(lat, 0)
      expect(hit.lon).toBeCloseTo(lon, 6)
    }
  })
})

describe('surfacePosition', () => {
  it('is the ellipsoid point in gibsons, to a nanometer', () => {
    const p = surfacePosition(31.6, -98.8)
    const back = axesToLatLon(p.x, p.y, p.z)
    expect(back.lat).toBeCloseTo(31.6, 9)
    expect(back.lon).toBeCloseTo(-98.8, 9)
    expect(Math.abs(back.altM)).toBeLessThan(1e-7)
  })
})

describe('sphereRing', () => {
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

  it('lies on the sphere and on the ellipsoid at both ends of the range', () => {
    for (const [lat, lon] of PLACES) {
      const c = latLonToCsMetres(lat, lon, 0)
      for (const radiusM of [2 ** 21, 2 ** 12, 16]) {
        const ring = sphereRing(c, radiusM, 64)
        expect(ring).not.toBeNull()
        expect(ring!.length).toBe(64)
        for (const [rlat, rlon] of ring!) {
          const p = latLonToCsMetres(rlat, rlon, 0)
          expect(Math.abs(dist(p, c) - radiusM)).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('is a ring: spread around the centre, not bunched on one side', () => {
    const c = latLonToCsMetres(31.6, -98.8, 0)
    const ring = sphereRing(c, 2 ** 21, 8)!
    // Opposite vertices are a diameter apart, to the ellipsoid's curvature.
    const p0 = latLonToCsMetres(ring[0][0], ring[0][1], 0)
    const p4 = latLonToCsMetres(ring[4][0], ring[4][1], 0)
    expect(dist(p0, p4)).toBeGreaterThan(2 * 2 ** 21 * 0.95)
    // The first vertex is due north of the centre, and the fourth due south.
    expect(ring[0][0]).toBeGreaterThan(31.6 + 18)
    expect(ring[4][0]).toBeLessThan(31.6 - 18)
  })

  it('works from a pole, where azimuth is longitude', () => {
    const ring = sphereRing({ x: 0, y: WGS84_B_M, z: 0 }, 2 ** 21, 12)!
    expect(ring.length).toBe(12)
    for (const [lat] of ring) expect(lat).toBeCloseTo(90 - 18.9, 0)
    const lons = ring.map(([, lon]) => lon)
    expect(new Set(lons.map((l) => Math.round(l))).size).toBe(12)
  })

  it('is absent when the sphere does not reach the ground', () => {
    const up = latLonToCsMetres(31.6, -98.8, 100)
    expect(sphereRing(up, 16, 8)).toBeNull()
    expect(sphereRing(up, 2 ** 12, 8)).not.toBeNull()
  })
})

describe('formatLatLonDeg', () => {
  it('names the hemispheres to a tenth of a degree', () => {
    expect(formatLatLonDeg(31.63, -98.85)).toBe('31.6°N 98.8°W')
    expect(formatLatLonDeg(-54.83, 129.06)).toBe('54.8°S 129.1°E')
    expect(formatLatLonDeg(0, 0)).toBe('0.0°N 0.0°E')
  })
})
