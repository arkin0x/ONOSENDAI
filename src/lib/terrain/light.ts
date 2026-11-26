/**
 * light.ts - how much light reaches each cell of a chunk, for Block shading
 * (owner, 2026-11-26: "inside of chunks in Cyberspace the lighting is so
 * uniform that it actually impairs my depth perception").
 *
 * Two kinds of light, each a level from 0 (dark) to 15 (full), falling by
 * one a block as it spreads through open cells:
 *
 * - Open light: open space outside the surveyed ground is lit, all of it
 *   (a chunk not loaded or not surveyed is open space, world.ts); a cell
 *   with nothing but open cells above it, all the way out, is lit too, the
 *   ground's up being cyberspace +Y. From those cells it spreads into caves
 *   and tunnels, so the deeper you go the darker it gets.
 * - Block light: the glowing blocks (Magmaflow, Glowcore, Lumenwood and the
 *   rest, EMIT) light what is round them in their own colour, a level for
 *   each of red, green and blue.
 *
 * Light passes through open space and through what is seen or walked
 * through (glass, water, magma: blocks.ts clearTable); every other block
 * stops it.
 *
 * A chunk's light depends only on the cells within 16 blocks of it, and on
 * the columns above it, so it is worked out from the chunk and its 26
 * neighbours alone (a 64 cube round it, WINDOW) and the same on every
 * device, and an edit relights only the chunks it can reach (lightReaches).
 *
 * The answer is a 34 cube of texels, the chunk and one cell round it, for a
 * 3D texture the block shader samples half a block out from each face,
 * filtered between the four cells round each point (terrainMaterial.ts).
 * Red, green and blue are the light that reaches the cell, open and block
 * light together (the brighter of the two in each colour); alpha says
 * whether the cell is open. Filtered, alpha is the share of open cells round
 * the point, so a face darkens toward a crease or a corner where solid
 * blocks close in: ambient occlusion from the same texture, in the dark as
 * in the light, with no change to the greedy mesh. A solid cell carries its
 * brightest open neighbour's light, so the light itself never smears dark
 * into a wall.
 */

import { KINDS } from './blocks'

/** The full level. */
export const MAX_LIGHT = 15
/** Texels on each side of a chunk's light: the chunk and one cell round it. */
export const LIGHT_SIDE = 34
/** Bytes of a chunk's light: RGBA, the light's red, green and blue levels times 17, and 255 for an open cell or 0 for a solid one. */
export const LIGHT_BYTES = LIGHT_SIDE * LIGHT_SIDE * LIGHT_SIDE * 4
/** Blocks round the chunk that are read: light spreads 15 blocks, and the texels reach one more. */
export const MARGIN = 16
/** The side of the cube that is read: the chunk and MARGIN round it. */
export const WINDOW = 32 + 2 * MARGIN
/**
 * What glows, and how far: the level its light starts at, and its colour
 * (the kind's glow colour). Magmaflow, Glowcore and Lumenwood the most;
 * Prismite, common in crystal ground, the least, so a crystal cave glows
 * without washing out.
 */
export const EMIT: Readonly<Record<string, { level: number; color: string }>> = {
  Magmaflow: { level: 15, color: '#ff7a1a' },
  Glowcore: { level: 13, color: '#00e5ff' },
  Lumenwood: { level: 11, color: '#7dffcf' },
  Gibsonite: { level: 12, color: '#ff00ff' },
  Prismite: { level: 7, color: '#c58bff' },
  'Relic shard': { level: 12, color: '#ff3b6b' },
  Voidpearl: { level: 12, color: '#b48cff' },
  Auroric: { level: 12, color: '#6dffd8' },
  Chronite: { level: 12, color: '#ffe08a' },
  'Singularity core': { level: 12, color: '#ffffff' },
  'Genesis shard': { level: 12, color: '#ffc23a' },
}

/** For the light: which ids let light through, and what each id gives off. */
export interface LightTables {
  /** 1 for every id light passes through: open space, and the seen and walked through. */
  pass: Uint8Array
  /** Red, green and blue levels for each id: 3 bytes an id, 0 for what does not glow. */
  emit: Uint8Array
}

/** The tables for the kinds this client knows. */
export function lightTables(): LightTables {
  const pass = new Uint8Array(256)
  const emit = new Uint8Array(768)
  pass[0] = 1
  for (const k of KINDS) {
    if (k.clear || k.passable) pass[k.id] = 1
    const e = EMIT[k.name]
    if (!e) continue
    const n = parseInt(e.color.slice(1), 16)
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    const top = Math.max(...rgb, 1)
    for (let c = 0; c < 3; c++) emit[3 * k.id + c] = Math.round((e.level * rgb[c]) / top)
  }
  return { pass, emit }
}

/** The chunk and its 26 neighbours, null where a chunk is not loaded or not surveyed (open space). Index aroundIndex. */
export type Around = ReadonlyArray<Uint8Array | null>

/** Where a neighbour at chunk offset (dx, dy, dz), each -1 to 1, sits in Around. */
export const aroundIndex = (dx: number, dy: number, dz: number): number => (dx + 1) + 3 * (dy + 1) + 9 * (dz + 1)

/** Across the 3 by 3 chunks' footprint, 96 by 96 columns, x fastest: 1 where nothing above the top chunks stops light, 0 where a chunk higher up has a solid block in the column. */
export const FOOT = 96

/** Where a texel of a chunk's light keeps a cell at (x, y, z), each -1 to 32: x fastest, then z, then y, as the chunk keeps its cells. */
export const texelIndex = (x: number, y: number, z: number): number => (x + 1) + LIGHT_SIDE * ((z + 1) + LIGHT_SIDE * (y + 1))

/** Growable lists of cells, one for each light level, so light spreads from the brightest first and each cell is set once. */
class Buckets {
  lists: Int32Array[] = Array.from({ length: MAX_LIGHT + 1 }, () => new Int32Array(256))
  counts = new Int32Array(MAX_LIGHT + 1)
  push(level: number, cell: number): void {
    let l = this.lists[level]
    const n = this.counts[level]
    if (n === l.length) { const g = new Int32Array(l.length * 2); g.set(l); this.lists[level] = l = g }
    l[n] = cell
    this.counts[level] = n + 1
  }
  clear(): void { this.counts.fill(0) }
}

const W = WINDOW
const W2 = W * W
const CELLS_W = W * W2

/** Scratch, kept between calls (one chunk at a time, in the worker or on the page). */
let scratch: { pass: Uint8Array; sky: Uint8Array; block: Uint8Array[]; buckets: Buckets } | null = null

/**
 * Spread light from what `buckets` holds through the cells `pass` lets it
 * through, falling by one a block: from the brightest level down, so each
 * cell is set once, to the brightest light that reaches it.
 */
function spread(level: Uint8Array, pass: Uint8Array, buckets: Buckets): void {
  for (let l = MAX_LIGHT; l > 1; l--) {
    const next = l - 1
    // The list for this level can grow while it is read only from a brighter one, never from itself.
    const list = buckets.lists[l]
    for (let i = 0; i < buckets.counts[l]; i++) {
      const c = list[i]
      if (level[c] !== l) continue
      const x = c & 63, z = (c >> 6) & 63, y = c >> 12
      if (x > 0) { const n = c - 1; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
      if (x < W - 1) { const n = c + 1; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
      if (z > 0) { const n = c - W; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
      if (z < W - 1) { const n = c + W; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
      if (y > 0) { const n = c - W2; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
      if (y < W - 1) { const n = c + W2; if (pass[n] && level[n] < next) { level[n] = next; buckets.push(next, n) } }
    }
  }
  buckets.clear()
}

/**
 * The light of the chunk at the middle of `around`, as LIGHT_BYTES of RGBA
 * texels (texelIndex): the light's red, green and blue levels times 17
 * (0 to 255), and 255 where the cell is open, 0 where it is solid. `skyTop`
 * (FOOT by FOOT) says which columns are open above the top row of chunks;
 * null when nothing is loaded up there. Integers only: the same bytes on
 * every device.
 */
export function computeLight(around: Around, skyTop: Uint8Array | null, tables: LightTables, out: Uint8Array<ArrayBuffer> = new Uint8Array(LIGHT_BYTES)): Uint8Array<ArrayBuffer> {
  scratch ??= { pass: new Uint8Array(CELLS_W), sky: new Uint8Array(CELLS_W), block: [new Uint8Array(CELLS_W), new Uint8Array(CELLS_W), new Uint8Array(CELLS_W)], buckets: new Buckets() }
  const { pass, sky, block, buckets } = scratch
  sky.fill(0)
  block[0].fill(0); block[1].fill(0); block[2].fill(0)
  const tPass = tables.pass, tEmit = tables.emit
  const emitters: number[] = []

  // The window: what each cell lets through; open space outside the ground is lit; what glows.
  for (let wy = 0; wy < W; wy++) {
    const fy = wy + MARGIN, cy = fy >> 5, ly = fy & 31
    for (let wz = 0; wz < W; wz++) {
      const fz = wz + MARGIN, cz = fz >> 5, lz = fz & 31
      const row = (wz << 6) | (wy << 12)
      // x runs over three chunks: 16 cells of the one before, 32 of the middle, 16 of the one after.
      for (let cx = 0; cx < 3; cx++) {
        const from = cx === 0 ? 16 : 0, to = cx === 2 ? 16 : 32
        const wx0 = cx * 32 + from - MARGIN
        const ch = around[cx + 3 * cy + 9 * cz]
        if (!ch) {
          for (let lx = from; lx < to; lx++) { const w = row | (wx0 + lx - from); pass[w] = 1; sky[w] = MAX_LIGHT }
          continue
        }
        const base = (lz << 5) | (ly << 10)
        for (let lx = from; lx < to; lx++) {
          const id = ch[base | lx]
          const w = row | (wx0 + lx - from)
          pass[w] = tPass[id]
          if (id && (tEmit[3 * id] | tEmit[3 * id + 1] | tEmit[3 * id + 2])) emitters.push(w, id)
        }
      }
    }
  }

  // Columns open all the way up: lit at the full level, however deep.
  for (let wz = 0; wz < W; wz++) {
    const fz = wz + MARGIN
    for (let wx = 0; wx < W; wx++) {
      const fx = wx + MARGIN
      if (skyTop && !skyTop[fx + FOOT * fz]) continue
      // Above the window, in the top row of chunks (its cells 16 to 31).
      const ch = around[(fx >> 5) + 6 + 9 * (fz >> 5)]
      let open = true
      if (ch) {
        const base = (fx & 31) | ((fz & 31) << 5)
        for (let ly = 31; ly >= 16; ly--) if (!tPass[ch[base | (ly << 10)]]) { open = false; break }
      }
      if (!open) continue
      for (let wy = W - 1; wy >= 0; wy--) {
        const w = wx | (wz << 6) | (wy << 12)
        if (!pass[w]) break
        sky[w] = MAX_LIGHT
      }
    }
  }

  // Open light spreads from every lit cell next to an open one that is not (a lit cell among lit ones has nothing to give).
  for (let c = 0; c < CELLS_W; c++) {
    if (sky[c] !== MAX_LIGHT) continue
    const x = c & 63, z = (c >> 6) & 63, y = c >> 12
    if ((x > 0 && pass[c - 1] && sky[c - 1] < MAX_LIGHT) || (x < W - 1 && pass[c + 1] && sky[c + 1] < MAX_LIGHT)
      || (z > 0 && pass[c - W] && sky[c - W] < MAX_LIGHT) || (z < W - 1 && pass[c + W] && sky[c + W] < MAX_LIGHT)
      || (y > 0 && pass[c - W2] && sky[c - W2] < MAX_LIGHT) || (y < W - 1 && pass[c + W2] && sky[c + W2] < MAX_LIGHT)) buckets.push(MAX_LIGHT, c)
  }
  spread(sky, pass, buckets)

  // Block light, a colour at a time: from a glowing cell, or from the open cells round a solid one.
  for (let ch = 0; ch < 3; ch++) {
    const level = block[ch]
    let any = false
    for (let i = 0; i < emitters.length; i += 2) {
      const c = emitters[i], e = tEmit[3 * emitters[i + 1] + ch]
      if (e === 0) continue
      any = true
      if (pass[c]) { if (level[c] < e) { level[c] = e; buckets.push(e, c) } continue }
      const x = c & 63, z = (c >> 6) & 63, y = c >> 12
      const ns = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, z > 0 ? c - W : -1, z < W - 1 ? c + W : -1, y > 0 ? c - W2 : -1, y < W - 1 ? c + W2 : -1]
      for (const n of ns) if (n >= 0 && pass[n] && level[n] < e - 1) { level[n] = e - 1; buckets.push(e - 1, n) }
    }
    if (any) spread(level, pass, buckets)
    else buckets.clear()
  }

  // The texels: the chunk and one cell round it, open and block light together. A solid cell carries its brightest open neighbour's light.
  const L = LIGHT_SIDE
  const b0 = block[0], b1 = block[1], b2 = block[2]
  for (let ty = 0; ty < L; ty++) for (let tz = 0; tz < L; tz++) for (let tx = 0; tx < L; tx++) {
    const w = (tx + MARGIN - 1) | ((tz + MARGIN - 1) << 6) | ((ty + MARGIN - 1) << 12)
    const o = 4 * (tx + L * (tz + L * ty))
    if (pass[w]) {
      const s0 = sky[w]
      out[o] = Math.max(s0, b0[w]) * 17; out[o + 1] = Math.max(s0, b1[w]) * 17; out[o + 2] = Math.max(s0, b2[w]) * 17; out[o + 3] = 255
      continue
    }
    let r = 0, g = 0, b = 0
    for (const n of [w - 1, w + 1, w - W, w + W, w - W2, w + W2]) {
      if (!pass[n]) continue
      const s0 = sky[n]
      r = Math.max(r, s0, b0[n]); g = Math.max(g, s0, b1[n]); b = Math.max(b, s0, b2[n])
    }
    out[o] = r * 17; out[o + 1] = g * 17; out[o + 2] = b * 17; out[o + 3] = 0
  }
  return out
}

/**
 * Whether a change at chunk-local (x, y, z) of some chunk can change the
 * light of the chunk at chunk offset `d` from it. Within 15 blocks of the
 * chunk's walls across (x and z), and not more than 15 below it: a cell 16
 * from every texel can only bring light that has faded to 0 by the time it
 * gets there. Any distance above: a block up the column shades it.
 */
export function lightReaches(d: readonly [number, number, number], x: number, y: number, z: number): boolean {
  const px = x - 32 * d[0], py = y - 32 * d[1], pz = z - 32 * d[2]
  const r = MARGIN - 1
  return px >= -r && px < 32 + r && pz >= -r && pz < 32 + r && py >= -r
}

/**
 * For skyTop: the columns of a chunk with any block that stops light, 32 by
 * 32, x fastest, 1 where one does.
 */
export function shadedColumns(blocks: Uint8Array, pass: Uint8Array): Uint8Array {
  const out = new Uint8Array(1024)
  for (let c = 0; c < 32768; c++) if (!pass[blocks[c]]) out[c & 1023] = 1
  return out
}

/** The light's levels at a cell, -1 to 32 on each axis, as [red, green, blue], each 0 to 15. */
export function lightAt(light: Uint8Array, x: number, y: number, z: number): [number, number, number] {
  const o = 4 * texelIndex(x, y, z)
  return [light[o] / 17, light[o + 1] / 17, light[o + 2] / 17]
}

/**
 * The share of open cells the block shader reads at a corner of a face
 * (terrainMaterial.ts), 0 to 1: the four cells round the corner in the
 * layer in front of the face, as the texture's filter averages them there.
 * 1 on an open face; less toward a crease or a corner, its ambient
 * occlusion. `cell` the block, `face` 0 to 5 (-x, +x, -y, +y, -z, +z),
 * `corner` [su, sv], each 0 or 1, along the face's two other axes in x, y, z
 * order.
 */
export function cornerOpen(light: Uint8Array, cell: readonly [number, number, number], face: number, corner: readonly [number, number]): number {
  const d = face >> 1, dir = face & 1 ? 1 : -1
  const [a, b] = d === 0 ? [1, 2] : d === 1 ? [0, 2] : [0, 1]
  let sum = 0
  for (const da of [corner[0] - 1, corner[0]]) for (const db of [corner[1] - 1, corner[1]]) {
    const p = [cell[0], cell[1], cell[2]]
    p[d] += dir; p[a] += da; p[b] += db
    sum += light[4 * texelIndex(p[0], p[1], p[2]) + 3]
  }
  return sum / (4 * 255)
}
