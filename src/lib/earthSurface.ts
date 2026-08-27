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
 * and the origin carry about a nanometre of representation error at
 * Earth-radius magnitudes (float64 ulp, tens of gibsons), so their
 * difference does too, and a few nanometres is invisible at every scale the
 * surface draws at. No Decimal derivation is needed anywhere in the render
 * path; the consensus-critical decimal profile stays in landfall.ts where
 * verifiers need it.
 *
 * Everything here is pure: the scene components own subscription, geometry
 * and materials.
 */

import { BackSide, FrontSide } from 'three'
import type { AxisDirection, Position, ViewAxes } from './space'

export const WGS84_A_M = 6378137
export const WGS84_F = 1 / 298.257223563
export const WGS84_B_M = WGS84_A_M * (1 - WGS84_F)
const E2 = WGS84_F * (2 - WGS84_F)

/** §9.7: 1 metre = 2^33 gibsons (Cantor height 34 is 2 metres). */
export const GIBSONS_PER_M = 2 ** 33

/** §9.7: the WGS84 mapping is centred on the half-axis point. */
const CENTRE = 1n << 84n

/** Mean radius in km, the same summary Earth.tsx has always drawn. */
export const EARTH_RADIUS_KM = 6371

/** Cyberspace axis values in metres from the mapping centre (float64). */
export interface CsMetres {
  x: number
  y: number
  z: number
}

/**
 * Geodetic latitude/longitude (degrees) and height above the ellipsoid
 * (metres) to cyberspace axis metres. Standard geodetic-to-ECEF, then the
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
 * The render origin's axis values in metres from the mapping centre. The
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
 * A surface point as a render-space vertex: metre deltas from the origin,
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
 * How strongly surface detail (the graticule patch, and later the
 * coastlines) is drawn at this scale. Full strength down to 2^34, the
 * spec's human scale, then fading out through metre scale: below that the
 * shore and the grid of places stop being what the view is about, and the
 * fade is the scale itself teaching that. Zero at and below 2^31.
 */
export const SURFACE_DETAIL_FULL = 34
export const SURFACE_DETAIL_GONE = 31

export function surfaceDetailOpacity(scaleExp: number): number {
  if (scaleExp >= SURFACE_DETAIL_FULL) return 1
  if (scaleExp <= SURFACE_DETAIL_GONE) return 0
  return (scaleExp - SURFACE_DETAIL_GONE) / (SURFACE_DETAIL_FULL - SURFACE_DETAIL_GONE)
}

/**
 * Which face of the land shell points away from the planet, in render space.
 *
 * The fill is a closed-ish shell on a ball, so the near hemisphere can be
 * separated from the far one by backface culling: it costs nothing, it does
 * not depend on the ocean sphere's radius the way a depth test would, and it
 * halves the fill rate. What it needs is to know which way is out, and that
 * is not a constant. §9.4 permutes two axes on the way from ECEF, which is a
 * reflection, and the view frame permutes and flips them again, so the sign
 * changes as the camera moves.
 *
 * Rather than track the signs by hand, this measures them. Walking east then
 * north from a point is a counter-clockwise turn seen from outside the
 * planet, and pack-land.mjs winds every triangle the same way, so the sign of
 * that turn against the local outward direction is exactly the answer.
 */
export function outwardSide(
  originM: CsMetres, scaleExp: number, axes: ViewAxes,
): typeof FrontSide | typeof BackSide {
  const at = (lat: number, lon: number, alt = 0): [number, number, number] =>
    surfaceVertex(lat, lon, alt, originM, scaleExp, axes)
  const a = at(0, 0)
  const east = at(0, 1)
  const north = at(1, 0)
  // A kilometre straight up, which is out of the surface by construction.
  const up = at(0, 0, 1000)
  const u = [east[0] - a[0], east[1] - a[1], east[2] - a[2]]
  const v = [north[0] - a[0], north[1] - a[1], north[2] - a[2]]
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
  const outward = [up[0] - a[0], up[1] - a[1], up[2] - a[2]]
  const agrees = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] > 0
  return agrees ? FrontSide : BackSide
}
