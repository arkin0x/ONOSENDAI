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
 *   4. The clock is the trusted tip (§4.1): NTH's newest verified anchor
 *      (seedSources.ts), never the stop index, which any key's kind 321 can
 *      fill. NTH publishes a block only once it is 6 deep, so the anchor is
 *      the clock block as it stands, never 6 more below it (seedClock
 *      clockAtAnchor). The planted height is clamped with header times
 *      (seedClock.ts). Until it is settled the seed draws as its axiom,
 *      generation 0 (§4.2).
 *   5. A DNA whose caps could pass this device's budget (bloomBudget.ts) also
 *      draws as its axiom until GROW ANYWAY.
 *   6. The bloom grows and draws in the worker (growJob.ts), a slice at a
 *      time, one request at a time, and comes back as buffers made into a
 *      shard (bloomShard.ts). The hashes that drive its weather come only
 *      from verified headers (the header book: NTH's anchors, the blobs). A
 *      driving block the page lacks leaves it behind, drawn at the
 *      generation it reached (§4.1).
 *
 * Nothing here blocks: every step is a promise, and the worker does the
 * arithmetic. The engine takes its sources as arguments so a test can run it
 * against mock relays and injected headers.
 */

import { BLOCKS_PER_GENERATION, targetGeneration, workOk, type BloomGrowth } from 'sno-core/seeds'
import type { ShardModel } from 'sno-core/shards'
import type { SeedItem } from './seedItem'
import type { DnaResolver, DnaVerdict } from './dnaStore'
import type { HeaderBook } from './headerBook'
import { clockAtAnchor, settlePlanted, type HeaderFetch } from './seedClock'
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
  /** The DNA, once resolved and valid; `generations` is its caps' days of growth, for a row's "day 12 of 41". */
  dna?: { id: string; name: string; author: string; price: number; generations: number }
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
  /** The trusted tip: the height of NTH's newest verified anchor, already 6 deep (seedClock clockAtAnchor), or null before one is known. */
  tip: () => number | null
  /** One request to the seeds worker (growClient growInWorker). */
  grow: (req: Omit<GrowRequest, 'id' | 'type'>) => Promise<SeedsResponse>
  /** Let the worker drop what it keeps for seeds no longer wanted (growClient forgetInWorker). */
  forget?: (ids: string[]) => void
  /** This device's step budget (bloomBudget deviceBudget). */
  budget: number
  /** Told whenever a seed's view changes. */
  onView: (id: string, view: BloomView) => void
}

/** The heights of the blocks that drive a bloom's generations up to the clock's (§4.1). */
export function drivingHeights(planting: PlantingWire, clock: number): number[] {
  if (planting.planted === null) return []
  const g = targetGeneration({ coord: planting.coord, planted: planting.planted, scale: planting.scale, caps: planting.caps }, clock)
  const out: number[] = []
  for (let k = 1; k <= g; k++) out.push(planting.planted + k * BLOCKS_PER_GENERATION)
  return out
}

/** The hashes of the driving blocks, as far as the page holds them. */
export function drivingHashes(planting: PlantingWire, clock: number, hash: (h: number) => string | null | undefined): Record<number, string> {
  const out: Record<number, string> = {}
  for (const h of drivingHeights(planting, clock)) {
    const hex = hash(h)
    if (typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)) out[h] = hex
  }
  return out
}

/** The driving hashes in one short string, for telling whether a bloom drawn before was drawn from the same weather. */
function weatherPrint(hashes: Record<number, string>): string {
  return Object.keys(hashes).map(Number).sort((a, b) => a - b).map((h) => `${h}:${hashes[h].slice(-16)}`).join(',')
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

  /** Forget seeds no longer wanted, here and in the worker. */
  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.seeds.delete(id)
      this.views.delete(id)
      this.drawnFor.delete(id)
      this.anyway.delete(id)
    }
    this.deps.forget?.([...ids])
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
          try {
            await this.pass(id)
          } catch (e) {
            // Never left reading or growing for good: the card says it did not grow.
            const v = this.views.get(id)
            this.set(id, { ...(v ?? { seedId: id }), status: 'error', error: e instanceof Error ? e.message : String(e) })
          }
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
      const status = dnaStatus(verdict)
      const error = verdict.state === 'invalid' ? verdict.error : undefined
      // Asked again on a timer while its DNA is missing: a view that says the same is not written again.
      const now = this.views.get(id)
      if (now && now.status === status && now.error === error && !now.shard) return
      this.set(id, { seedId: id, status, ...(error !== undefined ? { error } : {}) })
      return
    }
    const dna = { id: verdict.id, name: verdict.name, author: verdict.author, price: verdict.price, generations: verdict.caps.generations }
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
    const clock = clockAtAnchor(tip)
    const planted = await settlePlanted(seed.planted, seed.createdAt, clock, this.deps.book, this.deps.fetchHeaders)
    if (planted.state === 'cannot-grow') {
      this.set(id, { seedId: id, status: 'cannot-grow', dna, clock })
      return
    }
    const settled = planted.state === 'settled' ? planted.height : null
    const heavy = tooHeavy(verdict.caps, this.deps.budget) && !this.anyway.has(id)
    const planting: PlantingWire = { coord: seed.coord, planted: heavy ? null : settled, scale: seed.scale, caps: verdict.caps }
    // The weather only from verified headers: fetched for the driving heights the book lacks.
    const lacking = drivingHeights(planting, clock).filter((h) => !this.deps.book.hash(h))
    if (lacking.length > 0) await this.deps.fetchHeaders(lacking)
    const hashes = drivingHashes(planting, clock, (h) => this.deps.book.hash(h))
    const status: BloomStatus = heavy ? 'heavy' : settled === null ? (planted.state === 'pending' && planted.waiting ? 'waiting' : 'pending') : 'grown'
    const base: BloomView = { seedId: id, status, dna, clock, ...(settled !== null ? { planted: settled } : {}) }
    // The same planting, the same weather, and the same block (an axiom is the
    // same at every block): the bloom drawn is already right.
    const drawKey = `${verdict.id}|${planting.planted ?? 'axiom'}|${planting.planted === null ? '' : clock}|${weatherPrint(hashes)}`
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

  /**
   * One bloom through the worker, slice after slice, each slice queued behind
   * the other blooms'. It ends: a seed forgotten meanwhile stops it, and a
   * slice that made no progress (its string pushed out of the worker's
   * memory between slices) is followed by one call that grows it whole.
   */
  private async growAll(req: Omit<GrowRequest, 'id' | 'type'>): Promise<SeedsResponse> {
    let last = -1
    let ask = req
    for (;;) {
      if (!this.seeds.has(req.key)) return { type: 'error', id: 0, key: req.key, error: 'No longer wanted.' }
      const answer = await this.enqueue(() => this.deps.grow(ask))
      if (answer.type !== 'partial') return answer
      if (answer.generation <= last) ask = { ...req, maxSteps: Number.MAX_SAFE_INTEGER }
      last = answer.generation
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => undefined)
    return run
  }
}
