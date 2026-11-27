/**
 * useBlueprintTool.ts - the BLUEPRINT tool in BUILD (design page 4.8): four
 * steps, each on one sheet. ARRANGEMENT (capture a stand-alone build from
 * TERRAIN with RECORD, which leaves the blocks in place, or compose one in a
 * 16 by 16 by 16 cage, placing kinds without spending them), PRIZE (a shard
 * from the workshop or ITEMS), SETTINGS (the three settings) and SEAL.
 * Creating and placing are separate (owner, 2026-11-27): a sealed blueprint
 * waits in ITEMS › BLUEPRINTS until it is placed.
 *
 * The recipe reveal (owner, 2026-11-27): an eye per block type (the main
 * control), a tap on a single block to flip it, and an optional "reveal about
 * N% at random" on top of the type settings. Everything starts revealed.
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'
import { arrangementFrom } from '../lib/blueprint/arrangement'
import { MAX_SIDE, type Arrangement, type LockKind, type PrizeReveal, type PrizeView } from '../lib/blueprint/format'
import { blockName } from '../lib/terrain/blocks'
import type { Position } from '../lib/space'

export type ToolStep = 0 | 1 | 2 | 3

export interface ToolPrize {
  name: string
  shard: ShardModel
  /** Where it came from, for the picker's mark. */
  from: 'workshop' | 'items'
}

export interface BlueprintToolState {
  open: boolean
  step: ToolStep
  arrangement: Arrangement | null
  /** Where the arrangement stood (its box's low corner) or will be built: the place a location lock locks to. */
  place: { lo: Position; plane: number } | null
  /** Waiting in TERRAIN for RECORD. */
  capturing: boolean
  /** The compose cage: block id per cell of 16 by 16 by 16 (x + 16 z + 256 y), the layer shown and the brush (0 erases). */
  cage: Uint16Array
  layer: number
  brush: number
  composing: boolean
  prize: ToolPrize | null
  /** Block types hidden with their eye. */
  typeHidden: ReadonlySet<number>
  /** Single blocks flipped by a tap (scan index). */
  flipped: ReadonlySet<number>
  /** Reveal about this many percent at random, of the blocks whose type is shown (100: no shortcut). */
  randomPct: number
  seed: number
  reveal: PrizeReveal
  views: ReadonlySet<PrizeView>
  text: string
  lock: LockKind
  height: number
  title: string
  sealing: boolean
  error: string | null
  openTool: () => void
  close: () => void
  setStep: (s: ToolStep) => void
  /** RECORD in TERRAIN found a stand-alone build. */
  captured: (a: Arrangement, place: { lo: Position; plane: number }) => void
  set: (p: Partial<BlueprintToolState>) => void
  paint: (x: number, z: number) => void
  /** Use the cage as the arrangement. */
  takeCage: (place: { lo: Position; plane: number }) => string | null
  toggleType: (id: number) => void
  flip: (index: number) => void
  reset: () => void
}

const CAGE = MAX_SIDE
const fresh = (): Pick<BlueprintToolState, 'typeHidden' | 'flipped' | 'randomPct' | 'seed'> => ({ typeHidden: new Set(), flipped: new Set(), randomPct: 100, seed: Math.floor(Math.random() * 1e9) })

export const useBlueprintTool = create<BlueprintToolState>((set, get) => ({
  open: false,
  step: 0,
  arrangement: null,
  place: null,
  capturing: false,
  cage: new Uint16Array(CAGE * CAGE * CAGE),
  layer: 0,
  brush: 1,
  composing: false,
  prize: null,
  ...fresh(),
  reveal: 'hidden',
  views: new Set<PrizeView>(['iso']),
  text: '',
  lock: 'standard',
  height: 8,
  title: '',
  sealing: false,
  error: null,
  openTool: () => set({ open: true, capturing: false, error: null }),
  close: () => set({ open: false, capturing: false, composing: false, error: null }),
  setStep: (step) => set({ step, error: null }),
  captured: (a, place) => set({ arrangement: a, place, capturing: false, composing: false, open: true, step: 1, ...fresh(), error: null }),
  set: (p) => set(p),
  paint: (x, z) => {
    const { cage, layer, brush } = get()
    const next = cage.slice()
    const i = x + CAGE * z + CAGE * CAGE * layer
    next[i] = next[i] === brush ? 0 : brush
    set({ cage: next })
  },
  takeCage: (place) => {
    const blocks: Array<{ at: [number, number, number]; id: number }> = []
    get().cage.forEach((id, i) => { if (id) blocks.push({ at: [i % CAGE, Math.floor(i / (CAGE * CAGE)), Math.floor(i / CAGE) % CAGE], id }) })
    const a = arrangementFrom(blocks)
    if (!a) return 'Place at least one block in the cage.'
    set({ arrangement: a, place, composing: false, step: 1, ...fresh(), error: null })
    return null
  },
  toggleType: (id) => {
    const t = new Set(get().typeHidden)
    if (t.has(id)) t.delete(id)
    else t.add(id)
    // A type's eye sets every block of it: single flips of that type start over.
    const a = get().arrangement
    const flipped = new Set([...get().flipped].filter((i) => a?.cells[i] !== id))
    set({ typeHidden: t, flipped })
  },
  flip: (index) => {
    const f = new Set(get().flipped)
    if (f.has(index)) f.delete(index)
    else f.add(index)
    set({ flipped: f })
  },
  reset: () => set({ ...fresh() }),
}))

/** A steady number in 0 to 1 for a cell and a seed: the random shortcut never reshuffles as the maker toggles. */
function hash01(i: number, seed: number): number {
  let h = (i * 2654435761) ^ seed
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Whether a finder sees this block: its type's eye, then the random shortcut, then a single flip. */
export function shownCell(s: Pick<BlueprintToolState, 'arrangement' | 'typeHidden' | 'flipped' | 'randomPct' | 'seed'>, i: number): boolean {
  const id = s.arrangement?.cells[i] ?? 0
  if (!id) return false
  const base = !s.typeHidden.has(id) && (s.randomPct >= 100 || hash01(i, s.seed) < s.randomPct / 100)
  return s.flipped.has(i) ? !base : base
}

/** The parts list: each block type with its count and how many show. */
export function partsList(s: Pick<BlueprintToolState, 'arrangement' | 'typeHidden' | 'flipped' | 'randomPct' | 'seed'>): Array<{ id: number; count: number; shown: number }> {
  const by = new Map<number, { id: number; count: number; shown: number }>()
  s.arrangement?.cells.forEach((id, i) => {
    if (!id) return
    const row = by.get(id) ?? { id, count: 0, shown: 0 }
    row.count++
    if (shownCell(s, i)) row.shown++
    by.set(id, row)
  })
  return [...by.values()].sort((a, b) => b.count - a.count || a.id - b.id)
}

/** The one-sentence summary (design page 4.5): "Finders see the shape, the Glowcore, and 12 of 40 Gridstone." */
export function revealSummary(parts: ReadonlyArray<{ id: number; count: number; shown: number }>): string {
  const total = parts.reduce((n, p) => n + p.count, 0)
  const shown = parts.reduce((n, p) => n + p.shown, 0)
  if (total > 0 && shown === total) return 'Finders see every block.'
  if (shown === 0) return 'Finders see only the shape.'
  const bits = parts.filter((p) => p.shown > 0).map((p) => {
    const name = blockName(p.id)
    if (p.shown === p.count) return p.count === 1 ? `the ${name}` : `all ${p.count} ${name}`
    return `${p.shown} of ${p.count} ${name}`
  })
  if (bits.length === 1) return `Finders see the shape and ${bits[0]}.`
  return `Finders see the shape, ${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}.`
}
