import { describe, expect, it } from 'vitest'
import { landTier, parseLand, trianglesInWindow, type LandMesh } from './land'

// This repo ships no @types/node, the app being browser-only, so the specifier
// is assembled at run time: vitest executes the test in node and resolves it,
// while tsc leaves a computed dynamic import alone instead of asking for types
// that are not installed for one fixture read.
const nodeFs = 'node:fs'
const { readFileSync } = await import(nodeFs)

/** Hand-build an LND1 buffer the way pack-land.mjs does. */
function pack(verts: number[][], tris: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + verts.length * 8 + 4 + tris.length * 4)
  const view = new DataView(buf)
  view.setUint8(0, 0x4c)
  view.setUint8(1, 0x4e)
  view.setUint8(2, 0x44)
  view.setUint8(3, 0x31)
  view.setUint32(4, verts.length, true)
  let o = 8
  for (const [lat, lon] of verts) {
    view.setFloat32(o, lat, true)
    view.setFloat32(o + 4, lon, true)
    o += 8
  }
  view.setUint32(o, tris.length, true)
  o += 4
  for (const i of tris) {
    view.setUint32(o, i, true)
    o += 4
  }
  return buf
}

describe('parseLand', () => {
  it('round-trips vertices and indices', () => {
    const m = parseLand(pack(
      [[10, 20], [11, 21], [12, 19], [-5, 170]],
      [0, 1, 2, 2, 1, 3],
    ))
    expect(Array.from(m.pts)).toEqual([10, 20, 11, 21, 12, 19, -5, 170])
    expect(Array.from(m.tris)).toEqual([0, 1, 2, 2, 1, 3])
  })

  it('rejects other bytes', () => {
    expect(() => parseLand(new ArrayBuffer(4))).toThrow()
    const wrong = pack([[0, 0], [1, 1], [2, 0]], [0, 1, 2])
    new DataView(wrong).setUint8(0, 0x58)
    expect(() => parseLand(wrong)).toThrow()
  })

  it('rejects a buffer that stops short of its own counts', () => {
    const whole = pack([[0, 0], [1, 1], [2, 0]], [0, 1, 2])
    // Cut inside the vertices, so the index count is not even there to read.
    expect(() => parseLand(whole.slice(0, 16))).toThrow()
    // Cut inside the indices, where the header still reads as valid.
    expect(() => parseLand(whole.slice(0, whole.byteLength - 4))).toThrow()
  })
})

describe('landTier', () => {
  it('refines as the window closes in, then gives up', () => {
    expect(landTier(55)).toBe('110m')
    expect(landTier(50)).toBe('110m')
    expect(landTier(49)).toBe('50m')
    expect(landTier(42)).toBe('50m')
    // Below 42 the 50m outline would no longer line up with the drawn coast.
    expect(landTier(41)).toBe(null)
    expect(landTier(20)).toBe(null)
  })
})

describe('trianglesInWindow', () => {
  const land: LandMesh = parseLand(pack(
    [
      [10, 20], [12, 20], [11, 22], // 0..2, a small triangle
      [-40, 100], [-42, 100], [-41, 104], // 3..5, far away
      [5, 179], [6, 179], [5.5, 179.9], // 6..8, hard against the seam
      [-20, -60], [20, -60], [0, -20], // 9..11, wider than a close window
    ],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  ))

  it('keeps what overlaps and drops what does not', () => {
    expect(Array.from(trianglesInWindow(land, 9, 13, 19, 23))).toEqual([0, 1, 2])
    expect(trianglesInWindow(land, 30, 60, 0, 10)).toHaveLength(0)
  })

  it('keeps a triangle that swallows the window whole', () => {
    // No corner of 9..11 is inside this window; its bounds still cover it.
    expect(Array.from(trianglesInWindow(land, -1, 1, -45, -43))).toEqual([9, 10, 11])
  })

  it('sees across the antimeridian through the +-360 aliases', () => {
    // A window past +180: [170, 190] names the seam's far side too.
    expect(Array.from(trianglesInWindow(land, 4, 7, 170, 190))).toEqual([6, 7, 8])
    // The same triangle from the other approach, window below -180.
    expect(Array.from(trianglesInWindow(land, 4, 7, -190, -170))).toEqual([6, 7, 8])
  })
})

describe('the packed land-110m.bin on disk', () => {
  // node hands back a view into a pooled buffer, so the bytes are copied into
  // an ArrayBuffer of their own before the parser is pointed at them.
  const bytes: Uint8Array = readFileSync(new URL('../../public/land-110m.bin', import.meta.url))
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  const land = parseLand(buf)

  it('parses as a whole mesh', () => {
    expect(land.pts.length).toBeGreaterThan(0)
    expect(land.pts.length % 2).toBe(0)
    expect(land.tris.length % 3).toBe(0)
    expect(land.tris.length).toBeGreaterThan(0)
  })

  it('indexes only vertices it actually has', () => {
    const verts = land.pts.length / 2
    let worst = -1
    for (const i of land.tris) if (i > worst) worst = i
    expect(worst).toBeLessThan(verts)
    expect(worst).toBeGreaterThanOrEqual(0)
  })

  it('stores every vertex as a real lat/lon, in that order', () => {
    let badLat = 0
    let badLon = 0
    for (let p = 0; p < land.pts.length; p += 2) {
      if (!(land.pts[p] >= -90 && land.pts[p] <= 90)) badLat++
      if (!(land.pts[p + 1] >= -180 && land.pts[p + 1] <= 180)) badLon++
    }
    expect(badLat).toBe(0)
    expect(badLon).toBe(0)
  })

  it('hands back every triangle for a whole-globe window', () => {
    expect(trianglesInWindow(land, -90, 90, -180, 180)).toHaveLength(land.tris.length)
  })

  // Bounds checks would still pass if lat and lon had been swapped somewhere
  // between the pack script and the parser, or if the ears had been cut wrong.
  // Asking where the mesh actually says land is will not.
  it('covers the continents and leaves the oceans open', () => {
    for (const [lat, lon] of [[39, -98], [23, 10], [62, 100], [-25, 134], [-80, 0]]) {
      expect(covers(land, lat, lon), `${lat}, ${lon} should be land`).toBe(true)
    }
    for (const [lat, lon] of [[0, -140], [-40, -20], [-20, 80], [40, -160]]) {
      expect(covers(land, lat, lon), `${lat}, ${lon} should be ocean`).toBe(false)
    }
  })
})

/** Whether any triangle of the mesh contains a point, by half-plane signs. */
function covers(land: LandMesh, lat: number, lon: number): boolean {
  const { pts, tris } = land
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t] * 2
    const b = tris[t + 1] * 2
    const c = tris[t + 2] * 2
    const d1 = (lon - pts[b + 1]) * (pts[a] - pts[b]) - (pts[a + 1] - pts[b + 1]) * (lat - pts[b])
    const d2 = (lon - pts[c + 1]) * (pts[b] - pts[c]) - (pts[b + 1] - pts[c + 1]) * (lat - pts[c])
    const d3 = (lon - pts[a + 1]) * (pts[c] - pts[a]) - (pts[c + 1] - pts[a + 1]) * (lat - pts[a])
    // A point outside sees both signs; inside or on an edge it never does.
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true
  }
  return false
}
