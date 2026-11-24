/**
 * terrainLayerWriter.test.ts - the next version of a layer (lib/terrain/
 * layerWriter.ts, DECK-0009 §5.3 and §5.5): a first version's settle claims
 * exactly its placements; a cell still placed keeps its first settle and
 * takes a new latest one only when its value changes; a cell released and
 * placed again takes a new settle; unchanged, nothing is written; past 32
 * settles the newest merge into the new one; and every version reads back
 * by the DECK's own rules.
 */

import { describe, expect, it } from 'vitest'
import { idx } from '../terrain/coords'
import { generate } from '../terrain/generate'
import { decodePlane, expandRuns, parsePlaintext, plaintextJson, settleId, type LayerPlaintext } from '../terrain/blockLayer'
import { nextPlaintext, surveyOnlyPlaintext } from '../terrain/layerWriter'
import { CELLS } from '../terrain/coords'

const ground = generate({ x: 0n, y: 0n, z: 0n, plane: 0 }).blocks
const H = '00000000000000000001a7d1f3a2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e'
const block = (height: number) => ({ height, hash: H })
const author = 'a'.repeat(64)
const lookup = '3c5d8c498f57d6d61527c53b824efe9edd768c2efd4d05acad6ea2775727c649'

/** A plaintext's plane 0 as placements by cell: value, first and latest settle heights. */
function read(p: LayerPlaintext): Map<number, { v: number; t0: number; t1: number }> {
  // It must be what a reader accepts: well formed, settles hash, claims cover first settles.
  expect(parsePlaintext(plaintextJson(p))).not.toBeNull()
  for (const s of p.settles) expect(settleId(author, lookup, s)).not.toBeNull()
  const d = decodePlane(p.planes[0], ground, p.settles.length)
  if (!d || d === 'aside') throw new Error('plane')
  const out = new Map<number, { v: number; t0: number; t1: number }>()
  d.placements.forEach((c, k) => {
    const claims = expandRuns(p.settles[d.t0[k]][3][0], CELLS, 2)!
    expect(claims[c], `cell ${c} claimed by its first settle`).toBe(1)
    expect(p.settles[d.t0[k]][0]).toBeLessThanOrEqual(p.settles[d.t1[k]][0])
    out.set(c, { v: d.values[c], t0: p.settles[d.t0[k]][0], t1: p.settles[d.t1[k]][0] })
  })
  return out
}

const a = idx(1, 30, 1), b = idx(2, 30, 1), c = idx(3, 30, 1)
const withCells = (cells: Record<number, number>): Uint8Array => {
  const v = ground.slice()
  for (const [k, id] of Object.entries(cells)) v[Number(k)] = id
  return v
}

describe('the next version of a layer', () => {
  it('a first version: one settle claiming exactly its placements', () => {
    const p = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5, [b]: 5 }), ground, block: block(100) })!
    expect(p.settles).toHaveLength(1)
    const m = read(p)
    expect([...m.keys()].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y))
    const claims = expandRuns(p.settles[0][3][0], CELLS, 2)!
    expect(claims.reduce((n, v) => n + v, 0)).toBe(2)
  })

  it('kept cells keep their first settle; a changed value takes a new latest; a new cell takes the new settle', () => {
    const v1 = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5, [b]: 5 }), ground, block: block(100) })!
    const v2 = nextPlaintext({ prev: v1, plane: 0, values: withCells({ [a]: 5, [b]: 43, [c]: 5 }), ground, block: block(110) })!
    const m = read(v2)
    expect(m.get(a)).toEqual({ v: 5, t0: 100, t1: 100 })
    expect(m.get(b)).toEqual({ v: 43, t0: 100, t1: 110 })
    expect(m.get(c)).toEqual({ v: 5, t0: 110, t1: 110 })
    // The first settle is carried unchanged, claims and all.
    expect(v2.settles[0]).toEqual(v1.settles[0])
    // The new settle claims only the new cell.
    expect(expandRuns(v2.settles[1][3][0], CELLS, 2)!.reduce((n, x) => n + x, 0)).toBe(1)
  })

  it('unchanged: nothing to write', () => {
    const v1 = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5 }), ground, block: block(100) })!
    expect(nextPlaintext({ prev: v1, plane: 0, values: withCells({ [a]: 5 }), ground, block: block(120) })).toBeNull()
  })

  it('released then placed again: a new first settle (its old claim is dead)', () => {
    const v1 = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5, [b]: 5 }), ground, block: block(100) })!
    const v2 = nextPlaintext({ prev: v1, plane: 0, values: withCells({ [b]: 5 }), ground, block: block(110) })!
    expect(read(v2).has(a)).toBe(false)
    const v3 = nextPlaintext({ prev: v2, plane: 0, values: withCells({ [a]: 5, [b]: 5 }), ground, block: block(120) })!
    expect(read(v3).get(a)).toEqual({ v: 5, t0: 120, t1: 120 })
    expect(read(v3).get(b)?.t0).toBe(100)
  })

  it('everything released: a version that only surveys, one settle claiming nothing', () => {
    const v1 = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5 }), ground, block: block(100) })!
    const v2 = nextPlaintext({ prev: v1, plane: 0, values: ground, ground, block: block(110) })!
    expect(read(v2).size).toBe(0)
    expect(v2.settles).toHaveLength(1)
    expect(v2.planes[0].pal).toEqual([null])
    expect(surveyOnlyPlaintext(0, block(1), '0'.repeat(16)).planes[0].cells).toEqual([0, -32767])
  })

  it('past 32 settles the newest merge into the new one; the oldest keep their place', () => {
    let p: LayerPlaintext | null = null
    const placed: Record<number, number> = {}
    for (let i = 0; i < 40; i++) {
      placed[idx(i % 32, 31, (i >> 5) * 4)] = 196
      p = nextPlaintext({ prev: p, plane: 0, values: withCells(placed), ground, block: block(1000 + i) })!
      expect(p.settles.length).toBeLessThanOrEqual(32)
    }
    const m = read(p!)
    expect(m.size).toBe(40)
    // The first cell still dates from the first block.
    expect(m.get(idx(0, 31, 0))?.t0).toBe(1000)
    // The new block is a settle of the last version.
    expect(p!.settles.some((s) => s[0] === 1039)).toBe(true)
  })

  it('a new settle is never earlier than one it follows (the tip went back)', () => {
    const v1 = nextPlaintext({ prev: null, plane: 0, values: withCells({ [a]: 5 }), ground, block: block(500) })!
    const v2 = nextPlaintext({ prev: v1, plane: 0, values: withCells({ [a]: 43 }), ground, block: block(490) })!
    expect(read(v2).get(a)).toEqual({ v: 43, t0: 500, t1: 500 })
  })
})
