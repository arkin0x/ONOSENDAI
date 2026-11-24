/**
 * terrainGenerate.test.ts - TERRAIN's ground (lib/terrain/generate.ts) is
 * DECK-0009's: the survey seed, the ChaCha20 stream and every block of the
 * DECK's test vector chunks match (fixtures/deck0009-vectors.json, from the
 * draft's blocks-vectors.json); terrain K is the spec's; the veins wait for
 * the cubes their K allows; the reach rule is the DECK's; and a chunk is
 * fast enough for a phone.
 */

import { describe, expect, it } from 'vitest'
import { bigintTo32Bytes, deriveRegionKeys, terrainK, xyzToCoord, coordToXyz } from 'cyberspace-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { fastCoordBytes, chunkKey, parseChunkKey, chunkOf, CELLS, type ChunkBase } from '../terrain/coords'
import { RELIC, RELIC_MIN_K, VEINS, chacha20Keystream, cubeK, fineStream, generate, kAt, surveySeed } from '../terrain/generate'
import { reachDistance } from '../terrain/world'
import { EMPTY, KINDS, blockKind, blockName, DECK_TO_KIND } from '../terrain/blocks'
import { regionKeyAt } from '../shardCrypto'
import VECTORS from './fixtures/deck0009-vectors.json'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function axis(r: () => number): bigint {
  let v = 0n
  for (let i = 0; i < 3; i++) v = (v << 32n) | BigInt((r() * 4294967296) >>> 0)
  return v & ((1n << 85n) - 1n)
}
const randomChunk = (r: () => number, plane = 0): ChunkBase => chunkOf(axis(r), axis(r), axis(r), plane)
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)))
const base = (c: { X: string; Y: string; Z: string; plane: number }): ChunkBase => ({ x: BigInt(c.X), y: BigInt(c.Y), z: BigInt(c.Z), plane: c.plane })

describe('the table-driven coordinate builder', () => {
  it('writes exactly what cyberspace-core writes, on random coordinates and the axis ends', () => {
    const r = rng(5)
    const max = (1n << 85n) - 1n
    const cases: Array<[bigint, bigint, bigint, number]> = [[0n, 0n, 0n, 0], [max, max, max, 1], [max, 0n, max, 0], [1n, 2n, 3n, 1]]
    for (let i = 0; i < 400; i++) cases.push([axis(r), axis(r), axis(r), i & 1])
    for (const [x, y, z, p] of cases) expect(hex(fastCoordBytes(x, y, z, p))).toBe(hex(bigintTo32Bytes(xyzToCoord(x, y, z, p as 0 | 1))))
  })

  it('names chunks the same way on every device, and reads the name back', () => {
    const c = chunkOf(0x12345n, 0x6789an, 0xbcdefn, 1)
    expect(c).toEqual({ x: 0x12340n, y: 0x67880n, z: 0xbcde0n, plane: 1 })
    expect(parseChunkKey(chunkKey(c))).toEqual(c)
    expect(parseChunkKey('1:12345:0:0')).toBeNull()
  })
})

describe('terrain K', () => {
  it('is the spec\'s own, gibson by gibson', () => {
    const r = rng(11)
    for (let i = 0; i < 40; i++) {
      const x = axis(r), y = axis(r), z = axis(r), p = (i & 1) as 0 | 1
      expect(kAt(x, y, z, p)).toBe(terrainK(x, y, z, p))
    }
  })
})

describe('DECK-0009 test vectors', () => {
  it('ChaCha20 gives the RFC keystream the DECK checks', () => {
    const c = VECTORS.chacha20_check
    expect(hex(chacha20Keystream(unhex(c.key), 32))).toBe(c.keystream_head)
  })

  for (const c of VECTORS.chunks) {
    it(`the ${c.name} chunk: the survey seed, the stream and every block`, () => {
      const b = base(c)
      const seed = surveySeed(b)
      expect(hex(seed)).toBe(c.survey_seed)
      // The seed is never the region key (DECK §3.2).
      expect(hex(seed)).not.toBe(hex(deriveRegionKeys(regionKeyAt(b, 5, 5).regionN).locationDecryptionKey))
      expect(hex(fineStream(b).slice(0, 32))).toBe(c.stream_head)
      const g = generate(b)
      expect(g.family).toBe(c.family)
      // The cube K the DECK lists: the 64 cubes' own corners of the 5 by 5 by 5 lattice.
      const cubes: number[] = []
      for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) cubes.push(g.kInt[x + 5 * (z + 5 * y)])
      expect(cubes).toEqual(c.cube_K)
      const counts: Record<string, number> = {}
      for (const id of g.blocks) counts[id] = (counts[id] ?? 0) + 1
      expect(counts).toEqual(c.counts)
      expect(hex(sha256(g.blocks))).toBe(c.ground_sha256)
    })
  }

  for (const v of VECTORS.reach) {
    it(`reach: ${v.name}`, () => {
      const at = coordToXyz(BigInt(`0x${v.coord}`))
      const chunk = { x: BigInt(v.chunk[0]), y: BigInt(v.chunk[1]), z: BigInt(v.chunk[2]), plane: Number(v.chunk[3]) }
      const d = reachDistance({ x: at.x, y: at.y, z: at.z, plane: at.plane }, chunk)
      expect(d === Infinity ? null : d).toBe(v.distance)
      expect(d <= 16).toBe(v.within_reach)
    })
  }
})

describe('the ground', () => {
  it('is the same for the same chunk, every time, and differs between chunks and planes', () => {
    const c = base(VECTORS.chunks[0])
    const a = hex(sha256(generate(c).blocks))
    expect(hex(sha256(generate({ ...c }).blocks))).toBe(a)
    expect(hex(sha256(generate({ ...c, x: c.x + 32n }).blocks))).not.toBe(a)
    expect(hex(sha256(generate({ ...c, plane: 1 }).blocks))).not.toBe(a)
  })

  it('every block it makes has one of the thirteen names, never another game\'s', () => {
    const r = rng(21)
    const names = new Set(KINDS.map((k) => k.name))
    for (let i = 0; i < 4; i++) {
      for (const id of generate(randomChunk(r, i & 1)).blocks) {
        if (id === EMPTY) continue
        expect(DECK_TO_KIND[id]).toBeDefined()
        expect(names.has(blockName(id))).toBe(true)
      }
    }
    expect(blockKind(300)?.name).toBe('Unknown block')
    for (const k of KINDS) expect(blockKind(k.id)).toBe(k)
  })
})

describe('terrain K decides', () => {
  it('veins appear only in cubes of their K or more, and costlier cubes are more solid', () => {
    const r = rng(77)
    const gate = new Map<number, number>([...VEINS.map((v) => [v[0], v[2]] as [number, number]), [RELIC, RELIC_MIN_K]])
    const low = { cells: 0, open: 0 }, high = { cells: 0, open: 0 }
    const chunks = [...VECTORS.chunks.map(base)]
    for (let i = 0; i < 4; i++) chunks.push(randomChunk(r))
    for (const c of chunks) {
      const g = generate(c)
      for (let o = 0; o < CELLS; o++) {
        const id = g.blocks[o], kc = cubeK(g, o)
        // Prismite (8) is crystal rock as well as a vein, so only the other veins are gated everywhere.
        const min = id === 8 ? undefined : gate.get(id)
        if (min !== undefined) expect(kc).toBeGreaterThanOrEqual(min)
        const bucket = kc <= 8 ? low : kc >= 12 ? high : null
        if (!bucket) continue
        bucket.cells++
        if (id === EMPTY) bucket.open++
      }
    }
    expect(low.cells).toBeGreaterThan(0)
    expect(high.cells).toBeGreaterThan(0)
    expect(high.open / high.cells).toBeLessThan(low.open / low.cells)
  })
})

describe('speed', () => {
  it('generates a chunk well inside a phone\'s frame budget on this machine', () => {
    const r = rng(3)
    generate(randomChunk(r))
    const times: number[] = []
    for (let i = 0; i < 7; i++) {
      const c = randomChunk(r)
      const t0 = performance.now()
      generate(c)
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    // Tens of milliseconds here unloaded; the bound leaves room for a loaded test machine.
    expect(times[3]).toBeLessThan(250)
  })
})
