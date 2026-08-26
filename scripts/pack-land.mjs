/**
 * pack-land.mjs - Natural Earth land polygons to the client's binary form.
 *
 * Usage: node scripts/pack-land.mjs <dir with ne_*_land.geojson>
 *
 * Reads ne_110m_land.geojson and ne_50m_land.geojson (public domain, from
 * github.com/nvkelso/natural-earth-vector) and writes
 * public/land-{110m,50m}.bin.
 *
 * Format LND1, little-endian:
 *   bytes 0..3  ASCII "LND1"
 *   u32         vertex count V
 *   V pairs of  (f32 lat, f32 lon)
 *   u32         index count I, always a multiple of 3
 *   I x u32     triangle indices into the vertex array
 *
 * The triangulation happens HERE rather than on the client. Ear clipping is
 * the expensive part of drawing a fill and its answer never changes, so it is
 * paid once at pack time and the client only has buffers to upload.
 *
 * Ears are cut in plain lat/lon space, treating (lon, lat) as flat 2D. That is
 * exact for what gets drawn because Natural Earth already splits its polygons
 * at the antimeridian, so no ring ever wraps the seam, and because the surface
 * patch the fill lands on is itself a lat/lon grid.
 *
 * Two things then have to be repaired before the mesh is fit to draw on a
 * BALL, and both are done here so the client never thinks about them.
 *
 * Refinement. Ear clipping is free to join any two vertices of a polygon, so
 * a shape as wide as Russia comes back with triangles whose edges span sixty
 * degrees of arc. A triangle is flat, so a sixty degree edge is a chord whose
 * middle sits at 83% of the radius: it dives through the planet, gets buried
 * by the ocean sphere at 99.5%, and surfaces again somewhere it has no
 * business being. Those were the wedge-shaped seams behind Russia, Chile and
 * California. Splitting every triangle until no edge exceeds MAX_ARC_DEG puts
 * the deepest chord at 99.97% of the radius, comfortably outside the ocean.
 * Midpoints are taken in lat/lon, which is the space the ring edges are
 * straight in, so a split adds no new shape and a neighbour left unsplit
 * leaves no crack worth the name.
 *
 * Winding. With the triangles hugging the surface, the near hemisphere can be
 * separated from the far one by backface culling, which needs every triangle
 * wound the same way. Each one is turned to face outward here, once.
 *
 * The 10m tier is deliberately absent: 446k points would pack to roughly 9 MB
 * for a fill that only ever backs the coastline. src/lib/land.ts stops asking
 * for a fill below the scale where 50m still reads as accurate.
 *
 * Run once when Natural Earth updates; the outputs are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Earcut } from 'three/src/extras/Earcut.js'

/**
 * The longest edge, in degrees of arc, a triangle may keep.
 *
 * Backface culling, not the depth buffer, is what hides the far hemisphere,
 * so this does not have to clear the ocean sphere; it only has to keep the
 * fill hugging the surface closely enough to line up with the coastline
 * drawn on top of it. Eight degrees sags a chord 15.5 km at its middle,
 * which is a pixel at the zooms the whole globe is visible at and stays
 * under the lines at every zoom below that. Tighter costs real bytes: three
 * degrees quadruples the 110m tier.
 */
const MAX_ARC_DEG = 8

/** A lat/lon on the unit sphere, for measuring arcs and facing. */
function unit(lat, lon) {
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
}

function arcDeg(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}

/**
 * Split triangles until no edge spans more than MAX_ARC_DEG.
 *
 * Four ways at a time, sharing midpoints through a cache keyed by the edge's
 * two vertices, so a split edge is split identically for both triangles that
 * own it. Only triangles that are still too big are queued again, so a
 * continent's coastline detail is left alone and its wide interior spans are
 * the only thing that grows.
 */
function refine(verts, tris) {
  const mid = new Map()
  const midpoint = (i, j) => {
    const key = i < j ? `${i},${j}` : `${j},${i}`
    const seen = mid.get(key)
    if (seen !== undefined) return seen
    const k = verts.length / 2
    verts.push((verts[i * 2] + verts[j * 2]) / 2, (verts[i * 2 + 1] + verts[j * 2 + 1]) / 2)
    mid.set(key, k)
    return k
  }
  const out = []
  let queue = tris
  // Bounded on purpose: a runaway split would eat memory silently, and no
  // real edge needs more than a handful of halvings to clear three degrees.
  for (let pass = 0; pass < 12 && queue.length > 0; pass++) {
    const next = []
    for (let t = 0; t < queue.length; t += 3) {
      const [a, b, c] = [queue[t], queue[t + 1], queue[t + 2]]
      const pa = unit(verts[a * 2], verts[a * 2 + 1])
      const pb = unit(verts[b * 2], verts[b * 2 + 1])
      const pc = unit(verts[c * 2], verts[c * 2 + 1])
      if (Math.max(arcDeg(pa, pb), arcDeg(pb, pc), arcDeg(pc, pa)) <= MAX_ARC_DEG) {
        out.push(a, b, c)
        continue
      }
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    queue = next
  }
  // Whatever is still oversized after the last pass is kept rather than
  // dropped: a hole in a continent would be worse than a long triangle.
  for (const i of queue) out.push(i)
  return out
}

/** Turn every triangle to face away from the planet's centre. */
function orientOutward(verts, tris) {
  for (let t = 0; t < tris.length; t += 3) {
    const p = [0, 1, 2].map((k) => unit(verts[tris[t + k] * 2], verts[tris[t + k] * 2 + 1]))
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
    const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    // Against the centroid, which for a small triangle on a sphere points
    // straight out of the surface it sits on.
    const outward = n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2]
    if (outward < 0) {
      const swap = tris[t + 1]
      tris[t + 1] = tris[t + 2]
      tris[t + 2] = swap
    }
  }
}

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/pack-land.mjs <dir with ne_*_land.geojson>')
  process.exit(1)
}

/**
 * A ring without GeoJSON's repeated closing point. Earcut discards the
 * duplicate itself, but it would still be sitting in the vertex array
 * referenced by nothing, so it is trimmed before it ever gets there.
 */
function open(ring) {
  const n = ring.length
  const closed = n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]
  return closed ? ring.slice(0, n - 1) : ring
}

for (const tier of ['110m', '50m']) {
  const geo = JSON.parse(readFileSync(join(src, `ne_${tier}_land.geojson`), 'utf8'))
  const verts = [] // flat lat, lon, lat, lon, ...
  const tris = []
  for (const f of geo.features) {
    const g = f.geometry
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    for (const rings of polys) {
      // Earcut takes one flat coordinate run with the holes appended after the
      // outer ring and their start vertices listed separately. Coordinates go
      // in the way GeoJSON stores them, x = lon and y = lat; the swap to lat
      // first happens only where they are written out.
      const outer = open(rings[0] ?? [])
      if (outer.length < 3) continue
      const flat = []
      for (const [lon, lat] of outer) flat.push(lon, lat)
      const holes = []
      for (let h = 1; h < rings.length; h++) {
        const hole = open(rings[h])
        if (hole.length < 3) continue
        holes.push(flat.length / 2)
        for (const [lon, lat] of hole) flat.push(lon, lat)
      }
      // Indices come back local to this polygon, so they shift by however many
      // vertices the polygons before it already contributed.
      const base = verts.length / 2
      const idx = Earcut.triangulate(flat, holes, 2)
      for (let i = 0; i < flat.length; i += 2) verts.push(flat[i + 1], flat[i])
      for (const i of idx) tris.push(base + i)
    }
  }
  const rawTris = tris.length / 3
  // Rebound rather than spread: a refined 50m tier runs to hundreds of
  // thousands of indices, and spreading that into push() blows the stack.
  const refined = refine(verts, tris)
  orientOutward(verts, refined)
  const count = verts.length / 2
  const buf = new ArrayBuffer(8 + count * 8 + 4 + refined.length * 4)
  const view = new DataView(buf)
  view.setUint8(0, 0x4c) // L
  view.setUint8(1, 0x4e) // N
  view.setUint8(2, 0x44) // D
  view.setUint8(3, 0x31) // 1
  view.setUint32(4, count, true)
  let o = 8
  for (let i = 0; i < verts.length; i += 2) {
    view.setFloat32(o, verts[i], true)
    view.setFloat32(o + 4, verts[i + 1], true)
    o += 8
  }
  view.setUint32(o, refined.length, true)
  o += 4
  for (const i of refined) {
    view.setUint32(o, i, true)
    o += 4
  }
  const out = join('public', `land-${tier}.bin`)
  writeFileSync(out, Buffer.from(buf))
  console.log(
    `${out}: ${count} vertices, ${refined.length / 3} triangles ` +
    `(${rawTris} before refinement), ` +
    `${buf.byteLength} bytes (${(buf.byteLength / 1024).toFixed(0)} KB)`,
  )
}
