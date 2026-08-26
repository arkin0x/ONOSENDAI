/**
 * land.ts - the land itself, from Natural Earth, as triangles.
 *
 * coastline.ts draws the outline; this fills what the outline encloses. Two
 * tiers of the public-domain Natural Earth land polygons ship in public/ as
 * LND1 binaries (scripts/pack-land.mjs documents the format and regenerates
 * them), already triangulated, so nothing here does any ear clipping: the
 * client reads two arrays and the fill is ready to upload.
 *
 * Everything here is pure parsing and geometry selection; fetching and
 * caching live in the hook, and drawing in the scene, exactly as they do for
 * the coastline.
 *
 * The antimeridian is a non-problem for the same reason it is for the lines:
 * vertices are rendered in 3D, and Natural Earth already splits its polygons
 * at the seam, so no triangle straddles it. Only the window QUERY has to
 * remember the seam, which it does through coastline.ts's lonOverlaps.
 */
import { lonOverlaps } from './coastline'

/** One tier's land as a single indexed mesh. */
export interface LandMesh {
  /** [lat0, lon0, lat1, lon1, ...] in degrees, interleaved like CoastLine's pts. */
  pts: Float32Array
  /** Triangle corners as vertex numbers, three per triangle. */
  tris: Uint32Array
}

export type LandTier = '110m' | '50m'

/**
 * Which tier a zoom deserves, or null for no fill at all.
 *
 * The floor is the interesting part. 50m is accurate to roughly 1 to 2 km,
 * and at scaleExp 42 the visible half window is already down to about 100 km,
 * so one step closer and the fill's edge would sit visibly inland or offshore
 * of the coastline drawn over it. A missing fill reads as a design choice; a
 * fill that disagrees with its own shoreline reads as a bug. The lines keep
 * their own finer tiers below this point, only the fill stops.
 */
export function landTier(scaleExp: number): LandTier | null {
  if (scaleExp >= 50) return '110m'
  if (scaleExp >= 42) return '50m'
  return null
}

/** Parse an LND1 buffer. Throws on anything that is not a whole LND1 file. */
export function parseLand(buf: ArrayBuffer): LandMesh {
  const view = new DataView(buf)
  if (
    buf.byteLength < 8 ||
    view.getUint8(0) !== 0x4c || view.getUint8(1) !== 0x4e ||
    view.getUint8(2) !== 0x44 || view.getUint8(3) !== 0x31
  ) {
    throw new Error('not a LND1 land file')
  }
  // The two counts are all that stands between a short read and a mesh of
  // garbage indices, so the length is checked against them before either
  // array is walked rather than trusting the reads to stay in bounds.
  const vertCount = view.getUint32(4, true)
  const triOff = 8 + vertCount * 8
  if (buf.byteLength < triOff + 4) throw new Error('truncated LND1 land file')
  const idxCount = view.getUint32(triOff, true)
  if (buf.byteLength < triOff + 4 + idxCount * 4) throw new Error('truncated LND1 land file')

  const pts = new Float32Array(vertCount * 2)
  let o = 8
  for (let p = 0; p < vertCount; p++) {
    pts[p * 2] = view.getFloat32(o, true)
    pts[p * 2 + 1] = view.getFloat32(o + 4, true)
    o += 8
  }
  const tris = new Uint32Array(idxCount)
  o = triOff + 4
  for (let i = 0; i < idxCount; i++) {
    tris[i] = view.getUint32(o, true)
    o += 4
  }
  return { pts, tris }
}

/**
 * The triangles that touch a lat/lon window, as a fresh index array over the
 * same vertices.
 *
 * Selection is by each triangle's bounds, not by whether a corner lands
 * inside: corner testing would drop any triangle larger than the window,
 * which is precisely what sits under the camera deep inside a continent,
 * where one ear can cover the whole view and its corners are all offscreen.
 * Testing bounds keeps those and keeps every triangle a corner test would
 * have found anyway.
 */
export function trianglesInWindow(
  land: LandMesh,
  latLo: number,
  latHi: number,
  lonLo: number,
  lonHi: number,
): Uint32Array {
  const { pts, tris } = land
  const out: number[] = []
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t] * 2
    const b = tris[t + 1] * 2
    const c = tris[t + 2] * 2
    if (Math.max(pts[a], pts[b], pts[c]) < latLo) continue
    if (Math.min(pts[a], pts[b], pts[c]) > latHi) continue
    const minLon = Math.min(pts[a + 1], pts[b + 1], pts[c + 1])
    const maxLon = Math.max(pts[a + 1], pts[b + 1], pts[c + 1])
    if (!lonOverlaps(minLon, maxLon, lonLo, lonHi)) continue
    out.push(tris[t], tris[t + 1], tris[t + 2])
  }
  return Uint32Array.from(out)
}

/**
 * How far a refined triangle's middle sags below the surface, in metres.
 *
 * pack-land.mjs splits until no edge spans more than eight degrees of arc, and
 * a flat chord across eight degrees of a 6371 km sphere dips 15.5 km at its
 * midpoint. The vertices are exactly on the surface, so a coastline drawn over
 * the fill still lines up; it is only the interior that sits low. Anything
 * drawn UNDER the fill has to be sunk past this or it will bury the middle of
 * every large continent.
 */
export const LAND_CHORD_SAG_M = 15_600
