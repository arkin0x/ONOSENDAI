/**
 * growJob.ts - what the seeds worker does: grow blooms, draw them, and read
 * header times out of a header blob. Pure apart from the blob's bytes, so the
 * tests run it inline exactly as the worker does (workers/seeds.worker.ts).
 *
 * A bloom grows once per generation and draws once per block (DECK-0008
 * §4.6, §4.7): the grown string is kept here per seed id, and each request
 * grows it on from where it was (sno-core growSymbols `{ from }`) and draws
 * it at the request's clock. The DNA crosses the boundary as its text and is
 * parsed here: a parsed DNA holds compiled functions and cannot be cloned.
 * Geometry goes back as typed arrays in the transfer list, never cloned.
 *
 * One request grows at most `maxSteps` symbol steps. A bloom that needs more
 * comes back `partial`, undrawn, and the page asks again after the others
 * had their turn; growth resumes where it stopped.
 */

import {
  bloomTransferList,
  drawBloom,
  growSymbols,
  growthApplies,
  tryParseDna,
  type BloomBuffers,
  type BloomGrowth,
  type Caps,
  type Dna,
  type GrownSymbols,
  type SeedPlanting,
} from 'sno-core/seeds'
import { blobChainTimes } from './headerBook'

/** A seed's planting as it crosses to the worker. */
export interface PlantingWire {
  coord: string
  /** The effective planted height, or null while it is not settled (drawn at generation 0). */
  planted: number | null
  scale: number
  caps: Caps
}

export interface GrowRequest {
  type: 'grow'
  /** Answers carry it back. */
  id: number
  /** The seed's event id: what its grown string is kept by. */
  key: string
  /** The DNA's SEEDO text. */
  dna: string
  seed: PlantingWire
  clock: number
  /** The hashes of the driving blocks the page holds, by height (§4.1). One it lacks leaves the bloom behind. */
  hashes: Record<number, string>
  /** The most symbol steps this request may take (bloomBudget SLICE_STEPS). */
  maxSteps: number
}

export interface BlobTimesRequest {
  type: 'blob-times'
  id: number
  url: string
  sha256: string
  startHeight: number
  count: number
  /** The display hash of the block before the blob: its linkage seed. */
  prevHash: string
  /** The manifest's checkpoint for the blob's last block. */
  finalHash: string
}

export interface ForgetRequest {
  type: 'forget'
  keys: string[]
}

export type SeedsRequest = GrowRequest | BlobTimesRequest | ForgetRequest

export type SeedsResponse =
  | { type: 'bloom'; id: number; key: string; growth: BloomGrowth; buffers: BloomBuffers }
  | { type: 'partial'; id: number; key: string; generation: number; targetGeneration: number }
  | { type: 'error'; id: number; key: string; error: string }
  | { type: 'blob-times'; id: number; startHeight: number; times: Uint32Array | null; error?: string }

/** Grown strings kept, least recently used first out. Each is at most a symbol cap of symbols. */
export const GROWN_KEPT = 64
/** Parsed DNAs kept by text. */
const PARSED_KEPT = 32

/** One worker's memory: parsed DNAs and grown strings. */
export class GrowCache {
  readonly grown = new Map<string, GrownSymbols>()
  private parsed = new Map<string, Dna>()

  dna(text: string): Dna | string {
    const hit = this.parsed.get(text)
    if (hit) {
      this.parsed.delete(text)
      this.parsed.set(text, hit)
      return hit
    }
    const read = tryParseDna(text)
    if (!read.ok) return read.error
    this.parsed.set(text, read.dna)
    while (this.parsed.size > PARSED_KEPT) this.parsed.delete(this.parsed.keys().next().value as string)
    return read.dna
  }

  keep(key: string, g: GrownSymbols): void {
    this.grown.delete(key)
    this.grown.set(key, g)
    while (this.grown.size > GROWN_KEPT) this.grown.delete(this.grown.keys().next().value as string)
  }

  forget(keys: readonly string[]): void {
    for (const k of keys) this.grown.delete(k)
  }
}

/** A planting as the engine takes it. */
export function plantingOf(w: PlantingWire): SeedPlanting {
  return { coord: w.coord, planted: w.planted, scale: w.scale, caps: w.caps }
}

/**
 * Grow and draw one bloom. The answer and the buffers to transfer with it.
 * Never throws: an invalid DNA, an axiom over the symbol cap or a malformed
 * coordinate comes back as an error.
 */
export function handleGrow(req: GrowRequest, cache: GrowCache): { answer: SeedsResponse; transfer: ArrayBuffer[] } {
  const fail = (error: string): { answer: SeedsResponse; transfer: ArrayBuffer[] } => ({ answer: { type: 'error', id: req.id, key: req.key, error }, transfer: [] })
  const dna = cache.dna(req.dna)
  if (typeof dna === 'string') return fail(dna)
  const seed = plantingOf(req.seed)
  const hash = (h: number): string | undefined => req.hashes[h]
  try {
    const from = cache.grown.get(req.key)
    const grown = growSymbols(dna, seed, req.clock, hash, { ...(from ? { from } : {}), maxSteps: req.maxSteps })
    cache.keep(req.key, grown)
    if (grown.stopped === 'budget') {
      return { answer: { type: 'partial', id: req.id, key: req.key, generation: grown.generation, targetGeneration: grown.targetGeneration }, transfer: [] }
    }
    // Checked before every draw (sno-core README): a string kept while the
    // seed was unsettled stops applying the moment it settles.
    if (!growthApplies(grown, dna, seed, req.clock)) {
      cache.forget([req.key])
      return fail('The grown string no longer applies.')
    }
    const drawn = drawBloom(dna, grown, seed, req.clock, { payload: false, json: false, buffers: true })
    const buffers = drawn.buffers!
    const growth: BloomGrowth = {
      age: drawn.age,
      generation: drawn.generation,
      targetGeneration: drawn.targetGeneration,
      behind: drawn.behind,
      ...(drawn.stopped ? { stopped: drawn.stopped } : {}),
      ...(drawn.missingBlock !== undefined ? { missingBlock: drawn.missingBlock } : {}),
      symbols: drawn.symbols,
      weatherBlocks: drawn.weatherBlocks,
    }
    return { answer: { type: 'bloom', id: req.id, key: req.key, growth, buffers }, transfer: bloomTransferList(buffers) }
  } catch (e) {
    cache.forget([req.key])
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/** Where a blob's bytes come from: the Cache API the header sync fills, else the network. Replaced in tests. */
export type BlobLoader = (url: string, sha256: string) => Promise<Uint8Array>

/** The header times of one blob, its chain checked against its checkpoint (headerBook blobChainTimes). */
export async function handleBlobTimes(req: BlobTimesRequest, load: BlobLoader): Promise<{ answer: SeedsResponse; transfer: ArrayBuffer[] }> {
  try {
    const bytes = await load(req.url, req.sha256)
    const times = blobChainTimes(bytes, req.count, req.prevHash, req.finalHash)
    if (!times) return { answer: { type: 'blob-times', id: req.id, startHeight: req.startHeight, times: null, error: 'The blob does not chain to its checkpoint.' }, transfer: [] }
    return { answer: { type: 'blob-times', id: req.id, startHeight: req.startHeight, times }, transfer: [times.buffer as ArrayBuffer] }
  } catch (e) {
    return { answer: { type: 'blob-times', id: req.id, startHeight: req.startHeight, times: null, error: e instanceof Error ? e.message : String(e) }, transfer: [] }
  }
}
