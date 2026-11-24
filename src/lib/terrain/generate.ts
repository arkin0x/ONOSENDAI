/**
 * generate.ts - the ground of one chunk, from public facts only: DECK-0009
 * (Blocks, draft, cyberspace PR #122) §3, revision 1, ported from its
 * reference code (decks/blocks-reference.mjs) and checked against its test
 * vectors (lib/__tests__/terrainGenerate.test.ts), so every client draws the
 * same block in every cell.
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
 * - Materials: the strata of one of six families (from the 2^11 digest, read
 *   at a warped place so family and band borders are soft), a fleck, a skin
 *   on top of open air, veins (Ferrovein, Cobaltine from K 6, Prismite from 9,
 *   Glowcore from 10, Gibsonite from 13) and the Relic shard from 13.
 *
 * Every value that decides a block is an integer below 2^53. Block ids are
 * the DECK's registry, which is the previews' block set (blocks.ts).
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { regionKeyAt } from '../shardCrypto'
import { CELLS, fastCoordBytes, idx, type ChunkBase } from './coords'

/** Which ground a layer's diff is against: the DECK's `ground` revision. */
export const GENERATOR_VERSION = 1

const enc = new TextEncoder()
const TERRAIN_DOMAIN = enc.encode('CYBERSPACE_TERRAIN_K_V2')
/** DECK-0009 §3.2. */
export const SURVEY_DOMAIN = enc.encode('CYBERSPACE_BLOCKS_SURVEY_V1')

const AXIS_MASK = (1n << 85n) - 1n
const wrap = (v: bigint): bigint => v & AXIS_MASK

// §3.6 Smoothstep weights.
const W8 = [0, 22, 80, 162, 256, 350, 432, 490, 512]
const W128 = (f: number): number => 384 * f * f - 2 * f * f * f

// §3.8 Thresholds, revision 1.
export const EMPTY_THR = [1337, 1323, 1308, 1294, 1280, 1266, 1253, 1239, 1225, 1211, 1196, 1182, 1168, 1153, 1138, 1123, 1108]
export const VEIN_THR = [3884, 3854, 3827, 3802, 3779, 3757, 3736, 3717, 3698, 3681, 3664, 3648, 3633, 3618, 3603, 3590, 3576]
export const RELIC_THR = 4508

/**
 * §3.9 Families: strata (a band picked by a hash), the skin on top of open
 * air, the fleck, and the rind, which is not ground: the band rock a client
 * draws on a chunk face bordering an unsurveyed chunk (the drawn-only skin).
 */
export const FAMILIES: ReadonlyArray<{ name: string; strata: readonly number[]; top: number; speckle: number; rind: number }> = [
  { name: 'temperate', strata: [1, 1, 2, 1, 5, 1, 2, 3], top: 4, speckle: 2, rind: 2 },
  { name: 'dune', strata: [3, 5, 1, 3, 2, 5], top: 3, speckle: 5, rind: 1 },
  { name: 'frozen', strata: [6, 6, 1, 6, 2, 1], top: 6, speckle: 2, rind: 2 },
  { name: 'volcanic', strata: [7, 2, 7, 5, 1, 2, 7], top: 7, speckle: 5, rind: 2 },
  { name: 'crystal', strata: [6, 1, 6, 2, 8, 1, 6, 2], top: 6, speckle: 8, rind: 2 },
  { name: 'karst', strata: [1, 3, 1, 2, 1, 3], top: 4, speckle: 3, rind: 2 },
]
/** §3.9 Veins: [id, weight, the least cube K it appears in], in this order. */
export const VEINS: ReadonlyArray<readonly [number, number, number]> = [[40, 55, 0], [41, 25, 6], [8, 12, 9], [42, 3, 10], [43, 2, 13]]
export const RELIC = 192
export const RELIC_MIN_K = 13

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
  /** The chunk's own family (its corner's 2^11 digest; cells near a soft border may take a neighbour's). */
  family: string
  /** That family's skin on top of open air and its rind: what the drawn-only chunk skin uses (lib/terrain/mesh.ts). */
  top: number
  rind: number
}

/** §3.9 The vein field, the vein kind field and its stretch u (0..255). */
function veinValues(L: Lattices, x: number, y: number, z: number): { vein: number; veinT: number; u: number } {
  const vein = 11 * tri(L.vein, 8, x, y, z) + 9 * tri(L.veinD, 4, x, y, z)
  const veinT = tri(L.veinT, 8, x, y, z)
  const s = 9 * veinT - 512
  return { vein, veinT, u: s <= 0 ? 0 : Math.min(255, Math.floor(s / 5)) }
}

/** §3.9 Soft strata borders: the 2^9 and 2^11 digests a cell's band and family come from, read at a warped place. */
function strataAt(L: Lattices, x: number, y: number, z: number, fineByte: number): { d9: Uint8Array; d11: Uint8Array } {
  const gx = tri128(L.gx, L, x, y, z) - 128, gy = tri128(L.gy, L, x, y, z) - 128, gz = tri128(L.gz, L, x, y, z) - 128
  const c = tri(L.caveD, 4, x, y, z) - 128, f = fineByte - 128
  const w9 = [(gx * 44 + c * 8 + f * 5) >> 8, (gy * 44 - c * 8 + f * 5) >> 8, (gz * 44 + c * 8 - f * 5) >> 8]
  const w11 = [(gz * 120 + c * 16 + f * 5) >> 8, (gx * 120 + c * 8 + f * 5) >> 8, (gy * 120 - c * 16 - f * 5) >> 8]
  return { d9: L.digestAt(9, x + w9[0], y + w9[1], z + w9[2]), d11: L.digestAt(11, x + w11[0], y + w11[1], z + w11[2]) }
}

/** §3 The ground of one chunk: one block id per cell, idx order (coords.ts idx). */
export function generate(base: ChunkBase): Generated {
  const L = lattices(base)
  const fine = fineStream(base)
  const fineAbove = fineStream({ ...base, y: wrap(base.y + 32n) })
  const solid = new Uint8Array(32 * 33 * 32)
  for (let y = 0; y <= 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const f = y < 32 ? fine[idx(x, y, z)] : fineAbove[idx(x, 0, z)]
    solid[x + 32 * z + 1024 * y] = solidAt(L, x, y, z, f) ? 1 : 0
  }
  const yBase = Number(base.y & 0xffffffn)
  const out = new Uint8Array(CELLS)
  for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const o = idx(x, y, z)
    if (!solid[o]) continue
    const kc = L.K[(x >> 3) + 5 * ((z >> 3) + 5 * (y >> 3))]
    const v = veinValues(L, x, y, z)
    let id = 0
    if (kc >= RELIC_MIN_K && v.vein >= RELIC_THR) id = RELIC
    else if (v.vein >= VEIN_THR[kc]) {
      let total = 0
      for (const [, w, mk] of VEINS) if (kc >= mk) total += w
      let r = Math.floor((v.u * total) / 256)
      for (const [vid, w, mk] of VEINS) { if (kc < mk) continue; if (r < w) { id = vid; break } r -= w }
    } else {
      const st = strataAt(L, x, y, z, fine[o])
      const fam = FAMILIES[st.d11[1] % FAMILIES.length]
      const T = 3 + (st.d9[2] % 8)
      const warp = tri128(L.warp, L, x, y, z)
      const cave4 = tri(L.caveD, 4, x, y, z)
      const warpOff = Math.floor((warp * 18) / 256) + Math.floor((v.veinT * 8) / 256) + Math.floor((cave4 * 4) / 256)
      const band = Math.floor((yBase + y + warpOff) / T)
      const h = Math.imul(band ^ (st.d9[3] << 8), 0x9e3779b1) >>> 0
      id = fam.strata[(h >>> 16) % fam.strata.length]
      if (fine[o] < 6) id = fam.speckle
      if (!solid[x + 32 * z + 1024 * (y + 1)]) id = fam.top
    }
    out[o] = id
  }
  const fam0 = FAMILIES[L.d11[1] % FAMILIES.length]
  const kInt = Uint8Array.from(L.K)
  let sum = 0
  for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) sum += kInt[x + 5 * (z + 5 * y)]
  return { blocks: out, kInt, meanK: sum / 64, family: fam0.name, top: fam0.top, rind: fam0.rind }
}

/** K of the cube a chunk-local cell sits in (its low lattice corner, as §3.9 reads it). */
export function cubeK(g: Pick<Generated, 'kInt'>, o: number): number {
  const x = o & 31, z = (o >> 5) & 31, y = o >> 10
  return g.kInt[(x >> 3) + 5 * ((z >> 3) + 5 * (y >> 3))]
}
