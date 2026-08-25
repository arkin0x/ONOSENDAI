/**
 * sectorName.test.ts — the two things v1 got wrong, asserted so they cannot
 * come back.
 *
 * v1's name was periodic in the coordinate: the word triple repeated every 20
 * sectors on an axis, and the whole string every 10,000. Those two periods are
 * tested for explicitly, along with the general property that made them
 * possible, which is that neighbouring sectors must not share a name.
 */

import { describe, it, expect } from 'vitest'
import { LEXICON, NAME_SPACE, sectorName } from './sectorName'

const sid = (sx: bigint, sy: bigint, sz: bigint) => ({ sx, sy, sz })

/** Deterministic stream, so a failure reproduces rather than vanishing. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const randomSector = (r: () => number) =>
  sid(
    BigInt(Math.floor(r() * 2 ** 40)),
    BigInt(Math.floor(r() * 2 ** 40)),
    BigInt(Math.floor(r() * 2 ** 40)),
  )

describe('lexicon', () => {
  it('has no duplicates in any list', () => {
    for (const list of Object.values(LEXICON)) {
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('reports a namespace that matches the lists', () => {
    const { ADJECTIVES, NOUNS, DESIGNATIONS } = LEXICON
    expect(NAME_SPACE).toBe(ADJECTIVES.length * NOUNS.length * DESIGNATIONS.length)
  })
})

describe('sectorName', () => {
  it('is deterministic', () => {
    const s = sid(12345678901n, 98765432109n, 55555555555n)
    expect(sectorName(s)).toBe(sectorName(s))
  })

  it('always yields three words drawn from the right list', () => {
    const r = rng(7)
    for (let i = 0; i < 500; i++) {
      const parts = sectorName(randomSector(r)).split(' ')
      expect(parts).toHaveLength(3)
      expect(LEXICON.ADJECTIVES).toContain(parts[0])
      expect(LEXICON.NOUNS).toContain(parts[1])
      expect(LEXICON.DESIGNATIONS).toContain(parts[2])
    }
  })

  it('names the sector at the origin without special-casing zero', () => {
    // fold() uses do/while precisely so an index of 0 still gets mixed.
    expect(sectorName(sid(0n, 0n, 0n))).not.toBe(sectorName(sid(1n, 0n, 0n)))
  })

  it('is NOT periodic at v1 period 20, on any axis', () => {
    // v1 indexed by `coord % 20`, so every 20th sector shared a word triple.
    const base = sid(1_000_000n, 2_000_000n, 3_000_000n)
    const name = sectorName(base)
    expect(sectorName(sid(base.sx + 20n, base.sy, base.sz))).not.toBe(name)
    expect(sectorName(sid(base.sx, base.sy + 20n, base.sz))).not.toBe(name)
    expect(sectorName(sid(base.sx, base.sy, base.sz + 20n))).not.toBe(name)
  })

  it('is NOT periodic at v1 period 10000, on any axis', () => {
    const base = sid(4_000_000n, 5_000_000n, 6_000_000n)
    const name = sectorName(base)
    expect(sectorName(sid(base.sx + 10_000n, base.sy, base.sz))).not.toBe(name)
    expect(sectorName(sid(base.sx, base.sy + 10_000n, base.sz))).not.toBe(name)
    expect(sectorName(sid(base.sx, base.sy, base.sz + 10_000n))).not.toBe(name)
  })

  it('gives 512 consecutive sectors 512 different names', () => {
    // The property underneath both periodicity tests. v1 fails this at 21.
    const names = new Set<string>()
    for (let i = 0n; i < 512n; i++) names.add(sectorName(sid(9_000_000n + i, 42n, 42n)))
    expect(names.size).toBe(512)
  })

  it('separates sectors that differ in one bit of one axis', () => {
    const r = rng(99)
    for (let i = 0; i < 300; i++) {
      const s = randomSector(r)
      for (let bit = 0n; bit < 40n; bit += 7n) {
        expect(sectorName({ ...s, sx: s.sx ^ (1n << bit) })).not.toBe(sectorName(s))
      }
    }
  })

  it('spreads names across the lexicon rather than favouring a corner', () => {
    // Chi-square would be overkill; what matters is that no slot is starved,
    // which is what a low-diffusion hash looks like.
    const r = rng(2024)
    const seen = [new Set<string>(), new Set<string>(), new Set<string>()]
    for (let i = 0; i < 60_000; i++) {
      sectorName(randomSector(r)).split(' ').forEach((w, k) => seen[k].add(w))
    }
    expect(seen[0].size).toBe(LEXICON.ADJECTIVES.length)
    expect(seen[1].size).toBe(LEXICON.NOUNS.length)
    expect(seen[2].size).toBe(LEXICON.DESIGNATIONS.length)
  })
})
