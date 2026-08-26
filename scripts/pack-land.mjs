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
 * The 10m tier is deliberately absent: 446k points would pack to roughly 9 MB
 * for a fill that only ever backs the coastline. src/lib/land.ts stops asking
 * for a fill below the scale where 50m still reads as accurate.
 *
 * Run once when Natural Earth updates; the outputs are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Earcut } from 'three/src/extras/Earcut.js'

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
  const count = verts.length / 2
  const buf = new ArrayBuffer(8 + count * 8 + 4 + tris.length * 4)
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
  view.setUint32(o, tris.length, true)
  o += 4
  for (const i of tris) {
    view.setUint32(o, i, true)
    o += 4
  }
  const out = join('public', `land-${tier}.bin`)
  writeFileSync(out, Buffer.from(buf))
  console.log(
    `${out}: ${count} vertices, ${tris.length / 3} triangles, ` +
    `${buf.byteLength} bytes (${(buf.byteLength / 1024).toFixed(0)} KB)`,
  )
}
