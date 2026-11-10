/**
 * bloomEngine.ts - from a seed found in a bag to a bloom the scene draws.
 *
 * For each seed the view wants (DECK-0008 §8.2, §4, §5):
 *
 *   1. The seed was read with every check before its DNA (seedItem.ts), the
 *      NIP-13 precheck included, so only a seed that paid the base price
 *      gets this far.
 *   2. Its DNA is resolved by id (dnaStore.ts). A mixed DNA is shown as
 *      coming soon; one missing or refused says so.
 *   3. Its work is checked against its DNA's price (sno-core workOk): a seed
 *      that paid less than its DNA asks is skipped, never grown (§7).
 *   4. The clock is the tip of the Bitcoin line minus 6 (§4.1), and the
 *      planted height is clamped with header times (seedClock.ts). Until it
 *      is settled the seed draws as its axiom, generation 0 (§4.2).
 *   5. A DNA whose caps could pass this device's budget (bloomBudget.ts) also
 *      draws as its axiom until GROW ANYWAY.
 *   6. The bloom grows and draws in the worker (growJob.ts), a slice at a
 *      time, one request at a time, and comes back as buffers made into a
 *      shard (bloomShard.ts). A driving block the page lacks leaves it
 *      behind, drawn at the generation it reached (§4.1).
 *
 * Nothing here blocks: every step is a promise, and the worker does the
 * arithmetic. The engine takes its sources as arguments so a test can run it
 * against mock relays and injected headers.
 */

import { BLOCKS_PER_GENERATION, clockHeight, targetGeneration, workOk, type BloomGrowth } from 'sno-core/seeds'
import type { ShardModel } from 'sno-core/shards'
import type { SeedItem } from './seedItem'
import type { DnaResolver, DnaVerdict } from './dnaStore'
import type { HeaderBook } from './headerBook'
import { settlePlanted, type HeaderFetch } from './seedClock'
import { SLICE_STEPS, tooHeavy } from './bloomBudget'
import { bloomShard } from './bloomShard'
import type { GrowRequest, PlantingWire, SeedsResponse } from './growJob'

/** Where a seed is on its way to a bloom. The card says each in a few words (bloomWords). */
export type BloomStatus =
  | 'reading'
  | 'dna-missing'
  | 'dna-invalid'
  | 'mixed'
  | 'underpaid'
  | 'no-clock'
  | 'pending'
  | 'waiting'
  | 'cannot-grow'
  | 'heavy'
  | 'growing'
  | 'grown'
  | 'error'

/** What the scene and the card know of one seed's bloom. */
export interface BloomView {
  seedId: string
  status: BloomStatus
  /** The DNA, once resolved and valid. */
  dna?: { id: string; name: string; author: string; price: number }
  /** Why the DNA was refused, or growth failed. */
  error?: string
  clock?: number
  /** The effective planted height, once settled. */
  planted?: number
  growth?: BloomGrowth
  /** What the scene draws: the bloom, or its axiom while pending or too heavy. */
  shard?: ShardModel
}

export interface BloomDeps {
  dna: Pick<DnaResolver, 'resolve' | 'verdict'>
  book: HeaderBook
  fetchHeaders: HeaderFetch
  /** The best tip height of the Bitcoin line, or null before it is known. */
  tip: () => number | null
  /** A block hash from the hyperspace index, by height. */
  indexHash: (height: number) => string | null | undefined
  /** One request to the seeds worker (growClient growInWorker). */
  grow: (req: Omit<GrowRequest, 'id' | 'type'>) => Promise<SeedsResponse>
  /** This device's step budget (bloomBudget deviceBudget). */
  budget: number
  /** Told whenever a seed's view changes. */
  onView: (id: string, view: BloomView) => void
}

/** The hashes of the blocks that drive a bloom's generations (§4.1), as far as the page holds them. */
export function drivingHashes(planting: PlantingWire, clock: number, hash: (h: number) => string | null | undefined): Record<number, string> {
  const out: Record<number, string> = {}
  if (planting.planted === null) return out
  const g = targetGeneration({ coord: planting.coord, planted: planting.planted, scale: planting.scale, caps: planting.caps }, clock)
  for (let k = 1; k <= g; k++) {
    const h = planting.planted + k * BLOCKS_PER_GENERATION
    const hex = hash(h)
    if (typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)) out[h] = hex
  }
  return out
}

function dnaStatus(v: DnaVerdict): BloomStatus {
  return v.state === 'mixed' ? 'mixed' : v.state === 'missing' ? 'dna-missing' : v.state === 'invalid' ? 'dna-invalid' : 'reading'
}

export class BloomEngine {
  private seeds = new Map<string, SeedItem>()
  private views = new Map<string, BloomView>()
  private anyway = new Set<string>()
  private running = new Map<string, Promise<void>>()
  private dirty = new Set<string>()
  /** What each drawn bloom was drawn for, so the same block is not drawn twice. */
  private drawnFor = new Map<string, string>()
  /** Worker requests, one at a time. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private deps: BloomDeps) {}

  view(id: string): BloomView | undefined { return this.views.get(id) }

  /** Grow these seeds (as far as each can), starting any not seen before. */
  want(seeds: readonly SeedItem[]): void {
    for (const s of seeds) {
      if (this.seeds.has(s.id)) continue
      this.seeds.set(s.id, s)
      void this.refresh(s.id)
    }
  }

  /** GROW ANYWAY: grow a seed past this device's budget. */
  growAnyway(id: string): void {
    this.anyway.add(id)
    void this.refresh(id)
  }

  /** Look at every seed again: the tip moved, a DNA arrived, headers or hashes came in. */
  refreshAll(only?: (v: BloomView | undefined) => boolean): void {
    for (const id of this.seeds.keys()) if (!only || only(this.views.get(id))) void this.refresh(id)
  }

  /** Forget seeds no longer wanted, keeping at most `keep` (the newest wanted). */
  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.seeds.delete(id)
      this.views.delete(id)
      this.drawnFor.delete(id)
    }
  }

  wanted(): string[] { return [...this.seeds.keys()] }

  /**
   * Run one seed's pass. A pass asked for while one runs runs again after it,
   * and the promise is that run's: it settles once the seed is up to date.
   */
  refresh(id: string): Promise<void> {
    const running = this.running.get(id)
    if (running) { this.dirty.add(id); return running }
    const run = (async () => {
      try {
        do {
          this.dirty.delete(id)
          await this.pass(id)
        } while (this.dirty.has(id))
      } finally {
        this.running.delete(id)
      }
    })()
    this.running.set(id, run)
    return run
  }

  private set(id: string, view: BloomView): void {
    if (!this.seeds.has(id)) return
    this.views.set(id, view)
    this.deps.onView(id, view)
  }

  private async pass(id: string): Promise<void> {
    const seed = this.seeds.get(id)
    if (!seed) return
    const was = this.views.get(id)
    if (!was) this.set(id, { seedId: id, status: 'reading' })
    const verdict = await this.deps.dna.resolve(seed.dnaId)
    if (verdict.state !== 'ok') {
      this.set(id, { seedId: id, status: dnaStatus(verdict), ...(verdict.state === 'invalid' ? { error: verdict.error } : {}) })
      return
    }
    const dna = { id: verdict.id, name: verdict.name, author: verdict.author, price: verdict.price }
    // §7: the committed target and the id's work, at the DNA's own price.
    if (!workOk({ id: seed.id, tags: seed.tags }, verdict.price)) {
      this.set(id, { seedId: id, status: 'underpaid', dna })
      return
    }
    const tip = this.deps.tip()
    if (tip === null) {
      this.set(id, { seedId: id, status: 'no-clock', dna })
      return
    }
    const clock = clockHeight(tip)
    const planted = await settlePlanted(seed.planted, seed.createdAt, clock, this.deps.book, this.deps.fetchHeaders)
    if (planted.state === 'cannot-grow') {
      this.set(id, { seedId: id, status: 'cannot-grow', dna, clock })
      return
    }
    const settled = planted.state === 'settled' ? planted.height : null
    const heavy = tooHeavy(verdict.caps, this.deps.budget) && !this.anyway.has(id)
    const planting: PlantingWire = { coord: seed.coord, planted: heavy ? null : settled, scale: seed.scale, caps: verdict.caps }
    const hash = (h: number): string | null | undefined => this.deps.book.hash(h) ?? this.deps.indexHash(h)
    const hashes = drivingHashes(planting, clock, hash)
    const status: BloomStatus = heavy ? 'heavy' : settled === null ? (planted.state === 'pending' && planted.waiting ? 'waiting' : 'pending') : 'grown'
    const base: BloomView = { seedId: id, status, dna, clock, ...(settled !== null ? { planted: settled } : {}) }
    // The same block, the same planting, the same hashes: the bloom drawn is already right.
    const drawKey = `${verdict.id}|${clock}|${planting.planted}|${Object.keys(hashes).length}`
    const prev = this.views.get(id)
    if (this.drawnFor.get(id) === drawKey && prev?.shard) {
      if (prev.status !== status) this.set(id, { ...prev, ...base, growth: prev.growth, shard: prev.shard })
      return
    }
    if (status === 'grown' && prev?.status !== 'grown') this.set(id, { ...base, status: 'growing', ...(prev?.shard ? { shard: prev.shard } : {}) })
    const answer = await this.growAll({ key: seed.id, dna: verdict.text, seed: planting, clock, hashes, maxSteps: SLICE_STEPS })
    if (answer.type === 'error') {
      this.set(id, { ...base, status: 'error', error: answer.error })
      return
    }
    if (answer.type !== 'bloom') return
    this.drawnFor.set(id, drawKey)
    const shard = bloomShard(answer.buffers, verdict.name, seed.scale, `bloom:${seed.id}:${clock}:${answer.growth.generation}:${planting.planted ?? 'axiom'}`)
    this.set(id, { ...base, growth: answer.growth, shard })
  }

  /** One bloom through the worker, slice after slice, each slice queued behind the other blooms'. */
  private async growAll(req: Omit<GrowRequest, 'id' | 'type'>): Promise<SeedsResponse> {
    for (;;) {
      const answer = await this.enqueue(() => this.deps.grow(req))
      if (answer.type !== 'partial') return answer
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => undefined)
    return run
  }
}
