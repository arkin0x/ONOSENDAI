/**
 * useBlooms.ts - the blooms of the seeds in view (DECK-0008), for the scene
 * and the bloom card.
 *
 * The work is the engine's (lib/seeds/bloomEngine.ts); this store holds what
 * React renders: one BloomView per seed, by the seed's id, updated at most
 * once a frame however many blooms change. The engine looks at its seeds
 * again whenever the trusted tip moves (NTH's newest verified anchor: a block
 * is a 144th of a day's growth) and when a DNA arrives. The hyperspace line's
 * own tip is only a hint that a block came and NTH should be asked.
 */

import { create } from 'zustand'
import { BloomEngine, type BloomView } from '../lib/seeds/bloomEngine'
import { dnaResolver, fetchSeedHeaders, headerBook, refreshTrustedTip, trustedTip, TIP_REFRESH_MS } from '../lib/seeds/seedSources'
import { deviceBudget, looksLikePhone } from '../lib/seeds/bloomBudget'
import { MISSING_RETRY_MS } from '../lib/seeds/dnaStore'
import { forgetInWorker, growInWorker } from '../lib/seeds/growClient'
import type { SeedItem } from '../lib/seeds/seedItem'
import { useHyperspace } from './useHyperspace'

interface BloomsState {
  views: Record<string, BloomView>
}

export const useBlooms = create<BloomsState>(() => ({ views: {} }))

/** The most seeds kept; the oldest wanted are forgotten first. The worker keeps as many grown strings (growJob GROWN_KEPT). */
export const BLOOMS_KEPT = 128

let engine: BloomEngine | null = null

/** Views changed since the last frame, written to the store together. */
const changed = new Map<string, BloomView>()
let flushQueued = false
function flush(): void {
  flushQueued = false
  if (changed.size === 0) return
  const batch = new Map(changed)
  changed.clear()
  useBlooms.setState((s) => {
    const views = { ...s.views }
    for (const [id, v] of batch) views[id] = v
    return { views }
  })
}
function queueView(id: string, view: BloomView): void {
  changed.set(id, view)
  if (flushQueued) return
  flushQueued = true
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else setTimeout(flush, 0)
}

function getEngine(): BloomEngine {
  if (engine) return engine
  const made = new BloomEngine({
    dna: dnaResolver,
    book: headerBook,
    fetchHeaders: fetchSeedHeaders,
    tip: trustedTip,
    grow: growInWorker,
    forget: forgetInWorker,
    budget: deviceBudget(looksLikePhone()),
    onView: queueView,
  })
  engine = made
  // A new trusted tip: every bloom grows by a block, and pending seeds may settle.
  let tip = trustedTip()
  const ask = (): void => {
    void refreshTrustedTip(useHyperspace.getState().tipHeight).then((t) => {
      if (t === tip) return
      tip = t
      made.refreshAll()
    })
  }
  ask()
  // The hyperspace line hearing of a block is the cue to ask NTH; a timer covers a line that hears nothing.
  useHyperspace.subscribe((s, before) => { if (s.tipHeight !== before.tipHeight) ask() })
  if (typeof setInterval === 'function') setInterval(ask, TIP_REFRESH_MS)
  // A DNA arrived from a bag or a relay.
  dnaResolver.onChange(() => made.refreshAll((v) => !v || v.status === 'reading' || v.status === 'dna-missing'))
  // A DNA not found is asked for again on the resolver's backoff (15 s doubling to two minutes), not only at the next block.
  if (typeof setInterval === 'function') setInterval(() => made.refreshAll((v) => v?.status === 'dna-missing'), MISSING_RETRY_MS)
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
    for (const id of drop) changed.delete(id)
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
