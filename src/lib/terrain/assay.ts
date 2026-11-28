/**
 * assay.ts - the survey card's numbers (owner, 2026-11-27: "survey card
 * sounds excellent"): what one chunk holds, as a list, never where.
 *
 * Players could not find Glowcore or Cinderrock: a survey fills the whole
 * 32 by 32 by 32 chunk, but only faces open to the air are seen, so a rare
 * block buried inside goes unnoticed. The card says what is there and
 * whether any of it shows, and leaves the finding to you.
 *
 * - assayBlocks: one pass over the chunk's 32,768 cells (what stands now:
 *   the ground with every layer merged over it, world.ts ChunkSlot.blocks),
 *   counting each kind, marking a kind seen when one of its blocks has a face
 *   the scene draws (open space beside it, or a see-through or walk-through
 *   block of another kind: the mesher's own rule, blocks.ts clearTable), and
 *   the kind most of each of the 32 layers is made of, for the card's strata.
 *   A face on the chunk's edge looks at the next chunk's cell, open space
 *   where that chunk is not loaded or not surveyed (as world.ts draws it).
 * - chunkAssay: the same, kept per chunk and per version of it and of its six
 *   neighbours, so opening the card again costs nothing and nothing counts per
 *   frame.
 * - surveyCard: the card itself: the ground type with its signature rock,
 *   every kind sorted rarest first, the hardness (terrain K, plainly named)
 *   and a gentle line for each recipe block that is here.
 *
 * Pure: nothing here reads a store or the clock.
 */

import { CELLS } from './coords'
import { blockName, clearTable } from './blocks'
import type { ChunkSlot, TerrainWorld } from './world'
import { NEIGHBOURS } from './world'
import { COMPILER_RECIPE, QUARRY_CHARGE_RECIPE, recipeNeeds } from '../blueprint/recipes'

/** What one pass over a chunk finds. */
export interface Assay {
  /** Blocks of each id, 0 to 255 (index 0, open space, is counted too). */
  counts: Uint32Array
  /** 1 for each id with at least one face the scene draws. */
  seen: Uint8Array
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
 * One pass over `blocks`. `around` holds the six neighbours' blocks in
 * world.ts NEIGHBOURS order (-x, +x, -y, +y, -z, +z), null for open space.
 */
export function assayBlocks(blocks: Uint8Array, around: ReadonlyArray<Uint8Array | null> = []): Assay {
  runs++
  clears ??= clearTable()
  const ct = clears
  const counts = new Uint32Array(256)
  const seen = new Uint8Array(256)
  const layer = new Uint16Array(32 * 256)
  const open = (id: number, n: number): boolean => n === 0 || (ct[n] === 1 && n !== id)
  const nx0 = around[0] ?? null, nx1 = around[1] ?? null, ny0 = around[2] ?? null, ny1 = around[3] ?? null, nz0 = around[4] ?? null, nz1 = around[5] ?? null
  for (let o = 0; o < CELLS; o++) {
    const id = blocks[o]
    counts[id]++
    if (id === 0) continue
    const x = o & 31, z = (o >> 5) & 31, y = o >> 10
    layer[(y << 8) | id]++
    if (seen[id]) continue
    // The six faces: inside the chunk the cell beside it, on an edge the next chunk's (open space where it has none).
    if ((x > 0 ? open(id, blocks[o - 1]) : open(id, nx0 ? nx0[o + 31] : 0))
      || (x < 31 ? open(id, blocks[o + 1]) : open(id, nx1 ? nx1[o - 31] : 0))
      || (y > 0 ? open(id, blocks[o - 1024]) : open(id, ny0 ? ny0[o + 31 * 1024] : 0))
      || (y < 31 ? open(id, blocks[o + 1024]) : open(id, ny1 ? ny1[o - 31 * 1024] : 0))
      || (z > 0 ? open(id, blocks[o - 32]) : open(id, nz0 ? nz0[o + 31 * 32] : 0))
      || (z < 31 ? open(id, blocks[o + 32]) : open(id, nz1 ? nz1[o - 31 * 32] : 0))) seen[id] = 1
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
  return { counts, seen, strata }
}

/** The six neighbours' blocks of a loaded chunk, in NEIGHBOURS order: null where none is held. */
export function neighbourBlocks(world: TerrainWorld, slot: ChunkSlot): Array<Uint8Array | null> {
  return NEIGHBOURS.map(([dx, dy, dz]) => world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)?.blocks ?? null)
}

/** Kept passes, by chunk key: its stamp (its version and its neighbours') and the pass. */
const kept = new Map<string, { world: TerrainWorld; stamp: string; assay: Assay }>()
/** How many chunks' passes are kept at once. */
export const ASSAYS_KEPT = 12

/** For tests: forget every kept pass. */
export function forgetAssays(): void {
  kept.clear()
}

/**
 * The pass for a loaded chunk, worked out once per version of it and of its
 * neighbours (a block mined or placed, a layer arriving, a neighbour coming or
 * going all change a version), else the kept one. Null before it has blocks.
 */
export function chunkAssay(world: TerrainWorld, slot: ChunkSlot): Assay | null {
  const blocks = slot.blocks
  if (!blocks) return null
  const around = NEIGHBOURS.map(([dx, dy, dz]) => world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz))
  const stamp = `${slot.revision ?? 2}|${slot.version}|${around.map((n) => (n?.blocks ? n.version : '-')).join(',')}`
  const k = kept.get(slot.key)
  if (k && k.world === world && k.stamp === stamp) return k.assay
  const assay = assayBlocks(blocks, around.map((n) => n?.blocks ?? null))
  kept.delete(slot.key)
  kept.set(slot.key, { world, stamp, assay })
  while (kept.size > ASSAYS_KEPT) kept.delete(kept.keys().next().value as string)
  return assay
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

/** One line of the card's list. */
export interface CardRow {
  id: number
  name: string
  count: number
  /** At least one face is open to the air (or behind glass or water). */
  visible: boolean
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
  /** Blocks in the chunk, every kind. */
  total: number
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
 * so it gets none): "Glowcore here: the Compiler needs one." With the
 * Compiler made already, the Compiler's needs are left out.
 */
export function recipeNotes(present: ReadonlyArray<number>, ownsCompiler: boolean): string[] {
  const out: string[] = []
  for (const id of present) {
    if (COMMON.has(id)) continue
    const uses = RECIPES.filter((r) => (r.needs[id] ?? 0) > 0 && !(r.tool === 'compiler' && ownsCompiler))
    if (uses.length === 0) continue
    const parts = uses.map((r, i) => (i === 0 ? `${r.name} needs ${word(r.needs[id])}` : `${r.name} ${word(r.needs[id])}`))
    out.push(`${blockName(id)} here: ${parts.join(' and ')}.`)
  }
  return out
}

/** The survey card for a chunk's pass and its ground's facts. */
export function surveyCard(assay: Assay, facts: GroundFacts | null | undefined, opts: { ownsCompiler?: boolean } = {}): SurveyCardData {
  const rows: CardRow[] = []
  let total = 0
  for (let id = 1; id < 256; id++) {
    const n = assay.counts[id]
    if (!n) continue
    total += n
    rows.push({ id, name: blockName(id), count: n, visible: assay.seen[id] === 1, prized: PRIZED.has(id) })
  }
  rows.sort((a, b) => rankOf(a.id) - rankOf(b.id))
  const look = facts ? GROUND_LOOK[facts.family] : undefined
  const ground = facts ? { family: facts.family, name: look?.name ?? facts.family.charAt(0).toUpperCase() + facts.family.slice(1), rock: look?.rock ?? facts.top } : null
  return {
    ground,
    hardness: facts ? { max: facts.maxK, mean: facts.meanK } : null,
    finds: rows.filter((r) => !COMMON.has(r.id)),
    common: rows.filter((r) => COMMON.has(r.id)),
    notes: recipeNotes(rows.map((r) => r.id), !!opts.ownsCompiler),
    strata: assay.strata,
    total,
  }
}
