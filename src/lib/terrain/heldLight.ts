/**
 * heldLight.ts - a glowing block in your hand lights where you are (owner,
 * 2026-11-27: "if i select a glowing block in my inventory i want that
 * block's glow effect to surround my avatar and provide light where i am so
 * i can see").
 *
 * While the chosen hotbar slot holds a block that glows (light.ts EMIT) and
 * you carry at least one, you are a light of its colour and level, at the
 * cell your eye is in. It spreads as a glowing block's light does
 * (light.ts computeLight): a level a block through open space, glass, water
 * and magma, stopped by every other block, from the block's level at the
 * eye down to nothing 15 blocks off, stored as BRIGHT_BLOCK. So it lights a
 * cave as that block placed at your eye would, byte for byte (the tests
 * check it): a placed solid block lights from the open cells round it, a
 * level lower there, which is what this gives them too; only the eye's own
 * cell, which a placed block would fill, is lit as well.
 *
 * Only this light is worked out when you move, never the chunks' own: one
 * flood from one cell, in a cube of HELD_SIDE cells round the eye (the
 * farthest its light can reach), read from the chunks that cube overlaps (8
 * at most). The block shader (terrain/terrainMaterial.ts) reads it as a
 * second small texture beside each chunk's light and takes the brighter of
 * the two, as the chunk's own light already takes the brighter of open light
 * and block light.
 */

import { isCompiler, type Inventory } from './terrainDb'
import { BRIGHT_BLOCK, EMIT, MAX_LIGHT, lightTables, type LightTables } from './light'
import { KINDS } from './blocks'

/** How far the light reaches: a level a block from MAX_LIGHT, nothing left at this many blocks. */
export const HELD_REACH = MAX_LIGHT
/** The cube of cells round the eye the light is worked out in: the eye and HELD_REACH each way, so its outer layer is always dark. */
export const HELD_SIDE = 2 * HELD_REACH + 1
const S = HELD_SIDE
const S2 = S * S
const CELLS_H = S * S2
/** Bytes of the held light: RGBA texels, x fastest, then z, then y, as a chunk's light (light.ts texelIndex); alpha unused. */
export const HELD_BYTES = CELLS_H * 4

/** What a glowing kind gives your hand: its light level, its glow colour, and the level in red, green and blue (as light.ts lightTables stores it). */
export interface HeldGlow {
  id: number
  name: string
  level: number
  color: string
  rgb: readonly [number, number, number]
}

let tables: LightTables | null = null
/** The light tables, made once. */
export function heldTables(): LightTables {
  tables ??= lightTables()
  return tables
}

const glows = new Map<number, HeldGlow | null>()

/** The glow of a block kind, by id, or null when it does not glow (light.ts EMIT is the list). Made once per id, so asking every frame allocates nothing. */
export function heldGlow(id: number): HeldGlow | null {
  const had = glows.get(id)
  if (had !== undefined) return had
  const k = KINDS.find((kind) => kind.id === id)
  const e = k ? EMIT[k.name] : undefined
  const t = heldTables().emit
  const g: HeldGlow | null = k && e ? { id, name: k.name, level: e.level, color: e.color, rgb: [t[3 * id], t[3 * id + 1], t[3 * id + 2]] } : null
  glows.set(id, g)
  return g
}

/** Every kind that lights your way, brightest first. */
export function glowingKinds(): HeldGlow[] {
  return KINDS.map((k) => heldGlow(k.id)).filter((g): g is HeldGlow => g !== null).sort((a, b) => b.level - a.level)
}

/** The glowing block in hand, or null: the chosen slot holds a kind that glows, and you carry at least one (an empty slot, none left, the Compiler: none). */
export function heldLightSource(inv: Pick<Inventory, 'hotbar' | 'slot' | 'counts'>): HeldGlow | null {
  const id = inv.hotbar[inv.slot]
  if (!id || isCompiler(id) || (inv.counts[id] ?? 0) <= 0) return null
  return heldGlow(id)
}

/** The cube's lowest corner for an eye in cell `eye` (cs offsets from the field's origin): the eye sits at its middle. */
export function heldCorner(eye: readonly [number, number, number], out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = eye[0] - HELD_REACH; out[1] = eye[1] - HELD_REACH; out[2] = eye[2] - HELD_REACH
  return out
}

/** The chunk offsets the cube at `corner` overlaps: 1 to 8 chunks, the only ones its light is read from. */
export function heldChunks(corner: readonly [number, number, number]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const lo = corner.map((v) => v >> 5), hi = corner.map((v) => (v + S - 1) >> 5)
  for (let cz = lo[2]; cz <= hi[2]; cz++) for (let cy = lo[1]; cy <= hi[1]; cy++) for (let cx = lo[0]; cx <= hi[0]; cx++) out.push([cx, cy, cz])
  return out
}

/** A chunk's blocks by chunk offset, or null where it is not loaded or not surveyed (open space, as light.ts reads it). */
export type ChunkBlocks = (cx: number, cy: number, cz: number) => Uint8Array | null

/** Scratch, kept between calls: which cells let light through, how far each is from the eye, and the flood's queue. */
let scratch: { pass: Uint8Array; dist: Uint8Array; queue: Int32Array } | null = null
const FAR = 255

/**
 * Which cells of the cube at `corner` let light through (1) or stop it (0),
 * into `pass` (HELD_SIDE cubed, x fastest, then z, then y), read a chunk at
 * a time from `blocks`.
 */
export function fillHeldPass(blocks: ChunkBlocks, corner: readonly [number, number, number], pass: Uint8Array, passTable: Uint8Array = heldTables().pass): Uint8Array {
  for (const [cx, cy, cz] of heldChunks(corner)) {
    const ch = blocks(cx, cy, cz)
    // The part of the cube in this chunk, in cube cells.
    const x0 = Math.max(0, 32 * cx - corner[0]), x1 = Math.min(S, 32 * cx + 32 - corner[0])
    const y0 = Math.max(0, 32 * cy - corner[1]), y1 = Math.min(S, 32 * cy + 32 - corner[1])
    const z0 = Math.max(0, 32 * cz - corner[2]), z1 = Math.min(S, 32 * cz + 32 - corner[2])
    for (let y = y0; y < y1; y++) {
      const ly = (y + corner[1]) & 31
      for (let z = z0; z < z1; z++) {
        const lz = (z + corner[2]) & 31
        const row = S * (z + S * y)
        if (!ch) { pass.fill(1, row + x0, row + x1); continue }
        const base = (lz << 5) | (ly << 10)
        for (let x = x0; x < x1; x++) pass[row + x] = passTable[ch[base | ((x + corner[0]) & 31)]]
      }
    }
  }
  return pass
}

/**
 * The held light in the cube round the eye, as HELD_BYTES of RGBA texels:
 * BRIGHT_BLOCK of each colour's level, the glow's level at the eye less one
 * for every block of open path to the cell, 0 where it is solid or out of
 * reach. One flood from the eye (every colour falls by the same step from
 * the same cell, so one distance serves all three), as light.ts spreads a
 * glowing block's light: from an open eye cell its own level; from an eye
 * inside a solid block, the open cells round it one lower.
 */
export function computeHeldLight(pass: Uint8Array, rgb: readonly [number, number, number], out: Uint8Array = new Uint8Array(HELD_BYTES)): Uint8Array {
  scratch ??= { pass: new Uint8Array(CELLS_H), dist: new Uint8Array(CELLS_H), queue: new Int32Array(CELLS_H) }
  const { dist, queue } = scratch
  dist.fill(FAR)
  out.fill(0)
  const top = Math.max(rgb[0], rgb[1], rgb[2])
  if (top <= 0) return out
  const mid = HELD_REACH + S * (HELD_REACH + S * HELD_REACH)
  let head = 0, tail = 0
  if (pass[mid]) { dist[mid] = 0; queue[tail++] = mid } else {
    for (const n of [mid - 1, mid + 1, mid - S, mid + S, mid - S2, mid + S2]) if (pass[n]) { dist[n] = 1; queue[tail++] = n }
  }
  // Only cells still lit spread: one at distance d gives its neighbours d + 1 while the brightest colour has a level left there.
  while (head < tail) {
    const c = queue[head++]
    const d = dist[c] + 1
    if (top - d < 1) continue
    const x = c % S, z = Math.floor(c / S) % S, y = Math.floor(c / S2)
    if (x > 0) { const n = c - 1; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
    if (x < S - 1) { const n = c + 1; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
    if (z > 0) { const n = c - S; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
    if (z < S - 1) { const n = c + S; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
    if (y > 0) { const n = c - S2; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
    if (y < S - 1) { const n = c + S2; if (pass[n] && dist[n] === FAR) { dist[n] = d; queue[tail++] = n } }
  }
  for (let i = 0; i < tail; i++) {
    const c = queue[i], d = dist[c], o = 4 * c
    out[o] = BRIGHT_BLOCK[Math.max(0, rgb[0] - d)]
    out[o + 1] = BRIGHT_BLOCK[Math.max(0, rgb[1] - d)]
    out[o + 2] = BRIGHT_BLOCK[Math.max(0, rgb[2] - d)]
  }
  return out
}

/** The held light's pass scratch (HELD_SIDE cubed), shared so a cell change allocates nothing. */
export function heldPassScratch(): Uint8Array {
  scratch ??= { pass: new Uint8Array(CELLS_H), dist: new Uint8Array(CELLS_H), queue: new Int32Array(CELLS_H) }
  return scratch.pass
}

/** The held light's bytes at a cube cell (each 0 to HELD_SIDE - 1), as [red, green, blue]. */
export function heldAt(light: Uint8Array, x: number, y: number, z: number): [number, number, number] {
  const o = 4 * (x + S * (z + S * y))
  return [light[o], light[o + 1], light[o + 2]]
}

/**
 * How the shader puts a chunk's light, the held light and the eye lamp
 * together at a point, as brightness (1 full open light), mirrored here from
 * terrainMaterial.ts for the tests: the brighter of the chunk's and the
 * held light in each colour, then never below the eye lamp or the floor.
 * The brighter, not the sum: every light in Block shading meets the others
 * this way (open and block light, the eye lamp), so a Glowcore in hand looks
 * like a Glowcore and not white, and the Headlamp's grey never washes its
 * colour out where both reach.
 */
export function heldShine(chunk: readonly [number, number, number], held: readonly [number, number, number], lamp: number, floor: number): [number, number, number] {
  const f = Math.max(floor, lamp)
  return [Math.max(chunk[0], held[0], f), Math.max(chunk[1], held[1], f), Math.max(chunk[2], held[2], f)]
}

/** The glow drawn round the block in hand and at the screen's edges: its colour as "r, g, b", how strong (the level over 15), and whether it breathes (only while motion is allowed). */
export function heldGlowLook(glow: HeldGlow | null, reducedMotion: boolean): { rgb: string; strength: number; pulse: boolean } | null {
  if (!glow) return null
  const n = parseInt(glow.color.slice(1), 16)
  return { rgb: `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`, strength: glow.level / MAX_LIGHT, pulse: !reducedMotion }
}
