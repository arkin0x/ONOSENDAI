/**
 * draw.ts - a blueprint drawn on a 2D canvas: the isometric model, the three
 * views along the axes, a section through one layer, the XYZ compass and the
 * black sun (design page craft-design/block-uses, 4.1 and 4.6).
 *
 * Every drawer takes a CanvasRenderingContext2D and draws in the context's
 * current transform, so a caller scales for the screen's pixel ratio once and
 * a test passes a stand-in that records the calls. Nothing here reads the
 * page, except the tile picture cache at the end (TILE_IMAGES), which does
 * nothing where there is no Image.
 *
 * World axes, always (4.1), and drawn as the game shows them (CYBERSPACE_V2
 * §11.1, left-handed): facing the black sun (+Z) with +Y up, +X is on the
 * right. Every picture here is a view a player could really see, so a chiral
 * build is never drawn as its mirror image (axis audit, 2026-11-27):
 * - isometric: from the (+X, +Y, -Z) corner, behind and to the right of a
 *   player facing the sun. +X runs right and down the screen, +Z right and
 *   up (the sun beyond the build), +Y straight up; the faces seen are a
 *   block's top, its -Z face (left) and its +X face (right);
 * - from above: looking down -Y, +X right, +Z up, the sun at the top edge (the
 *   game's own top-down view, lib/space.ts topDownQuaternion);
 * - facing the sun ('z'): from the -Z side looking along +Z, +X right, +Y up,
 *   the sun behind the build;
 * - from +X ('x'): looking along -X, +Y up, +Z on the right.
 *
 * A revealed block draws with its real tile on each face it shows; a hidden
 * one as dark grey smoke drifting inside its cell, so the volume reads but
 * not the block.
 */

import { blockKind, type BlockKind } from '../terrain/blocks'
import { tileUrl } from '../terrain/tiles'
import { cellAt, cellIndex, type FinderView } from './format'

/** cos 30 degrees: the isometric grid's horizontal step. */
export const ISO_C = Math.cos(Math.PI / 6)
/** How far apart the layers float when fully exploded, in blocks between one layer and the next. */
export const EXPLODE_GAP = 0.75
/** How far past the box's +Z side the floor arrow reaches to the black sun, in blocks. */
const FLOOR_SUN = 1.6

/** The compass's colours: the app's 3D compass (scene/Compass3D.tsx). */
export const AXIS_COLOR = { X: '#ff4444', Y: '#44ff44', Z: '#4488ff' } as const
/** The black sun as it reads on screen (Compass3D SUN_CORE and SUN_GLOW; the scene colour is #9258d1). */
export const SUN_CORE = '#e8acff'
export const SUN_GLOW = '#d48cff'

/** A view along one axis. */
export type AxisView = 'x' | 'y' | 'z'
/** Which view a compass is turned to match. */
export type CompassOrientation = 'iso' | AxisView

/** Block tile pictures, by block id and face (0 top, 1 side, 2 bottom); null until loaded, when the drawing uses flat colours. */
export interface TileImages {
  get(id: number, face: number): CanvasImageSource | null
}

export interface IsoOpts {
  /** The square box to draw into, in the context's units. */
  x: number
  y: number
  size: number
  /** The smoke's drift, in seconds of slow motion. */
  smokePhase?: number
  /**
   * 0 assembled to 1 apart: the layers float apart along +Y. When given (even
   * 0), the drawing keeps room for the layers fully apart, so an animation
   * never rescales it.
   */
  exploded?: number
  /** The front quarter removed (the +X, -Z quarter, nearest the viewer). */
  cutaway?: boolean
  /** A floor grid under the box and a +Z arrow on it to the black sun. */
  floor?: boolean
  tiles?: TileImages
}

/** Where the isometric drawing sits: `u` pixels to a block's edge, the origin's screen point, the gap per layer, and the box's depth along Z. */
export interface IsoLayout {
  u: number
  ox: number
  oy: number
  gap: number
  sz: number
}

type Size = readonly [number, number, number]
type Pt = [number, number]

/** A world point's screen offset in blocks, before scale: +X right and down, +Z right and up, +Y up (from the (+X, +Y, -Z) corner). */
function isoRaw(X: number, Y: number, Z: number): Pt {
  return [(X + Z) * ISO_C, (X - Z) / 2 - Y]
}

/** The scale and placement that fit the box (and its floor and exploded room) into the square. */
export function isoLayout(size: Size, opts: Pick<IsoOpts, 'x' | 'y' | 'size' | 'exploded' | 'floor'>): IsoLayout {
  const [sx, sy, sz] = size
  const gap = opts.exploded === undefined ? 0 : EXPLODE_GAP
  const top = sy + Math.max(0, sy - 1) * gap
  const zr = sz + (opts.floor ? FLOOR_SUN : 0)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const X of [0, sx]) for (const Y of [0, top]) for (const Z of [0, zr]) {
    const [px, py] = isoRaw(X, Y, Z)
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py)
  }
  if (opts.floor) { minY -= 0.4; maxX += 0.6 }
  const w = maxX - minX, h = maxY - minY
  const pad = Math.max(1, opts.size * 0.05)
  const u = Math.max(0.01, Math.min((opts.size - 2 * pad) / w, (opts.size - 2 * pad) / h))
  return {
    u,
    ox: opts.x + (opts.size - w * u) / 2 - minX * u,
    oy: opts.y + (opts.size - h * u) / 2 - minY * u,
    gap,
    sz,
  }
}

/** A world point (in blocks, the box's own frame) on the screen; `lift` raises it along +Y without moving it in depth. */
export function isoPoint(L: IsoLayout, X: number, Y: number, Z: number, lift = 0): Pt {
  const [px, py] = isoRaw(X, Y + lift, Z)
  return [L.ox + px * L.u, L.oy + py * L.u]
}

/** Whether a cell is in the front quarter a cutaway removes: the (+X, -Z) quarter, nearest the viewer. */
function inCut(size: Size, x: number, z: number): boolean {
  return x >= size[0] / 2 && z < size[2] / 2
}

/**
 * The occupied cells the isometric view draws, back to front (painter's
 * order): by x + y - z (nearer the (+X, +Y, -Z) corner is nearer), then lower layers first. On the block grid two cells
 * with the same sum never overlap on screen; an exploded view only lifts the
 * higher layers further from the ones in front of them.
 */
export function isoOrder(view: FinderView, cutaway = false): number[] {
  const out: number[] = []
  const sum: number[] = []
  const ys: number[] = []
  view.occupied.forEach((occ, i) => {
    if (!occ) return
    const [x, y, z] = cellAt(view.size, i)
    if (cutaway && inCut(view.size, x, z)) return
    out.push(i)
    sum[i] = x + y + (view.size[2] - 1 - z)
    ys[i] = y
  })
  return out.sort((a, b) => sum[a] - sum[b] || ys[a] - ys[b] || a - b)
}

/** How many occupied cells the finder sees as smoke. */
export function hiddenCount(view: FinderView): number {
  let n = 0
  view.occupied.forEach((occ, i) => { if (occ && !view.revealed.has(i)) n++ })
  return n
}

/** How many cells are occupied. */
export function blockCount(view: FinderView): number {
  let n = 0
  for (const occ of view.occupied) if (occ) n++
  return n
}

/** A fast stable hash to 0..1, for the smoke's blobs. */
function h01(a: number, b: number): number {
  let h = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177)
  h ^= h >>> 13
  h = Math.imul(h, 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fract = (v: number): number => v - Math.floor(v)

/**
 * One face of smoke: the unit square mapped by (e1, e2) from `o`. A dark
 * translucent haze with two soft blobs drifting through it, wrapping at the
 * edges so the drift never jumps.
 */
function smokeFace(ctx: CanvasRenderingContext2D, o: Pt, e1: Pt, e2: Pt, shade: number, phase: number, seed: number): void {
  ctx.save()
  ctx.transform(e1[0], e1[1], e2[0], e2[1], o[0], o[1])
  ctx.beginPath()
  ctx.rect(0, 0, 1, 1)
  ctx.clip()
  ctx.fillStyle = 'rgba(34, 38, 48, 0.66)'
  ctx.fillRect(-0.01, -0.01, 1.02, 1.02)
  for (let k = 0; k < 2; k++) {
    const cx = fract(h01(seed, k) + phase * (0.05 + 0.03 * k))
    const cy = fract(h01(seed, k + 7) + phase * (0.035 - 0.02 * k))
    const r = 0.42 + 0.2 * h01(seed, k + 3)
    const l = 120 + Math.floor(50 * h01(seed, k + 5))
    for (const dx of cx > 0.5 ? [0, -1] : [0, 1]) {
      for (const dy of cy > 0.5 ? [0, -1] : [0, 1]) {
        const g = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r)
        g.addColorStop(0, `rgba(${l}, ${l + 6}, ${l + 16}, 0.34)`)
        g.addColorStop(1, `rgba(${l}, ${l + 6}, ${l + 16}, 0)`)
        ctx.fillStyle = g
        ctx.fillRect(cx + dx - r, cy + dy - r, 2 * r, 2 * r)
      }
    }
  }
  if (shade) { ctx.fillStyle = `rgba(0, 0, 0, ${shade})`; ctx.fillRect(-0.01, -0.01, 1.02, 1.02) }
  ctx.strokeStyle = 'rgba(200, 212, 230, 0.3)'
  ctx.lineWidth = 0.035
  ctx.strokeRect(0, 0, 1, 1)
  ctx.restore()
}

/** One face of a revealed block: its tile, or its flat colour until the tile loads, darkened by `shade`. */
function tileFace(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, kind: BlockKind, o: Pt, e1: Pt, e2: Pt, shade: number): void {
  ctx.save()
  ctx.transform(e1[0], e1[1], e2[0], e2[1], o[0], o[1])
  if (kind.clear) ctx.globalAlpha = 0.74
  if (img) ctx.drawImage(img, -0.01, -0.01, 1.02, 1.02)
  else { ctx.fillStyle = kind.color; ctx.fillRect(-0.01, -0.01, 1.02, 1.02) }
  if (shade) { ctx.fillStyle = `rgba(0, 0, 0, ${shade})`; ctx.fillRect(-0.01, -0.01, 1.02, 1.02) }
  ctx.globalAlpha = kind.glow ? 0.7 : 0.35
  ctx.strokeStyle = kind.edge
  ctx.lineWidth = 0.04
  ctx.strokeRect(0, 0, 1, 1)
  ctx.restore()
}

/** The shades of a block's top, its -Z face (left) and its +X face (right). */
const SHADE = { top: 0, z: 0.22, x: 0.4 }

/**
 * The isometric drawing of the box: revealed cells as cubes with their real
 * tiles, hidden ones as smoke, back to front, inside a faint outline of the
 * box. Faces against a drawn neighbour are skipped (a clear block's
 * neighbours keep theirs, since they show through it).
 */
export function drawIso(ctx: CanvasRenderingContext2D, view: FinderView, opts: IsoOpts): void {
  const size = view.size
  const [sx, sy, sz] = size
  const L = isoLayout(size, opts)
  const e = Math.min(1, Math.max(0, opts.exploded ?? 0))
  const phase = opts.smokePhase ?? 0
  const tiles = opts.tiles ?? TILE_IMAGES
  const order = isoOrder(view, opts.cutaway)
  const drawn = new Set(order)
  const lw = Math.max(0.75, L.u * 0.035)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.lineCap = 'round'

  const line = (a: Pt, b: Pt): void => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke() }
  if (opts.floor) {
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.16)'
    ctx.lineWidth = lw
    for (let i = 0; i <= sx; i++) line(isoPoint(L, i, 0, 0), isoPoint(L, i, 0, sz))
    for (let j = 0; j <= sz; j++) line(isoPoint(L, 0, 0, j), isoPoint(L, sx, 0, j))
    // From the build's +Z face, a short dotted line along +Z to the black sun just beyond it (owner, 2026-11-27: the
    // line and the sun belong to the build, not far off from it).
    const a = isoPoint(L, sx / 2, 0, sz), b = isoPoint(L, sx / 2, 0, sz + 0.75)
    ctx.strokeStyle = 'rgba(212, 140, 255, 0.85)'
    ctx.lineWidth = Math.max(1, L.u * 0.06)
    ctx.setLineDash([Math.max(2, L.u * 0.12), Math.max(2, L.u * 0.1)])
    line(a, b)
    ctx.setLineDash([])
    const d: Pt = [b[0] - a[0], b[1] - a[1]]
    const len = Math.hypot(d[0], d[1]) || 1
    const ux = d[0] / len, uy = d[1] / len, hs = Math.max(3, L.u * 0.2)
    ctx.fillStyle = 'rgba(212, 140, 255, 0.9)'
    ctx.beginPath()
    ctx.moveTo(b[0] + ux * hs, b[1] + uy * hs)
    ctx.lineTo(b[0] - uy * hs * 0.6, b[1] + ux * hs * 0.6)
    ctx.lineTo(b[0] + uy * hs * 0.6, b[1] - ux * hs * 0.6)
    ctx.closePath()
    ctx.fill()
    const s = isoPoint(L, sx / 2, 0, sz + 1.2)
    const r = Math.max(3, L.u * 0.28)
    drawBlackSun(ctx, s[0], s[1], r)
    ctx.font = `600 ${Math.max(9, Math.round(L.u * 0.34))}px ui-monospace, monospace`
    ctx.fillStyle = SUN_CORE
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('+Z', s[0] + r * 1.8, s[1])
  }

  // The box's three back edges, behind everything.
  ctx.strokeStyle = 'rgba(160, 220, 255, 0.22)'
  ctx.lineWidth = lw
  ctx.setLineDash([lw * 3, lw * 3])
  const O = isoPoint(L, 0, 0, sz)
  line(O, isoPoint(L, sx, 0, sz)); line(O, isoPoint(L, 0, sy, sz)); line(O, isoPoint(L, 0, 0, 0))
  ctx.setLineDash([])

  const covers = (j: number): boolean => {
    if (!drawn.has(j)) return false
    const id = view.revealed.get(j)
    return id === undefined || !blockKind(id)?.clear
  }
  for (const i of order) {
    const [X, Y, Z] = cellAt(size, i)
    const lift = e * Y * L.gap
    // The faces a viewer at the (+X, +Y, -Z) corner sees: the top, the -Z face (left) and the +X face (right).
    const top = Y + 1 >= sy || !covers(cellIndex(size, X, Y + 1, Z)) || e > 0
    const zf = Z === 0 || !covers(cellIndex(size, X, Y, Z - 1))
    const xf = X + 1 >= sx || !covers(cellIndex(size, X + 1, Y, Z))
    const p = (a: number, b: number, c: number): Pt => isoPoint(L, a, b, c, lift)
    const T = p(X, Y + 1, Z), TX = p(X + 1, Y + 1, Z), TZ = p(X, Y + 1, Z + 1)
    const dX: Pt = [TX[0] - T[0], TX[1] - T[1]]
    const dZ: Pt = [TZ[0] - T[0], TZ[1] - T[1]]
    const down: Pt = [0, L.u]
    const id = view.revealed.get(i)
    if (id === undefined) {
      const seed = X * 7 + Y * 131 + Z * 29
      if (top) smokeFace(ctx, T, dX, dZ, SHADE.top, phase, seed)
      if (zf) smokeFace(ctx, T, dX, down, SHADE.z, phase + 3, seed + 1)
      if (xf) smokeFace(ctx, TX, dZ, down, SHADE.x, phase + 6, seed + 2)
    } else {
      const kind = blockKind(id)
      if (!kind) continue
      if (top) tileFace(ctx, tiles.get(id, 0), kind, T, dX, dZ, SHADE.top)
      if (zf) tileFace(ctx, tiles.get(id, 1), kind, T, dX, down, SHADE.z)
      if (xf) tileFace(ctx, tiles.get(id, 1), kind, TX, dZ, down, SHADE.x)
    }
  }

  // The nine edges in front, faint, over the build: the cage it sits in (every edge but the three at the far corner, (0, 0, sz)).
  ctx.strokeStyle = 'rgba(160, 220, 255, 0.26)'
  ctx.lineWidth = lw
  const P = (a: number, b: number, c: number): Pt => isoPoint(L, a, b, c)
  line(P(sx, 0, sz), P(sx, sy, sz)); line(P(sx, 0, sz), P(sx, 0, 0))
  line(P(0, sy, sz), P(sx, sy, sz)); line(P(0, sy, sz), P(0, sy, 0))
  line(P(0, 0, 0), P(sx, 0, 0)); line(P(0, 0, 0), P(0, sy, 0))
  line(P(sx, sy, 0), P(0, sy, 0)); line(P(sx, sy, 0), P(sx, 0, 0)); line(P(sx, sy, 0), P(sx, sy, sz))
  ctx.restore()
}

/** The convex hull of points (monotone chain), counter-clockwise on screen. */
function hull(pts: Pt[]): Pt[] {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = [], upper: Pt[] = []
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop(); lower.push(p) }
  for (const p of s.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop(); upper.push(p) }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Point in a convex polygon (either winding). */
function inConvex(pts: Pt[], x: number, y: number): boolean {
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
    if (c === 0) continue
    const s = c > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * The front-most occupied cell under a point of the isometric drawing drawn
 * with the same options, or null: each drawn cube's outline (a hexagon),
 * tested back to front, the last hit wins.
 */
export function isoHit(view: FinderView, opts: IsoOpts, px: number, py: number): number | null {
  const L = isoLayout(view.size, opts)
  const e = Math.min(1, Math.max(0, opts.exploded ?? 0))
  let hit: number | null = null
  for (const i of isoOrder(view, opts.cutaway)) {
    const [X, Y, Z] = cellAt(view.size, i)
    const lift = e * Y * L.gap
    const p = (a: number, b: number, c: number): Pt => isoPoint(L, a, b, c, lift)
    // The cube's outline on screen: the hull of its eight corners.
    const corners: Pt[] = []
    for (const a of [X, X + 1]) for (const b of [Y, Y + 1]) for (const c of [Z, Z + 1]) corners.push(p(a, b, c))
    if (inConvex(hull(corners), px, py)) hit = i
  }
  return hit
}

/** One cell of a view along an axis: the first block met, and how many empty cells deep it sits. */
export interface AxisCell {
  col: number
  row: number
  index: number
  depth: number
}

/**
 * A view along an axis as a grid: for each cell of the picture, the first
 * occupied cell met looking in, or null. From above ('y', looking down -Y):
 * columns X, rows Z from +Z at the top (the sun at the top edge). Facing the
 * sun ('z', from the -Z side looking along +Z): columns X, rows Y from the
 * top, the first block met counting from z = 0. From +X ('x', looking along
 * -X): columns Z with +Z on the right, rows Y from the top.
 */
export function axisGrid(view: FinderView, axis: AxisView): { cols: number; rows: number; cells: Array<AxisCell | null> } {
  const [sx, sy, sz] = view.size
  const cols = axis === 'x' ? sz : sx
  const rows = axis === 'y' ? sz : sy
  const cells: Array<AxisCell | null> = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let found: AxisCell | null = null
      if (axis === 'y') {
        const z = sz - 1 - row
        for (let y = sy - 1; y >= 0 && !found; y--) { const i = cellIndex(view.size, col, y, z); if (view.occupied[i]) found = { col, row, index: i, depth: sy - 1 - y } }
      } else if (axis === 'z') {
        const y = sy - 1 - row
        for (let z = 0; z < sz && !found; z++) { const i = cellIndex(view.size, col, y, z); if (view.occupied[i]) found = { col, row, index: i, depth: z } }
      } else {
        const y = sy - 1 - row, z = col
        for (let x = sx - 1; x >= 0 && !found; x--) { const i = cellIndex(view.size, x, y, z); if (view.occupied[i]) found = { col, row, index: i, depth: sx - 1 - x } }
      }
      cells.push(found)
    }
  }
  return { cols, rows, cells }
}

export interface FlatOpts {
  /** The box to draw into: `size` wide and `height` (default `size`) tall; the grid is centred in it. */
  x: number
  y: number
  size: number
  height?: number
  smokePhase?: number
  tiles?: TileImages
}

/** A grid's cell size and origin inside the box. Whole pixels when the cells are big enough to show it. */
function flatLayout(cols: number, rows: number, opts: FlatOpts): { c: number; ox: number; oy: number } {
  const h = opts.height ?? opts.size
  let c = Math.min(opts.size / cols, h / rows)
  if (c >= 6) c = Math.floor(c)
  return { c, ox: opts.x + (opts.size - c * cols) / 2, oy: opts.y + (h - c * rows) / 2 }
}

/** One square cell: the tile (or flat colour) if revealed, smoke if hidden. */
function flatCell(ctx: CanvasRenderingContext2D, view: FinderView, index: number, face: number, px: number, py: number, c: number, phase: number, tiles: TileImages, seed: number): void {
  const id = view.revealed.get(index)
  if (id === undefined) { smokeFace(ctx, [px, py], [c, 0], [0, c], 0, phase, seed); return }
  const kind = blockKind(id)
  if (kind) tileFace(ctx, tiles.get(id, face), kind, [px, py], [c, 0], [0, c], 0)
}

/** The view along an axis (axisGrid): each cell the first block met, darker the deeper it sits. */
export function drawAxisView(ctx: CanvasRenderingContext2D, view: FinderView, axis: AxisView, opts: FlatOpts): void {
  const g = axisGrid(view, axis)
  const { c, ox, oy } = flatLayout(g.cols, g.rows, opts)
  const tiles = opts.tiles ?? TILE_IMAGES
  const face = axis === 'y' ? 0 : 1
  ctx.save()
  ctx.imageSmoothingEnabled = false
  g.cells.forEach((cell, k) => {
    const col = k % g.cols, row = Math.floor(k / g.cols)
    const px = ox + col * c, py = oy + row * c
    if (cell) {
      flatCell(ctx, view, cell.index, face, px, py, c, (opts.smokePhase ?? 0) + col * 0.7 + row * 1.3, tiles, col * 5 + row * 11)
      if (cell.depth) { ctx.fillStyle = `rgba(2, 10, 24, ${Math.min(0.55, cell.depth * 0.13)})`; ctx.fillRect(px, py, c, c) }
    }
    ctx.strokeStyle = cell ? 'rgba(234, 246, 255, 0.55)' : 'rgba(160, 220, 255, 0.14)'
    ctx.lineWidth = 1
    ctx.strokeRect(px + 0.5, py + 0.5, c - 1, c - 1)
  })
  ctx.restore()
}

/**
 * A section through one layer, seen from above (as 'y': X across, +Z up, the
 * sun at the top edge): its blocks, and any sealed hollow (enclosedEmpty)
 * marked with a dashed red square.
 */
export function drawSection(ctx: CanvasRenderingContext2D, view: FinderView, layer: number, opts: FlatOpts & { hollow?: ReadonlySet<number> }): void {
  const [sx, , sz] = view.size
  const { c, ox, oy } = flatLayout(sx, sz, opts)
  const tiles = opts.tiles ?? TILE_IMAGES
  ctx.save()
  ctx.imageSmoothingEnabled = false
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = cellIndex(view.size, x, layer, z)
      const px = ox + x * c, py = oy + (sz - 1 - z) * c
      if (view.occupied[i]) flatCell(ctx, view, i, 0, px, py, c, (opts.smokePhase ?? 0) + x + z, tiles, x * 3 + z * 7 + layer * 13)
      else if (opts.hollow?.has(i)) {
        ctx.strokeStyle = 'rgba(255, 90, 126, 0.75)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 2])
        const inset = Math.max(1.5, c * 0.15)
        ctx.strokeRect(px + inset, py + inset, c - 2 * inset, c - 2 * inset)
        ctx.setLineDash([])
      }
      ctx.strokeStyle = view.occupied[i] ? 'rgba(234, 246, 255, 0.5)' : 'rgba(160, 220, 255, 0.14)'
      ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, c - 1, c - 1)
    }
  }
  ctx.restore()
}

/** ONOSENDAI's black sun: a bright violet ring round a black centre, with a soft violet glow. */
export function drawBlackSun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(212, 140, 255, 0.3)'
  ctx.lineWidth = Math.max(1, r * 0.4)
  ctx.stroke()
  ctx.shadowColor = SUN_GLOW
  ctx.shadowBlur = r * 1.4
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#000000'
  ctx.fill()
  ctx.lineWidth = Math.max(1.4, r * 0.26)
  ctx.strokeStyle = SUN_CORE
  ctx.stroke()
  ctx.restore()
}

/**
 * Each axis's direction on screen in each view; null where it runs straight
 * in or out of the picture: +X toward the viewer in 'x' (a ring round a dot),
 * +Z away from the viewer in 'z' (the black sun, straight ahead). These match the drawings: the isometric one and the three views.
 */
export const COMPASS_DIRS: Readonly<Record<CompassOrientation, Readonly<Record<'X' | 'Y' | 'Z', Pt | null>>>> = {
  iso: { X: [ISO_C, 0.5], Y: [0, -1], Z: [ISO_C, -0.5] },
  z: { X: [1, 0], Y: [0, -1], Z: null },
  y: { X: [1, 0], Y: null, Z: [0, -1] },
  x: { X: null, Y: [0, -1], Z: [1, 0] },
}

/**
 * The XYZ compass (X red, Y green, Z blue) with the black sun past +Z,
 * turned to match a view. An axis pointing at the viewer is a ring round a
 * dot; when that axis is +Z, the ring is the black sun itself, as the app's
 * compass draws it end on.
 */
export function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, orientation: CompassOrientation): void {
  const D = COMPASS_DIRS[orientation]
  const L = r * 0.52
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(2, 8, 18, 0.72)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(234, 246, 255, 0.28)'
  ctx.lineWidth = Math.max(1, r * 0.025)
  ctx.stroke()
  ctx.font = `700 ${Math.max(7, Math.round(r * 0.24))}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineCap = 'round'
  // Draw the axes pointing down the screen last, so the nearer ones sit on top.
  const axes = (['X', 'Y', 'Z'] as const).slice().sort((a, b) => (D[a]?.[1] ?? 2) - (D[b]?.[1] ?? 2))
  for (const ax of axes) {
    const d = D[ax]
    const col = AXIS_COLOR[ax]
    if (!d) {
      if (ax === 'Z') { drawBlackSun(ctx, cx, cy, r * 0.17); continue }
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2)
      ctx.strokeStyle = col
      ctx.lineWidth = Math.max(1.2, r * 0.05)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.045, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
      ctx.fillText(`+${ax}`, cx + r * 0.3, cy - r * 0.26)
      continue
    }
    const ex = cx + d[0] * L, ey = cy + d[1] * L
    ctx.strokeStyle = col
    ctx.lineWidth = Math.max(1.4, r * 0.06)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    const hs = r * 0.15, nx = -d[1], ny = d[0]
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.moveTo(ex + d[0] * hs, ey + d[1] * hs)
    ctx.lineTo(ex + nx * hs * 0.6, ey + ny * hs * 0.6)
    ctx.lineTo(ex - nx * hs * 0.6, ey - ny * hs * 0.6)
    ctx.closePath()
    ctx.fill()
    if (ax === 'Z') drawBlackSun(ctx, cx + d[0] * (L + r * 0.33), cy + d[1] * (L + r * 0.33), r * 0.1)
    else ctx.fillText(ax, cx + d[0] * (L + r * 0.3), cy + d[1] * (L + r * 0.3))
  }
  ctx.restore()
}

/**
 * The empty cells sealed inside the build: those no path of empty cells
 * (through faces) connects to the outside of the box.
 */
export function enclosedEmpty(view: FinderView): Set<number> {
  const [sx, sy, sz] = view.size
  const px = sx + 2, py = sy + 2, pz = sz + 2
  const seen = new Uint8Array(px * py * pz)
  const at = (x: number, y: number, z: number): number => x + px * (z + pz * y)
  const solidAt = (x: number, y: number, z: number): boolean =>
    x >= 1 && x <= sx && y >= 1 && y <= sy && z >= 1 && z <= sz && view.occupied[cellIndex(view.size, x - 1, y - 1, z - 1)]
  const stack: Array<[number, number, number]> = [[0, 0, 0]]
  seen[0] = 1
  while (stack.length) {
    const [x, y, z] = stack.pop()!
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = x + dx, b = y + dy, c = z + dz
      if (a < 0 || b < 0 || c < 0 || a >= px || b >= py || c >= pz) continue
      const k = at(a, b, c)
      if (seen[k] || solidAt(a, b, c)) continue
      seen[k] = 1
      stack.push([a, b, c])
    }
  }
  const out = new Set<number>()
  view.occupied.forEach((occ, i) => {
    if (occ) return
    const [x, y, z] = cellAt(view.size, i)
    if (!seen[at(x + 1, y + 1, z + 1)]) out.add(i)
  })
  return out
}

/** The occupied cells seen from none of the six sides of the box (another block lies between them and every side). */
export function buriedCells(view: FinderView): Set<number> {
  const size = view.size
  const out = new Set<number>()
  view.occupied.forEach((occ, i) => {
    if (!occ) return
    const p = cellAt(size, i)
    for (let axis = 0; axis < 3; axis++) {
      for (const dir of [-1, 1]) {
        let clear = true
        const q: [number, number, number] = [p[0], p[1], p[2]]
        for (q[axis] += dir; q[axis] >= 0 && q[axis] < size[axis]; q[axis] += dir) {
          if (view.occupied[cellIndex(size, q[0], q[1], q[2])]) { clear = false; break }
        }
        if (clear) return
      }
    }
    out.add(i)
  })
  return out
}

/** Whether the build has an inside worth a cutaway: a sealed hollow, or blocks no side shows. */
export function hasInterior(view: FinderView): boolean {
  return enclosedEmpty(view).size > 0 || buriedCells(view).size > 0
}

/* ---------- Tile pictures, loaded once ---------- */

const images = new Map<string, HTMLImageElement>()
const listeners = new Set<() => void>()
let notifying = false

function loaded(): void {
  if (notifying) return
  notifying = true
  setTimeout(() => { notifying = false; for (const fn of [...listeners]) fn() }, 0)
}

/**
 * The block tiles as images (tiles.ts tileUrl), each made and loaded once for
 * the page. `get` answers null until a picture has loaded (the drawing uses
 * flat colours meanwhile); `onLoad` hears when more have loaded, batched, to
 * draw again.
 */
export const TILE_IMAGES: TileImages & { onLoad(fn: () => void): () => void } = {
  get(id: number, face: number): CanvasImageSource | null {
    const kind = blockKind(id)
    if (!kind || typeof Image === 'undefined') return null
    const key = `${kind.id}:${face}`
    let img = images.get(key)
    if (!img) {
      const url = tileUrl(kind, face)
      if (!url) return null
      img = new Image()
      img.onload = loaded
      img.src = url
      images.set(key, img)
    }
    return img.complete && img.naturalWidth > 0 ? img : null
  },
  onLoad(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
}
