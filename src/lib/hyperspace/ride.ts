/**
 * ride.ts: DECK-0001 v3 §5. A ride passes the blocks strictly between the two
 * endpoints plus the destination; each carries seeded Cantor work at height
 * K_b + K_LINE, hashed into a leaf, Merkle-aggregated into the proof root,
 * with SAMPLES openings for Level 1 verification.
 *
 * Openings version 2 (§5.5, §5.8): the sample positions come from G, which
 * costs a re-roll price to find. One attempt is one Cantor tree at
 * GRIND_HEIGHT, and the prover needs a nonce whose G, times A = ceil(n / 32),
 * stays below 2^256, so a prover that skipped blocks pays about one
 * thirty-second of the ride for every fresh set of samples.
 *
 * Everything here is consensus-critical and pure; the worker pool wraps it.
 */
import { alignedBase, bytesToHex, computeSubtreeCantor, hexToBytes, intToBytesBE, sha256 } from 'cyberspace-core'
import type { ActionEvent } from '../events'
import { GRANDFATHERED_V1_HYPERJUMPS } from './grandfathered'

export const K_LINE = 6
export const RIDE_MAX_HEIGHT = 16 + K_LINE
export const SAMPLES = 32
/** The height of one re-roll attempt's Cantor tree (§5.5). */
export const GRIND_HEIGHT = 16
export const PAD_LEAF = new Uint8Array(32)
/** The `mn` of a zero-length ride, which has no price (§5.6). */
export const ZERO_NONCE_HEX = '0'.repeat(16)

const enc = new TextEncoder()
export const HYPERSPACE_TERRAIN_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_TERRAIN_V1')
export const HYPERSPACE_SEED_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_SEED_V1')
export const HYPERSPACE_LEAF_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_LEAF_V1')
export const HYPERSPACE_GRIND_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_GRIND_V1')
export const HYPERSPACE_SAMPLE_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_SAMPLE_V2')

const TWO_256 = 1n << 256n
const NONCE_LIMIT = 1n << 64n

const AXIS_MASK = (1n << 85n) - 1n

function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function be64(n: number | bigint): Uint8Array {
  const out = new Uint8Array(8)
  let v = BigInt(n)
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

export function be32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  out[0] = (n >>> 24) & 0xff
  out[1] = (n >>> 16) & 0xff
  out[2] = (n >>> 8) & 0xff
  out[3] = n & 0xff
  return out
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}

/** §5.3 step 1: line terrain K for a block, from its hash. K in [0, 16]. */
export function lineTerrainK(blockHashHex: string): number {
  const digest = sha256(concat(HYPERSPACE_TERRAIN_DOMAIN, hexToBytes(blockHashHex)))
  let word = (digest[0] << 8) | digest[1]
  let count = 0
  while (word) {
    count += word & 1
    word >>>= 1
  }
  return count
}

/** §5.3 step 3: the temporal seed for block b under this chain position. */
export function rideSeed(previousEventIdHex: string, height: number): bigint {
  if (previousEventIdHex.length !== 64) throw new Error('previousEventIdHex must be 64 hex chars')
  const digest = sha256(concat(HYPERSPACE_SEED_DOMAIN, hexToBytes(previousEventIdHex), be64(height)))
  return bytesToBigInt(digest) & AXIS_MASK
}

/** §5.3 steps 1 to 5: one block's leaf, repeating its full Cantor work. */
export function computeRideLeaf(previousEventIdHex: string, height: number, blockHashHex: string): Uint8Array {
  const k = lineTerrainK(blockHashHex)
  const h = k + K_LINE
  const t = rideSeed(previousEventIdHex, height)
  const cantorT = computeSubtreeCantor(alignedBase(t, h), h, RIDE_MAX_HEIGHT)
  return sha256(concat(HYPERSPACE_LEAF_DOMAIN, be64(height), intToBytesBE(cantorT)))
}

/**
 * Where the chain head puts you on the line, or null when it does not.
 *
 * DECK-0001 v3 §4.3: a rider who has entered stays entered until a hop or a
 * sidestep leaves; every further hyperjump chains from the previous one,
 * with `from_height` equal to its `B`, and a hyperjump whose previous event
 * is neither an enter-hyperspace nor a hyperjump is invalid. So the head
 * alone says whether the next ride needs a boarding: an enter-hyperspace
 * head is boarded and the station decides where the ride starts
 * (`fromHeight` null); a hyperjump head is standing at its stop and the next
 * ride starts there. Anything else is off the line.
 */
export interface LineState {
  /** The head's id: the next ride's `previous`, and what seeds its leaves (§5.3). */
  previousId: string
  /** The head's coordinate: the next ride's `c` (§5.2). */
  coordHex: string
  /** The stop you stand at after a ride, or null when boarding decides it. */
  fromHeight: number | null
}

export function lineStateOf(actions: ActionEvent[]): LineState | null {
  const head = actions[actions.length - 1]
  if (!head) return null
  if (head.type === 'enter-hyperspace') return { previousId: head.id, coordHex: head.coordHex, fromHeight: null }
  if (head.type === 'hyperjump' && head.toHeight !== undefined) return { previousId: head.id, coordHex: head.coordHex, fromHeight: head.toHeight }
  return null
}

/** The heights a ride from `from` to `to` passes: (lo, hi], ascending. */
export function rideBlocks(fromHeight: number, toHeight: number): number[] {
  const lo = Math.min(fromHeight, toHeight)
  const hi = Math.max(fromHeight, toHeight)
  const out: number[] = []
  for (let b = lo + 1; b <= hi; b++) out.push(b)
  return out
}

/**
 * Where along the line the ride visually IS after `done` of `total` blocks:
 * the height whose stop the transit ghost stands at. Progress counts
 * completed leaves, which can finish out of order; the ghost walks the line
 * in order anyway, because "how far along" is what the count means to a
 * rider. A zero-length ride is already there; done is clamped so a stray
 * count can never walk past the destination.
 */
export function rideVisualHeight(fromHeight: number, toHeight: number, done: number, total: number): number {
  if (total <= 0) return toHeight
  const step = toHeight >= fromHeight ? 1 : -1
  const k = Math.max(0, Math.min(total, done))
  return fromHeight + step * k
}

/**
 * The walked stretch of the line, oldest first, head last, capped to the
 * most recent `cap` heights so an h18 ride cannot ask for a million-vertex
 * trail: the comet keeps its tail, not its history.
 */
export function rideTrail(fromHeight: number, toHeight: number, done: number, total: number, cap: number): number[] {
  const head = rideVisualHeight(fromHeight, toHeight, done, total)
  const step = toHeight >= fromHeight ? 1 : -1
  const walked = Math.abs(head - fromHeight) + 1
  const count = Math.max(1, Math.min(walked, cap))
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i++) out[count - 1 - i] = head - step * i
  return out
}

export function paddedCount(n: number): number {
  if (n <= 1) return Math.max(n, 0)
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function merkleDepth(n: number): number {
  const p = paddedCount(n)
  let d = 0
  for (let v = p; v > 1; v >>= 1) d++
  return d
}

/** §5.4: pad with PAD_LEAF to a power of two, parent = sha256(left || right). */
export function merkleLayers(leaves: Uint8Array[]): Uint8Array[][] {
  if (leaves.length === 0) return [[]]
  const p = paddedCount(leaves.length)
  let level: Uint8Array[] = leaves.slice()
  while (level.length < p) level.push(PAD_LEAF)
  const layers: Uint8Array[][] = [level]
  while (level.length > 1) {
    const next: Uint8Array[] = new Array(level.length / 2)
    for (let i = 0; i < level.length; i += 2) {
      next[i / 2] = sha256(concat(level[i], level[i + 1]))
    }
    layers.push(next)
    level = next
  }
  return layers
}

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  const layers = merkleLayers(leaves)
  const top = layers[layers.length - 1]
  return top.length === 1 ? top[0] : PAD_LEAF
}

/** §5.5: A, the price in attempts. Each succeeds with probability 1/A. */
export function attemptsRequired(n: number): number {
  return Math.max(1, Math.ceil(n / SAMPLES))
}

/**
 * §5.5: one re-roll attempt, one Cantor tree at GRIND_HEIGHT. Returns G.
 *
 *   seed_nonce = sha256(GRIND_DOMAIN || previous_event_id || root || be64(nonce))
 *   g_base     = ((int(seed_nonce) mod 2^85) >> 16) << 16
 *   G          = sha256(GRIND_DOMAIN || seed_nonce || int_to_bytes_be_min(cantor(g_base, 16)))
 */
export function grindAttempt(previousEventIdHex: string, root: Uint8Array, nonce: bigint): Uint8Array {
  if (previousEventIdHex.length !== 64) throw new Error('previousEventIdHex must be 64 hex chars')
  if (root.length !== 32) throw new Error('root must be 32 bytes')
  if (nonce < 0n || nonce >= NONCE_LIMIT) throw new Error('the nonce is an unsigned 64-bit integer')
  const seed = sha256(concat(HYPERSPACE_GRIND_DOMAIN, hexToBytes(previousEventIdHex), root, be64(nonce)))
  const cantorG = computeSubtreeCantor(alignedBase(bytesToBigInt(seed) & AXIS_MASK, GRIND_HEIGHT), GRIND_HEIGHT, GRIND_HEIGHT)
  return sha256(concat(HYPERSPACE_GRIND_DOMAIN, seed, intToBytesBE(cantorG)))
}

/** §5.5: the price is met when G, as a 256-bit big-endian integer, times A is below 2^256. */
export function meetsPrice(G: Uint8Array, attempts: number): boolean {
  return bytesToBigInt(G) * BigInt(attempts) < TWO_256
}

/**
 * The first nonce from `start` whose attempt meets the price, searching
 * upward on this thread, as the golden vectors do. The worker pool spreads
 * the same search over disjoint ranges (ridePool.ts); any valid nonce
 * verifies.
 */
export function findRideNonce(
  previousEventIdHex: string,
  root: Uint8Array,
  n: number,
  start = 0n,
): { nonce: bigint; G: Uint8Array } {
  const attempts = attemptsRequired(n)
  for (let nonce = start; nonce < NONCE_LIMIT; nonce++) {
    const G = grindAttempt(previousEventIdHex, root, nonce)
    if (meetsPrice(G, attempts)) return { nonce, G }
  }
  throw new Error('no 64-bit nonce meets the price')
}

/** The `mn` tag (§5.2): the nonce as exactly 16 lowercase hex characters, big-endian. */
export function encodeNonce(nonce: bigint): string {
  if (nonce < 0n || nonce >= NONCE_LIMIT) throw new Error('the nonce is an unsigned 64-bit integer')
  return nonce.toString(16).padStart(16, '0')
}

/** The nonce in an `mn` tag, or null unless it is exactly 16 lowercase hex characters. */
export function decodeNonce(hex: string): bigint | null {
  return /^[0-9a-f]{16}$/.test(hex) ? BigInt('0x' + hex) : null
}

/** §5.5: sample indices among the n real leaves, drawn from G. */
export function sampleIndices(G: Uint8Array, n: number, samples: number = SAMPLES): number[] {
  if (n <= 0) return []
  const out: number[] = []
  for (let i = 0; i < samples; i++) {
    const digest = sha256(concat(HYPERSPACE_SAMPLE_DOMAIN, G, be32(i)))
    out.push(Number(bytesToBigInt(digest) % BigInt(n)))
  }
  return out
}

/** The sibling path (leaf level first) for one index. */
export function inclusionPath(layers: Uint8Array[][], index: number): Uint8Array[] {
  const path: Uint8Array[] = []
  let i = index
  for (let level = 0; level < layers.length - 1; level++) {
    path.push(layers[level][i ^ 1])
    i >>= 1
  }
  return path
}

export function verifyInclusion(leaf: Uint8Array, index: number, path: Uint8Array[], root: Uint8Array): boolean {
  let acc = leaf
  let i = index
  for (const sibling of path) {
    acc = (i & 1) === 0 ? sha256(concat(acc, sibling)) : sha256(concat(sibling, acc))
    i >>= 1
  }
  if (acc.length !== root.length) return false
  for (let k = 0; k < acc.length; k++) if (acc[k] !== root[k]) return false
  return true
}

/** The mp tag: SAMPLES inclusion paths, ':'-joined, each path hex-concatenated. */
export function encodeOpenings(paths: Uint8Array[][]): string {
  return paths.map((p) => p.map((s) => bytesToHex(s)).join('')).join(':')
}

export function decodeOpenings(mp: string, depth: number): Uint8Array[][] | null {
  if (mp === '') return depth === 0 ? [] : null
  const parts = mp.split(':')
  const out: Uint8Array[][] = []
  for (const part of parts) {
    if (part.length !== depth * 64 || !/^[0-9a-f]*$/.test(part)) return null
    const path: Uint8Array[] = []
    for (let i = 0; i < depth; i++) path.push(hexToBytes(part.slice(i * 64, i * 64 + 64)))
    out.push(path)
  }
  return out
}

export interface RideProof {
  rootHex: string
  mp: string
  /** The re-roll nonce (§5.5), the value of the `mn` tag. */
  mnHex: string
}

/** §5.6: a zero-length ride's proof. No price and nothing to sample. */
export const ZERO_LENGTH_PROOF: Readonly<RideProof> = { rootHex: '0'.repeat(64), mp: '', mnHex: ZERO_NONCE_HEX }

/** The ride's Merkle tree (§5.4): every layer, which the openings are read from, and the root. */
export interface RideTree {
  layers: Uint8Array[][]
  root: Uint8Array
  /** The real leaf count, which A and the sample indices are taken over. */
  n: number
}

/** Leaves must be in ascending height order for rideBlocks(from, to), and at least one. */
export function rideTree(leaves: Uint8Array[]): RideTree {
  if (leaves.length === 0) throw new Error('a zero-length ride has no tree (§5.6)')
  const layers = merkleLayers(leaves)
  return { layers, root: layers[layers.length - 1][0], n: leaves.length }
}

/** §5.5: the proof, once a nonce meeting the price and its G are known. */
export function rideProofFor(tree: RideTree, nonce: bigint, G: Uint8Array): RideProof {
  const paths = sampleIndices(G, tree.n).map((i) => inclusionPath(tree.layers, i))
  return { rootHex: bytesToHex(tree.root), mp: encodeOpenings(paths), mnHex: encodeNonce(nonce) }
}

/**
 * The full ride proof from precomputed leaves (§5.4, §5.5), on this thread,
 * with the nonce searched upward from 0 as in the golden vectors. The worker
 * pool does the same in parallel and resumably (ridePool.ts).
 */
export function buildRideProof(previousEventIdHex: string, leaves: Uint8Array[]): RideProof {
  if (leaves.length === 0) return { ...ZERO_LENGTH_PROOF }
  const tree = rideTree(leaves)
  const { nonce, G } = findRideNonce(previousEventIdHex, tree.root, tree.n)
  return rideProofFor(tree, nonce, G)
}

/**
 * Whether a ride is one of those published before openings version 2 and
 * exempt under §5.8: it carries no `mn` tag, and its root and openings are
 * accepted without re-checking.
 */
export function isGrandfatheredV1Hyperjump(eventId: string | undefined): boolean {
  return eventId !== undefined && GRANDFATHERED_V1_HYPERJUMPS.has(eventId)
}

export interface RideVerifyInput {
  /** The event's id. Consulted only when `mn` is null: such a ride stands only if listed (§5.8). */
  eventId?: string
  previousEventIdHex: string
  fromHeight: number
  toHeight: number
  rootHex: string
  mp: string
  /** The `mn` tag's value, or null when the event has none. */
  mn: string | null
  /** Block hash for a height, 64 lowercase hex. */
  blockHashFor: (height: number) => string | Promise<string>
}

export interface RideVerifyResult {
  ok: boolean
  checked: number
  reason: string | null
  /** True when the ride has no `mn` and is on the §5.8 list, so its root and
   * openings were accepted unchecked. Everything else still needs checking. */
  grandfathered: boolean
}

/**
 * Level 1 verification of a ride's proof (§5.5 steps 3 to 6): the re-roll
 * price from one attempt, then the sampled leaves recomputed from scratch and
 * carried up their paths. The chain structure, the station and the stop
 * coordinate (steps 1 and 2) are the caller's to check, for a grandfathered
 * ride as for any other.
 */
export async function verifyRideLevel1(input: RideVerifyInput): Promise<RideVerifyResult> {
  const fail = (checked: number, reason: string): RideVerifyResult => ({ ok: false, checked, reason, grandfathered: false })
  if (input.mn === null || input.mn === undefined) {
    return isGrandfatheredV1Hyperjump(input.eventId)
      ? { ok: true, checked: 0, reason: null, grandfathered: true }
      : fail(0, 'no mn tag, and not a ride exempt under §5.8')
  }
  const nonce = decodeNonce(input.mn)
  if (nonce === null) return fail(0, 'malformed mn')
  const blocks = rideBlocks(input.fromHeight, input.toHeight)
  const n = blocks.length
  if (n === 0) {
    const zero = ZERO_LENGTH_PROOF
    return input.rootHex === zero.rootHex && input.mp === zero.mp && input.mn === zero.mnHex
      ? { ok: true, checked: 0, reason: null, grandfathered: false }
      : fail(0, 'a zero-length ride carries the zero root, an all-zero mn and no openings')
  }
  if (!/^[0-9a-f]{64}$/.test(input.rootHex)) return fail(0, 'malformed root')
  const root = hexToBytes(input.rootHex)
  const G = grindAttempt(input.previousEventIdHex, root, nonce)
  if (!meetsPrice(G, attemptsRequired(n))) return fail(0, 'the mn nonce does not meet the price')
  const indices = sampleIndices(G, n)
  const paths = decodeOpenings(input.mp, merkleDepth(n))
  if (paths === null || paths.length !== indices.length) return fail(0, 'malformed openings')
  for (let s = 0; s < indices.length; s++) {
    const idx = indices[s]
    const height = blocks[idx]
    const hash = await input.blockHashFor(height)
    const leaf = computeRideLeaf(input.previousEventIdHex, height, hash)
    if (!verifyInclusion(leaf, idx, paths[s], root)) {
      return fail(s, `opening ${s} (block ${height}) does not verify`)
    }
  }
  return { ok: true, checked: indices.length, reason: null, grandfathered: false }
}

/** Expected Cantor pairings for a ride of n blocks (mean 2^K_LINE * (3/2)^16). */
export function expectedRidePairs(n: number): number {
  return n * Math.round(2 ** K_LINE * (3 / 2) ** 16)
}

/**
 * Expected Cantor pairings for the re-roll price of a ride of n blocks: A
 * attempts of one GRIND_HEIGHT tree each (§5.5), about one thirty-second of
 * the ride. A zero-length ride has no price (§5.6).
 */
export function expectedPricePairs(n: number): number {
  return n === 0 ? 0 : attemptsRequired(n) * 2 ** GRIND_HEIGHT
}

/** Exact pairings for known block hashes: sum of 2^(K_b + K_LINE). */
export function exactRidePairs(blockHashes: string[]): number {
  let total = 0
  for (const h of blockHashes) total += 2 ** (lineTerrainK(h) + K_LINE)
  return total
}

/**
 * The K values the calibration sample spans. Low through average, never the
 * heavy tail: a K=16 block alone is 2^22 pairings and would make calibration
 * itself seconds long. The measurement is normalized per pairing and scaled
 * to the binomial mean block, so excluding the tail does not bias the result,
 * it only bounds the cost.
 */
export const CALIBRATION_KS = [4, 5, 6, 7, 8, 9, 10, 11]

/** One synthetic block hash per calibration K, in K order. Deterministic. */
export function calibrationHashes(): string[] {
  const enc = new TextEncoder()
  const found = new Map<number, string>()
  for (let counter = 0; found.size < CALIBRATION_KS.length && counter < 100_000; counter++) {
    const hex = bytesToHex(sha256(enc.encode(`ride-calibration-${counter}`)))
    const k = lineTerrainK(hex)
    if (CALIBRATION_KS.includes(k) && !found.has(k)) found.set(k, hex)
  }
  return CALIBRATION_KS.filter((k) => found.has(k)).map((k) => found.get(k) as string)
}

/** The calibration sample, timed wherever it runs: elapsed wall-clock and the
 * exact pairings it took, from which ms per mean block follows. */
export function timeCalibrationSample(): { elapsedMs: number; pairs: number } {
  const previousEventIdHex = 'ca'.repeat(32)
  const hashes = calibrationHashes()
  const started = performance.now()
  for (let i = 0; i < hashes.length; i++) {
    computeRideLeaf(previousEventIdHex, 1_000 + i, hashes[i])
  }
  return { elapsedMs: performance.now() - started, pairs: exactRidePairs(hashes) }
}

/**
 * What the chain's rides add up to: how many hyperjumps, and how many blocks
 * they passed between them (§5.3: the ride passes every block from the
 * lower height exclusive to the higher inclusive, so a ride's length is the
 * difference). Exact from the events themselves, which is why it is derived
 * from the chain rather than tallied as proofs finish: an adopted chain has
 * the same numbers as one ridden here.
 */
export function rideStatsOf(actions: ActionEvent[]): { hyperjumps: number; blocksRidden: number } {
  let hyperjumps = 0
  let blocksRidden = 0
  for (const a of actions) {
    if (a.type !== 'hyperjump' || a.fromHeight === undefined || a.toHeight === undefined) continue
    hyperjumps += 1
    blocksRidden += Math.abs(a.toHeight - a.fromHeight)
  }
  return { hyperjumps, blocksRidden }
}
