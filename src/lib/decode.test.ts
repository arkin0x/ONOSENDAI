import { describe, it, expect } from 'vitest'
import { decodeText, easeOutCubic, hash01, scrambleOffset, seedOf } from './decode'

describe('decodeText', () => {
  const target = 'THE SKY ABOVE THE PORT'
  const seed = seedOf('bag-1')

  it('is fully resolved at t = 1 and keeps the shape of the message at t = 0', () => {
    expect(decodeText(target, 1, seed, 0)).toBe(target)
    const start = decodeText(target, 0, seed, 0)
    expect(start).toHaveLength(target.length)
    expect(start).not.toBe(target)
    for (let i = 0; i < target.length; i++) if (target[i] === ' ') expect(start[i]).toBe(' ')
  })

  it('never un-resolves a character as t grows', () => {
    let resolved = new Set<number>()
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = decodeText(target, t, seed, 3)
      const now = new Set<number>()
      for (let i = 0; i < target.length; i++) if (s[i] === target[i] && target[i] !== ' ') now.add(i)
      for (const i of resolved) expect(now.has(i)).toBe(true)
      resolved = now
    }
    expect(resolved.size).toBe(target.replace(/\s/g, '').length)
  })

  it('changes its unresolved glyphs from frame to frame', () => {
    expect(decodeText(target, 0, seed, 1)).not.toBe(decodeText(target, 0, seed, 2))
  })
})

describe('hashes and easing', () => {
  it('hash01 is deterministic and in range; seedOf differs by key', () => {
    expect(hash01(7, 1)).toBe(hash01(7, 1))
    for (let i = 0; i < 200; i++) { const v = hash01(i, 99); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
    expect(seedOf('a')).not.toBe(seedOf('b'))
  })

  it('easeOutCubic is clamped and monotonic', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('scrambleOffset stays within the extent', () => {
    for (let i = 0; i < 50; i++) for (const v of scrambleOffset(i, 5, 8)) expect(Math.abs(v)).toBeLessThanOrEqual(8)
  })
})
