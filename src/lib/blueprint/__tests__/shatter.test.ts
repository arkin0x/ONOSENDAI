import { describe, expect, it } from 'vitest'
import {
  FREE_MS, SHATTER_CAPS, TRIS_PER_BLOCK, buildDust, buildRadius, buildShatter, linearRgb, shareOut, shatterCap, smashBusy,
} from '../shatter'

/** A solid box of Gridstone, w by h by d, from the origin. */
function box(w: number, h: number, d: number, id = 1): Array<{ at: [number, number, number]; id: number }> {
  const out: Array<{ at: [number, number, number]; id: number }> = []
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push({ at: [x, y, z], id })
  return out
}

describe('shatterCap', () => {
  it('is the phone cap on a phone, and by cores a laptop or a desktop otherwise', () => {
    expect(shatterCap('phone', 16)).toBe(SHATTER_CAPS.phone)
    expect(shatterCap('desktop', 4)).toBe(SHATTER_CAPS.laptop)
    expect(shatterCap('desktop', 8)).toBe(SHATTER_CAPS.desktop)
  })
})

describe('shareOut', () => {
  it('gives each block the full count when the cap allows', () => {
    expect(shareOut(5, 8_000)).toEqual([48, 48, 48, 48, 48])
  })

  it('stays under the cap and shares it evenly', () => {
    // The design's example: 47 blocks on a phone get about 32 each.
    const s = shareOut(47, SHATTER_CAPS.phone)
    expect(s.reduce((a, b) => a + b, 0)).toBe(SHATTER_CAPS.phone)
    expect(Math.min(...s)).toBe(31)
    expect(Math.max(...s)).toBe(32)
  })

  it('gives one triangle to an even spread of blocks when there are more blocks than the cap', () => {
    const s = shareOut(4_096, SHATTER_CAPS.phone)
    expect(s.reduce((a, b) => a + b, 0)).toBe(SHATTER_CAPS.phone)
    expect(Math.max(...s)).toBe(1)
    // Spread through the whole build, not piled at the front.
    expect(s.slice(0, 2_048).reduce((a, b) => a + b, 0)).toBeGreaterThan(700)
    expect(s.slice(2_048).reduce((a, b) => a + b, 0)).toBeGreaterThan(700)
  })

  it('draws a third with reduced motion', () => {
    expect(shareOut(10, 8_000, true).reduce((a, b) => a + b, 0)).toBe(160)
    expect(shareOut(47, SHATTER_CAPS.phone, true).reduce((a, b) => a + b, 0)).toBe(500)
  })

  it('gives nothing to no blocks', () => {
    expect(shareOut(0, 1_500)).toEqual([])
  })
})

describe('buildShatter', () => {
  const blocks = box(4, 3, 4)
  const centre = [2, 1.5, 2] as const

  it('makes as many triangles as the share, with every array the right length', () => {
    const s = buildShatter(blocks, centre, { cap: SHATTER_CAPS.phone, seed: 7 })
    expect(s.count).toBe(Math.min(SHATTER_CAPS.phone, blocks.length * TRIS_PER_BLOCK))
    for (const a of [s.start, s.motion, s.spin, s.look]) expect(a.length).toBe(s.count * 4)
  })

  it('a third of the triangles with reduced motion', () => {
    const full = buildShatter(blocks, centre, { cap: 8_000, seed: 7 })
    const calm = buildShatter(blocks, centre, { cap: 8_000, seed: 7, calm: true })
    expect(calm.count).toBe(Math.floor(full.count / 3))
  })

  it('starts each triangle inside a smashed block, flying a unit direction, turning on a unit axis', () => {
    const s = buildShatter(blocks, centre, { cap: 8_000, seed: 3 })
    for (let i = 0; i < s.count; i++) {
      const o = i * 4
      for (let a = 0; a < 3; a++) {
        expect(s.start[o + a]).toBeGreaterThanOrEqual(0)
        expect(s.start[o + a]).toBeLessThanOrEqual(a === 1 ? 3 : 4)
      }
      expect(s.start[o + 3]).toBeGreaterThanOrEqual(0)
      expect(s.start[o + 3]).toBeLessThanOrEqual(0.2)
      expect(Math.hypot(s.motion[o], s.motion[o + 1], s.motion[o + 2])).toBeCloseTo(1, 4)
      expect(s.motion[o + 3]).toBeGreaterThan(0)
      expect(Math.hypot(s.spin[o], s.spin[o + 1], s.spin[o + 2])).toBeCloseTo(1, 4)
      expect(s.look[o + 3]).toBeGreaterThan(0)
    }
  })

  it('carries the block colour (face or accent), linear', () => {
    const s = buildShatter([{ at: [0, 0, 0], id: 4 }], [0.5, 0.5, 0.5], { cap: 8_000, seed: 1 })
    const face = linearRgb('#00ba67'), edge = linearRgb('#00f39e')
    for (let i = 0; i < s.count; i++) {
      const c = [s.look[i * 4], s.look[i * 4 + 1], s.look[i * 4 + 2]]
      const isFace = c.every((v, a) => Math.abs(v - face[a]) < 1e-6)
      const isEdge = c.every((v, a) => Math.abs(v - edge[a]) < 1e-6)
      expect(isFace || isEdge).toBe(true)
    }
  })

  it('is the same for the same seed, and different for another', () => {
    const a = buildShatter(blocks, centre, { cap: 4_000, seed: 42 })
    const b = buildShatter(blocks, centre, { cap: 4_000, seed: 42 })
    const c = buildShatter(blocks, centre, { cap: 4_000, seed: 43 })
    expect(Array.from(a.start)).toEqual(Array.from(b.start))
    expect(Array.from(a.motion)).toEqual(Array.from(b.motion))
    expect(Array.from(a.spin)).toEqual(Array.from(b.spin))
    expect(Array.from(a.look)).toEqual(Array.from(b.look))
    expect(Array.from(a.start)).not.toEqual(Array.from(c.start))
  })

  it('reaches the far corner of the build', () => {
    expect(buildRadius([{ at: [0, 0, 0], id: 1 }], [0.5, 0.5, 0.5])).toBeCloseTo(Math.sqrt(3) / 2, 6)
  })
})

describe('buildDust', () => {
  it('makes the motes asked for, sinking', () => {
    const d = buildDust([0, 0, 0], 2, 100, 5)
    expect(d.at.length).toBe(300)
    for (let i = 0; i < 100; i++) expect(d.drift[i * 3 + 1]).toBeLessThan(0)
  })
})

describe('smashBusy', () => {
  const struck = 10_000
  it('is busy through the shatter, and while the outcome is pending', () => {
    expect(smashBusy(null, struck)).toBe(false)
    expect(smashBusy({ struck, outcome: 'pending', resolvedAt: null }, struck + 500)).toBe(true)
    expect(smashBusy({ struck, outcome: 'pending', resolvedAt: null }, struck + 60_000)).toBe(true)
  })

  it('stops once the ending has played', () => {
    expect(smashBusy({ struck, outcome: 'miss', resolvedAt: struck + 300 }, struck + 2_000)).toBe(true)
    expect(smashBusy({ struck, outcome: 'miss', resolvedAt: struck + 300 }, struck + 3_000)).toBe(false)
    expect(smashBusy({ struck, outcome: 'match', resolvedAt: struck + 300 }, struck + FREE_MS + 1)).toBe(true)
    expect(smashBusy({ struck, outcome: 'match', resolvedAt: struck + 300 }, struck + 2_000)).toBe(false)
  })
})
