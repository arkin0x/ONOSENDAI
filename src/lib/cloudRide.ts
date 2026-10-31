/**
 * cloudRide.ts - a hyperjump whose ride proof is bought from HOSAKA
 * (onosendai-launch #35, phase P5; arkinox, 2026-10-11).
 *
 * A ride passes hundreds of thousands of blocks, each a seeded Cantor tree
 * (DECK-0001 v3 §5.3): hours on a desktop, days on a phone. HOSAKA computes
 * the same proof on many machines at once in minutes. This module is what
 * sits between HOSAKA's answer and the store that signs: whether the
 * provider sells rides and whether one fits, the quote read and checked, the
 * finished result read and checked, and the choice the panel highlights.
 *
 * Nothing HOSAKA returns is believed. A completed job's root, `mp` and `mn`
 * go through the very Level 1 check (lib/hyperspace/ride.ts
 * verifyRideLevel1) every verifier runs on a published hyperjump: the
 * re-roll price from one attempt, then the 32 sampled leaves recomputed here
 * from the block hashes this client synced itself and carried up their
 * paths. A proof that fails is never signed.
 *
 * Pure apart from the worker hand off, which falls back inline (tests, or a
 * browser that cannot start the worker): a frozen frame is better than an
 * unverified proof.
 */

import type { HosakaJob, HosakaProvider, HosakaRideQuote, CloudRideResult } from './hosaka'
import { attemptsRequired, decodeNonce, grindAttempt, meetsPrice, rideBlocks, sampleIndices, verifyRideLevel1, type RideVerifyResult } from './hyperspace/ride'
import { hexToBytes } from 'cyberspace-core'
import type { RouteProfile } from './movePlan'
import type { VerifyRequest, VerifyResponse } from '../workers/verify.worker'

/** What a provider's `ride` service allows. */
export interface RideService {
  /** The most blocks one ride may pass; null when the provider does not say. */
  maxBlocks: number | null
  /** The newest block HOSAKA can verify headers up to; null when unsaid. */
  maxBlockHeight: number | null
  minMsats: number | null
}

/** The provider's ride service, or null when it does not sell rides. */
export function rideServiceOf(provider: HosakaProvider | null | undefined): RideService | null {
  const s = provider?.services?.find((x) => x?.type === 'ride')
  if (!s) return null
  const positive = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)
  return { maxBlocks: positive(s.max_blocks), maxBlockHeight: positive(s.max_block_height), minMsats: positive(s.min_msats) }
}

/**
 * Whether HOSAKA can take a ride between these blocks: not a zero-length
 * ride, no more blocks than it sells, and both ends at or under the newest
 * block whose header it can verify (it fetches and checks the headers itself
 * and never takes block hashes from a client).
 */
export function rideFits(service: RideService | null, fromHeight: number, toHeight: number): boolean {
  if (!service || fromHeight === toHeight || fromHeight < 0 || toHeight < 0) return false
  const blocks = rideBlocks(fromHeight, toHeight).length
  if (service.maxBlocks !== null && blocks > service.maxBlocks) return false
  if (service.maxBlockHeight !== null && Math.max(fromHeight, toHeight) > service.maxBlockHeight) return false
  return true
}

/** A quote the panel may show and act on: the price, the wait, for the ride asked about. */
export interface RideOffer {
  fromHeight: number
  toHeight: number
  costMsats: number
  /** Seconds HOSAKA expects; null when it did not say. */
  estSeconds: number | null
  estTime: string | null
}

/**
 * An answer from /api/v1/ride/quote as an offer for the ride asked about, or
 * null: not an object, a quote for another ride, a refusal, over the cap, or
 * no readable price. Only an offer is ever shown as a price.
 */
export function rideOfferOf(raw: unknown, fromHeight: number, toHeight: number): RideOffer | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const q = raw as Partial<HosakaRideQuote>
  if (q.within_cap !== true || q.refusal) return null
  if ((typeof q.from_height === 'number' && q.from_height !== fromHeight) || (typeof q.to_height === 'number' && q.to_height !== toHeight)) return null
  if (!(typeof q.cost_msats === 'number' && Number.isFinite(q.cost_msats) && q.cost_msats >= 0)) return null
  const est = typeof q.est_seconds === 'number' && Number.isFinite(q.est_seconds) && q.est_seconds > 0 ? q.est_seconds : null
  return { fromHeight, toHeight, costMsats: q.cost_msats, estSeconds: est, estTime: typeof q.est_time === 'string' ? q.est_time : null }
}

/**
 * Which of the two ways to ride the panel highlights. Never a payment: the
 * person still taps one. COST never pays for what this device can do, so it
 * is RIDE HERE. TIME and LOOT both take the quicker one (arkinox,
 * 2026-10-11: "faster = better user experience"; a ride holds no region
 * keys, so LOOT has nothing more to buy here than TIME): HOSAKA's wait plus
 * the payment round trip, against this device's own estimate. An unknown
 * local estimate (still calibrating) is a long one, since rides are long.
 */
export function rideChoice(profile: RouteProfile, localSeconds: number | null, offer: RideOffer | null, paymentSeconds = 30): 'local' | 'hosaka' {
  if (!offer || profile === 'cost') return 'local'
  if (offer.estSeconds === null) return 'local'
  if (localSeconds === null) return 'hosaka'
  return offer.estSeconds + paymentSeconds < localSeconds ? 'hosaka' : 'local'
}

/** A completed job's result as a ride proof, or the reason it is not one. */
export function rideResultOf(job: HosakaJob): CloudRideResult | string {
  const r = job.result as Partial<CloudRideResult> | null
  if (!r || typeof r !== 'object') return 'the job carries no result'
  if (typeof r.root !== 'string' || typeof r.mp !== 'string' || typeof r.mn !== 'string') return 'the result has no root, mp and mn'
  if (typeof r.previous_event_id !== 'string' || typeof r.from_height !== 'number' || typeof r.to_height !== 'number') return 'the result does not say which ride it proves'
  return r as CloudRideResult
}

/** The ride a job was bought for: what its result must prove. */
export interface RideAsked {
  previousId: string
  fromHeight: number
  toHeight: number
}

/** The block hash for a height, from the line this client synced; may wait for the sync, may throw. */
export type BlockHashFor = (height: number) => string | Promise<string>

/**
 * The heights whose leaves Level 1 recomputes, read from the proof itself (G
 * from root and mn), or null when the proof is too malformed to name any;
 * verifyRideLevel1 then refuses it with the reason.
 */
export function rideSampleHeights(previousId: string, fromHeight: number, toHeight: number, rootHex: string, mn: string): number[] | null {
  const nonce = decodeNonce(mn)
  if (nonce === null || !/^[0-9a-f]{64}$/.test(rootHex) || !/^[0-9a-f]{64}$/.test(previousId)) return null
  const blocks = rideBlocks(fromHeight, toHeight)
  if (blocks.length === 0) return null
  const G = grindAttempt(previousId, hexToBytes(rootHex), nonce)
  if (!meetsPrice(G, attemptsRequired(blocks.length))) return null
  return sampleIndices(G, blocks.length).map((i) => blocks[i])
}

let verifyId = 0

/** verifyRideLevel1 over a table of hashes, in the verify worker when there is one. */
function level1(input: { previousEventIdHex: string; fromHeight: number; toHeight: number; rootHex: string; mp: string; mn: string }, hashes: Record<number, string>): Promise<RideVerifyResult> {
  const inline = (): Promise<RideVerifyResult> => verifyRideLevel1({
    ...input,
    blockHashFor: (h) => {
      const hash = hashes[h]
      if (!hash) throw new Error(`no hash for block ${h}`)
      return hash
    },
  })
  if (typeof Worker === 'undefined') return inline()
  const request: VerifyRequest = { id: ++verifyId, kind: 'ride', ride: input, hashes }
  return new Promise<RideVerifyResult>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/verify.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      inline().then(resolve, reject)
      return
    }
    worker.onmessage = (event: MessageEvent<VerifyResponse>) => {
      worker.terminate()
      const msg = event.data
      if (msg.id !== request.id) return
      if ('error' in msg) reject(new Error(msg.error))
      else if ('ride' in msg) resolve(msg.ride)
      else reject(new Error('the verifier answered for something else'))
    }
    worker.onerror = () => {
      worker.terminate()
      inline().then(resolve, reject)
    }
    worker.postMessage(request)
  })
}

/**
 * Check a completed ride job before anything is signed. Returns what failed,
 * empty when the proof is good:
 *
 *   - the result is a ride proof at all, for this head and these two blocks
 *     (a proof for another head or other blocks is worthless here, however
 *     valid it is);
 *   - Level 1 (§5.5 steps 3 to 6), exactly as a reader checks a published
 *     hyperjump: the mn nonce meets the price, and every sampled leaf,
 *     recomputed here from this client's own block hashes, lies under the
 *     root along its opening.
 *
 * `blockHashFor` throwing (the line has not synced a sampled block yet)
 * rejects instead of returning a failure: the proof was not judged, so the
 * caller keeps it for RESUME rather than refusing it.
 */
export async function verifyCloudRide(job: HosakaJob, asked: RideAsked, blockHashFor: BlockHashFor): Promise<string[]> {
  return (await checkCloudRide(job, asked, blockHashFor)).failed
}

/** What a check of a finished ride found. */
export interface CloudRideCheck {
  /** What failed, empty when the proof is good. */
  failed: string[]
  /**
   * The block whose opening disagreed with this device's own hash for it, or null.
   * This device's line may be what is wrong, and the proof was paid for, so the
   * record is kept for the check to run again. Whatever else fails does not depend
   * on this device's line: the proof is wrong as it stands.
   */
  disagreesAt: number | null
}

/** verifyCloudRide, saying whether what failed could be this device's own line. */
export async function checkCloudRide(job: HosakaJob, asked: RideAsked, blockHashFor: BlockHashFor): Promise<CloudRideCheck> {
  const proofOnly = (failed: string[]): CloudRideCheck => ({ failed, disagreesAt: null })
  const r = rideResultOf(job)
  if (typeof r === 'string') return proofOnly([r])
  const failed: string[] = []
  if (r.previous_event_id !== asked.previousId) failed.push('the proof is bound to another chain head')
  if (r.from_height !== asked.fromHeight || r.to_height !== asked.toHeight) failed.push(`the proof is for a ride from block ${r.from_height} to block ${r.to_height}`)
  if (failed.length > 0) return proofOnly(failed)
  const heights = rideSampleHeights(asked.previousId, asked.fromHeight, asked.toHeight, r.root, r.mn) ?? []
  const hashes: Record<number, string> = {}
  for (const h of heights) {
    const hash = await blockHashFor(h)
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`block ${h} has no usable hash on this device yet`)
    hashes[h] = hash
  }
  const result = await level1({ previousEventIdHex: asked.previousId, fromHeight: asked.fromHeight, toHeight: asked.toHeight, rootHex: r.root, mp: r.mp, mn: r.mn }, hashes)
  if (result.ok) return proofOnly([])
  return { failed: [result.reason ?? 'Level 1 verification failed'], disagreesAt: result.openingHeight ?? null }
}
