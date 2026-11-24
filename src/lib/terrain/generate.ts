/**
 * generate.ts - the ground of one chunk, from public facts only: DECK-0009
 * (Blocks, draft, cyberspace PR #122) §3, revision 2: revision 1 ported
 * from its reference code (decks/blocks-reference.mjs) and checked against
 * its test vectors (lib/__tests__/terrainGenerate.test.ts), with the rock
 * and features of 2026-11-24 on top, so every client draws the same block in
 * every cell.
 *
 * In short (the DECK says it exactly):
 * - The survey seed is sha256("CYBERSPACE_BLOCKS_SURVEY_V1" || plane ||
 *   int_to_bytes_be_min(region_n)), region_n being the chunk's h5 Cantor root,
 *   computed with the app's own region-root code (lib/shardCrypto.ts). Never
 *   sha256(root) alone: that is the region key.
 * - The fine stream, one byte a cell, is the ChaCha20 keystream of that seed
 *   (RFC 8439, zero nonce, counter 0); the chunk above's first layer is read
 *   too, so the skin on the top layer does not depend on the chunk above.
 * - Smooth integer noise from the terrain digests' unused bytes, at lattices
 *   of 8, 4 and 128 gibsons, decides solid or empty. Terrain K (spec §5.2) of
 *   each lattice corner sets the empty threshold, so the costlier the cube,
 *   the more solid, and gates the veins: the rarest only in the costliest cubes.
 * - Rock (revision 2): the weighted strata of one of six families (from the
 *   2^11 digest, read at a warped place so family and band borders are
 *   soft), a fleck, and a skin on top of open air.
 * - Features (revision 2), in a fixed order from the bytes of the same
 *   ChaCha20 stream after the fine stream, each by a 32-bit draw against a
 *   chance: Magmaflow pockets with Basaltine round them, Tidewater pools,
 *   Lumenwood trees crowned with Canopy glass, veins (Ferrovein, Cobaltine,
 *   Prismite, Glowcore) and the rare band, one block each in the chunk's
 *   costliest cube (Voidpearl, Auroric, Chronite, Gibsonite, Singularity
 *   core, Relic shard, Genesis shard). Each waits for the terrain K it needs.
 *   scripts/terrain-calibrate.mjs measures what they make.
 *
 * Every value that decides a block is an integer below 2^53. Block ids are
 * the DECK's registry, which is the previews' block set (blocks.ts).
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { regionKeyAt } from '../shardCrypto'
import { CELLS, fastCoordBytes, idx, type ChunkBase } from './coords'

/** Which ground a layer's diff is against: the DECK's `ground` revision. */
export const GENERATOR_VERSION = 2

const enc = new TextEncoder()
const TERRAIN_DOMAIN = enc.encode('CYBERSPACE_TERRAIN_K_V2')
/**
 * DECK-0009 §3.2. Revision 2 keeps revision 1's seed, stream, lattices and
 * open space, so caves and K are unchanged; it changes which block fills
 * the rock and adds the features (layers name it: `ground: 2`).
 */
export const SURVEY_DOMAIN = enc.encode('CYBERSPACE_BLOCKS_SURVEY_V1')

const AXIS_MASK = (1n << 85n) - 1n
const wrap = (v: bigint): bigint => v & AXIS_MASK

// §3.6 Smoothstep weights.
const W8 = [0, 22, 80, 162, 256, 350, 432, 490, 512]
const W128 = (f: number): number => 384 * f * f - 2 * f * f * f

// §3.8 Thresholds, revision 1.
export const EMPTY_THR = [1337, 1323, 1308, 1294, 1280, 1266, 1253, 1239, 1225, 1211, 1196, 1182, 1168, 1153, 1138, 1123, 1108]

// Block ids (blocks.ts names them): the DECK's registry, revision 2.
export const B = {
  GRIDSTONE: 1, UMBERSLATE: 2, DRIFTSILT: 3, MOSSVEIL: 4, RUSTBAND: 5, FROSTSHALE: 6, CINDERROCK: 7, PRISMITE: 8,
  BASALTINE: 9, RIMEGLASS: 10, TIDEWATER: 11, MAGMAFLOW: 12, LUMENWOOD: 13, CANOPY: 14,
  FERROVEIN: 40, COBALTINE: 41, GLOWCORE: 42, GIBSONITE: 43,
  RELIC: 192, VOIDPEARL: 193, AURORIC: 194, CHRONITE: 195, SINGULARITY: 196, GENESIS: 197,
} as const

const { GRIDSTONE: G, UMBERSLATE: U, DRIFTSILT: D, RUSTBAND: R, FROSTSHALE: F, CINDERROCK: C, BASALTINE: BA, RIMEGLASS: RI } = B

/**
 * §3.9 Families, revision 2 (calibrated 2026-11-24 to the owner's table;
 * scripts/terrain-calibrate.mjs measures them): the strata as [id, weight]
 * (a band picks a kind by a hash, so a kind's weight over the total is its
 * share of bands), the skin on top of open air, the fleck, and the rind (not
 * ground: kept for readers that draw one). The owner's shares (Gridstone
 * about 25, Umberslate 18, Rustband 9, Driftsilt 11, Frostshale 15,
 * Cinderrock 20, Basaltine 6, Rimeglass 5) are kept as ratios inside each
 * family, since in one family they do not add up to the whole; Mossveil,
 * a skin only, is outside them.
 */
export const FAMILIES: ReadonlyArray<{ name: string; strata: ReadonlyArray<readonly [number, number]>; top: number; speckle: number; rind: number }> = [
  { name: 'temperate', strata: [[G, 25], [U, 18], [R, 9]], top: B.MOSSVEIL, speckle: U, rind: U },
  // The skin over open air is about 14% of a family's rock, so a kind that is also the skin gets less of the bands.
  { name: 'dune', strata: [[G, 47], [U, 34], [R, 17], [D, 3]], top: D, speckle: R, rind: G },
  { name: 'frozen', strata: [[G, 40], [U, 29], [R, 15], [F, 8], [RI, 8]], top: F, speckle: U, rind: U },
  { name: 'volcanic', strata: [[G, 37], [U, 27], [R, 13], [C, 13], [BA, 9]], top: C, speckle: R, rind: U },
  { name: 'crystal', strata: [[G, 43], [U, 31], [R, 16], [F, 10]], top: F, speckle: B.PRISMITE, rind: U },
  { name: 'karst', strata: [[G, 25], [U, 18], [R, 9], [D, 11]], top: B.MOSSVEIL, speckle: D, rind: U },
]

/** A band's kind: the hash's high half over the family's total weight. */
function pickStratum(strata: ReadonlyArray<readonly [number, number]>, h: number): number {
  let total = 0
  for (const [, w] of strata) total += w
  let r = (h >>> 16) % total
  for (const [id, w] of strata) { if (r < w) return id; r -= w }
  return strata[0][0]
}

/**
 * Features, revision 2: what each is placed by. An eligible chunk gets one
 * when a 32-bit draw from its feature stream is below `t` (so its chance is
 * t / 2^32, written beside it), `minK` being the least K of the chunk's
 * costliest cube for it to be eligible at all. Integers only, so any
 * language draws the same. Tidewater's threshold depends on the chunk's
 * K (poolThreshold).
 */
export const FEATURES = {
  ferrovein: { t: 3865470566, minK: 0 }, // 0.9
  cobaltine: { t: 2233382993, minK: 6 }, // 0.52
  prismite: { t: 1395864371, minK: 9 }, // 0.325
  glowcore: { t: 429496729, minK: 10 }, // 0.1
  trees: { t: 1460288880, minK: 0 }, // 0.34 of chunks with a tree site
  magma: { t: 536870912, minK: 11 }, // 0.125 of volcanic chunks
} as const

/**
 * Tidewater's threshold from the sum of the chunk's 64 cube K: a chance of
 * (768 - sum) / 1024, a quarter at a mean K of 8, more where K is low,
 * held between 0.05 and 0.6.
 */
export function poolThreshold(sumK: number): number {
  return Math.min(2576980377, Math.max(214748364, (768 - sumK) * 4194304))
}

/** The rare band, common to rarest (the owner's order): [id, least K of the costliest cube]. */
export const RARE: ReadonlyArray<readonly [number, number]> = [
  [B.VOIDPEARL, 11], [B.AURORIC, 11], [B.CHRONITE, 12], [B.GIBSONITE, 12], [B.SINGULARITY, 13], [B.RELIC, 13], [B.GENESIS, 14],
]

/**
 * The share of chunks whose costliest cube reaches each K (index K, 0..16),
 * measured over 200,000 random chunks (scripts/terrain-calibrate.mjs): what
 * turns a target per surveyed chunk into the chance given eligibility.
 */
export const MAXK_AT_LEAST: readonly number[] = [1, 1, 1, 1, 0.999995, 0.999705, 0.996205, 0.979775, 0.92474, 0.802875, 0.607995, 0.383905, 0.192085, 0.0728, 0.019475, 0.003215, 0.000215]

/** The rare band's ids. */
const RARE_IDS: ReadonlySet<number> = new Set([B.RELIC, B.VOIDPEARL, B.AURORIC, B.CHRONITE, B.GIBSONITE, B.SINGULARITY, B.GENESIS])

/** The owner's targets, chance per surveyed chunk, for the rare band. */
export const RARE_TARGET: Readonly<Record<number, number>> = {
  [B.VOIDPEARL]: 1 / 500, [B.AURORIC]: 1 / 1000, [B.CHRONITE]: 1 / 2000, [B.GIBSONITE]: 1 / 3000, [B.SINGULARITY]: 1 / 5000, [B.RELIC]: 1 / 7500, [B.GENESIS]: 1 / 10000,
}


const popcount4 = (n: number): number => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1)

/** The terrain digest of the aligned 2^bits cell holding (x, y, z): the spec's §5.2 step 1. */
export function terrainDigest(bits: number, x: bigint, y: bigint, z: bigint, plane: number): Uint8Array {
  const s = BigInt(bits)
  const msg = new Uint8Array(TERRAIN_DOMAIN.length + 33)
  msg.set(TERRAIN_DOMAIN, 0)
  msg[TERRAIN_DOMAIN.length] = bits
  msg.set(fastCoordBytes((x >> s) << s, (y >> s) << s, (z >> s) << s, plane), TERRAIN_DOMAIN.length + 1)
  return sha256(msg)
}

/** Terrain K at a gibson, as the spec computes it (cyberspace-core terrainK). */
export function kAt(x: bigint, y: bigint, z: bigint, plane: number): number {
  let k = 0
  for (const b of [3, 7, 9, 11]) k += popcount4(terrainDigest(b, x, y, z, plane)[0] & 15)
  return k
}

/** Big-endian bytes of a non-negative integer, as few as hold it (the spec's int_to_bytes_be_min). */
export function bytesBEMin(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0])
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

/** §3.2 The survey seed: SURVEY computes the chunk's h5 region root for this. */
export function surveySeed(base: ChunkBase): Uint8Array {
  const { regionN } = regionKeyAt(base, 5, 5)
  const n = bytesBEMin(regionN)
  const msg = new Uint8Array(SURVEY_DOMAIN.length + 1 + n.length)
  msg.set(SURVEY_DOMAIN, 0)
  msg[SURVEY_DOMAIN.length] = base.plane & 1
  msg.set(n, SURVEY_DOMAIN.length + 1)
  return sha256(msg)
}

const rotl = (v: number, c: number): number => ((v << c) | (v >>> (32 - c))) >>> 0

/** ChaCha20 keystream (RFC 8439 §2.3, §2.4): a 32-byte key, a zero nonce, counter from 0. */
export function chacha20Keystream(key: Uint8Array, length: number): Uint8Array {
  const k = new Uint32Array(8)
  for (let i = 0; i < 8; i++) k[i] = (key[4 * i] | (key[4 * i + 1] << 8) | (key[4 * i + 2] << 16) | (key[4 * i + 3] << 24)) >>> 0
  const out = new Uint8Array(length)
  const st = new Uint32Array(16), x = new Uint32Array(16)
  const qr = (a: number, b: number, c: number, d: number): void => {
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16)
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12)
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8)
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7)
  }
  for (let block = 0; block * 64 < length; block++) {
    st[0] = 0x61707865; st[1] = 0x3320646e; st[2] = 0x79622d32; st[3] = 0x6b206574
    for (let i = 0; i < 8; i++) st[4 + i] = k[i]
    st[12] = block; st[13] = 0; st[14] = 0; st[15] = 0
    x.set(st)
    for (let r = 0; r < 10; r++) {
      qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15)
      qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14)
    }
    for (let i = 0; i < 16; i++) {
      const v = (x[i] + st[i]) >>> 0
      for (let b = 0; b < 4; b++) { const o = block * 64 + 4 * i + b; if (o < length) out[o] = (v >>> (8 * b)) & 0xff }
    }
  }
  return out
}

/** §3.3 The fine stream: one byte a cell. */
export function fineStream(base: ChunkBase): Uint8Array {
  return chacha20Keystream(surveySeed(base), CELLS)
}

/** §3.6 lerp in 2^sh parts. Every value is non-negative, so the floor is exact. */
const lerp = (a: number, b: number, w: number, sh: number): number => Math.floor((a * (2 ** sh - w) + b * w) / 2 ** sh)

interface Lattices {
  /** Coarse lattice, 5 by 5 by 5 corners at 8 gibsons: K, 16 K, cave, tunnel, vein, vein kind. */
  K: Int32Array
  K16: Int32Array
  cave: Int32Array
  tun: Int32Array
  vein: Int32Array
  veinT: Int32Array
  /** Fine lattice, 9 by 9 by 9 corners at 4 gibsons. */
  veinD: Int32Array
  caveD: Int32Array
  /** The 128 lattice's eight corners and the chunk's place in it. */
  big: Int32Array
  warp: Int32Array
  /** The soft strata borders' warp fields (§3.9). */
  gx: Int32Array
  gy: Int32Array
  gz: Int32Array
  ox: number
  oy: number
  oz: number
  d9: Uint8Array
  d11: Uint8Array
  /** A digest of the 2^bits cell holding the gibson (dx, dy, dz) from the chunk's corner, kept for this chunk. */
  digestAt: (bits: number, dx: number, dy: number, dz: number) => Uint8Array
}

/** §3.4 and §3.5 The lattices a chunk reads. Corners past the axis end wrap to 0. */
function lattices(base: ChunkBase): Lattices {
  const { x: X, y: Y, z: Z, plane: P } = base
  const K = new Int32Array(125), K16 = new Int32Array(125), cave = new Int32Array(125), tun = new Int32Array(125), vein = new Int32Array(125), veinT = new Int32Array(125)
  const d3s: Uint8Array[] = new Array(125)
  // Digests of the 2^7, 2^9 and 2^11 cells, kept by their aligned corner for this chunk.
  const big = new Map<string, Uint8Array>()
  const digest = (bits: number, x: bigint, y: bigint, z: bigint): Uint8Array => {
    if (bits === 3) return terrainDigest(3, x, y, z, P)
    const s = BigInt(bits)
    const key = `${bits}:${x >> s}:${y >> s}:${z >> s}`
    let d = big.get(key)
    if (!d) { d = terrainDigest(bits, x, y, z, P); big.set(key, d) }
    return d
  }
  for (let j = 0; j < 5; j++) for (let k = 0; k < 5; k++) for (let i = 0; i < 5; i++) {
    const cx = wrap(X + BigInt(8 * i)), cy = wrap(Y + BigInt(8 * j)), cz = wrap(Z + BigInt(8 * k))
    const d3 = digest(3, cx, cy, cz)
    let kk = popcount4(d3[0] & 15)
    for (const b of [7, 9, 11]) kk += popcount4(digest(b, cx, cy, cz)[0] & 15)
    const a = i + 5 * (k + 5 * j)
    d3s[a] = d3
    K[a] = kk; K16[a] = 16 * kk
    cave[a] = d3[1]; tun[a] = d3[2]; vein[a] = d3[3]; veinT[a] = d3[4]
  }
  const veinD = new Int32Array(729), caveD = new Int32Array(729)
  for (let j = 0; j < 9; j++) for (let k = 0; k < 9; k++) for (let i = 0; i < 9; i++) {
    const d3 = d3s[(i >> 1) + 5 * ((k >> 1) + 5 * (j >> 1))]
    const sub = (i & 1) | ((j & 1) << 1) | ((k & 1) << 2)
    const b = i + 9 * (k + 9 * j)
    veinD[b] = d3[5 + sub]; caveD[b] = d3[13 + sub]
  }
  const Ox = (X >> 7n) << 7n, Oy = (Y >> 7n) << 7n, Oz = (Z >> 7n) << 7n
  const bigV = new Int32Array(8), warp = new Int32Array(8), gx = new Int32Array(8), gy = new Int32Array(8), gz = new Int32Array(8)
  for (let c = 0; c < 8; c++) {
    const d7 = digest(7, wrap(Ox + BigInt(128 * (c & 1))), wrap(Oy + BigInt(128 * ((c >> 1) & 1))), wrap(Oz + BigInt(128 * ((c >> 2) & 1))))
    bigV[c] = d7[1]; warp[c] = d7[2]; gx[c] = d7[3]; gy[c] = d7[4]; gz[c] = d7[5]
  }
  // The soft borders read the 2^9 and 2^11 digests a little way off the chunk: kept by cell, keyed by small numbers.
  const offIn = (v: bigint, b: number): number => Number(v & ((1n << BigInt(b)) - 1n))
  const near: Record<number, [number, number, number]> = { 9: [offIn(X, 9), offIn(Y, 9), offIn(Z, 9)], 11: [offIn(X, 11), offIn(Y, 11), offIn(Z, 11)] }
  const kept = new Map<number, Uint8Array>()
  const digestAt = (bits: number, dx: number, dy: number, dz: number): Uint8Array => {
    const o = near[bits], w = 1 << bits
    const kx = Math.floor((o[0] + dx) / w), ky = Math.floor((o[1] + dy) / w), kz = Math.floor((o[2] + dz) / w)
    const key = bits * 1e6 + (kx + 8) * 1e4 + (ky + 8) * 100 + (kz + 8)
    let d = kept.get(key)
    if (!d) { d = terrainDigest(bits, wrap(X + BigInt(dx)), wrap(Y + BigInt(dy)), wrap(Z + BigInt(dz)), P); kept.set(key, d) }
    return d
  }
  return {
    K, K16, cave, tun, vein, veinT, veinD, caveD, big: bigV, warp, gx, gy, gz,
    ox: Number(X - Ox), oy: Number(Y - Oy), oz: Number(Z - Oz),
    d9: digest(9, X, Y, Z), d11: digest(11, X, Y, Z), digestAt,
  }
}

/** §3.6 Trilinear value at local (x, y, z), each 0..32, on a lattice of spacing s (8 or 4). Order: x, then z, then y. */
function tri(arr: Int32Array, s: number, x: number, y: number, z: number): number {
  const n = 32 / s, m = n + 1
  let i = Math.floor(x / s); if (i > n - 1) i = n - 1
  let j = Math.floor(y / s); if (j > n - 1) j = n - 1
  let k = Math.floor(z / s); if (k > n - 1) k = n - 1
  const fx = x - s * i, fy = y - s * j, fz = z - s * k
  const wx = s === 8 ? W8[fx] : W8[2 * fx], wy = s === 8 ? W8[fy] : W8[2 * fy], wz = s === 8 ? W8[fz] : W8[2 * fz]
  const c = (di: number, dj: number, dk: number): number => arr[(i + di) + m * ((k + dk) + m * (j + dj))]
  const a0 = lerp(c(0, 0, 0), c(1, 0, 0), wx, 9), a1 = lerp(c(0, 0, 1), c(1, 0, 1), wx, 9)
  const a2 = lerp(c(0, 1, 0), c(1, 1, 0), wx, 9), a3 = lerp(c(0, 1, 1), c(1, 1, 1), wx, 9)
  const b0 = lerp(a0, a1, wz, 9), b1 = lerp(a2, a3, wz, 9)
  return lerp(b0, b1, wy, 9)
}

/** §3.6 The 128 lattice. */
function tri128(v: Int32Array, L: Lattices, x: number, y: number, z: number): number {
  const wx = W128(L.ox + x), wy = W128(L.oy + y), wz = W128(L.oz + z)
  const a0 = lerp(v[0], v[1], wx, 21), a1 = lerp(v[4], v[5], wx, 21)
  const a2 = lerp(v[2], v[3], wx, 21), a3 = lerp(v[6], v[7], wx, 21)
  const b0 = lerp(a0, a1, wz, 21), b1 = lerp(a2, a3, wz, 21)
  return lerp(b0, b1, wy, 21)
}

/** §3.7 Solid or empty, for local y 0..32 (32 is the chunk above's first layer). */
function solidAt(L: Lattices, x: number, y: number, z: number, fine: number): boolean {
  const cave8 = tri(L.cave, 8, x, y, z), cave4 = tri(L.caveD, 4, x, y, z), tun8 = tri(L.tun, 8, x, y, z)
  const bigV = tri128(L.big, L, x, y, z)
  const kS = tri(L.K16, 8, x, y, z)
  const D = 5 * cave8 + 2 * cave4 + 2 * bigV + fine
  const k0 = Math.min(15, kS >> 4), t = kS - 16 * k0
  const thr = Math.floor((EMPTY_THR[k0] * (16 - t) + EMPTY_THR[k0 + 1] * t) / 16)
  const tunnel = Math.abs(tun8 - 128) < 9 && Math.abs(cave4 - 128) < 16
  return D >= thr && !tunnel
}

/** A generated chunk. */
export interface Generated {
  blocks: Uint8Array
  /** K at each corner of the coarse lattice, (i + 5 (k + 5 j)): a cell's cube K is its low corner's. */
  kInt: Uint8Array
  meanK: number
  /** K of the chunk's costliest cube: what gates its rare blocks. */
  maxK: number
  /** Places a tree could stand (Mossveil under open air, in temperate and karst ground): the chunks trees are counted over. */
  treeSites: number
  /** The chunk's own family (its corner's 2^11 digest; cells near a soft border may take a neighbour's). */
  family: string
  /** That family's top (over open air) and its rind (DECK §3.9), for reference: nothing draws a skin. */
  top: number
  rind: number
}

/** §3.9 Soft strata borders: the 2^9 and 2^11 digests a cell's band and family come from, read at a warped place. */
function strataAt(L: Lattices, x: number, y: number, z: number, fineByte: number): { d9: Uint8Array; d11: Uint8Array } {
  const gx = tri128(L.gx, L, x, y, z) - 128, gy = tri128(L.gy, L, x, y, z) - 128, gz = tri128(L.gz, L, x, y, z) - 128
  const c = tri(L.caveD, 4, x, y, z) - 128, f = fineByte - 128
  const w9 = [(gx * 44 + c * 8 + f * 5) >> 8, (gy * 44 - c * 8 + f * 5) >> 8, (gz * 44 + c * 8 - f * 5) >> 8]
  const w11 = [(gz * 120 + c * 16 + f * 5) >> 8, (gx * 120 + c * 8 + f * 5) >> 8, (gy * 120 - c * 16 - f * 5) >> 8]
  return { d9: L.digestAt(9, x + w9[0], y + w9[1], z + w9[2]), d11: L.digestAt(11, x + w11[0], y + w11[1], z + w11[2]) }
}

/**
 * The rare band with its threshold given eligibility: floor(2^32 x target /
 * eligible share), so that the chance per surveyed chunk (eligible share
 * times threshold / 2^32) is the target. Written out as integers (a test
 * checks them against RARE_TARGET and MAXK_AT_LEAST).
 */
export const RARE_ODDS: ReadonlyArray<readonly [number, number, number]> = [
  [B.VOIDPEARL, 11, 22375156], [B.AURORIC, 11, 11187578], [B.CHRONITE, 12, 11179861], [B.GIBSONITE, 12, 7453240],
  [B.SINGULARITY, 13, 11799360], [B.RELIC, 13, 7866240], [B.GENESIS, 14, 22053747],
]

/** Bytes of the chunk's feature stream after its fine stream, read in order. */
export const FEATURE_BYTES = 8192

/** The feature stream, read in a fixed order: a draw past its end reads 0 (never reached in practice). */
class Draws {
  private i = 0
  constructor(private readonly b: Uint8Array) {}
  u8(): number { return this.i < this.b.length ? this.b[this.i++] : 0 }
  u32(): number { return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0 }
  /** Whether a 32-bit draw falls under a threshold (chance times 2^32): an integer test. */
  chance(t: number): boolean { return this.u32() < t }
}

/** The thresholds in force (tests raise them to 2^32 to test the gates alone). */
export interface Odds { features: typeof FEATURES; rare: ReadonlyArray<readonly [number, number, number]>; pools?: number }

/** §3 The ground of one chunk, revision 2: one block id per cell, idx order (coords.ts idx). */
export function generate(base: ChunkBase, odds: Odds = { features: FEATURES, rare: RARE_ODDS }): Generated {
  const L = lattices(base)
  const stream = chacha20Keystream(surveySeed(base), CELLS + FEATURE_BYTES)
  const fine = stream.subarray(0, CELLS)
  const draws = new Draws(stream.subarray(CELLS))
  const fineAbove = fineStream({ ...base, y: wrap(base.y + 32n) })
  const solid = new Uint8Array(32 * 33 * 32)
  for (let y = 0; y <= 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const f = y < 32 ? fine[idx(x, y, z)] : fineAbove[idx(x, 0, z)]
    solid[x + 32 * z + 1024 * y] = solidAt(L, x, y, z, f) ? 1 : 0
  }
  const yBase = Number(base.y & 0xffffffn)
  const out = new Uint8Array(CELLS)
  // 1. Rock: the strata of the cell's family, the fleck, and the skin on top of open air.
  for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const o = idx(x, y, z)
    if (!solid[o]) continue
    const st = strataAt(L, x, y, z, fine[o])
    const fam = FAMILIES[st.d11[1] % FAMILIES.length]
    const T = 3 + (st.d9[2] % 8)
    const warp = tri128(L.warp, L, x, y, z)
    const cave4 = tri(L.caveD, 4, x, y, z)
    const veinT = tri(L.veinT, 8, x, y, z)
    const warpOff = Math.floor((warp * 18) / 256) + Math.floor((veinT * 8) / 256) + Math.floor((cave4 * 4) / 256)
    const band = Math.floor((yBase + y + warpOff) / T)
    const h = Math.imul(band ^ (st.d9[3] << 8), 0x9e3779b1) >>> 0
    let id = pickStratum(fam.strata, h)
    if (fine[o] < 6) id = fam.speckle
    if (!solid[x + 32 * z + 1024 * (y + 1)]) id = fam.top
    out[o] = id
  }
  const fam0 = FAMILIES[L.d11[1] % FAMILIES.length]
  // The chunk's costliest cube: where the rare band is placed, and what gates it.
  let maxK = -1, maxCube = 0, sum = 0
  for (let cy = 0; cy < 4; cy++) for (let cz = 0; cz < 4; cz++) for (let cx = 0; cx < 4; cx++) {
    const k = L.K[cx + 5 * (cz + 5 * cy)]
    sum += k
    if (k > maxK) { maxK = k; maxCube = cx + 4 * (cz + 4 * cy) }
  }
  const meanK = sum / 64
  const kOf = (x: number, y: number, z: number): number => L.K[(x >> 3) + 5 * ((z >> 3) + 5 * (y >> 3))]
  const rock = (o: number): boolean => {
    const id = out[o]
    return id !== 0 && id !== B.TIDEWATER && id !== B.MAGMAFLOW && id !== B.LUMENWOOD && id !== B.CANOPY && !RARE_IDS.has(id)
  }
  // The first rock from a drawn cell of the costliest cube, round the cube in index order: found whenever the cube has any.
  const rockInCostliest = (): number => {
    const cx = 8 * (maxCube & 3), cz = 8 * ((maxCube >> 2) & 3), cy = 8 * (maxCube >> 4)
    const start = ((draws.u8() << 8) | draws.u8()) & 511
    for (let i = 0; i < 512; i++) {
      const c = (start + i) & 511
      const o = idx(cx + (c & 7), cy + (c >> 6), cz + ((c >> 3) & 7))
      if (rock(o)) return o
    }
    return -1
  }
  const f = odds.features
  // 2. Magmaflow pockets in volcanic ground of K 11 and up, with Basaltine round them.
  if (fam0.name === 'volcanic' && maxK >= f.magma.minK && draws.chance(f.magma.t)) {
    const at = rockInCostliest()
    for (let t = 0; t < 1 && at >= 0; t++) {
      const cx = at & 31, cz = (at >> 5) & 31, cy = at >> 10
      const rx = 1 + (draws.u8() % 3), ry = 1 + (draws.u8() % 2), rz = 1 + (draws.u8() % 3)
      const inside = (dx: number, dy: number, dz: number, ax: number, ay: number, az: number): boolean =>
        dx * dx * ay * ay * az * az + dy * dy * ax * ax * az * az + dz * dz * ax * ax * ay * ay <= ax * ax * ay * ay * az * az
      for (let dy = -ry - 2; dy <= ry + 2; dy++) for (let dz = -rz - 2; dz <= rz + 2; dz++) for (let dx = -rx - 2; dx <= rx + 2; dx++) {
        const x = cx + dx, y = cy + dy, z = cz + dz
        if (x < 0 || y < 0 || z < 0 || x > 31 || y > 31 || z > 31) continue
        const o = idx(x, y, z)
        if (!rock(o)) continue
        if (inside(dx, dy, dz, rx, ry, rz)) out[o] = kOf(x, y, z) >= f.magma.minK ? B.MAGMAFLOW : B.BASALTINE
        else if (inside(dx, dy, dz, rx + 2, ry + 2, rz + 2)) out[o] = B.BASALTINE
      }
      break
    }
  }
  // 3. Tidewater pools in low places, more where K is low: a basin of open cells over solid floor, 20 to 200 blocks.
  if (draws.chance(odds.pools ?? poolThreshold(sum))) {
    for (let t = 0; t < 8; t++) {
      const px = draws.u8() & 31, pz = draws.u8() & 31, r = 2 + (draws.u8() % 5)
      let floor = -1
      for (let y = 31; y > 0; y--) if (out[idx(px, y, pz)] === 0 && out[idx(px, y - 1, pz)] !== 0) { floor = y; break }
      if (floor < 0) continue
      const placed: number[] = []
      for (let y = floor; y >= Math.max(1, floor - 2) && placed.length < 200; y--) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r || placed.length >= 200) continue
          const x = px + dx, z = pz + dz
          if (x < 0 || z < 0 || x > 31 || z > 31) continue
          const o = idx(x, y, z)
          if (out[o] === 0 && out[idx(x, y - 1, z)] !== 0 && out[idx(x, y - 1, z)] !== B.LUMENWOOD) { out[o] = B.TIDEWATER; placed.push(o) }
        }
      }
      if (placed.length >= 20) break
      for (const o of placed) out[o] = 0
    }
  }
  // 4. Lumenwood trees crowned with Canopy glass, on Mossveil with open air above, in temperate and karst ground.
  //    A site is a Mossveil cell, 2 or more from the chunk's sides, with 8 open cells over it inside the chunk.
  const sites: number[] = []
  if (fam0.name === 'temperate' || fam0.name === 'karst') {
    for (let tz = 2; tz < 30; tz++) for (let tx = 2; tx < 30; tx++) {
      for (let y = 23; y >= 0; y--) {
        if (out[idx(tx, y, tz)] !== B.MOSSVEIL) continue
        let air = true
        for (let a = 1; a <= 8 && air; a++) if (out[idx(tx, y + a, tz)] !== 0) air = false
        if (air) { sites.push(idx(tx, y, tz)); break }
      }
    }
  }
  if (sites.length > 0 && draws.chance(f.trees.t)) {
    const n = 1 + (draws.u8() % 4)
    for (let t = 0; t < n; t++) {
      const site = sites[draws.u32() % sites.length], h = 4 + (draws.u8() % 3)
      const tx = site & 31, tz = (site >> 5) & 31, ground = site >> 10
      if (out[idx(tx, ground + 1, tz)] !== 0) continue
      for (let y = ground + 1; y <= ground + h; y++) out[idx(tx, y, tz)] = B.LUMENWOOD
      for (let dy = h - 1; dy <= h + 2; dy++) {
        const rr = dy <= h ? 2 : dy === h + 1 ? 1 : 0
        for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
          if (rr === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
          const o = idx(tx + dx, ground + dy, tz + dz)
          if (out[o] === 0) out[o] = B.CANOPY
        }
      }
    }
  }
  // 5. Veins: a walk of `size` steps from a start in rock, turning the rock it passes in cubes of K minK and up.
  const vein = (id: number, size: number, minK: number, inCube: number | null): void => {
    for (let t = 0; t < 8; t++) {
      let x: number, y: number, z: number
      if (inCube === null) { x = draws.u8() & 31; y = draws.u8() & 31; z = draws.u8() & 31 }
      else { x = 8 * (inCube & 3) + (draws.u8() & 7); z = 8 * ((inCube >> 2) & 3) + (draws.u8() & 7); y = 8 * (inCube >> 4) + (draws.u8() & 7) }
      if (!rock(idx(x, y, z)) || kOf(x, y, z) < minK) continue
      for (let i = 0; i < size; i++) {
        const o = idx(x, y, z)
        if (rock(o) && kOf(x, y, z) >= minK) out[o] = id
        const d = draws.u8() % 6
        const a = d >> 1, sgn = d & 1 ? 1 : -1
        if (a === 0) x = Math.min(31, Math.max(0, x + sgn))
        else if (a === 1) y = Math.min(31, Math.max(0, y + sgn))
        else z = Math.min(31, Math.max(0, z + sgn))
      }
      return
    }
  }
  if (draws.chance(f.ferrovein.t)) {
    const n = 2 + (draws.u8() % 4)
    for (let i = 0; i < n; i++) vein(B.FERROVEIN, 4 + (draws.u8() % 9), 0, null)
  }
  if (maxK >= f.cobaltine.minK && draws.chance(f.cobaltine.t)) {
    const n = 1 + (draws.u8() % 2)
    for (let i = 0; i < n; i++) vein(B.COBALTINE, 3 + (draws.u8() % 6), f.cobaltine.minK, null)
  }
  if (maxK >= f.prismite.minK && draws.chance(f.prismite.t)) vein(B.PRISMITE, 4 + (draws.u8() % 7), f.prismite.minK, null)
  if (maxK >= f.glowcore.minK && draws.chance(f.glowcore.t)) vein(B.GLOWCORE, 2 + (draws.u8() % 7), f.glowcore.minK, maxCube)
  // 6. The rare band: one block (never a vein) in the chunk's costliest cube, rarer kinds needing higher K.
  for (const [id, minK, p] of odds.rare) {
    if (maxK < minK || !draws.chance(p)) continue
    const o = rockInCostliest()
    if (o >= 0) out[o] = id
  }
  return { blocks: out, kInt: Uint8Array.from(L.K), meanK, maxK, treeSites: sites.length, family: fam0.name, top: fam0.top, rind: fam0.rind }
}

/** K of a chunk's costliest cube, from its 64 cube digests and the three it shares (a chunk lies inside one cell of 2^7 and up). */
export function chunkMaxK(base: ChunkBase): number {
  let big = 0
  for (const b of [7, 9, 11]) big += popcount4(terrainDigest(b, base.x, base.y, base.z, base.plane)[0] & 15)
  let best = 0
  for (let c = 0; c < 64; c++) {
    const d = terrainDigest(3, base.x + BigInt(8 * (c & 3)), base.y + BigInt(8 * (c >> 4)), base.z + BigInt(8 * ((c >> 2) & 3)), base.plane)
    best = Math.max(best, popcount4(d[0] & 15))
  }
  return big + best
}

/** K of the cube a chunk-local cell sits in (its low lattice corner, as §3.9 reads it). */
export function cubeK(g: Pick<Generated, 'kInt'>, o: number): number {
  const x = o & 31, z = (o >> 5) & 31, y = o >> 10
  return g.kInt[(x >> 3) + 5 * ((z >> 3) + 5 * (y >> 3))]
}
