/**
 * terrainGenerate.test.ts - TERRAIN's ground (lib/terrain/generate.ts),
 * revision 2: the survey seed, the ChaCha20 stream, cube K and the open
 * space of the DECK's test vector chunks are revision 1's
 * (fixtures/deck0009-vectors.json, from the draft's blocks-vectors.json),
 * filled only by features; terrain K is the spec's; every feature and rare
 * block waits for the K it needs; the reach rule is the DECK's; a pinned
 * chunk stays block for block; and a chunk is fast enough for a phone.
 */

import { describe, expect, it } from 'vitest'
import { bigintTo32Bytes, deriveRegionKeys, terrainK, xyzToCoord, coordToXyz } from 'cyberspace-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { fastCoordBytes, chunkKey, parseChunkKey, chunkOf, CELLS, type ChunkBase } from '../terrain/coords'
import { B, FEATURES, MAXK_AT_LEAST, RARE, RARE_ODDS, RARE_TARGET, chacha20Keystream, chunkMaxK, cubeK, fineStream, generate, kAt, surveySeed } from '../terrain/generate'
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
/** sha256 of the first vector chunk's revision 2 ground. */
const PINNED = 'e5ff10f286cb54015644230673f999ace28fb000cb268aacce577323efe96f16'
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
    it(`the ${c.name} chunk: the survey seed, the stream, cube K, and revision 1's open space filled only by features`, () => {
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
      // Revision 2 keeps revision 1's caves: the cells left open are revision 1's open cells, less those features fill.
      let open = 0, filled = 0
      for (const id of g.blocks) {
        if (id === EMPTY) open++
        else if (id === B.TIDEWATER || id === B.LUMENWOOD || id === B.CANOPY) filled++
      }
      expect(open).toBeLessThanOrEqual(c.counts['0'])
      expect(open + filled).toBeGreaterThanOrEqual(c.counts['0'])
      expect(g.maxK).toBe(Math.max(...c.cube_K))
      expect(chunkMaxK(b)).toBe(g.maxK)
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

  it('stays block for block on a pinned chunk (a change here is a new revision)', () => {
    const g = generate(base(VECTORS.chunks[0]))
    expect(hex(sha256(g.blocks))).toBe(PINNED)
  })

  it('every block it makes has one of our names, never another game\'s', () => {
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
  it('the rare band, Cobaltine, Prismite, Glowcore and Magmaflow appear only where K allows, the rare ones as single blocks', () => {
    const r = rng(77)
    const gate = new Map<number, number>([[B.COBALTINE, FEATURES.cobaltine.minK], [B.GLOWCORE, FEATURES.glowcore.minK], [B.MAGMAFLOW, FEATURES.magma.minK], ...RARE.map(([id, k]) => [id, k] as [number, number])])
    const rare = new Set(RARE.map(([id]) => id))
    const chunks = [...VECTORS.chunks.map(base)]
    for (let i = 0; i < 6; i++) chunks.push(randomChunk(r))
    // Every chance raised to 1, so the gates are what is tested.
    const odds = { features: Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, { ...v, t: 2 ** 32 }])) as unknown as typeof FEATURES, rare: RARE.map(([id, k]) => [id, k, 2 ** 32] as const), pools: 2 ** 32 }
    let seen = 0
    for (const c of chunks) {
      const g = generate(c, odds)
      const n = new Map<number, number>()
      for (let o = 0; o < CELLS; o++) {
        const id = g.blocks[o]
        const min = gate.get(id)
        if (min === undefined) continue
        seen++
        n.set(id, (n.get(id) ?? 0) + 1)
        // Veins and pockets wait for their cube's K; the rare band for the chunk's costliest cube.
        expect(rare.has(id) ? g.maxK : cubeK(g, o)).toBeGreaterThanOrEqual(min)
      }
      for (const id of rare) expect(n.get(id) ?? 0).toBeLessThanOrEqual(1)
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('the rare band\'s thresholds', () => {
  it('are floor(2^32 x target / eligible share), so a surveyed chunk holds each at the owner\'s rate', () => {
    for (const [id, k, t] of RARE_ODDS) {
      expect(t).toBe(Math.floor(4294967296 * Math.min(1, RARE_TARGET[id] / MAXK_AT_LEAST[k])))
      expect((MAXK_AT_LEAST[k] * t) / 4294967296).toBeCloseTo(RARE_TARGET[id], 9)
    }
    expect(RARE_ODDS.map(([id]) => id)).toEqual(RARE.map(([id]) => id))
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
