/**
 * hint.test.ts - the hider's clue (spec §7.7), checked against the spec's own
 * golden vectors from hint-reference.py and against an encoder written here
 * straight from §2.3's reference pseudocode, independent of cyberspace-core.
 */

import { describe, expect, it } from 'vitest'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { SECTOR_HINT, hintFits, hintTags, isSectorHint, parseHint, searchExponent, type HintHeights } from '../hint'
import type { Position } from '../space'

/** §2.3 xyz_to_coord, transcribed: X at bits 3, 6, ...; Y at 2, 5, ...; Z at 1, 4, ...; the plane at bit 0. */
function referenceCoord(x: bigint, y: bigint, z: bigint, plane: number): string {
  let c = BigInt(plane & 1)
  for (let i = 0n; i < 85n; i++) {
    c |= ((z >> i) & 1n) << (1n + i * 3n)
    c |= ((y >> i) & 1n) << (2n + i * 3n)
    c |= ((x >> i) & 1n) << (3n + i * 3n)
  }
  return c.toString(16).padStart(64, '0')
}

/** hint-reference.py's hint_tags, transcribed, for cases the golden table does not cover. */
function referenceHintTags(p: Position, plane: number, [hx, hy, hz]: HintHeights): string[][] {
  const base = (v: bigint, h: number): bigint => (v >> BigInt(h)) << BigInt(h)
  const b = [base(p.x, hx), base(p.y, hy), base(p.z, hz)]
  const tags = [['hint', referenceCoord(b[0], b[1], b[2], plane), String(hx), String(hy), String(hz)]]
  const known: string[] = []
  ;(['X', 'Y', 'Z'] as const).forEach((name, i) => {
    if ([hx, hy, hz][i] <= 30) { known.push((b[i] >> 30n).toString()); tags.push([name, known[known.length - 1]]) } else known.push('')
  })
  if (known.every((k) => k !== '')) tags.push(['S', known.join('-')])
  return tags
}

const LONDON = 'c492492492492492492492edf5bee7267451c787d95ba4d7840c76d1e33c9940'
const london = (() => { const { x, y, z } = coordToXyz(hexToCoord(LONDON)); return { x, y, z } })()
const IDEA = { x: (1n << 84n) + 12345n, y: 3n * (1n << 80n) + 777n, z: (1n << 85n) - 1n - 4242n }

describe('the §2.3 encoder this test trusts', () => {
  it('reproduces the §9.8 london golden coordinate', () => {
    expect(referenceCoord(london.x, london.y, london.z, 0)).toBe(LONDON)
  })
})

describe('hintTags against the spec golden vectors (§7.7, hint-reference.py)', () => {
  it('london_h5_box11', () => {
    expect(hintTags(london, 0, [11, 11, 11])).toEqual([
      ['hint', 'c492492492492492492492edf5bee7267451c787d95ba4d7840c76d000000000', '11', '11', '11'],
      ['X', '18014398541305938'], ['Y', '18014398549232983'], ['Z', '18014398509410999'],
      ['S', '18014398541305938-18014398549232983-18014398509410999'],
    ])
  })

  it('london_h5_x_exact', () => {
    expect(hintTags(london, 0, [5, 14, 14])).toEqual([
      ['hint', 'c492492492492492492492edf5bee7267451c787d95ba4d7840c749041240000', '5', '14', '14'],
      ['X', '18014398541305938'], ['Y', '18014398549232983'], ['Z', '18014398509410999'],
      ['S', '18014398541305938-18014398549232983-18014398509410999'],
    ])
  })

  it('ideaspace_h8_y_open: an axis above 30 gets no sector tag, and then no S', () => {
    expect(IDEA.x).toBe(coordToXyz(hexToCoord('a4b64924924924924924924924924924924924924924924924924d84b60d9c8f')).x)
    expect(hintTags(IDEA, 1, [12, 40, 12])).toEqual([
      ['hint', 'a4b64924924924924924924924924924924924924924924924924d8000000001', '12', '40', '12'],
      ['X', '18014398509481984'], ['Z', '36028797018963967'],
    ])
  })
})

describe('the sector hint (heights of 30 name exactly one sector)', () => {
  // Produced by hint-reference.py's hint_tags(point, plane, (30, 30, 30)).
  it('london, dataspace', () => {
    expect(hintTags(london, 0, SECTOR_HINT)).toEqual([
      ['hint', 'c492492492492492492492edf5bee7267451c787d80000000000000000000000', '30', '30', '30'],
      ['X', '18014398541305938'], ['Y', '18014398549232983'], ['Z', '18014398509410999'],
      ['S', '18014398541305938-18014398549232983-18014398509410999'],
    ])
  })

  it('ideaspace keeps its plane bit and its own sectors', () => {
    expect(hintTags(IDEA, 1, SECTOR_HINT)).toEqual([
      ['hint', 'a4b6492492492492492492492492492492492492480000000000000000000001', '30', '30', '30'],
      ['X', '18014398509481984'], ['Y', '3377699720527872'], ['Z', '36028797018963967'],
      ['S', '18014398509481984-3377699720527872-36028797018963967'],
    ])
  })

  it('agrees with the transcribed reference at many points, and every point of a sector gives the same tags', () => {
    let seed = 0x2545f4914f6cdd1dn
    const rand85 = (): bigint => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 128n) - 1n); return seed & ((1n << 85n) - 1n) }
    for (let i = 0; i < 40; i++) {
      const p = { x: rand85(), y: rand85(), z: rand85() }
      const plane = (i % 2) as 0 | 1
      const tags = hintTags(p, plane, SECTOR_HINT)
      expect(tags).toEqual(referenceHintTags(p, plane, SECTOR_HINT))
      // The base: the low 30 bits of every axis zero, the plane bit as given.
      const base = coordToXyz(hexToCoord(tags[0][1]))
      for (const v of [base.x, base.y, base.z]) expect(v & ((1n << 30n) - 1n)).toBe(0n)
      expect(base.plane).toBe(plane)
      // Anywhere else in the same sector writes the same hint (canonical form).
      const other = { x: p.x ^ ((1n << 30n) - 1n), y: p.y | ((1n << 30n) - 1n), z: (p.z >> 30n) << 30n }
      expect(hintTags(other, plane, SECTOR_HINT)).toEqual(tags)
    }
  })
})

describe('parseHint (§7.7 malformed hints are absent)', () => {
  const good = hintTags(london, 0, [11, 11, 11])
  const hex = good[0][1]

  it('reads back what hintTags wrote, and the sector hint', () => {
    expect(parseHint(good, 5)?.heights).toEqual([11, 11, 11])
    const sector = parseHint(hintTags(IDEA, 1, SECTOR_HINT), 12)!
    expect(sector.heights).toEqual(SECTOR_HINT)
    expect(sector.plane).toBe(1)
    expect(isSectorHint(sector.heights)).toBe(true)
  })

  it('refuses each malformation hint-reference.py lists', () => {
    expect(parseHint([['hint', hex, '4', '11', '11']], 5)).toBeNull()
    expect(parseHint([['hint', hex, '11', '11', '86']], 5)).toBeNull()
    expect(parseHint([['hint', hex, '11', '11']], 5)).toBeNull()
    expect(parseHint([['hint', hex, '11', '11', '011']], 5)).toBeNull()
    expect(parseHint([['hint', 'zz'.repeat(32), '11', '11', '11']], 5)).toBeNull()
    expect(parseHint([['hint', LONDON, '11', '11', '11']], 5)).toBeNull()
    expect(parseHint([['d', '00'.repeat(32)]], 5)).toBeNull()
    expect(parseHint(good, 11)).not.toBeNull()
    expect(parseHint(good, 12)).toBeNull()
  })

  it('refuses two hint tags, and a whole-axis height whose base is not 0', () => {
    expect(parseHint([...good, good[0]], 5)).toBeNull()
    expect(parseHint([['hint', referenceCoord(0n, 0n, 0n, 0), '85', '85', '85']], 5)?.heights).toEqual([85, 85, 85])
    expect(parseHint([['hint', referenceCoord(1n << 84n, 0n, 0n, 0), '85', '85', '85']], 5)).toBeNull()
  })
})

describe('the search the sector hint saves (§7.7 "Why the hint is a knob")', () => {
  it('is 2^3(85-h) regions of height h in all of cyberspace, 2^3(30-h) in one sector', () => {
    expect(searchExponent(12, 85)).toBe(219)
    expect(searchExponent(12, 30)).toBe(54)
    expect(searchExponent(0, 30)).toBe(90)
    expect(searchExponent(30, 30)).toBe(0)
  })

  it('a hint must be at least the bag height and at most 85', () => {
    expect(hintFits(SECTOR_HINT, 30)).toBe(true)
    expect(hintFits(SECTOR_HINT, 31)).toBe(false)
    expect(hintFits([85, 85, 86], 0)).toBe(false)
  })
})
