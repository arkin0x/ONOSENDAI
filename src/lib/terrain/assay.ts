/**
 * assay.ts - the survey card's numbers (owner, 2026-11-27: "survey card
 * sounds excellent"): what one chunk holds, as a list, never where.
 *
 * Players could not find Glowcore or Cinderrock: a survey fills the whole
 * 32 by 32 by 32 chunk, but only faces open to the air are seen, so a rare
 * block buried inside goes unnoticed. The card says what is there and how
 * much of it shows, and leaves the finding to you.
 *
 * - assayBlocks: what is in the chunk's 32,768 cells now (the ground with
 *   every layer merged over it, world.ts ChunkSlot.blocks): each kind's
 *   count and, of each kind, how many blocks are visible (owner, 2026-11-28:
 *   "surely they arent always one or the other"; "what if the air adjacent
 *   to the block is cut off from the outside"; "it has to account for any
 *   adjacent chunks"). A block is visible when one of its faces is drawn
 *   (open space beside it, or a see-through or walk-through block of another
 *   kind: the mesher's own rule, blocks.ts clearTable) onto open space you
 *   can reach from outside without digging (reachOpen, across the chunk and
 *   its 26 neighbours). The rest of the kind is buried. It also finds the
 *   kind most of each of the 32 layers is made of, for the card's strata.
 * - chunkAssay: the same, kept per chunk and per version of it and of its 26
 *   neighbours, so opening the card again costs nothing and nothing counts per
 *   frame.
 * - minedBlocks and chunkMined: what YOU took out of the chunk's ground
 *   (owner, 2026-11-28: "how many of the blocks in the chunk you've mined and
 *   how many are left"): each cell of the base ground your own blocks hold as
 *   open space or another block, counted by the ground's kind. Kept per chunk
 *   and version like the pass.
 * - surveyCard: the card itself: the ground type with its signature rock,
 *   every kind sorted rarest first with how many are left (how many of them
 *   visible and how many buried) and how many you mined, the hardness
 *   (terrain K, plainly named) and a gentle line for each recipe block that
 *   is here.
 *
 * Pure: nothing here reads a store or the clock.
 */

import { CELLS } from './coords'
import { blockName, clearTable } from './blocks'
import type { ChunkSlot, TerrainWorld } from './world'
import { aroundIndex, type Around } from './light'
import { COMPILER_RECIPE, QUARRY_CHARGE_RECIPE, recipeNeeds } from '../blueprint/recipes'
import { MAXK_AT_LEAST } from './generate'

/** What one pass over a chunk finds. */
export interface Assay {
  /** Blocks of each id, 0 to 255 (index 0, open space, is counted too). */
  counts: Uint32Array
  /** Of each id, the visible blocks: a face the scene draws onto open space you can reach (reachOpen). counts minus this is buried. */
  shown: Uint32Array
  /** The kind most of each layer is made of, y 0 (bottom) to 31; 0 for a layer that is mostly open space. */
  strata: Uint8Array
}

/** A layer with fewer solid cells than this (of 1,024) is drawn as open space in the strata. */
export const STRATA_MIN = 96

let clears: Uint8Array | null = null
let runs = 0

/** For tests: how many full passes have run. */
export function assayRuns(): number {
  return runs
}

/**
 * The chunk and its 26 neighbours side by side, 96 cells on each side, with a
 * border one cell thick round them (so a step to the next cell never needs a
 * bounds check): 98 on each side, x fastest, then z, then y, as a chunk keeps
 * its cells.
 */
export const HOOD = 98
const HOOD_PLANE = HOOD * HOOD
const HOOD_CELLS = HOOD_PLANE * HOOD

/** Where the cell (x, y, z) of the neighbour at chunk offset (dx, dy, dz) sits in the hood. */
export const hoodIndex = (dx: number, dy: number, dz: number, x: number, y: number, z: number): number =>
  (1 + 32 * (dx + 1) + x) + HOOD * (1 + 32 * (dz + 1) + z) + HOOD_PLANE * (1 + 32 * (dy + 1) + y)

/**
 * The chunk and its 26 neighbours as one block of ids (the hood): `around` in
 * light.ts aroundIndex order (its middle, 13, is the chunk itself and is read
 * from `blocks`), null for a neighbour that is open space. The border is open
 * space too.
 */
export function hoodBlocks(blocks: Uint8Array, around: Around = []): Uint8Array {
  const hood = new Uint8Array(HOOD_CELLS)
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = aroundIndex(dx, dy, dz)
    const src = i === 13 ? blocks : around[i] ?? null
    if (!src) continue
    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) {
      const o = 32 * z + 1024 * y
      hood.set(src.subarray(o, o + 32), hoodIndex(dx, dy, dz, 0, y, z))
    }
  }
  return hood
}

/**
 * The open cells of a chunk and its 26 neighbours (hoodBlocks) you can reach
 * from outside without digging: open space, or a see-through or walk-through
 * block (blocks.ts clearTable, so Tidewater, drawn clear, and the liquids you
 * walk through let the eye and you through), flooded from every open cell on
 * the outside of the 3 by 3 by 3 chunks through open cells beside each other.
 * 1 for each cell reached (the border, which is never stepped into, is 1 too).
 * `empty` names the chunks (aroundIndex) that are all open space: every one
 * of them touches the outside, so all its cells are reached at once and only
 * its faces start the flood, which keeps the count quick where few of the
 * chunks round you are surveyed.
 *
 * An approximation: what lies past the 26 neighbours is taken to be the
 * outside, so a pocket that is closed only further out than that counts as
 * reachable, and one that opens to the outside only further out is sealed.
 */
export function reachOpen(hood: Uint8Array, ct: Uint8Array = (clears ??= clearTable()), empty: ReadonlyArray<boolean> = []): Uint8Array {
  const pass = new Uint8Array(256)
  pass[0] = 1
  for (let id = 1; id < 256; id++) pass[id] = ct[id]
  const reached = new Uint8Array(HOOD_CELLS)
  const queue = new Uint32Array(HOOD_CELLS)
  let tail = 0
  const last = HOOD - 1
  // The border: marked reached, so the flood never steps into it.
  for (let a = 0; a < HOOD; a++) for (let b = 0; b < HOOD; b++) {
    reached[a + HOOD * b] = 1
    reached[a + HOOD * b + HOOD_PLANE * last] = 1
    reached[a + HOOD_PLANE * b] = 1
    reached[a + HOOD * last + HOOD_PLANE * b] = 1
    reached[HOOD * a + HOOD_PLANE * b] = 1
    reached[last + HOOD * a + HOOD_PLANE * b] = 1
  }
  // A chunk all open space: every cell reached, its faces seeds.
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!empty[aroundIndex(dx, dy, dz)]) continue
    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) {
      const row = hoodIndex(dx, dy, dz, 0, y, z)
      reached.fill(1, row, row + 32)
      if (y === 0 || y === 31 || z === 0 || z === 31) for (let x = 0; x < 32; x++) queue[tail++] = row + x
      else { queue[tail++] = row; queue[tail++] = row + 31 }
    }
  }
  // The seeds: every open cell just inside the border.
  for (let a = 1; a < last; a++) for (let b = 1; b < last; b++) {
    for (const g of [a + HOOD * b + HOOD_PLANE, a + HOOD * b + HOOD_PLANE * (last - 1), a + HOOD + HOOD_PLANE * b, a + HOOD * (last - 1) + HOOD_PLANE * b, 1 + HOOD * a + HOOD_PLANE * b, last - 1 + HOOD * a + HOOD_PLANE * b]) {
      if (!reached[g] && pass[hood[g]]) { reached[g] = 1; queue[tail++] = g }
    }
  }
  for (let head = 0; head < tail; head++) {
    const g = queue[head]
    let n = g - 1
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
    n = g + 1
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
    n = g - HOOD
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
    n = g + HOOD
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
    n = g - HOOD_PLANE
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
    n = g + HOOD_PLANE
    if (!reached[n] && pass[hood[n]]) { reached[n] = 1; queue[tail++] = n }
  }
  return reached
}

/**
 * One count of `blocks`: the flood (reachOpen) and one pass over the chunk's
 * cells. `around` holds the 26 neighbours' blocks in light.ts aroundIndex
 * order, null for open space (a chunk not loaded and not surveyed, as world.ts
 * draws it).
 */
export function assayBlocks(blocks: Uint8Array, around: Around = []): Assay {
  runs++
  clears ??= clearTable()
  const ct = clears
  const counts = new Uint32Array(256)
  const shown = new Uint32Array(256)
  const layer = new Uint16Array(32 * 256)
  const hood = hoodBlocks(blocks, around)
  const empty = Array.from({ length: 27 }, (_, i) => i !== 13 && !around[i])
  const reached = reachOpen(hood, ct, empty)
  // A face is seen when it is drawn (the mesher's rule) onto a cell you can reach.
  const seen = (id: number, g: number): boolean => reached[g] === 1 && (hood[g] === 0 || (ct[hood[g]] === 1 && hood[g] !== id))
  for (let o = 0; o < CELLS; o++) {
    const id = blocks[o]
    counts[id]++
    if (id === 0) continue
    const x = o & 31, z = (o >> 5) & 31, y = o >> 10
    layer[(y << 8) | id]++
    // The chunk sits in the middle of the block, so all six cells beside it are there, in the chunk or a neighbour.
    const g = hoodIndex(0, 0, 0, x, y, z)
    if (seen(id, g - 1) || seen(id, g + 1) || seen(id, g - HOOD) || seen(id, g + HOOD) || seen(id, g - HOOD_PLANE) || seen(id, g + HOOD_PLANE)) shown[id]++
  }
  const strata = new Uint8Array(32)
  for (let y = 0; y < 32; y++) {
    let best = 0, most = 0, solid = 0
    for (let id = 1; id < 256; id++) {
      const n = layer[(y << 8) | id]
      solid += n
      if (n > most) { most = n; best = id }
    }
    strata[y] = solid >= STRATA_MIN ? best : 0
  }
  return { counts, shown, strata }
}

/**
 * Kept passes, by the chunk's own slot (never its key: a chunk dropped and
 * loaded again is a new slot whose versions start over, review of #956): the
 * neighbour slots it was counted with and the blocks it read for each, its
 * stamp (its revision and version and theirs) and the pass. Weak, so a slot
 * let go (a chunk dropped, TERRAIN closed, another identity's field) takes its
 * pass with it.
 */
let kept = new WeakMap<ChunkSlot, { slots: ReadonlyArray<ChunkSlot | null>; read: Around; stamp: string; assay: Assay }>()

/** For tests: forget every kept pass. */
export function forgetAssays(): void {
  kept = new WeakMap()
  keptMined = new WeakMap()
}

/**
 * The pass for a loaded chunk, worked out once per version of it and of its
 * 26 neighbours (a block mined or placed, a layer arriving, a neighbour coming,
 * going or loaded again all change it), else the kept one. A neighbour not
 * loaded reads `ground` at its place (aroundIndex): the caller's generated
 * ground for a chunk surveyed but not loaded (terrain/surveyCard.ts), or open
 * space. Null before the chunk has blocks.
 */
export function chunkAssay(world: TerrainWorld, slot: ChunkSlot, ground: Around = []): Assay | null {
  const blocks = slot.blocks
  if (!blocks) return null
  const slots: Array<ChunkSlot | null> = new Array(27).fill(null)
  const read: Array<Uint8Array | null> = new Array(27).fill(null)
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = aroundIndex(dx, dy, dz)
    if (i === 13) continue
    const n = world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)
    slots[i] = n
    read[i] = n?.blocks ?? ground[i] ?? null
  }
  const stamp = `${slot.revision ?? 2}|${slot.version}|${slots.map((n) => (n?.blocks ? n.version : '-')).join(',')}`
  const k = kept.get(slot)
  if (k && k.stamp === stamp && k.slots.every((n, i) => n === slots[i]) && k.read.every((r, i) => r === read[i])) return k.assay
  const assay = assayBlocks(blocks, read)
  kept.set(slot, { slots, read, stamp, assay })
  return assay
}

/**
 * What you took out of a chunk's ground, by kind: each cell where the base
 * ground (`base`, at the revision the card shows) holds a block and your own
 * blocks (`own`: the ground with your layer and log over it, world.ts
 * ChunkSlot.own) hold open space or another block. Only your own blocks are
 * read, so a block someone else mined is never yours. A block you placed and
 * mined again leaves the cell as its ground was (open space), so it counts
 * nothing; a Quarry Charge's blast writes your blocks as mining does, so its
 * cells count.
 *
 * Where your blocks sit on another revision's ground than the one shown
 * (`generated`, the ground `own` was built over; a home owner who surveyed at
 * another revision), a cell counts only where you changed it (`own` differs
 * from `generated`, or it is one of your explicit cells, DECK-0009 §5.4): what
 * mining there carried was the base you were shown (store/useTerrain.ts
 * yieldOf), so it is the base's kind that is counted.
 */
export function minedBlocks(own: Uint8Array, base: Uint8Array, generated: Uint8Array | null = null, explicit: ReadonlySet<number> | null = null): Uint32Array {
  const mined = new Uint32Array(256)
  const other = generated && generated !== base ? generated : null
  for (let c = 0; c < CELLS; c++) {
    const b = base[c], o = own[c]
    if (b === 0 || o === b) continue
    if (other && o === other[c] && !explicit?.has(c)) continue
    mined[b]++
  }
  return mined
}

/** Kept counts of what you mined, by the chunk's own slot (as `kept`): its stamp, the blocks they were counted from, the counts. */
let keptMined = new WeakMap<ChunkSlot, { stamp: string; own: Uint8Array; generated: Uint8Array | null; mined: Uint32Array }>()

/**
 * What you mined in a loaded chunk (minedBlocks), worked out once per version
 * of it and per base revision shown, else the kept counts. Null where you hold
 * no blocks of your own there (you never surveyed or built in it).
 * `base` is the ground at `baseRevision` (store/useTerrain.ts groundFor).
 */
export function chunkMined(slot: ChunkSlot, base: Uint8Array, baseRevision: number, explicit: ReadonlySet<number> | null = null): Uint32Array | null {
  const own = slot.own
  if (!own) return null
  const generated = (slot.revision ?? 2) === baseRevision ? null : slot.generated
  const stamp = `${slot.revision ?? 2}|${baseRevision}|${slot.version}|${explicit ? explicit.size : '-'}`
  const k = keptMined.get(slot)
  if (k && k.stamp === stamp && k.own === own && k.generated === generated) return k.mined
  const mined = minedBlocks(own, base, generated, generated ? explicit : null)
  keptMined.set(slot, { stamp, own, generated, mined })
  return mined
}

/**
 * Every kind TERRAIN knows, rarest first: the rare band (generate.ts RARE,
 * rarest first), then Glowcore, Cinderrock, Prismite, Cobaltine and Ferrovein
 * (the owner's order) with the features each family adds beside them, then the
 * common rock. A kind not listed here (a later revision's, or a made block)
 * comes after the finds.
 */
export const RARITY: readonly number[] = [
  197, 192, 196, 43, 195, 194, 193, // Genesis shard, Relic shard, Singularity core, Gibsonite, Chronite, Auroric, Voidpearl
  42, 7, 12, 8, 13, 14, 41, 40, // Glowcore, Cinderrock, Magmaflow, Prismite, Lumenwood, Canopy glass, Cobaltine, Ferrovein
  9, 10, 11, // Basaltine, Rimeglass, Tidewater
  6, 3, 5, 4, 2, 1, // common rock: Frostshale, Driftsilt, Rustband, Mossveil, Umberslate, Gridstone
]
/** The common rock: every chunk is mostly these. */
export const COMMON: ReadonlySet<number> = new Set([6, 3, 5, 4, 2, 1])
/** The rare band and Glowcore: the card marks these brighter. */
export const PRIZED: ReadonlySet<number> = new Set([197, 192, 196, 43, 195, 194, 193, 42])

const RANK = new Map(RARITY.map((id, i) => [id, i]))
/** Where a kind sorts: its place in RARITY; an unlisted kind after the finds, before the common rock. */
function rankOf(id: number): number {
  return RANK.get(id) ?? RARITY.indexOf(9) - 0.5 + id / 1000
}

/** How each ground type is shown: its name and its signature rock (a block id). */
export const GROUND_LOOK: Readonly<Record<string, { name: string; rock: number }>> = {
  temperate: { name: 'Temperate', rock: 4 }, // Mossveil
  dune: { name: 'Dune', rock: 3 }, // Driftsilt
  frozen: { name: 'Frozen', rock: 6 }, // Frostshale
  volcanic: { name: 'Volcanic', rock: 7 }, // Cinderrock
  crystal: { name: 'Crystal', rock: 8 }, // Prismite
  karst: { name: 'Karst', rock: 5 }, // Rustband
}

/** The ground's facts, as the generator gave them for this chunk (world.ts ChunkSlot.ground). */
export interface GroundFacts {
  family: string
  /** Terrain K of the chunk's costliest cube, 0 to 16. */
  maxK: number
  /** Its mean over the chunk's 64 cubes. */
  meanK: number
  /** The family's skin over open air (a block id): the swatch for a family this build has no look for. */
  top: number
}

/** The highest terrain K: the hardness bar's full length. */
export const HARDNESS_MAX = 16

/**
 * The average hardness of a chunk, as the card shows it (its costliest cube's
 * terrain K), over every chunk: the mean of MAXK_AT_LEAST's measured shares
 * (the mean of a count is the sum of its tail), rounded. 10.
 */
export const AVERAGE_HARDNESS = Math.round(MAXK_AT_LEAST.slice(1).reduce((a, b) => a + b, 0))

/**
 * The line under the hardness bar (owner, 2026-11-28: "Richer than the
 * average hardness of 10"): richer, about the same, or leaner than the
 * average chunk.
 */
export function hardnessLine(max: number): string {
  if (max > AVERAGE_HARDNESS) return `Richer than the average hardness of ${AVERAGE_HARDNESS}.`
  if (max < AVERAGE_HARDNESS) return `Leaner than the average hardness of ${AVERAGE_HARDNESS}.`
  return `About the average hardness of ${AVERAGE_HARDNESS}.`
}

/** One line of the card's list. */
export interface CardRow {
  id: number
  name: string
  /** How many are in the chunk now (LEFT): 0 for a kind you mined out, or one kept on the card while it is open. */
  count: number
  /** How many you took out of the chunk's ground (MINED). */
  mined: number
  /** Of what is left, the blocks you could see without digging: a face open to space you can reach (or to glass or water). */
  visible: number
  /** Of what is left, the rest: count minus visible. */
  buried: number
  /** The rare band or Glowcore. */
  prized: boolean
}

/** The card, ready to draw. */
export interface SurveyCardData {
  ground: { family: string; name: string; rock: number } | null
  /** Terrain K, plainly named: its costliest cube and its mean, 0 to 16; null when the ground's facts are not known. */
  hardness: { max: number; mean: number } | null
  /** The finds, rarest first. */
  finds: CardRow[]
  /** The common rock, rarest first. */
  common: CardRow[]
  /** A gentle line for each recipe block that is here. */
  notes: string[]
  /** The kind each layer is mostly made of, bottom to top (0 for mostly open space). */
  strata: Uint8Array
  /** Blocks in the chunk now, every kind: what is left. */
  total: number
  /** Blocks you took out of the chunk's ground, every kind. */
  minedTotal: number
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const word = (n: number): string => WORDS[n] ?? String(n)

/** The recipes whose blocks the card points out, and how many of each they take. */
const RECIPES: ReadonlyArray<{ name: string; tool: 'compiler' | 'quarry'; needs: Readonly<Record<number, number>> }> = [
  { name: 'the Compiler', tool: 'compiler', needs: recipeNeeds(COMPILER_RECIPE) },
  { name: 'the Quarry Charge', tool: 'quarry', needs: recipeNeeds(QUARRY_CHARGE_RECIPE) },
]

/**
 * A line for each find here that a recipe takes (common rock is everywhere,
 * so it gets none): "Glowcore: the Compiler needs one." With the
 * Compiler made already, the Compiler's needs are left out.
 */
export function recipeNotes(present: ReadonlyArray<number>, ownsCompiler: boolean): string[] {
  const out: string[] = []
  for (const id of present) {
    if (COMMON.has(id)) continue
    const uses = RECIPES.filter((r) => (r.needs[id] ?? 0) > 0 && !(r.tool === 'compiler' && ownsCompiler))
    if (uses.length === 0) continue
    const parts = uses.map((r, i) => (i === 0 ? `${r.name} needs ${word(r.needs[id])}` : `${r.name} ${word(r.needs[id])}`))
    out.push(`${blockName(id)}: ${parts.join(' and ')}.`)
  }
  return out
}

/**
 * The survey card for a chunk's pass and its ground's facts. `mined` is what
 * you took out of it (chunkMined), by kind. A kind is listed while any of it
 * is left or you mined some, and a kind in `keep` stays listed at 0 (the card
 * keeps every row it has shown while it is open, so a kind mined out never
 * jumps off the list).
 */
export function surveyCard(assay: Assay, facts: GroundFacts | null | undefined, opts: { ownsCompiler?: boolean; mined?: Uint32Array | null; keep?: Iterable<number> } = {}): SurveyCardData {
  const rows: CardRow[] = []
  const keep = new Set(opts.keep ?? [])
  let total = 0
  let minedTotal = 0
  for (let id = 1; id < 256; id++) {
    const n = assay.counts[id]
    const m = opts.mined?.[id] ?? 0
    total += n
    minedTotal += m
    if (!n && !m && !keep.has(id)) continue
    rows.push({ id, name: blockName(id), count: n, mined: m, visible: assay.shown[id], buried: n - assay.shown[id], prized: PRIZED.has(id) })
  }
  rows.sort((a, b) => rankOf(a.id) - rankOf(b.id))
  const look = facts ? GROUND_LOOK[facts.family] : undefined
  const ground = facts ? { family: facts.family, name: look?.name ?? facts.family.charAt(0).toUpperCase() + facts.family.slice(1), rock: look?.rock ?? facts.top } : null
  return {
    ground,
    hardness: facts ? { max: facts.maxK, mean: facts.meanK } : null,
    finds: rows.filter((r) => !COMMON.has(r.id)),
    common: rows.filter((r) => COMMON.has(r.id)),
    notes: recipeNotes(rows.filter((r) => r.count > 0).map((r) => r.id), !!opts.ownsCompiler),
    strata: assay.strata,
    total,
    minedTotal,
  }
}

/**
 * One slice of the core as the card reads it out (owner, 2026-11-28: "id like
 * to tap or slide my finger across the core sample to see the name of the
 * resource representing the layer"): layer 1 is the chunk's top, on the core's
 * left, as a core log reads, down to layer 32 at the bottom. It says only what
 * the slice's colour already shows: the kind the layer is mostly made of, or
 * that it is mostly open space.
 */
export interface CoreLayer {
  /** 1 (the chunk's top) to 32 (its bottom). */
  layer: number
  /** The kind the layer is mostly made of; 0 for a layer that is mostly open space. */
  id: number
  /** What the readout says: "Layer 7: Cinderrock", or "Layer 12: mostly open". */
  line: string
}

/** The core's slices, top of the chunk first, from the card's strata (bottom to top). */
export function coreLayers(strata: Uint8Array): CoreLayer[] {
  const n = strata.length
  return Array.from({ length: n }, (_, i) => {
    const id = strata[n - 1 - i]
    return { layer: i + 1, id, line: `Layer ${i + 1}: ${id ? blockName(id) : 'mostly open'}` }
  })
}

/**
 * The slice under a pointer at `x` on a core that starts at `left` and is
 * `width` wide, 0 to slices - 1: a finger slid past either end keeps the end
 * slice.
 */
export function coreSliceAt(x: number, left: number, width: number, slices: number): number {
  if (!(width > 0) || slices < 1) return 0
  const i = Math.floor(((x - left) / width) * slices)
  return Math.min(slices - 1, Math.max(0, Number.isFinite(i) ? i : 0))
}
