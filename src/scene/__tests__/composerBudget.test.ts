/**
 * The main view's multisampled buffer is held to a budget: at a desktop's
 * resolutions the library's default of 8 samples asks for most of a gigabyte,
 * resolved every frame.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { composerBytes, composerSamples, screenPixels } from '../composerBudget'

const MB = 1e6
const P_1080 = 1920 * 1080
const P_1440 = 2560 * 1440
const P_4K = 3840 * 2160

describe('the composer budget', () => {
  it('keeps the scene buffer under 210 MB at 1440p, where 8 samples asked for 383 MB', () => {
    expect(composerBytes(P_1440, 8) / MB).toBeCloseTo(383.5, 0)
    expect(composerBytes(P_1440, composerSamples(P_1440)) / MB).toBeLessThan(210)
  })

  it('keeps the scene buffer under 270 MB at 4K, where 8 samples asked for 863 MB', () => {
    expect(composerBytes(P_4K, 8) / MB).toBeCloseTo(862.9, 0)
    expect(composerBytes(P_4K, composerSamples(P_4K)) / MB).toBeLessThan(270)
  })

  it('leaves 1080p and below four samples, so a phone sees no change from what its GPU allowed', () => {
    expect(composerSamples(P_1080)).toBe(4)
    expect(composerSamples(1080 * 2400)).toBe(4)
    expect(composerSamples(P_1440)).toBe(4)
    expect(composerSamples(P_4K)).toBe(2)
  })

  it('counts the device pixels the canvas draws, at the ratio it clamps to', () => {
    expect(screenPixels({ screen: { width: 2560, height: 1440 }, devicePixelRatio: 1 })).toBe(P_1440)
    expect(screenPixels({ screen: { width: 2560, height: 1440 }, devicePixelRatio: 1.5 })).toBe(P_4K)
    // Scene.tsx draws at 1 to 2, whatever the device says.
    expect(screenPixels({ screen: { width: 1000, height: 1000 }, devicePixelRatio: 3 })).toBe(4_000_000)
    expect(screenPixels({ screen: { width: 1000, height: 1000 }, devicePixelRatio: 0.5 })).toBe(1_000_000)
  })
})

describe('the scene uses it', () => {
  const scene = fs.readFileSync(path.resolve(__dirname, '../Scene.tsx'), 'utf8')
  it('asks for the budget\'s samples, not the library\'s default of 8', () => {
    expect(scene).toMatch(/<EffectComposer [^>]*multisampling=\{COMPOSER_SAMPLES\}/)
  })
  it('gives the second buffer no samples, since it only takes a full-screen pass', () => {
    expect(scene).toMatch(/composer\.outputBuffer\.samples = 0/)
  })
  it('keeps the sample count outside the render, so no render makes a new composer', () => {
    expect(scene).toMatch(/^const COMPOSER_SAMPLES = /m)
  })
})
