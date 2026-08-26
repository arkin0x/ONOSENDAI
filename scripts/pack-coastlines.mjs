/**
 * pack-coastlines.mjs - Natural Earth coastlines to the client's binary form.
 *
 * Usage: node scripts/pack-coastlines.mjs <dir with ne_*_coastline.geojson>
 *
 * Reads ne_110m_coastline.geojson, ne_50m_coastline.geojson and
 * ne_10m_coastline.geojson (public domain, from
 * github.com/nvkelso/natural-earth-vector) and writes
 * public/coastline-{110m,50m,10m}.bin.
 *
 * Format CST1, little-endian:
 *   bytes 0..3  ASCII "CST1"
 *   u32         line count
 *   per line:   u32 point count, then point count pairs of (f32 lat, f32 lon)
 *
 * f32 keeps about 2e-5 degrees (roughly 2 metres), an order of magnitude
 * finer than the 10m tier's own cartographic accuracy, at half the bytes.
 * Run once when Natural Earth updates; the outputs are committed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/pack-coastlines.mjs <dir with ne_*_coastline.geojson>')
  process.exit(1)
}

for (const tier of ['110m', '50m', '10m']) {
  const geo = JSON.parse(readFileSync(join(src, `ne_${tier}_coastline.geojson`), 'utf8'))
  const lines = []
  for (const f of geo.features) {
    const g = f.geometry
    const multi = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
    if (g.type !== 'LineString' && g.type !== 'MultiLineString') continue
    for (const line of multi) if (line.length >= 2) lines.push(line)
  }
  let points = 0
  for (const line of lines) points += line.length
  const buf = new ArrayBuffer(8 + lines.length * 4 + points * 8)
  const view = new DataView(buf)
  view.setUint8(0, 0x43) // C
  view.setUint8(1, 0x53) // S
  view.setUint8(2, 0x54) // T
  view.setUint8(3, 0x31) // 1
  view.setUint32(4, lines.length, true)
  let o = 8
  for (const line of lines) {
    view.setUint32(o, line.length, true)
    o += 4
    for (const [lon, lat] of line) { // GeoJSON order is lon, lat
      view.setFloat32(o, lat, true)
      view.setFloat32(o + 4, lon, true)
      o += 8
    }
  }
  const out = join('public', `coastline-${tier}.bin`)
  writeFileSync(out, Buffer.from(buf))
  console.log(`${out}: ${lines.length} lines, ${points} points, ${(buf.byteLength / 1024).toFixed(0)} KB`)
}
