/**
 * mesh.ts - one chunk's blocks as one mesh: only the faces between a block
 * and open space, merged greedily into rectangles of one block kind (the
 * method of Lysenko, 2012, which sno-core's MagicaVoxel import also uses).
 *
 * The output is in the chunk's own frame, cyberspace axes, a cell (x, y, z)
 * spanning [x, x + 1] on each axis; the scene places and turns it. A face on
 * the chunk's border is drawn unless the neighbour's cell across it is solid,
 * read from the neighbour's border slab; a neighbour not yet surveyed is open
 * space, so its faces are drawn.
 *
 * Vertex layout, 5 floats: position (3), tile (1: the kind's tile row times
 * 3 plus the face, 0 top, 1 side, 2 bottom, tiles.ts), shade (1, the face's
 * light by which way it faces). The material repeats the tile once a block
 * across a merged rectangle, from the position, so it still reads as blocks.
 *
 * The chunk skin (the previews' rind): on a chunk face that borders a chunk
 * not surveyed, the exposed blocks within SKIN_DEPTH of it are drawn in the
 * family's skin (its top on top of open air, its band rock in blobs on the
 * sides), so a lone chunk reads as an island rather than a slice. Drawn
 * only, never stored (coordinator, 2026-11-24): the blocks are what they
 * are, and mining one gives what it is.
 */

import { idx } from './coords'

/** Each neighbour's border layer, the 32 by 32 cells touching this chunk, or null when it is open space. Order: -x, +x, -y, +y, -z, +z. */
export type Borders = [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null]

/** One chunk's mesh, ready for a BufferGeometry. */
export interface ChunkMesh {
  /** 10 floats a vertex (see above). */
  vertices: Float32Array
  indices: Uint32Array
  /** Rectangles drawn: two triangles each. */
  quads: number
}

export const FLOATS_PER_VERTEX = 5

/** How deep the drawn skin reaches from a face that borders a chunk not surveyed. */
export const SKIN_DEPTH = 3

/** The skin's kinds: tile rows (blocks.ts index) for the top and the sides; null draws none. */
export interface Skin { top: number; rind: number; seed: number }

/** Light by face: -x, +x, -y, +y, -z, +z. Up (+y here) brightest. */
const SHADE = [0.72, 0.8, 0.5, 1, 0.64, 0.88]

/** Where a border slab keeps the cell at (u, v) of the face it touches: u, v the two axes other than the face's, in x, y, z order. */
export const slabIndex = (u: number, v: number): number => u + 32 * v

/** The layer of `blocks` on one face of the chunk, as the neighbour across that face reads it. */
export function borderSlab(blocks: Uint8Array, face: number): Uint8Array {
  const out = new Uint8Array(1024)
  const d = face >> 1, at = face & 1 ? 31 : 0
  // u and v are the other two axes in x, y, z order.
  const [a, b] = d === 0 ? [1, 2] : d === 1 ? [0, 2] : [0, 1]
  const p = [0, 0, 0]
  for (let v = 0; v < 32; v++) for (let u = 0; u < 32; u++) {
    p[d] = at
    p[a] = u; p[b] = v
    out[slabIndex(u, v)] = blocks[idx(p[0], p[1], p[2])]
  }
  return out
}

/** A cell's place hash for the skin's blobs (the previews' h3). */
function h3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ seed, 0x9e3779b1)
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
const blob = (x: number, y: number, z: number, seed: number): number => 0.6 * h3(x >> 2, y >> 2, z >> 2, seed) + 0.4 * h3((x + 1) >> 1, (y + 1) >> 1, (z + 1) >> 1, seed)

/**
 * The skin's tile row for each cell (255 for none): exposed blocks near the
 * faces that border chunks not surveyed. Veins and the relic (ids 40 and up)
 * keep their own look. `open` is -x, +x, -y, +y, -z, +z, as Borders.
 */
export function skinCells(blocks: Uint8Array, open: readonly boolean[], skin: Skin): Uint8Array | null {
  if (!open.some(Boolean)) return null
  const out = new Uint8Array(blocks.length).fill(255)
  const near = (x: number, y: number, z: number): boolean =>
    (open[0] && x < SKIN_DEPTH) || (open[1] && x > 31 - SKIN_DEPTH) || (open[2] && y < SKIN_DEPTH) ||
    (open[3] && y > 31 - SKIN_DEPTH) || (open[4] && z < SKIN_DEPTH) || (open[5] && z > 31 - SKIN_DEPTH)
  const emptyAt = (x: number, y: number, z: number): boolean => {
    if (x < 0) return open[0]; if (x > 31) return open[1]; if (y < 0) return open[2]; if (y > 31) return open[3]; if (z < 0) return open[4]; if (z > 31) return open[5]
    return blocks[idx(x, y, z)] === 0
  }
  for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const o = idx(x, y, z), id = blocks[o]
    if (id === 0 || id >= 40 || !near(x, y, z)) continue
    if (emptyAt(x, y + 1, z)) { out[o] = skin.top; continue }
    if ((emptyAt(x + 1, y, z) || emptyAt(x - 1, y, z) || emptyAt(x, y - 1, z) || emptyAt(x, y, z + 1) || emptyAt(x, y, z - 1)) && blob(x, y, z, skin.seed) < 0.6) out[o] = skin.rind
  }
  return out
}

/**
 * Greedy mesh of one chunk. `tiles` maps each id 0 to 255 to its kind's tile
 * row (blocks.ts tileTable); `skin`, when given, draws the chunk skin.
 */
export function meshChunk(blocks: Uint8Array, borders: Borders, tiles: Uint8Array, skin: Skin | null = null): ChunkMesh {
  let verts = new Float32Array(4096 * FLOATS_PER_VERTEX)
  let inds = new Uint32Array(6144)
  let nv = 0, ni = 0, quads = 0
  const skinned = skin ? skinCells(blocks, borders.map((b) => b === null), skin) : null
  // A face's look: the skin's row where the skin covers the cell, else the kind's.
  const rowAt = (o: number): number => (skinned && skinned[o] !== 255 ? skinned[o] : tiles[blocks[o]])
  const mask = new Int32Array(1024)
  const x = [0, 0, 0], q = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0]

  const grow = (): void => {
    if ((nv + 4) * FLOATS_PER_VERTEX > verts.length) { const n = new Float32Array(verts.length * 2); n.set(verts); verts = n }
    if (ni + 6 > inds.length) { const n = new Uint32Array(inds.length * 2); n.set(inds); inds = n }
  }

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3
    // Across the border: the neighbour's slab is indexed by the two other axes in x, y, z order.
    const [a, b] = d === 0 ? [1, 2] : d === 1 ? [0, 2] : [0, 1]
    for (let side = 0; side < 2; side++) {
      const faceIndex = d * 2 + side
      const border = borders[faceIndex]
      const shade = SHADE[faceIndex]
      // Which tile of the kind: the top on +y, the bottom on -y, a side elsewhere.
      const face = d === 1 ? (side ? 0 : 2) : 1
      q[0] = q[1] = q[2] = 0
      q[d] = side ? 1 : -1
      for (x[d] = 0; x[d] < 32; x[d]++) {
        // The face mask of this slice: the tile (plus one) where the block's face toward `side` is open.
        let n = 0
        for (x[v] = 0; x[v] < 32; x[v]++) for (x[u] = 0; x[u] < 32; x[u]++, n++) {
          const o = idx(x[0], x[1], x[2])
          const here = blocks[o]
          if (here === 0) { mask[n] = 0; continue }
          const nd = x[d] + q[d]
          let across: number
          if (nd < 0 || nd > 31) across = border ? border[slabIndex(x[a], x[b])] : 0
          else { const save = x[d]; x[d] = nd; across = blocks[idx(x[0], x[1], x[2])]; x[d] = save }
          mask[n] = across === 0 ? rowAt(o) * 3 + face + 1 : 0
        }
        // Merge the mask into rectangles of one tile.
        n = 0
        for (let j = 0; j < 32; j++) {
          for (let i = 0; i < 32;) {
            const c = mask[n]
            if (c === 0) { i++; n++; continue }
            let w = 1
            while (i + w < 32 && mask[n + w] === c) w++
            let h = 1
            outer: for (; j + h < 32; h++) {
              for (let k = 0; k < w; k++) if (mask[n + k + h * 32] !== c) break outer
            }
            x[u] = i; x[v] = j
            const base = [x[0], x[1], x[2]]
            base[d] += side ? 1 : 0
            du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0
            du[u] = w; dv[v] = h
            grow()
            const corners = [
              [base[0], base[1], base[2]],
              [base[0] + du[0], base[1] + du[1], base[2] + du[2]],
              [base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]],
              [base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]],
            ]
            for (const p of corners) {
              const o = nv * FLOATS_PER_VERTEX
              verts[o] = p[0]; verts[o + 1] = p[1]; verts[o + 2] = p[2]
              verts[o + 3] = c - 1
              verts[o + 4] = shade
              nv++
            }
            // Counter-clockwise seen from outside the block (right-handed axes): u x v is +d.
            const s0 = nv - 4
            if (side) inds.set([s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3], ni)
            else inds.set([s0, s0 + 2, s0 + 1, s0, s0 + 3, s0 + 2], ni)
            ni += 6
            quads++
            for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * 32] = 0
            i += w; n += w
          }
        }
      }
    }
  }
  return { vertices: verts.slice(0, nv * FLOATS_PER_VERTEX), indices: inds.slice(0, ni), quads }
}
