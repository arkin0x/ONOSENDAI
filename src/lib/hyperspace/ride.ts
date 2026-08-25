/**
 * ride.ts: DECK-0001 v3 §5. A ride passes the blocks strictly between the two
 * endpoints plus the destination; each carries seeded Cantor work at height
 * K_b + K_LINE, hashed into a leaf, Merkle-aggregated into the proof root,
 * with SAMPLES Fiat-Shamir openings for Level 1 verification.
 *
 * Everything here is consensus-critical and pure; the worker pool wraps it.
 */
import {
  sha256,
  hexToBytes,
  bytesToHex,
  intToBytesBE,
  alignedBase,
  computeSubtreeCantor,
} from 'cyberspace-core'

export const K_LINE = 6
export const RIDE_MAX_HEIGHT = 16 + K_LINE
export const SAMPLES = 32
export const PAD_LEAF = new Uint8Array(32)

const enc = new TextEncoder()
export const HYPERSPACE_TERRAIN_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_TERRAIN_V1')
export const HYPERSPACE_SEED_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_SEED_V1')
export const HYPERSPACE_LEAF_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_LEAF_V1')
export const HYPERSPACE_SAMPLE_DOMAIN = enc.encode('CYBERSPACE_HYPERSPACE_SAMPLE_V1')

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

export function be64(n: number): Uint8Array {
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

/** The heights a ride from `from` to `to` passes: (lo, hi], ascending. */
export function rideBlocks(fromHeight: number, toHeight: number): number[] {
  const lo = Math.min(fromHeight, toHeight)
  const hi = Math.max(fromHeight, toHeight)
  const out: number[] = []
  for (let b = lo + 1; b <= hi; b++) out.push(b)
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

/** §5.5: Fiat-Shamir sample indices among the n real leaves. */
export function sampleIndices(root: Uint8Array, n: number, samples: number = SAMPLES): number[] {
  if (n <= 0) return []
  const out: number[] = []
  for (let i = 0; i < samples; i++) {
    const digest = sha256(concat(HYPERSPACE_SAMPLE_DOMAIN, root, be32(i)))
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
}

/**
 * Compute the full ride proof from precomputed leaves (§5.4 and §5.5).
 * Leaves must be in ascending height order for rideBlocks(from, to).
 */
export function buildRideProof(leaves: Uint8Array[]): RideProof {
  if (leaves.length === 0) {
    return { rootHex: '0'.repeat(64), mp: '' } // §5.6 zero-length ride
  }
  const layers = merkleLayers(leaves)
  const root = layers[layers.length - 1][0]
  const indices = sampleIndices(root, leaves.length)
  const paths = indices.map((i) => inclusionPath(layers, i))
  return { rootHex: bytesToHex(root), mp: encodeOpenings(paths) }
}

export interface RideVerifyInput {
  previousEventIdHex: string
  fromHeight: number
  toHeight: number
  rootHex: string
  mp: string
  /** Block hash for a height, 64 lowercase hex. */
  blockHashFor: (height: number) => string | Promise<string>
}

export interface RideVerifyResult {
  ok: boolean
  checked: number
  reason: string | null
}

/** Level 1 verification (§5.5): recompute the sampled leaves from scratch. */
export async function verifyRideLevel1(input: RideVerifyInput): Promise<RideVerifyResult> {
  const blocks = rideBlocks(input.fromHeight, input.toHeight)
  const n = blocks.length
  if (n === 0) {
    const ok = input.rootHex === '0'.repeat(64) && input.mp === ''
    return { ok, checked: 0, reason: ok ? null : 'zero-length ride must carry the zero root' }
  }
  if (!/^[0-9a-f]{64}$/.test(input.rootHex)) return { ok: false, checked: 0, reason: 'malformed root' }
  const root = hexToBytes(input.rootHex)
  const depth = merkleDepth(n)
  const indices = sampleIndices(root, n)
  const paths = decodeOpenings(input.mp, depth)
  if (paths === null || paths.length !== indices.length) {
    return { ok: false, checked: 0, reason: 'malformed openings' }
  }
  for (let s = 0; s < indices.length; s++) {
    const idx = indices[s]
    const height = blocks[idx]
    const hash = await input.blockHashFor(height)
    const leaf = computeRideLeaf(input.previousEventIdHex, height, hash)
    if (!verifyInclusion(leaf, idx, paths[s], root)) {
      return { ok: false, checked: s, reason: `opening ${s} (block ${height}) does not verify` }
    }
  }
  return { ok: true, checked: indices.length, reason: null }
}

/** Expected Cantor pairings for a ride of n blocks (mean 2^K_LINE * (3/2)^16). */
export function expectedRidePairs(n: number): number {
  return n * Math.round(2 ** K_LINE * (3 / 2) ** 16)
}

/** Exact pairings for known block hashes: sum of 2^(K_b + K_LINE). */
export function exactRidePairs(blockHashes: string[]): number {
  let total = 0
  for (const h of blockHashes) total += 2 ** (lineTerrainK(h) + K_LINE)
  return total
}
