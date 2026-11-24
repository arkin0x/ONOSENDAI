/**
 * blockMesh.ts: a grid of blocks as the rectangles that show (design 4.3,
 * steps 3 and 4).
 *
 * Cull: a face is kept only where it looks into open space, or into a block
 * you can see through. Merge: neighbouring faces of one colour on one plane
 * become one rectangle, greedily (Lysenko, 2012). Whole cubes are meshed the
 * way sno-core's MagicaVoxel importer (vox.ts) meshes voxels, a mask per
 * slice; this is a port of that loop, since vox.ts keeps it inside its file
 * reader and colours by RGB, and here a cell carries one of our palette
 * indices, a layer and a shape. Blocks that are not cubes (blockShapes.ts)
 * give their boxes' faces, culled against their neighbours and against their
 * own other boxes, and merged rectangle by rectangle.
 *
 * Every face belongs to a layer (solid, glass, ice, water), and each layer
 * becomes its own objects, since SNO's opacity is per object. A solid cube
 * hides the faces of anything against it; a see-through block hides only
 * faces of its own layer, so the stone behind a window still shows through
 * it, and the inside faces of a pool or a glass wall are never drawn.
 *
 * A mesh is made for one box of the grid at a time (a piece, cut by place:
 * blockShard.ts), but every neighbour is read from the whole grid, so no face
 * appears where two pieces meet.
 *
 * Coordinates are the file's (x east, y up, z south), in ticks, 120 to a
 * block. Pure, and on the import's clock.
 */

import { stateProps, type BlockGrid, type V3 } from './blockGrid'
import { boxesFor, isFull, T, type Box } from './blockShapes'
import { colourFor, drawn, lookOf, type BlockLook, type ColourChoices, type Layer } from './colourTable'
import { BlockImportError, MAX_CELLS } from './blockGrid'
import type { Clock } from './formats'

/** One block state as the mesher draws it. */
export interface Material {
  layer: Layer
  colour: number
  /** A whole cube: meshed by mask, and it hides what is against it. */
  full: boolean
  boxes: Box[]
  /** For each side (axis * 2 + (side > 0 ? 1 : 0)), the rectangles its boxes show there, as [u0, u1, v0, v1]. */
  sides: Array<Array<[number, number, number, number]>>
}

/** One rectangle of a mesh, in ticks: on the plane `plane` across axis `d`, facing `side`, spanning u and v (the next two axes after d). */
export interface Quad {
  d: number
  side: 1 | -1
  plane: number
  u0: number
  u1: number
  v0: number
  v1: number
  colour: number
}

/** The axes across a face on axis d: u, then v, so u x v points along +d. */
const U = [1, 2, 0]
const V = [2, 0, 1]

/** The rectangles a set of boxes shows on each side of its block. */
function sidesOf(boxes: Box[]): Material['sides'] {
  const out: Material['sides'] = [[], [], [], [], [], []]
  for (const b of boxes) {
    for (let d = 0; d < 3; d++) {
      const u = U[d], v = V[d]
      const rect: [number, number, number, number] = [b[u], b[u + 3], b[v], b[v + 3]]
      if (b[d] === 0) out[d * 2].push(rect)
      if (b[d + 3] === T) out[d * 2 + 1].push(rect)
    }
  }
  return out
}

/** Each palette entry's material under these choices, or null when it is not drawn. Entry 0 (air) is always null. */
export function materialsFor(palette: readonly string[], choices: ColourChoices, looks: readonly BlockLook[] = palette.map(lookOf)): Array<Material | null> {
  return palette.map((state, i) => {
    if (i === 0) return null
    const look = looks[i]
    if (!drawn(look, choices)) return null
    const boxes = boxesFor(look.shape, stateProps(state))
    return { layer: look.layer, colour: colourFor(state, look, choices), full: isFull(boxes), boxes, sides: sidesOf(boxes) }
  })
}

/** The regions chosen, laid into one grid of palette indices over the box they span together. */
export interface Field {
  size: V3
  /** Palette index per cell, x fastest, then z, then y. */
  cells: Uint16Array
}

/** The regions in `include` (every one when absent), in one field. A later region's blocks stand over an earlier's. */
export function fieldOf(grid: BlockGrid, include?: ReadonlySet<number>): Field {
  const chosen = grid.regions.filter((_, i) => !include || include.has(i))
  if (chosen.length === 0) return { size: [0, 0, 0], cells: new Uint16Array(0) }
  const min = [0, 1, 2].map((a) => Math.min(...chosen.map((r) => r.origin[a])))
  const max = [0, 1, 2].map((a) => Math.max(...chosen.map((r) => r.origin[a] + r.size[a])))
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as V3
  if (size[0] * size[1] * size[2] > MAX_CELLS) throw new BlockImportError('Those regions stand too far apart to import together. Leave some out.')
  if (chosen.length === 1 && min.every((n, a) => n === chosen[0].origin[a])) return { size, cells: chosen[0].cells }
  const cells = new Uint16Array(size[0] * size[1] * size[2])
  for (const r of chosen) {
    const [ox, oy, oz] = [r.origin[0] - min[0], r.origin[1] - min[1], r.origin[2] - min[2]]
    const [sx, sy, sz] = r.size
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
      const from = sx * (z + sz * y)
      const to = ox + size[0] * (oz + z + size[2] * (oy + y))
      for (let x = 0; x < sx; x++) { const c = r.cells[from + x]; if (c) cells[to + x] = c }
    }
  }
  return { size, cells }
}

/** A box of the field: its lowest corner and one past its highest, in blocks. */
export interface CellBox { min: V3; max: V3 }

/** Whether a neighbour hides a face of `layer`: a whole cube, solid or of the same see-through layer. */
const hides = (n: Material | null, layer: Layer): boolean => !!n && n.full && (n.layer === 'solid' || n.layer === layer)

/** Whether `inner` lies inside `outer`, both [u0, u1, v0, v1]. */
const inside = (inner: readonly number[], outer: readonly number[]): boolean => inner[0] >= outer[0] && inner[1] <= outer[1] && inner[2] >= outer[2] && inner[3] <= outer[3]

/**
 * The rectangles that show of the blocks in `box`, by layer: culled against
 * the whole field, merged within the box.
 */
export function meshBox(field: Field, materials: ReadonlyArray<Material | null>, box: CellBox, clock: Clock = () => undefined): Map<Layer, Quad[]> {
  const [X, , Z] = field.size
  const dims = field.size
  const cells = field.cells
  const at = (p: readonly number[]): Material | null => {
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= dims[0] || p[1] >= dims[1] || p[2] >= dims[2]) return null
    return materials[cells[p[0] + X * (p[2] + Z * p[1])]] ?? null
  }
  const out = new Map<Layer, Quad[]>()
  const push = (layer: Layer, q: Quad): void => { let list = out.get(layer); if (!list) { list = []; out.set(layer, list) } list.push(q) }

  // Which layers have whole cubes and which have shapes in this box, so each pass runs only where it has work.
  const cubeLayers = new Set<Layer>()
  let shapes = false
  for (let y = box.min[1]; y < box.max[1]; y++) for (let z = box.min[2]; z < box.max[2]; z++) {
    clock()
    const row = X * (z + Z * y)
    for (let x = box.min[0]; x < box.max[0]; x++) {
      const m = materials[cells[row + x]]
      if (!m) continue
      if (m.full) cubeLayers.add(m.layer)
      else shapes = true
    }
  }

  // Whole cubes: a mask per slice, per axis and side, merged greedily.
  const p = [0, 0, 0], q = [0, 0, 0]
  for (const layer of cubeLayers) {
    for (let d = 0; d < 3; d++) {
      const u = U[d], v = V[d]
      const nu = box.max[u] - box.min[u], nv = box.max[v] - box.min[v]
      const mask = new Int32Array(nu * nv)
      for (const side of [1, -1] as const) {
        for (let s = box.min[d]; s < box.max[d]; s++) {
          let any = false
          for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
            clock()
            p[d] = s; p[u] = box.min[u] + i; p[v] = box.min[v] + j
            const m = at(p)
            let c = 0
            if (m && m.full && m.layer === layer) {
              q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[d] = s + side
              if (!hides(at(q), layer)) { c = m.colour + 1; any = true }
            }
            mask[j * nu + i] = c
          }
          if (!any) continue
          for (let j = 0; j < nv; j++) for (let i = 0; i < nu;) {
            const c = mask[j * nu + i]
            if (!c) { i++; continue }
            let w = 1
            while (i + w < nu && mask[j * nu + i + w] === c) w++
            let h = 1
            grow: while (j + h < nv) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * nu + i + k] !== c) break grow
              h++
            }
            for (let b = 0; b < h; b++) for (let k = 0; k < w; k++) mask[(j + b) * nu + i + k] = 0
            const u0 = (box.min[u] + i) * T, v0 = (box.min[v] + j) * T
            push(layer, { d, side, plane: (s + (side > 0 ? 1 : 0)) * T, u0, u1: u0 + w * T, v0, v1: v0 + h * T, colour: c - 1 })
            i += w
          }
        }
      }
    }
  }

  // Shapes: each box's faces, culled, then merged rectangle by rectangle.
  if (shapes) {
    const loose = new Map<string, Quad[]>()
    const n = [0, 0, 0]
    for (let y = box.min[1]; y < box.max[1]; y++) for (let z = box.min[2]; z < box.max[2]; z++) for (let x = box.min[0]; x < box.max[0]; x++) {
      clock()
      const m = materials[cells[x + X * (z + Z * y)]]
      if (!m || m.full) continue
      const cell = [x, y, z]
      for (let bi = 0; bi < m.boxes.length; bi++) {
        const b = m.boxes[bi]
        for (let d = 0; d < 3; d++) {
          const u = U[d], v = V[d]
          const rect = [b[u], b[u + 3], b[v], b[v + 3]]
          for (const side of [1, -1] as const) {
            const plane = side > 0 ? b[d + 3] : b[d]
            // Against another of its own boxes, face to face: inside the block, never seen.
            let hidden = m.boxes.some((o, oi) => oi !== bi && (side > 0 ? o[d] === plane : o[d + 3] === plane) && inside(rect, [o[u], o[u + 3], o[v], o[v + 3]]))
            if (!hidden && plane === (side > 0 ? T : 0)) {
              n[0] = x; n[1] = y; n[2] = z; n[d] += side
              const nb = at(n)
              if (hides(nb, m.layer)) hidden = true
              else if (nb && !nb.full && (nb.layer === 'solid' || nb.layer === m.layer)) {
                // A shape beside a shape: hidden where the neighbour's own side covers it (two slabs, a row of panes).
                hidden = nb.sides[d * 2 + (side > 0 ? 0 : 1)].some((r) => inside(rect, r))
              }
            }
            if (hidden) continue
            const quad: Quad = {
              d, side, plane: cell[d] * T + plane,
              u0: cell[u] * T + rect[0], u1: cell[u] * T + rect[1], v0: cell[v] * T + rect[2], v1: cell[v] * T + rect[3],
              colour: m.colour,
            }
            const key = `${m.layer}|${d}|${side}|${quad.plane}|${m.colour}`
            let list = loose.get(key)
            if (!list) { list = []; loose.set(key, list) }
            list.push(quad)
          }
        }
      }
    }
    for (const [key, list] of loose) {
      clock()
      const layer = key.slice(0, key.indexOf('|')) as Layer
      for (const merged of mergeRects(list)) push(layer, merged)
    }
  }
  return out
}

/**
 * Rectangles on one plane, of one colour, merged where two share a whole
 * edge: first along u, then along v.
 */
export function mergeRects(list: Quad[]): Quad[] {
  let rects = list.map((r) => ({ ...r }))
  rects.sort((a, b) => a.v0 - b.v0 || a.v1 - b.v1 || a.u0 - b.u0)
  let out: Quad[] = []
  for (const r of rects) {
    const last = out[out.length - 1]
    if (last && last.v0 === r.v0 && last.v1 === r.v1 && last.u1 === r.u0) last.u1 = r.u1
    else out.push(r)
  }
  rects = out
  rects.sort((a, b) => a.u0 - b.u0 || a.u1 - b.u1 || a.v0 - b.v0)
  out = []
  for (const r of rects) {
    const last = out[out.length - 1]
    if (last && last.u0 === r.u0 && last.u1 === r.u1 && last.v1 === r.v0) last.v1 = r.v1
    else out.push(r)
  }
  return out
}

/** How many faces of whole cubes look into open space in a box, before merging: for tests and the preview's words. */
export function culledFaceCount(field: Field, materials: ReadonlyArray<Material | null>, box: CellBox): number {
  const [X, , Z] = field.size
  const at = (x: number, y: number, z: number): Material | null =>
    x < 0 || y < 0 || z < 0 || x >= field.size[0] || y >= field.size[1] || z >= field.size[2] ? null : materials[field.cells[x + X * (z + Z * y)]] ?? null
  let n = 0
  for (let y = box.min[1]; y < box.max[1]; y++) for (let z = box.min[2]; z < box.max[2]; z++) for (let x = box.min[0]; x < box.max[0]; x++) {
    const m = at(x, y, z)
    if (!m || !m.full) continue
    if (!hides(at(x + 1, y, z), m.layer)) n++
    if (!hides(at(x - 1, y, z), m.layer)) n++
    if (!hides(at(x, y + 1, z), m.layer)) n++
    if (!hides(at(x, y - 1, z), m.layer)) n++
    if (!hides(at(x, y, z + 1), m.layer)) n++
    if (!hides(at(x, y, z - 1), m.layer)) n++
  }
  return n
}
