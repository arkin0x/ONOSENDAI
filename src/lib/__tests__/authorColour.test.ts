/**
 * authorColour.test.ts: every author wears one of eight colours picked from
 * their key, the same everywhere, and none of the eight can be mistaken for
 * a colour that already means something in the scene (trail red, sidestep
 * purple, game pink, region green; owner, 2026-11-26).
 */
import { describe, expect, it } from 'vitest'
import { AUTHOR_COLOURS, HUE_CLEARANCE, RESERVED_HUES, authorColour, authorColourIndex, hueDistance, hueOf } from '../authorColour'
import { GAME, SIDESTEP } from '../palette'

describe('author colours', () => {
  it('are eight, all different', () => {
    expect(AUTHOR_COLOURS).toHaveLength(8)
    expect(new Set(AUTHOR_COLOURS).size).toBe(8)
  })

  it('keep clear of every hue the scene already uses for a meaning', () => {
    for (const c of AUTHOR_COLOURS) {
      const h = hueOf(c)
      expect(h).not.toBeNull()
      for (const r of RESERVED_HUES) expect(hueDistance(h!, r.hue), `${c} against ${r.name}`).toBeGreaterThanOrEqual(HUE_CLEARANCE)
    }
  })

  it('reserve the hues the scene really draws', () => {
    // The reserved hues are those of the colours themselves, to the degree.
    for (const r of RESERVED_HUES) expect(Math.abs(hueDistance(hueOf(r.colour)!, r.hue))).toBeLessThanOrEqual(1.5)
    expect(RESERVED_HUES.find((r) => r.name === 'sidestep purple')!.colour).toBe(SIDESTEP)
    expect(RESERVED_HUES.find((r) => r.name === 'game pink')!.colour).toBe(GAME)
  })

  it('are bright enough to read on the dark scene', () => {
    for (const c of AUTHOR_COLOURS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.45)
    }
  })

  it('pick the same colour for the same key every time, and spread keys over all eight', () => {
    const key = 'ab'.repeat(32)
    expect(authorColour(key)).toBe(authorColour(key))
    const seen = new Set<number>()
    for (let i = 0; i < 400; i++) seen.add(authorColourIndex(i.toString(16).padStart(64, '0')))
    expect(seen.size).toBe(8)
    expect(authorColour('')).toBe(AUTHOR_COLOURS[0])
    expect(authorColour(null)).toBe(AUTHOR_COLOURS[0])
  })

  it('measures hue round the circle', () => {
    expect(hueDistance(350, 10)).toBe(20)
    expect(hueOf('#ff0000')).toBe(0)
    expect(hueOf('#808080')).toBeNull()
  })
})
