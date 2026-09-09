/**
 * clip.ts — a shard cropped to the region it is encrypted to.
 *
 * A shard hidden at height h is sealed to one aligned cube of side 2^h. If
 * the shape is larger than that cube, the part outside it is simply not
 * drawn: the region is the thing the key opens, and what the key opens ends
 * at the region's walls. A region is an axis-aligned box, so this is exact
 * plane clipping against its six faces rather than a general boolean, which
 * gives the same result as intersecting with the box and needs no library.
 * Colors interpolate along a cut edge, so a cut face keeps its gradient.
 *
 * Everything here is in the mesh's own render frame: model units, after the
 * z flip toRender applies, before the group scale. regionBox puts a cyberspace
 * region into that frame.
 */

import type { ViewAxes } from './space'
import { alignTo, stepFor, type Position } from './space'

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/** A vertex mid-clip: a position and a color. */
type V = { p: [number, number, number]; c: [number, number, number] }

function lerp(a: V, b: V, t: number): V {
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    c: [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t],
  }
}

/**
 * Sutherland-Hodgman: one polygon against one plane. `axis` and `sign` name
 * the plane x_axis * sign >= limit * sign, so sign +1 keeps what is above
 * `limit` and sign -1 keeps what is below it.
 */
function clipPolygon(poly: V[], axis: 0 | 1 | 2, sign: 1 | -1, limit: number): V[] {
  const out: V[] = []
  const inside = (v: V): boolean => (v.p[axis] - limit) * sign >= 0
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const prev = poly[(i + poly.length - 1) % poly.length]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(lerp(prev, cur, (limit - prev.p[axis]) / (cur.p[axis] - prev.p[axis])))
      out.push(cur)
    } else if (prevIn) {
      out.push(lerp(prev, cur, (limit - prev.p[axis]) / (cur.p[axis] - prev.p[axis])))
    }
  }
  return out
}

function clipToBox(poly: V[], box: Box): V[] {
  let p = poly
  for (const axis of [0, 1, 2] as const) {
    if (p.length === 0) return p
    p = clipPolygon(p, axis, 1, box.min[axis])
    if (p.length === 0) return p
    p = clipPolygon(p, axis, -1, box.max[axis])
  }
  return p
}

export interface Mesh {
  positions: Float32Array
  colors: Float32Array
  index: number[]
}

/**
 * Every triangle of a mesh clipped to a box. The triangles that survive are
 * fanned from their clipped polygons; vertices are emitted per polygon, since
 * a cut vertex belongs to one face. Vertices no triangle uses are dropped.
 */
export function clipMesh(mesh: Mesh, box: Box): Mesh {
  const at = (i: number): V => ({
    p: [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]],
    c: [mesh.colors[i * 3], mesh.colors[i * 3 + 1], mesh.colors[i * 3 + 2]],
  })
  const pos: number[] = []
  const col: number[] = []
  const index: number[] = []
  for (let t = 0; t + 2 < mesh.index.length; t += 3) {
    const poly = clipToBox([at(mesh.index[t]), at(mesh.index[t + 1]), at(mesh.index[t + 2])], box)
    if (poly.length < 3) continue
    const base = pos.length / 3
    for (const v of poly) { pos.push(...v.p); col.push(...v.c) }
    for (let k = 1; k + 1 < poly.length; k++) index.push(base, base + k, base + k + 1)
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), index }
}

/** The points of a mesh that lie inside a box, walls included. */
export function clipPoints(positions: Float32Array, colors: Float32Array, box: Box): { positions: Float32Array; colors: Float32Array } {
  const pos: number[] = []
  const col: number[] = []
  for (let i = 0; i * 3 < positions.length; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
    if (x < box.min[0] || x > box.max[0] || y < box.min[1] || y > box.max[1] || z < box.min[2] || z > box.max[2]) continue
    pos.push(x, y, z); col.push(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) }
}

/** Whether a box already contains the whole of a mesh's bounds, so no clip is needed. */
export function boxContains(box: Box, positions: Float32Array): boolean {
  for (let i = 0; i * 3 < positions.length; i++) {
    for (const a of [0, 1, 2] as const) {
      const v = positions[i * 3 + a]
      if (v < box.min[a] || v > box.max[a]) return false
    }
  }
  return true
}

/**
 * The region cube of side 2^height that contains `at`, in the render frame of
 * a shard placed at `at` with model units of 2^unit gibsons.
 *
 * The shard's group sits at the centre of the cell holding `at` at the
 * current zoom, so the frame's origin is that world point: the aligned
 * coordinate plus half a cell. Each render axis is one world axis with a
 * direction, as cellCentre maps them, so a box edge on a world axis lands on
 * its render axis at (edge minus origin) over 2^unit, flipped when the axis
 * points the other way.
 */
export function regionBox(at: Position, height: number, unit: number, scaleExp: number, axes: ViewAxes): Box {
  const h = BigInt(height)
  const half = Number(stepFor(scaleExp)) / 2
  const perUnit = 2 ** unit
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    const v = at[a.axis]
    const base = (v >> h) << h
    const origin = alignTo(v, scaleExp)
    const lo = (Number(base - origin) - half) / perUnit
    const hi = (Number(base + (1n << h) - origin) - half) / perUnit
    if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
  })
  return { min, max }
}
