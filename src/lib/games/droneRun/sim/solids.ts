/**
 * solids.ts - the battlefield's static collision geometry: a soup of
 * triangles in region-local gibsons (Y up), indexed by a uniform grid, and
 * the few questions the simulation asks of it.
 *
 * - segmentCast: the first triangle a straight segment meets (Moller and
 *   Trumbore), walking the grid's cells along it (Amanatides and Woo), so a
 *   long sight line costs the cells it crosses, not the whole field.
 * - sphereHits / spherePush: whether a ball touches any triangle, and the
 *   push that would take it clear (closest point on each triangle, Ericson).
 * - groundBelow / ceilingAbove: a straight drop or rise.
 *
 * Faces are two-sided, as WALK reads them (lib/walkConstrain.ts): a shard's
 * winding is not to be trusted, so a face holds from both sides and a hit's
 * normal is turned to face where the segment came from.
 *
 * A triangle whose normal is within about 53 degrees of straight up or down
 * is FLAT (a floor or a ceiling, |ny| >= FLAT_NY); the rest are walls. The
 * player's body leaves floors to its ground probe and collides with walls
 * (sim/player.ts); drones and shots meet everything.
 *
 * The geometry never changes during a run, so everything here is built once.
 * The only mutable part is the per-query mailbox (`stamp`), scratch that
 * makes a triangle in several cells tested once a query; it is not run
 * state and never affects a result.
 */

import type { Vec3 } from '../types'

/** |normal.y| at or above this: a floor or a ceiling (cos 53 degrees). */
export const FLAT_NY = 0.6

/** Barycentric slack, so two triangles that share an edge leave no seam a segment slips through. */
const EDGE_SLACK = 1e-7

/** A triangle seen this nearly edge-on is never crossed. */
const PARALLEL = 1e-12

/** The default grid cell, gibsons. */
export const DEFAULT_CELL = 4

/** No grid axis gets more cells than this; a wider soup gets bigger cells. */
const MAX_CELLS_PER_AXIS = 256

/** Where a segment met a triangle. */
export interface Hit {
  /** Along the segment, 0 at `from` and 1 at `to`. */
  t: number
  point: Vec3
  /** Unit normal of the triangle, turned toward the segment's start. */
  normal: Vec3
  /** The triangle's index. */
  tri: number
}

/** The indexed triangles. Built by buildSolids; read only. */
export interface Solids {
  count: number
  /** Per triangle 12 numbers: corner a, edge ab, edge ac, unit normal. */
  data: Float64Array
  /** Per triangle: 1 when FLAT (floor or ceiling). */
  flat: Uint8Array
  /** The grid: origin, cell size, cells per axis, and each cell's triangles (CSR). */
  ox: number
  oy: number
  oz: number
  cell: number
  nx: number
  ny: number
  nz: number
  start: Int32Array
  items: Int32Array
  /** Scratch mailbox: the query that last tested each triangle. */
  stamp: Uint32Array
  query: number
  /** The bounds of every corner, or null for none. */
  min: Vec3 | null
  max: Vec3 | null
}

/**
 * Indexes `tris` (9 numbers a triangle: three corners x, y, z, region-local
 * gibsons). A triangle with no area is dropped.
 */
export function buildSolids(tris: ArrayLike<number>, cell: number = DEFAULT_CELL): Solids {
  const raw = Math.floor(tris.length / 9)
  const data = new Float64Array(raw * 12)
  const flat = new Uint8Array(raw)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  let n = 0
  for (let i = 0; i < raw; i++) {
    const o = i * 9
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2]
    const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az
    const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz)
    if (!(len > 1e-12)) continue
    nx /= len; ny /= len; nz /= len
    const d = n * 12
    data[d] = ax; data[d + 1] = ay; data[d + 2] = az
    data[d + 3] = e1x; data[d + 4] = e1y; data[d + 5] = e1z
    data[d + 6] = e2x; data[d + 7] = e2y; data[d + 8] = e2z
    data[d + 9] = nx; data[d + 10] = ny; data[d + 11] = nz
    flat[n] = Math.abs(ny) >= FLAT_NY ? 1 : 0
    for (let k = 0; k < 9; k++) {
      const a = k % 3, v = tris[o + k]
      if (v < lo[a]) lo[a] = v
      if (v > hi[a]) hi[a] = v
    }
    n++
  }
  const s: Solids = {
    count: n, data: data.subarray(0, n * 12), flat: flat.subarray(0, n),
    ox: 0, oy: 0, oz: 0, cell, nx: 1, ny: 1, nz: 1,
    start: new Int32Array(2), items: new Int32Array(0), stamp: new Uint32Array(n), query: 0,
    min: n ? [lo[0], lo[1], lo[2]] : null, max: n ? [hi[0], hi[1], hi[2]] : null,
  }
  if (!n) return s
  let size = cell
  while (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / size > MAX_CELLS_PER_AXIS) size *= 2
  s.cell = size
  s.ox = lo[0] - 1e-6; s.oy = lo[1] - 1e-6; s.oz = lo[2] - 1e-6
  s.nx = Math.max(1, Math.ceil((hi[0] + 1e-6 - s.ox) / size))
  s.ny = Math.max(1, Math.ceil((hi[1] + 1e-6 - s.oy) / size))
  s.nz = Math.max(1, Math.ceil((hi[2] + 1e-6 - s.oz) / size))
  const cells = s.nx * s.ny * s.nz
  const count = new Int32Array(cells + 1)
  const span = (i: number, out: Int32Array): void => {
    const d = i * 12
    const ax = data[d], ay = data[d + 1], az = data[d + 2]
    const bx = ax + data[d + 3], by = ay + data[d + 4], bz = az + data[d + 5]
    const cx = ax + data[d + 6], cy = ay + data[d + 7], cz = az + data[d + 8]
    out[0] = clampCell((Math.min(ax, bx, cx) - s.ox) / size, s.nx)
    out[1] = clampCell((Math.min(ay, by, cy) - s.oy) / size, s.ny)
    out[2] = clampCell((Math.min(az, bz, cz) - s.oz) / size, s.nz)
    out[3] = clampCell((Math.max(ax, bx, cx) - s.ox) / size, s.nx)
    out[4] = clampCell((Math.max(ay, by, cy) - s.oy) / size, s.ny)
    out[5] = clampCell((Math.max(az, bz, cz) - s.oz) / size, s.nz)
  }
  const b = new Int32Array(6)
  for (let pass = 0; pass < 2; pass++) {
    const fill = pass === 1 ? count.slice() : null
    const items = pass === 1 ? new Int32Array(count[cells]) : null
    for (let i = 0; i < n; i++) {
      span(i, b)
      for (let z = b[2]; z <= b[5]; z++) for (let y = b[1]; y <= b[4]; y++) for (let x = b[0]; x <= b[3]; x++) {
        const c = (z * s.ny + y) * s.nx + x
        if (pass === 0) count[c + 1]++
        else items![fill![c]++] = i
      }
    }
    if (pass === 0) for (let c = 0; c < cells; c++) count[c + 1] += count[c]
    else s.items = items!
  }
  s.start = count
  return s
}

function clampCell(v: number, n: number): number {
  const c = Math.floor(v)
  return c < 0 ? 0 : c >= n ? n - 1 : c
}

function nextQuery(s: Solids): number {
  s.query = (s.query + 1) >>> 0
  if (s.query === 0) { s.stamp.fill(0); s.query = 1 }
  return s.query
}

/**
 * Moller and Trumbore against triangle `i`, two-sided: the segment's t (0 at
 * the start, 1 at the end) where it crosses, or -1.
 */
function crossT(s: Solids, i: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
  const d = s.data, o = i * 12
  const e1x = d[o + 3], e1y = d[o + 4], e1z = d[o + 5], e2x = d[o + 6], e2y = d[o + 7], e2z = d[o + 8]
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x
  const det = e1x * hx + e1y * hy + e1z * hz
  if (Math.abs(det) < PARALLEL) return -1
  const inv = 1 / det
  const tx = px - d[o], ty = py - d[o + 1], tz = pz - d[o + 2]
  const u = (tx * hx + ty * hy + tz * hz) * inv
  if (u < -EDGE_SLACK || u > 1 + EDGE_SLACK) return -1
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < -EDGE_SLACK || u + v > 1 + EDGE_SLACK) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t >= 0 && t <= 1 ? t : -1
}

/**
 * Walks the cells a segment crosses, nearest first, calling `visit` with
 * each cell's triangles not yet tested this query, until `visit` says stop
 * (it returns the segment t up to which nothing nearer can still be found,
 * and the walk stops once a cell begins beyond that).
 */
function walk(s: Solids, from: Vec3, to: Vec3, visit: (i: number) => void, bestT: () => number): void {
  if (!s.count) return
  const q = nextQuery(s)
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  // The segment clipped to the grid's box (slabs).
  let t0 = 0, t1 = 1
  const lo = [s.ox, s.oy, s.oz], hi = [s.ox + s.nx * s.cell, s.oy + s.ny * s.cell, s.oz + s.nz * s.cell]
  const p = from, dv = [dx, dy, dz]
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dv[a]) < 1e-15) { if (p[a] < lo[a] || p[a] > hi[a]) return; continue }
    let ta = (lo[a] - p[a]) / dv[a], tb = (hi[a] - p[a]) / dv[a]
    if (ta > tb) { const x = ta; ta = tb; tb = x }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return
  }
  const size = s.cell
  const sx = p[0] + dx * t0, sy = p[1] + dy * t0, sz = p[2] + dz * t0
  let cx = clampCell((sx - s.ox) / size, s.nx), cy = clampCell((sy - s.oy) / size, s.ny), cz = clampCell((sz - s.oz) / size, s.nz)
  const stx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sty = dy > 0 ? 1 : dy < 0 ? -1 : 0, stz = dz > 0 ? 1 : dz < 0 ? -1 : 0
  const boundary = (c: number, st: number, o: number, pv: number, dvv: number): number =>
    st === 0 ? Infinity : (o + (c + (st > 0 ? 1 : 0)) * size - pv) / dvv
  let tmx = boundary(cx, stx, s.ox, p[0], dx), tmy = boundary(cy, sty, s.oy, p[1], dy), tmz = boundary(cz, stz, s.oz, p[2], dz)
  const tdx = stx === 0 ? Infinity : size / Math.abs(dx), tdy = sty === 0 ? Infinity : size / Math.abs(dy), tdz = stz === 0 ? Infinity : size / Math.abs(dz)
  let tEnter = t0
  for (;;) {
    if (tEnter > bestT() || tEnter > t1) return
    const c = (cz * s.ny + cy) * s.nx + cx
    for (let k = s.start[c], e = s.start[c + 1]; k < e; k++) {
      const i = s.items[k]
      if (s.stamp[i] === q) continue
      s.stamp[i] = q
      visit(i)
    }
    if (tmx <= tmy && tmx <= tmz) { cx += stx; tEnter = tmx; tmx += tdx; if (cx < 0 || cx >= s.nx) return }
    else if (tmy <= tmz) { cy += sty; tEnter = tmy; tmy += tdy; if (cy < 0 || cy >= s.ny) return }
    else { cz += stz; tEnter = tmz; tmz += tdz; if (cz < 0 || cz >= s.nz) return }
  }
}

/** Which triangles a query counts: all, only walls (not FLAT), or only FLAT ones. */
export type TriFilter = 'all' | 'walls' | 'flats'

function passes(s: Solids, i: number, filter: TriFilter): boolean {
  return filter === 'all' || (filter === 'walls' ? s.flat[i] === 0 : s.flat[i] === 1)
}

/** The first triangle the segment `from` to `to` meets, or null. */
export function segmentCast(s: Solids, from: Vec3, to: Vec3, filter: TriFilter = 'all'): Hit | null {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  let best = Infinity, bestI = -1
  walk(s, from, to, (i) => {
    if (!passes(s, i, filter)) return
    const t = crossT(s, i, from[0], from[1], from[2], dx, dy, dz)
    if (t >= 0 && (t < best || (t === best && i < bestI))) { best = t; bestI = i }
  }, () => best)
  if (bestI < 0) return null
  const o = bestI * 12
  let nx = s.data[o + 9], ny = s.data[o + 10], nz = s.data[o + 11]
  if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz }
  return { t: best, point: [from[0] + dx * best, from[1] + dy * best, from[2] + dz * best], normal: [nx, ny, nz], tri: bestI }
}

/** Whether nothing lies on the segment (a sight line): stops at the first triangle found. */
export function segmentClear(s: Solids, from: Vec3, to: Vec3): boolean {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  let hit = false
  walk(s, from, to, (i) => {
    if (!hit && crossT(s, i, from[0], from[1], from[2], dx, dy, dz) >= 0) hit = true
  }, () => (hit ? -1 : Infinity))
  return !hit
}

/** The height of the first surface straight below (x, y, z) within `maxDrop`, or null. */
export function groundBelow(s: Solids, x: number, y: number, z: number, maxDrop: number): number | null {
  const h = segmentCast(s, [x, y, z], [x, y - maxDrop, z])
  return h ? h.point[1] : null
}

/** The height of the first surface straight above (x, y, z) within `maxRise`, or null. */
export function ceilingAbove(s: Solids, x: number, y: number, z: number, maxRise: number): number | null {
  const h = segmentCast(s, [x, y, z], [x, y + maxRise, z])
  return h ? h.point[1] : null
}

/** Scratch for closestOnTri. */
const cp = new Float64Array(3)

/** The point of triangle `i` closest to p, into `cp` (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(s: Solids, i: number, px: number, py: number, pz: number): void {
  const d = s.data, o = i * 12
  const ax = d[o], ay = d[o + 1], az = d[o + 2]
  const abx = d[o + 3], aby = d[o + 4], abz = d[o + 5], acx = d[o + 6], acy = d[o + 7], acz = d[o + 8]
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) { cp[0] = ax; cp[1] = ay; cp[2] = az; return }
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) { cp[0] = ax + abx; cp[1] = ay + aby; cp[2] = az + abz; return }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); cp[0] = ax + abx * v; cp[1] = ay + aby * v; cp[2] = az + abz * v; return }
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) { cp[0] = ax + acx; cp[1] = ay + acy; cp[2] = az + acz; return }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); cp[0] = ax + acx * w; cp[1] = ay + acy * w; cp[2] = az + acz * w; return }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    cp[0] = ax + abx + (acx - abx) * w; cp[1] = ay + aby + (acy - aby) * w; cp[2] = az + abz + (acz - abz) * w; return
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den
  cp[0] = ax + abx * v + acx * w; cp[1] = ay + aby * v + acy * w; cp[2] = az + abz * v + acz * w
}

/** Calls `visit` once for each triangle in the cells a box overlaps. */
function each(s: Solids, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, visit: (i: number) => boolean | void): void {
  if (!s.count) return
  const size = s.cell
  if (x1 < s.ox || y1 < s.oy || z1 < s.oz || x0 > s.ox + s.nx * size || y0 > s.oy + s.ny * size || z0 > s.oz + s.nz * size) return
  const q = nextQuery(s)
  const ax = clampCell((x0 - s.ox) / size, s.nx), bx = clampCell((x1 - s.ox) / size, s.nx)
  const ay = clampCell((y0 - s.oy) / size, s.ny), by = clampCell((y1 - s.oy) / size, s.ny)
  const az = clampCell((z0 - s.oz) / size, s.nz), bz = clampCell((z1 - s.oz) / size, s.nz)
  for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const c = (z * s.ny + y) * s.nx + x
    for (let k = s.start[c], e = s.start[c + 1]; k < e; k++) {
      const i = s.items[k]
      if (s.stamp[i] === q) continue
      s.stamp[i] = q
      if (visit(i) === true) return
    }
  }
}

/** Whether a ball at `c` of radius `r` touches any triangle that passes `filter`. */
export function sphereHits(s: Solids, c: Vec3, r: number, filter: TriFilter = 'all'): boolean {
  let hit = false
  const r2 = r * r
  each(s, c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, (i) => {
    if (!passes(s, i, filter)) return
    closestOnTri(s, i, c[0], c[1], c[2])
    const dx = c[0] - cp[0], dy = c[1] - cp[1], dz = c[2] - cp[2]
    if (dx * dx + dy * dy + dz * dz < r2) { hit = true; return true }
  })
  return hit
}

/**
 * The push that takes a ball at `c` of radius `r` clear of the deepest
 * triangle it touches (of those passing `filter`), added into `out`: away
 * from that triangle's closest point by the overlap. Returns how many it
 * touches. Only the deepest, so two triangles of one face (or a corner's
 * two walls) never push twice: callers repeat it and test again.
 */
export function spherePush(s: Solids, c: Vec3, r: number, out: Vec3, filter: TriFilter = 'all'): number {
  let touching = 0
  const r2 = r * r
  let best = -1, bx = 0, by = 0, bz = 0
  each(s, c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, (i) => {
    if (!passes(s, i, filter)) return
    closestOnTri(s, i, c[0], c[1], c[2])
    let dx = c[0] - cp[0], dy = c[1] - cp[1], dz = c[2] - cp[2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r2) return
    touching++
    let d = Math.sqrt(d2)
    if (d < 1e-9) { const o = i * 12; dx = s.data[o + 9]; dy = s.data[o + 10]; dz = s.data[o + 11]; d = 1e-9 }
    const depth = r - d
    if (depth > best) { best = depth; const k = depth / Math.hypot(dx, dy, dz); bx = dx * k; by = dy * k; bz = dz * k }
  })
  if (touching) { out[0] += bx; out[1] += by; out[2] += bz }
  return touching
}
