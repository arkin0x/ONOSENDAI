/**
 * blockBuild.ts: a block build (lib/blocks/blockGrid.ts) as shards ready for
 * the workshop: one shard when it fits, or sealed pieces and a parent that
 * places them (design 4.3 to 4.5; ruled D3, D4 and D5 on 2026-11-24).
 *
 * The steps:
 *
 * 1. The regions chosen become one field, and each block state a material
 *    under the person's colour choices (lib/blocks/colourTable.ts).
 * 2. The field is meshed (lib/blocks/blockMesh.ts) into rectangles per layer.
 * 3. Each layer's rectangles are written as an SNO object and measured
 *    against `budget`, what one hidden object holds (lib/shardFullness.ts
 *    wholePayloadLimit, passed in by the caller). A layer that does not fit
 *    is cut by place: its box into eight aligned cubes, again and again
 *    where a cube still does not fit, so each piece is a part of the build in
 *    space (design 4.4, "Cut pieces by place, not by face order").
 * 4. One solid object that fits is the build. Anything else (a build too
 *    big for one, or one with glass, ice or water, which are drawn see
 *    through and so are objects of their own) is pieces, and a parent places
 *    them, as a split build does (ONOSENDAI #868: hiding the parent seals
 *    each piece under the bag's key, each signed on its own).
 *
 * One block is one model unit, so with `unit` 0 a block is one gibson, and
 * `unit` 1 or 2 makes it 2 or 4 with no change to the geometry (design 4.5).
 * The build stands on its lowest layer of blocks, centred on the origin
 * across. The file's frame (x east, y up, z south) is written into SNO's
 * model frame with z negated, so it is drawn as it was built, not mirrored.
 *
 * Pure, and on the import's clock.
 */

import { MAX_EXTENT, TICKS_PER_UNIT as T, neededExtent, newShard, uuid, type ShardModel, type ShardVertex } from 'sno-core/shards'
import { payloadBytes } from 'sno-core/meshToShard'
import { BUILT_IN_RGB, type Rgb } from 'sno-core/snoPalette'
import { BlockImportError, type BlockGrid, type V3 } from './blockGrid'
import { fieldOf, materialsFor, meshBox, type CellBox, type Field, type Material, type Quad } from './blockMesh'
import { LAYER_CONSTRAIN, LAYER_OPACITY, LAYERS, lookOf, type BlockLook, type ColourChoices, type Layer } from './colourTable'
import type { Clock } from './formats'

/** The most pieces one build is cut into: each is signed once when it is hidden. */
export const MAX_PIECES = 48
/**
 * The most blocks a build may span across (x and z) and up (y): nothing may
 * stand more than 4,096 units from its object's origin (DECK-0003 §1.8), and
 * the origin is the middle of the bottom.
 */
export const MAX_SIDE = 2 * MAX_EXTENT
export const MAX_HEIGHT = MAX_EXTENT

/** Blocks per gibson for each `unit` offered: 1, 2 or 4 gibsons a block. */
export const UNITS = [0, 1, 2] as const
export type BlockUnit = typeof UNITS[number]

export interface BuildOptions {
  /** Which regions to include, by index; every region when absent. */
  include?: readonly number[]
  choices: ColourChoices
  unit: BlockUnit
  /** The most payload bytes one object may be. */
  budget: number
  /** Looks already worked out for the palette (the worker keeps them). */
  looks?: readonly BlockLook[]
}

/** One object of the build: the build itself, or one piece of it. */
export interface BuiltObject {
  shard: ShardModel
  layer: Layer
  /** Where the parent places it, in the parent's ticks (model frame). */
  at: V3
  /** Its payload, in UTF-8 bytes. */
  bytes: number
  /** Rectangles drawn. */
  rects: number
}

/** Triangles to preview, per layer: positions in blocks (x east, y up, z south, centred), colours 0..1. */
export interface PreviewLayer {
  layer: Layer
  positions: Float32Array
  colors: Float32Array
}

export interface BuildResult {
  name: string
  /** The build's size in blocks: across (x), up (y), deep (z). */
  size: V3
  /** Blocks drawn. */
  blocks: number
  /** Rectangles drawn, over every object. */
  rects: number
  /** One object when the build is one shard; otherwise its pieces, which a parent places. */
  objects: BuiltObject[]
  /** Whether the build is one shard (no parent). */
  single: boolean
  unit: BlockUnit
  preview: PreviewLayer[]
}

/** A box's size in blocks, the largest side. */
const side = (b: CellBox): number => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])

/** The rectangles as a shard: corners shared, two triangles each, a colour per face, in SNO's frame from `origin` (ticks, the file's frame). */
export function shardOfQuads(quads: readonly Quad[], origin: V3, name: string, unit: number, layer: Layer): ShardModel {
  const vertices: ShardVertex[] = []
  const index = new Map<string, number>()
  const faces: Array<[number, number, number]> = []
  const facecolors: Rgb[] = []
  const corner = [0, 0, 0]
  const U = [1, 2, 0], V = [2, 0, 1]
  const vert = (c: Rgb): number => {
    // The file's frame into SNO's model frame: z negated (sno-core toRender negates it back), relative to the origin.
    const mx = corner[0] - origin[0], my = corner[1] - origin[1], mz = 0 - (corner[2] - origin[2])
    const key = `${mx},${my},${mz}`
    let i = index.get(key)
    if (i === undefined) {
      const p: [number, number, number] = [Math.floor(mx / T), Math.floor(my / T), Math.floor(mz / T)]
      const t: [number, number, number] = [mx - p[0] * T, my - p[1] * T, mz - p[2] * T]
      i = vertices.length
      vertices.push(t[0] || t[1] || t[2] ? { p, t, c } : { p, c })
      index.set(key, i)
    }
    return i
  }
  for (const q of quads) {
    const c = BUILT_IN_RGB[q.colour]
    const u = U[q.d], v = V[q.d]
    const uv: Array<[number, number]> = [[q.u0, q.v0], [q.u1, q.v0], [q.u1, q.v1], [q.u0, q.v1]]
    // Counter-clockwise seen from the side it faces, in the file's (right-handed) frame, which is the frame it is drawn in.
    const order = q.side > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1]
    const ids = order.map((o) => { corner[q.d] = q.plane; corner[u] = uv[o][0]; corner[v] = uv[o][1]; return vert(c) })
    faces.push([ids[0], ids[1], ids[2]], [ids[0], ids[2], ids[3]])
    facecolors.push(c, c)
  }
  const opacity = LAYER_OPACITY[layer]
  const shard: ShardModel = {
    ...newShard(name),
    unit,
    mode: 'solid',
    vertices,
    faces,
    facecolors,
    ...(opacity !== undefined ? { opacity } : {}),
    extra: { constrain: LAYER_CONSTRAIN[layer] },
  }
  shard.extent = neededExtent(shard)
  return shard
}

/** The build's blocks drawn, under these materials. */
function countDrawn(field: Field, materials: ReadonlyArray<Material | null>, clock: Clock): number {
  let n = 0
  const c = field.cells
  for (let i = 0; i < c.length; i++) { if ((i & 0xffff) === 0) clock(); if (materials[c[i]]) n++ }
  return n
}

/** The build, as shards that fit `budget`, or a BlockImportError saying why it cannot be. */
export function buildImport(grid: BlockGrid, options: BuildOptions, clock: Clock = () => undefined): BuildResult {
  const include = options.include ? new Set(options.include) : undefined
  const field = fieldOf(grid, include)
  const [X, Y, Z] = field.size
  if (X === 0) throw new BlockImportError('Choose at least one region to import.')
  if (Math.max(X, Z) > MAX_SIDE) throw new BlockImportError(`That build is ${Math.max(X, Z).toLocaleString('en-US')} blocks across. Import takes up to ${MAX_SIDE.toLocaleString('en-US')}: save a smaller part of it.`)
  if (Y > MAX_HEIGHT) throw new BlockImportError(`That build is ${Y.toLocaleString('en-US')} blocks tall. Import takes up to ${MAX_HEIGHT.toLocaleString('en-US')}: save a smaller part of it.`)
  const materials = materialsFor(grid.palette, options.choices, options.looks ?? grid.palette.map(lookOf))
  const blocks = countDrawn(field, materials, clock)
  if (blocks === 0) throw new BlockImportError('Nothing in that build is drawn. Turn on decorations, or include another region.')
  const base = (grid.name.trim() || 'Imported build').slice(0, 40)
  // Centred across, standing on its lowest layer: the origin is the middle of the bottom.
  const cx = Math.floor(X / 2) * T, cz = Math.floor(Z / 2) * T

  // Cut by place: a box meshed whole, and cut into eight where a layer does not fit.
  const pieces: Array<{ layer: Layer; origin: V3; quads: Quad[]; shard: ShardModel; bytes: number }> = []
  const whole: CellBox = { min: [0, 0, 0], max: [X, Y, Z] }
  const cut = (box: CellBox, wanted: ReadonlySet<Layer>): void => {
    const meshed = meshBox(field, materials, box, clock)
    const over = new Set<Layer>()
    for (const layer of LAYERS) {
      if (!wanted.has(layer)) continue
      const quads = meshed.get(layer)
      if (!quads || quads.length === 0) continue
      const origin = farCorner(box, cx, cz)
      // Measured under the longest name a piece can be given ("<name> piece 48"), so naming it later never pushes it past the budget.
      const shard = shardOfQuads(quads, origin, `${base} piece ${MAX_PIECES}`, options.unit, layer)
      const bytes = payloadBytes(shard)
      // A piece longer than 4,096 blocks would reach past the bound from its own origin: cut, whatever its bytes.
      if ((bytes <= options.budget && side(box) <= MAX_EXTENT) || side(box) <= 1) {
        pieces.push({ layer, origin, quads, shard, bytes })
        if (pieces.length > MAX_PIECES) throw new BlockImportError(`This build needs more than ${MAX_PIECES} pieces. Turn on MERGE SIMILAR, leave decorations off, or save a smaller part of it.`)
      } else over.add(layer)
    }
    if (over.size === 0) return
    // Halved on whole blocks, at the middle of the box's own aligned cube.
    const half = Math.max(1, nextPow2(side(box)) / 2)
    for (const oy of [0, half]) for (const oz of [0, half]) for (const ox of [0, half]) {
      const min: V3 = [box.min[0] + ox, box.min[1] + oy, box.min[2] + oz]
      const max: V3 = [Math.min(box.max[0], min[0] + half), Math.min(box.max[1], min[1] + half), Math.min(box.max[2], min[2] + half)]
      if (min[0] >= max[0] || min[1] >= max[1] || min[2] >= max[2]) continue
      cut({ min, max }, over)
    }
  }
  cut(whole, new Set(LAYERS))
  if (pieces.length === 0) throw new BlockImportError('Nothing in that build is drawn. Turn on decorations, or include another region.')

  // One solid object is the build itself, written about the middle of its bottom, if it still fits there.
  let alone: ShardModel | null = null
  if (pieces.length === 1 && pieces[0].layer === 'solid') {
    alone = shardOfQuads(pieces[0].quads, [cx, 0, cz], base, options.unit, 'solid')
    if (payloadBytes(alone) > options.budget) alone = null
  }
  const single = alone !== null
  const counted: Record<Layer, number> = { solid: 0, glass: 0, ice: 0, water: 0 }
  const totals: Record<Layer, number> = { solid: 0, glass: 0, ice: 0, water: 0 }
  for (const p of pieces) totals[p.layer]++
  const objects: BuiltObject[] = pieces.map((p) => {
    // The build itself, written about the middle of its bottom.
    if (alone) return { shard: alone, layer: p.layer, at: [0, 0, 0], bytes: payloadBytes(alone), rects: p.quads.length }
    const n = ++counted[p.layer]
    const word = p.layer === 'solid' ? 'piece' : p.layer
    const name = totals[p.layer] > 1 ? `${base} ${word} ${n}` : `${base} ${word}`
    const shard = { ...p.shard, id: uuid(), name }
    const bytes = payloadBytes(shard)
    // Where the piece's own origin stands from the build's, in SNO's frame (z negated).
    const at: V3 = [p.origin[0] - cx, p.origin[1], 0 - (p.origin[2] - cz)]
    return { shard, layer: p.layer, at, bytes, rects: p.quads.length }
  })
  return {
    name: base,
    size: [X, Y, Z],
    blocks,
    rects: pieces.reduce((n, p) => n + p.quads.length, 0),
    objects,
    single,
    unit: options.unit,
    preview: previewOf(pieces, cx, cz),
  }
}

/**
 * A piece's origin, in ticks of the file's frame: the corner of its box
 * farthest from the build's origin (the middle of its bottom), on every axis.
 * BUILD sizes its hiding place by how far a model reaches from its origin,
 * and counts a placed object at its anchor only (lib/deployFit.ts), so
 * anchoring each piece at its far corner makes the parent reach as far as
 * the build does.
 */
function farCorner(box: CellBox, cx: number, cz: number): V3 {
  const pick = (lo: number, hi: number, mid: number): number => (Math.abs(lo * T - mid) > Math.abs(hi * T - mid) ? lo * T : hi * T)
  return [pick(box.min[0], box.max[0], cx), box.max[1] * T, pick(box.min[2], box.max[2], cz)]
}

/** The smallest power of two at least `n`. */
function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** Triangles for the preview, per layer, in blocks about the build's origin (the file's frame). */
function previewOf(pieces: ReadonlyArray<{ layer: Layer; quads: Quad[] }>, cx: number, cz: number): PreviewLayer[] {
  const out: PreviewLayer[] = []
  const U = [1, 2, 0], V = [2, 0, 1]
  for (const layer of LAYERS) {
    const quads = pieces.filter((p) => p.layer === layer).flatMap((p) => p.quads)
    if (quads.length === 0) continue
    const positions = new Float32Array(quads.length * 18)
    const colors = new Float32Array(quads.length * 18)
    let k = 0
    const c = [0, 0, 0]
    for (const q of quads) {
      const rgb = BUILT_IN_RGB[q.colour]
      const u = U[q.d], v = V[q.d]
      const uv: Array<[number, number]> = [[q.u0, q.v0], [q.u1, q.v0], [q.u1, q.v1], [q.u0, q.v1]]
      const order = q.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1]
      for (const o of order) {
        c[q.d] = q.plane; c[u] = uv[o][0]; c[v] = uv[o][1]
        positions[k] = (c[0] - cx) / T; positions[k + 1] = c[1] / T; positions[k + 2] = (c[2] - cz) / T
        colors[k] = rgb[0]; colors[k + 1] = rgb[1]; colors[k + 2] = rgb[2]
        k += 3
      }
    }
    out.push({ layer, positions, colors })
  }
  return out
}

/**
 * The parent that places a build's pieces (#868's split build): no faces of
 * its own, one reference per piece by address under `owner`, each placed at
 * its corner. Hiding it seals each piece, and each is signed on its own.
 */
export function parentOf(result: Pick<BuildResult, 'name' | 'objects' | 'unit'>, owner: string): ShardModel {
  const shard: ShardModel = {
    ...newShard(result.name),
    unit: result.unit,
    mode: 'solid',
    vertices: [],
    faces: [],
    refs: result.objects.map((o) => ['a', `33331:${owner}:${o.shard.id}`]),
    parts: result.objects.map((o, i) => ({ ref: i, at: [...o.at] as V3, turn: [0, 0, 0], step: 0 })),
  }
  shard.extent = neededExtent(shard)
  return shard
}
