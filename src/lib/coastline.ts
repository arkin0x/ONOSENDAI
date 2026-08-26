/**
 * coastline.ts - the shorelines, from Natural Earth, as data.
 *
 * Three tiers of the public-domain Natural Earth coastline ship in
 * public/ as CST1 binaries (scripts/pack-coastlines.mjs documents the
 * format and regenerates them). The globe draws the coarsest tier whole;
 * the surface patch queries a lat/lon window out of the finer ones.
 *
 * Everything here is pure parsing and geometry selection; fetching and
 * caching live in hooks/useCoastline, and drawing in the scene.
 *
 * One trap this deliberately does not have: the antimeridian. Vertices are
 * rendered in 3D, where a segment from lon 179.9 to -179.9 is a short
 * chord, so nothing splits or wraps lines. Only the window QUERY has to
 * remember that a window like [170, 190] names longitudes on both sides
 * of the seam, which the +-360 aliases below handle.
 */

/** One shoreline polyline: interleaved (lat, lon) pairs and its bounds. */
export interface CoastLine {
  /** [lat0, lon0, lat1, lon1, ...] in degrees. */
  pts: Float32Array
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export interface Coastline {
  lines: CoastLine[]
}

export type CoastTier = '110m' | '50m' | '10m'

/**
 * Which tier a zoom deserves: the globe reads the coarsest, the patch
 * refines as the window closes in. Thresholds sit where the coarser tier's
 * segment lengths would start to read as straight lines across the grid.
 */
export function coastTier(scaleExp: number): CoastTier {
  if (scaleExp >= 50) return '110m'
  if (scaleExp >= 46) return '50m'
  return '10m'
}

/** Parse a CST1 buffer. Throws on anything that is not CST1. */
export function parseCoastline(buf: ArrayBuffer): Coastline {
  const view = new DataView(buf)
  if (
    buf.byteLength < 8 ||
    view.getUint8(0) !== 0x43 || view.getUint8(1) !== 0x53 ||
    view.getUint8(2) !== 0x54 || view.getUint8(3) !== 0x31
  ) {
    throw new Error('not a CST1 coastline file')
  }
  const lineCount = view.getUint32(4, true)
  const lines: CoastLine[] = []
  let o = 8
  for (let i = 0; i < lineCount; i++) {
    const n = view.getUint32(o, true)
    o += 4
    const pts = new Float32Array(n * 2)
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    for (let p = 0; p < n; p++) {
      const lat = view.getFloat32(o, true)
      const lon = view.getFloat32(o + 4, true)
      o += 8
      pts[p * 2] = lat
      pts[p * 2 + 1] = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
    }
    lines.push({ pts, minLat, maxLat, minLon, maxLon })
  }
  return { lines }
}

/**
 * Whether a longitude span touches a window's. The window's longitudes may
 * run past +-180 (a window centred near the seam does), so the span is tested
 * where it sits and shifted a full turn either way. Exported because the land
 * fill in land.ts selects its triangles by exactly this rule, and one seam is
 * enough to get wrong once.
 */
export function lonOverlaps(
  minLon: number,
  maxLon: number,
  lonLo: number,
  lonHi: number,
): boolean {
  return (
    (maxLon >= lonLo && minLon <= lonHi) ||
    (maxLon + 360 >= lonLo && minLon + 360 <= lonHi) ||
    (maxLon - 360 >= lonLo && minLon - 360 <= lonHi)
  )
}

/** The lines whose bounds touch a lat/lon window. */
export function linesInWindow(
  coast: Coastline,
  latLo: number,
  latHi: number,
  lonLo: number,
  lonHi: number,
): CoastLine[] {
  const out: CoastLine[] = []
  for (const line of coast.lines) {
    if (line.maxLat < latLo || line.minLat > latHi) continue
    if (lonOverlaps(line.minLon, line.maxLon, lonLo, lonHi)) out.push(line)
  }
  return out
}
