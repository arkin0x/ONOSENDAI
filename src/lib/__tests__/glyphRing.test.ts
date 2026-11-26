/**
 * glyphRing.test.ts: the glyph ring round a letter (owner, 2026-11-26: "make
 * the glyph ring's glyphs randomly change to different characters. keep the
 * ring spin effect"): its glyphs are the cipher's, its changes are random but
 * bounded and the same under the same seed, and far off it thins evenly.
 */
import { describe, expect, it } from 'vitest'
import { GLYPHS } from '../decode'
import {
  CHANGES_PER_RING_S, MAX_CHANGES_PER_FRAME, RING_GLYPHS, RING_GLYPHS_FAR, RING_HIDE_PX, RING_THIN_PX,
  changeBudget, glyphChanges, mulberry32, ringAngle, ringRank, ringShown, ringStart,
} from '../glyphRing'

describe('the glyph ring', () => {
  it('starts from its message: the same key, the same glyphs, every one a cipher glyph', () => {
    const a = ringStart('msg-1')
    expect(a).toHaveLength(RING_GLYPHS)
    expect(ringStart('msg-1')).toEqual(a)
    expect(ringStart('msg-2')).not.toEqual(a)
    for (const g of a) { expect(Number.isInteger(g)).toBe(true); expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThan(GLYPHS.length) }
  })

  it('changes glyphs at random, the same under the same seed', () => {
    const one = glyphChanges(mulberry32(42), 240, 20)
    const two = glyphChanges(mulberry32(42), 240, 20)
    expect(one).toEqual(two)
    expect(glyphChanges(mulberry32(43), 240, 20)).not.toEqual(one)
  })

  it('never changes more than the cap in a frame, nor anything outside the rings or the glyph set', () => {
    const rng = mulberry32(7)
    for (const [slots, count] of [[24, 3], [24, 500], [4800, 10_000], [0, 5], [10, -3]] as const) {
      const out = glyphChanges(rng, slots, count)
      expect(out.length).toBeLessThanOrEqual(MAX_CHANGES_PER_FRAME)
      expect(out.length).toBe(slots > 0 ? Math.max(0, Math.min(count, MAX_CHANGES_PER_FRAME)) : 0)
      for (const c of out) {
        expect(c.slot).toBeGreaterThanOrEqual(0)
        expect(c.slot).toBeLessThan(slots)
        expect(c.glyph).toBeGreaterThanOrEqual(0)
        expect(c.glyph).toBeLessThan(GLYPHS.length)
      }
    }
  })

  it('spreads its changes over every glyph and every glyph shape in time', () => {
    const rng = mulberry32(1)
    const slots = new Set<number>()
    const glyphs = new Set<number>()
    for (let f = 0; f < 400; f++) for (const c of glyphChanges(rng, RING_GLYPHS, 3)) { slots.add(c.slot); glyphs.add(c.glyph) }
    expect(slots.size).toBe(RING_GLYPHS)
    expect(glyphs.size).toBe(GLYPHS.length)
  })

  it('changes at a steady rate per ring whatever the frame rate, capped per frame, a long pause not made up at once', () => {
    // One ring for one second at 60 and at 30 frames a second: the same number of changes, give or take one.
    for (const fps of [60, 30, 144]) {
      let carry = 0
      let total = 0
      for (let f = 0; f < fps; f++) { const b = changeBudget(1, 1 / fps, carry); carry = b.carry; total += b.count }
      expect(Math.abs(total - CHANGES_PER_RING_S)).toBeLessThanOrEqual(1)
    }
    expect(changeBudget(1000, 1 / 60, 0).count).toBe(MAX_CHANGES_PER_FRAME)
    expect(changeBudget(1, 30, 0).count).toBeLessThanOrEqual(Math.ceil(CHANGES_PER_RING_S * 0.25))
    expect(changeBudget(0, 1, 0)).toEqual({ count: 0, carry: 0 })
    expect(changeBudget(3, 0, 0.5)).toEqual({ count: 0, carry: 0 })
  })

  it('thins far off to every third glyph, evenly round the ring, and is gone below a fingertip', () => {
    expect(ringShown(RING_HIDE_PX - 1)).toBe(0)
    expect(ringShown(Number.NaN)).toBe(0)
    expect(ringShown(RING_HIDE_PX)).toBe(RING_GLYPHS_FAR)
    expect(ringShown(RING_THIN_PX - 1)).toBe(RING_GLYPHS_FAR)
    expect(ringShown(RING_THIN_PX)).toBe(RING_GLYPHS)
    // Ranks are each glyph's place in the order they are dropped: every one once.
    const ranks = Array.from({ length: RING_GLYPHS }, (_, i) => ringRank(i))
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: RING_GLYPHS }, (_, i) => i))
    // The thinned ring's glyphs sit evenly round it.
    const kept = ranks.map((r, i) => (r < RING_GLYPHS_FAR ? ringAngle(i) : null)).filter((a): a is number => a !== null)
    expect(kept).toHaveLength(RING_GLYPHS_FAR)
    for (let k = 1; k < kept.length; k++) expect(kept[k] - kept[k - 1]).toBeCloseTo((Math.PI * 2) / RING_GLYPHS_FAR, 9)
  })
})
