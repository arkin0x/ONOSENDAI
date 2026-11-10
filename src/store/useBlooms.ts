/**
 * useBlooms.ts - the blooms of the seeds in view (DECK-0008), for the scene
 * and the bloom card.
 *
 * The work is the engine's (lib/seeds/bloomEngine.ts); this store holds what
 * React renders: one BloomView per seed, by the seed's id. The engine looks
 * at its seeds again when the tip of the Bitcoin line moves (a block is a
 * day's 144th of growth), when a DNA arrives, and when the hyperspace index
 * gains hashes a bloom behind was waiting for.
 */

import { create } from 'zustand'
import { BloomEngine, type BloomView } from '../lib/seeds/bloomEngine'
import { dnaResolver, fetchSeedHeaders, headerBook } from '../lib/seeds/seedSources'
import { deviceBudget, looksLikePhone } from '../lib/seeds/bloomBudget'
import { growInWorker } from '../lib/seeds/growClient'
import type { SeedItem } from '../lib/seeds/seedItem'
import { getStopByHeight, useHyperspace } from './useHyperspace'

interface BloomsState {
  views: Record<string, BloomView>
}

export const useBlooms = create<BloomsState>(() => ({ views: {} }))

/** How often a change in the hyperspace index may send blooms behind back to the worker. */
const INDEX_REFRESH_MS = 3_000
/** The most seeds kept; the oldest wanted are forgotten first. */
export const BLOOMS_KEPT = 256

let engine: BloomEngine | null = null

function getEngine(): BloomEngine {
  if (engine) return engine
  const made = new BloomEngine({
    dna: dnaResolver,
    book: headerBook,
    fetchHeaders: fetchSeedHeaders,
    tip: () => useHyperspace.getState().tipHeight,
    indexHash: (h) => getStopByHeight(h)?.blockHash,
    grow: growInWorker,
    budget: deviceBudget(looksLikePhone()),
    onView: (id, view) => useBlooms.setState((s) => ({ views: { ...s.views, [id]: view } })),
  })
  engine = made
  // A new block: every bloom grows by a block, and pending seeds may settle.
  let tip = useHyperspace.getState().tipHeight
  useHyperspace.subscribe((s) => {
    if (s.tipHeight === tip) return
    tip = s.tipHeight
    made.refreshAll()
  })
  // A DNA arrived from a bag or a relay.
  dnaResolver.onChange(() => made.refreshAll((v) => !v || v.status === 'reading' || v.status === 'dna-missing'))
  // Hashes for a bloom that is behind, at most every few seconds.
  let indexTimer: ReturnType<typeof setTimeout> | null = null
  let indexVersion = useHyperspace.getState().indexVersion
  useHyperspace.subscribe((s) => {
    if (s.indexVersion === indexVersion || indexTimer) return
    indexVersion = s.indexVersion
    indexTimer = setTimeout(() => {
      indexTimer = null
      made.refreshAll((v) => !!v?.growth?.behind)
    }, INDEX_REFRESH_MS)
  })
  return made
}

/** Grow these seeds' blooms, as far as each can go. */
export function wantSeeds(seeds: readonly SeedItem[]): void {
  if (seeds.length === 0) return
  const e = getEngine()
  e.want(seeds)
  const all = e.wanted()
  if (all.length > BLOOMS_KEPT) {
    const keep = new Set(seeds.map((s) => s.id))
    const drop = all.filter((id) => !keep.has(id)).slice(0, all.length - BLOOMS_KEPT)
    e.forget(drop)
    useBlooms.setState((s) => {
      const views = { ...s.views }
      for (const id of drop) delete views[id]
      return { views }
    })
  }
}

/** GROW ANYWAY: grow this seed past the device's budget. */
export function growAnyway(seedId: string): void {
  getEngine().growAnyway(seedId)
}
