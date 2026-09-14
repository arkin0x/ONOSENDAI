/**
 * earthSurface.ts - float64 WGS84 helpers for drawing Earth's surface.
 *
 * The planet spans about forty binary orders of magnitude of zoom, and the
 * old renderer could only draw it at the top six: a sphere mesh built around
 * Earth's CENTRE stops fitting the grid below 2^50 (its radius is
 * 2^(55.6 - scaleExp) render cells), and a sphere big enough to stand on
 * would need float32 vertices at magnitudes where they quantize visibly.
 *
 * The way out is the render convention the whole scene already lives by:
 * never hand a large absolute to the GPU. Surface vertices are produced as
 * DELTAS from the render origin, computed in float64 METRES. Both the vertex
 * and the origin carry about a nanometer of representation error at
 * Earth-radius magnitudes (float64 ulp, tens of gibsons), so their
 * difference does too, and a few nanometers is invisible at every scale the
 * surface draws at. No Decimal derivation is needed anywhere in the render
 * path; the consensus-critical decimal profile stays in landfall.ts where
 * verifiers need it.
 *
 * Everything here is pure: the scene components own subscription, geometry
 * and materials.
 */

import type { AxisDirection, Position, ViewAxes } from './space'

export const WGS84_A_M = 6378137
export const WGS84_F = 1 / 298.257223563
export const WGS84_B_M = WGS84_A_M * (1 - WGS84_F)
const E2 = WGS84_F * (2 - WGS84_F)

/** §9.7: 1 meter = 2^33 gibsons (Cantor height 34 is 2 meters). */
export const GIBSONS_PER_M = 2 ** 33

/** §9.7: the WGS84 mapping is centred on the half-axis point. */
const CENTRE = 1n << 84n

/** Mean radius in km, the same summary Earth.tsx has always drawn. */
export const EARTH_RADIUS_KM = 6371

/** Cyberspace axis values in meters from the mapping centre (float64). */
export interface CsMetres {
  x: number
  y: number
  z: number
}

/**
 * Geodetic latitude/longitude (degrees) and height above the ellipsoid
 * (meters) to cyberspace axis meters. Standard geodetic-to-ECEF, then the
 * §9.4 permutation: X_cs = X_ecef, Y_cs = Z_ecef, Z_cs = Y_ecef.
 */
export function latLonToCsMetres(latDeg: number, lonDeg: number, altM = 0): CsMetres {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const s = Math.sin(lat)
  const c = Math.cos(lat)
  const n = WGS84_A_M / Math.sqrt(1 - E2 * s * s)
  const X = (n + altM) * c * Math.cos(lon)
  const Y = (n + altM) * c * Math.sin(lon)
  const Z = (n * (1 - E2) + altM) * s
  return { x: X, y: Z, z: Y }
}

/**
 * The render origin's axis values in meters from the mapping centre. The
 * bigint subtraction happens first, so the Number conversion sees a value
 * of Earth-radius magnitude (or the origin's true offset), never 2^84.
 */
export function originCsMetres(origin: Position): CsMetres {
  return {
    x: Number(origin.x - CENTRE) / GIBSONS_PER_M,
    y: Number(origin.y - CENTRE) / GIBSONS_PER_M,
    z: Number(origin.z - CENTRE) / GIBSONS_PER_M,
  }
}

/**
 * A surface point as a render-space vertex: meter deltas from the origin,
 * to cells at this scale, through the screen axis mapping, with the
 * continuous family's -0.5 shift (the one pointCentre and the globe's own
 * centre apply), so the surface stays glued to the landfall shell and the
 * cell-drawn world around it.
 */
export function surfaceVertex(
  latDeg: number,
  lonDeg: number,
  altM: number,
  originM: CsMetres,
  scaleExp: number,
  axes: ViewAxes,
): [number, number, number] {
  const m = latLonToCsMetres(latDeg, lonDeg, altM)
  const step = Number(1n << BigInt(scaleExp))
  const cell = (a: AxisDirection): number =>
    (((m[a.axis] - originM[a.axis]) * GIBSONS_PER_M) / step - 0.5) * a.dir
  return [cell(axes.right), cell(axes.up), cell(axes.out)]
}

/** Earth's mean radius in render cells at this scale: 2^(55.6 - scaleExp). */
export function earthRadiusCells(scaleExp: number): number {
  return (EARTH_RADIUS_KM * 1000 * GIBSONS_PER_M) / Number(1n << BigInt(scaleExp))
}

/**
 * Geodetic latitude and longitude (degrees) and height above the ellipsoid
 * (meters) of a point given in cyberspace axis meters: the inverse of
 * latLonToCsMetres. Undo the §9.4 permutation, then the standard iterative
 * ECEF-to-geodetic solve; six rounds is far past float64 convergence.
 * Exactly on the polar axis the iteration has no longitude and the height
 * is read off the axis directly.
 */
export function csMetresToLatLon(m: CsMetres): { lat: number; lon: number; altM: number } {
  const X = m.x
  const Y = m.z
  const Z = m.y
  const p = Math.hypot(X, Y)
  if (p < 1e-9) return { lat: Z >= 0 ? 90 : -90, lon: 0, altM: Math.abs(Z) - WGS84_B_M }
  const lon = Math.atan2(Y, X)
  let lat = Math.atan2(Z, p * (1 - E2))
  let n = WGS84_A_M
  let alt = 0
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat)
    n = WGS84_A_M / Math.sqrt(1 - E2 * s * s)
    alt = p / Math.cos(lat) - n
    lat = Math.atan2(Z, p * (1 - (E2 * n) / (n + alt)))
  }
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, altM: alt }
}

/**
 * The cyberspace position of a point on the ellipsoid, in gibsons. The
 * meters are float64 and the rounding to a gibson lands within a few
 * nanometers of the true surface, the same shortcut the landfall index
 * takes.
 */
export function surfacePosition(latDeg: number, lonDeg: number): Position {
  const m = latLonToCsMetres(latDeg, lonDeg, 0)
  const u = (v: number): bigint => CENTRE + BigInt(Math.round(v * GIBSONS_PER_M))
  return { x: u(m.x), y: u(m.y), z: u(m.z) }
}

/**
 * Where on Earth a click on the globe landed: the inverse of how the globe
 * is placed. `local` is the hit in render cells relative to the planet's
 * CENTRE (the globe's group sits at the centre, so a mesh-local point is
 * exactly that), which becomes meters from the centre per cyberspace axis
 * through the same screen-axis mapping surfaceVertex applies forward, then
 * a geodetic latitude and longitude, then the position ON the ellipsoid at
 * that latitude and longitude: the focus lies exactly on the ground
 * whether the hit came from a sphere at the mean radius or a facet of it.
 */
export function surfaceHit(
  local: [number, number, number],
  scaleExp: number,
  axes: ViewAxes,
): { lat: number; lon: number; position: Position } {
  const cellM = 2 ** (scaleExp - 33)
  const m: CsMetres = { x: 0, y: 0, z: 0 }
  const screen = [axes.right, axes.up, axes.out]
  for (let i = 0; i < 3; i++) m[screen[i].axis] = local[i] * screen[i].dir * cellM
  const { lat, lon } = csMetresToLatLon(m)
  return { lat, lon, position: surfacePosition(lat, lon) }
}

/**
 * The circle where a sphere meets the ellipsoid, as latitude/longitude
 * pairs, `segments` of them evenly spread in azimuth around the sphere's
 * centre. Null when the sphere does not reach the ground (the centre is
 * higher above or deeper below the surface than the radius).
 *
 * Each vertex is found exactly rather than approximated on a round Earth:
 * for its azimuth, walk out from the centre by an angular distance (the
 * spherical forward formula, which for this purpose only has to trace a
 * ray in latitude/longitude space) and solve for the distance at which
 * the surface point is `radiusM` from the centre in three dimensions. The
 * gap is smooth and nearly linear in the angle, so a secant from either
 * side of the round-Earth answer converges to float64 in a few steps. The
 * result lies on the ellipsoid by construction and on the sphere to under
 * a micrometer, which is what lets the drawn boundary agree with the
 * fixed-point cull that decides which dots are inside.
 */
export function sphereRing(
  centreM: CsMetres,
  radiusM: number,
  segments: number,
): Array<[number, number]> | null {
  const geo = csMetresToLatLon(centreM)
  if (!(Math.abs(geo.altM) < radiusM)) return null
  const lat1 = (geo.lat * Math.PI) / 180
  const lon1 = (geo.lon * Math.PI) / 180
  const sinLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)
  const sinLon1 = Math.sin(lon1)
  const cosLon1 = Math.cos(lon1)
  // The centre's direction on a unit sphere and its local north and east:
  // a destination is the centre rotated by `delta` toward the azimuth's
  // tangent direction. Written as vectors rather than the textbook
  // spherical formula, whose longitude term subtracts two numbers within
  // 1e-9 of each other for a 16 m ring at 89.9 degrees and lost six digits
  // there; this form is well conditioned everywhere, the poles included,
  // where north and east are still a proper tangent basis.
  const p1 = [cosLat1 * cosLon1, cosLat1 * sinLon1, sinLat1]
  const north = [-sinLat1 * cosLon1, -sinLat1 * sinLon1, cosLat1]
  const east = [-sinLon1, cosLon1, 0]
  const groundR = Math.sqrt(radiusM * radiusM - geo.altM * geo.altM)
  const delta0 = 2 * Math.asin(Math.min(1, groundR / (2 * EARTH_RADIUS_KM * 1000)))
  const at = (az: number, delta: number): [number, number] => {
    const c = Math.cos(delta)
    const s = Math.sin(delta)
    const tn = Math.cos(az)
    const te = Math.sin(az)
    const x = c * p1[0] + s * (tn * north[0] + te * east[0])
    const y = c * p1[1] + s * (tn * north[1] + te * east[1])
    const z = c * p1[2] + s * (tn * north[2] + te * east[2])
    return [(Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI]
  }
  const gap = (az: number, delta: number): number => {
    const [lat, lon] = at(az, delta)
    const p = latLonToCsMetres(lat, lon, 0)
    return Math.hypot(p.x - centreM.x, p.y - centreM.y, p.z - centreM.z) - radiusM
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const az = (2 * Math.PI * i) / segments
    let a = delta0 * 0.995
    let b = delta0 * 1.005
    let fa = gap(az, a)
    let fb = gap(az, b)
    for (let k = 0; k < 16 && Math.abs(fb) > 1e-7 && fb !== fa; k++) {
      const c = b - (fb * (b - a)) / (fb - fa)
      a = b
      fa = fb
      b = c
      fb = gap(az, b)
    }
    out.push(at(az, b))
  }
  return out
}

/** A place on Earth as text, a tenth of a degree: "31.6°N 98.8°W". */
export function formatLatLonDeg(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`
}

/**
 * The largest 1, 2 or 5 times a power of ten (in degrees) that fits at
 * least `minLines` graticule lines across a window, the way a chart picks
 * its rulings: whole degrees while they are readable, tenths and hundredths
 * as the ground closes in.
 */
export function graticuleStep(windowDeg: number, minLines = 6): number {
  const target = windowDeg / minLines
  if (!Number.isFinite(target) || target <= 0) return 1e-7
  const k = Math.floor(Math.log10(target))
  for (const mant of [5, 2, 1]) {
    const step = mant * 10 ** k
    if (step <= target) return step
  }
  return 10 ** k
}

/**
 * How strongly surface detail (the graticule patch and the coastlines) is
 * drawn at this scale. Full strength down to 2^32, half a metre a cell,
 * which is the last height the planet is drawn at and where you stand in a
 * hall and place things on its floor. It used to start fading at 2^34, the
 * spec's human scale, on the idea that metre scale is where the view stops
 * being about places; standing at a venue with the ground gone underfoot
 * said otherwise. Below 2^32 it fades, zero at and below 2^30, which is
 * where the microscopic begins.
 */
export const SURFACE_DETAIL_FULL = 32
export const SURFACE_DETAIL_GONE = 30

export function surfaceDetailOpacity(scaleExp: number): number {
  if (scaleExp >= SURFACE_DETAIL_FULL) return 1
  if (scaleExp <= SURFACE_DETAIL_GONE) return 0
  return (scaleExp - SURFACE_DETAIL_GONE) / (SURFACE_DETAIL_FULL - SURFACE_DETAIL_GONE)
}

