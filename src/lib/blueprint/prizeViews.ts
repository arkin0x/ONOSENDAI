/**
 * prizeViews.ts - the prize's pictures, made by the maker's client when a
 * blueprint is published (design page 4.7): the shard drawn flat along X,
 * along Y, along Z or isometric, as a silhouette or as a render, each a small
 * image (about 256 pixels, a few kilobytes) that goes into the record. The
 * shard itself stays sealed: a flat picture cannot be turned back into it.
 *
 * The shard's own triangles (scene/ShardMesh.tsx shardGeometry) are projected
 * orthographically in world axes, the same way the EXAMINE sheet draws the
 * build (lib/blueprint/draw.ts), and as the game shows them (CYBERSPACE_V2
 * §11.1: facing +Z with +Y up, +X is on the right): along X looks from +X
 * toward -X (+Z on the right), along Y looks down from above (+X right, +Z
 * up), along Z faces the sun (from -Z looking along +Z, +X right, +Y up), and
 * isometric looks from the (+X, +Y, -Z) corner.
 *
 * A silhouette is one flat light shape on transparent. A render is every face
 * in its own colours, sorted back to front, lit by one soft light from above
 * and in front. A shard with no faces draws its points.
 */

import { expandFaceColors, type ShardModel } from 'sno-core/shards'
import { shardGeometry } from '../../scene/ShardMesh'
import { VIEW_MAX_CHARS, type PrizeView } from './format'
import { partMatrix, resolveParts, type Placed } from 'sno-core/parts'
import { fetchOwnFirst } from '../parts'
import { authorOf } from '../carried'

export type PrizeMode = 'silhouette' | 'render'

const C = Math.cos(Math.PI / 6)
/** The silhouette's ink: the sheet's white. */
export const SILHOUETTE_INK = '#eaf6ff'
/** Where the render's light comes from, in world axes: above, from the viewers' side of the sun (-Z) and +X a little. */
const LIGHT: readonly [number, number, number] = (() => { const v = [0.35, 1, -0.55]; const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n] as const })()

/**
 * A world point on the picture: [right, down, nearness]. Nearness grows
 * toward the viewer, so sorting by it ascending draws back to front.
 */
export function projectPrizePoint(p: readonly [number, number, number], view: PrizeView): [number, number, number] {
  const [x, y, z] = p
  switch (view) {
    case 'x': return [z, -y, x]
    case 'y': return [x, -z, y]
    case 'z': return [x, -y, -z]
    case 'iso': return [(x + z) * C, (x - z) / 2 - y, x + y - z]
  }
}

/** A render position (three.js, Z negated: sno-core toRender) back to world axes. */
export function renderToWorld(x: number, y: number, z: number): [number, number, number] {
  return [x, y, 0 - z]
}

/** One projected triangle: its three corners on the picture, its mean nearness, its colour (0..1) and its light (0..1). */
export interface ProjectedTri {
  pts: [[number, number], [number, number], [number, number]]
  depth: number
  color: [number, number, number]
  light: number
}

/** How much light a face takes: soft, both sides lit, never black. */
export function faceLight(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const len = Math.hypot(n[0], n[1], n[2])
  if (!len) return 0.6
  const d = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len)
  return 0.42 + 0.58 * d
}

/**
 * A shard's geometry projected along a view: its triangles sorted back to
 * front, and its points (for a shard with no faces) as [right, down,
 * nearness, r, g, b].
 */
export function projectGeometry(g: { positions: ArrayLike<number>; colors: ArrayLike<number>; index: ArrayLike<number> }, view: PrizeView): { tris: ProjectedTri[]; points: Array<[number, number, number, number, number, number]> } {
  const n = Math.floor(g.positions.length / 3)
  const world: Array<[number, number, number]> = []
  const proj: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const w = renderToWorld(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2])
    world.push(w)
    proj.push(projectPrizePoint(w, view))
  }
  const tris: ProjectedTri[] = []
  for (let t = 0; t + 2 < g.index.length; t += 3) {
    const a = g.index[t], b = g.index[t + 1], c = g.index[t + 2]
    if (a >= n || b >= n || c >= n) continue
    const col: [number, number, number] = [0, 0, 0]
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) col[k] += (g.colors[v * 3 + k] ?? 0) / 3
    tris.push({
      pts: [[proj[a][0], proj[a][1]], [proj[b][0], proj[b][1]], [proj[c][0], proj[c][1]]],
      depth: (proj[a][2] + proj[b][2] + proj[c][2]) / 3,
      color: col,
      light: faceLight(world[a], world[b], world[c]),
    })
  }
  tris.sort((p, q) => p.depth - q.depth)
  const points: Array<[number, number, number, number, number, number]> = g.index.length >= 3
    ? []
    : proj.map((p, i) => [p[0], p[1], p[2], g.colors[i * 3] ?? 1, g.colors[i * 3 + 1] ?? 1, g.colors[i * 3 + 2] ?? 1] as [number, number, number, number, number, number]).sort((p, q) => p[2] - q[2])
  return { tris, points }
}

/**
 * The scale and offset that fit points into a `px` square with `pad` round
 * it, keeping the aspect and centring: picture = point * s + offset.
 */
export function fitView(points: ReadonlyArray<readonly [number, number]>, px: number, pad: number): { s: number; ox: number; oy: number } {
  if (!points.length) return { s: 1, ox: px / 2, oy: px / 2 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const span = Math.max(maxX - minX, maxY - minY)
  const s = span > 0 ? (px - 2 * pad) / span : 1
  return { s, ox: px / 2 - ((minX + maxX) / 2) * s, oy: px / 2 - ((minY + maxY) / 2) * s }
}

const rgb = (c: readonly number[], k: number): string =>
  `rgb(${Math.round(Math.min(1, Math.max(0, c[0] * k)) * 255)}, ${Math.round(Math.min(1, Math.max(0, c[1] * k)) * 255)}, ${Math.round(Math.min(1, Math.max(0, c[2] * k)) * 255)})`

/** Draw one view of projected geometry into a context `px` square. */
export function drawPrizeView(ctx: CanvasRenderingContext2D, projected: ReturnType<typeof projectGeometry>, mode: PrizeMode, px: number): void {
  const all: Array<[number, number]> = []
  for (const t of projected.tris) all.push(...t.pts)
  for (const p of projected.points) all.push([p[0], p[1]])
  const f = fitView(all, px, px * 0.08)
  const X = (u: number): number => u * f.s + f.ox
  const Y = (v: number): number => v * f.s + f.oy
  ctx.clearRect(0, 0, px, px)
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(0.6, px / 400)
  for (const t of projected.tris) {
    const fill = mode === 'silhouette' ? SILHOUETTE_INK : rgb(t.color, t.light)
    ctx.fillStyle = fill
    ctx.strokeStyle = fill
    ctx.beginPath()
    ctx.moveTo(X(t.pts[0][0]), Y(t.pts[0][1]))
    ctx.lineTo(X(t.pts[1][0]), Y(t.pts[1][1]))
    ctx.lineTo(X(t.pts[2][0]), Y(t.pts[2][1]))
    ctx.closePath()
    ctx.fill()
    // The same colour round the edge closes the hairline seams between faces.
    ctx.stroke()
  }
  const r = Math.max(1.5, px / 90)
  for (const p of projected.points) {
    ctx.fillStyle = mode === 'silhouette' ? SILHOUETTE_INK : rgb([p[3], p[4], p[5]], 1)
    ctx.beginPath()
    ctx.arc(X(p[0]), Y(p[1]), r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** A canvas as a small image: WebP where the browser makes it (a lower quality until it fits), PNG otherwise; '' when nothing fits `max`. */
function encode(canvas: HTMLCanvasElement, max: number): string {
  for (const q of [0.8, 0.6, 0.4]) {
    try {
      const webp = canvas.toDataURL('image/webp', q)
      if (!webp.startsWith('data:image/webp')) break
      if (webp.length <= max) return webp
    } catch { break }
  }
  try { const png = canvas.toDataURL('image/png'); return png.length <= max ? png : '' } catch { return '' }
}

/** The sizes a picture steps down through when it will not fit the spec's limit at the size asked. */
const SHRINK = [1, 0.75, 0.5, 0.375]

/**
 * The prize's pictures in the views asked for, as data URLs (`px` square,
 * transparent round the shape), each within the spec's VIEW_MAX_CHARS: a
 * picture that will not fit steps down in quality, then in size. Only the
 * views asked are in the answer (and one that fits at no size is left out);
 * where there is no canvas (a test, a worker), the answer is empty.
 */
export function prizeImages(shard: ShardModel, mode: PrizeMode, views: readonly PrizeView[], px = 256): Partial<Record<PrizeView, string>> {
  if (typeof document === 'undefined' || !views.length) return {}
  return imagesOf(shardGeometry(expandFaceColors(shard)), mode, views, px)
}

/** Pictures of a geometry in the views asked, each within VIEW_MAX_CHARS. */
function imagesOf(g: { positions: ArrayLike<number>; colors: ArrayLike<number>; index: ArrayLike<number> }, mode: PrizeMode, views: readonly PrizeView[], px: number): Partial<Record<PrizeView, string>> {
  const out: Partial<Record<PrizeView, string>> = {}
  const canvas = document.createElement('canvas')
  for (const view of new Set(views)) {
    const projected = projectGeometry(g, view)
    for (const k of SHRINK) {
      const side = Math.max(32, Math.round(px * k))
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) return out
      drawPrizeView(ctx, projected, mode, side)
      const url = encode(canvas, VIEW_MAX_CHARS)
      if (url) { out[view] = url; break }
    }
  }
  return out
}

/** How long the prize's placed pieces may take to arrive before its pictures are drawn without them. */
export const PARTS_WAIT_MS = 6000

type Geometry = { positions: ArrayLike<number>; colors: ArrayLike<number>; index: ArrayLike<number> }

/**
 * The prize's whole geometry: its own faces and every piece it places, at any
 * depth, each moved into the prize's frame by its placement (sno-core
 * partMatrix, as the scene places them). A prize built only of placed pieces
 * (a torch on a stand, say) has no faces of its own, and its pictures were
 * blank without this.
 */
export async function prizeGeometry(shard: ShardModel): Promise<Geometry> {
  const positions: number[] = [], colors: number[] = [], index: number[] = []
  const add = (g: Geometry, m: readonly number[] | null): void => {
    const base = positions.length / 3
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2]
      if (m) positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
      else positions.push(x, y, z)
    }
    for (let i = 0; i < g.colors.length; i++) colors.push(g.colors[i])
    for (let i = 0; i < g.index.length; i++) index.push(g.index[i] + base)
  }
  add(shardGeometry(expandFaceColors(shard)), null)
  if (shard.refs?.length && shard.parts?.length) {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PARTS_WAIT_MS))
    const placed = await Promise.race([resolveParts(shard, fetchOwnFirst, { author: authorOf(shard) }).catch(() => null), timeout])
    const walk = (list: readonly Placed[], unit: number, parent: readonly number[] | null, depth: number): void => {
      if (depth > 8) return
      for (const p of list) {
        if (!p.model) continue
        const local = partMatrix(p.part, unit, p.model.unit)
        const m = parent ? mul(parent, local) : local
        add(shardGeometry(expandFaceColors(p.model)), m)
        walk(p.children, p.model.unit, m, depth + 1)
      }
    }
    if (placed) walk(placed, shard.unit, null, 0)
  }
  return { positions, colors, index }
}

/** a × b, column-major 4 by 4. */
function mul(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}

/** The prize's pictures with every placed piece in them (prizeGeometry), as prizeImages draws them. */
export async function prizeImagesWhole(shard: ShardModel, mode: PrizeMode, views: readonly PrizeView[], px = 256): Promise<Partial<Record<PrizeView, string>>> {
  if (typeof document === 'undefined' || !views.length) return {}
  return imagesOf(await prizeGeometry(shard), mode, views, px)
}
