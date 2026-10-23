/**
 * The embedded checkpoints are trust anchors: a typo here would make a real
 * blob fail (or, if it matched a forgery, pass one). These pin the list's
 * shape; every value was cross-checked against two explorers before pinning.
 */
import { describe, expect, it } from 'vitest'
import { EMBEDDED_CHECKPOINTS, GENESIS_HASH } from '../checkpoints'

describe('EMBEDDED_CHECKPOINTS', () => {
  const heights = EMBEDDED_CHECKPOINTS.map((c) => c.height)

  it('starts at genesis and ascends without repeats', () => {
    expect(EMBEDDED_CHECKPOINTS[0]).toEqual({ height: 0, blockHash: GENESIS_HASH })
    expect([...heights].sort((a, b) => a - b)).toEqual(heights)
    expect(new Set(heights).size).toBe(heights.length)
  })

  it('pins only checkpoint heights (h % 1000 == 999), as mainnet hashes', () => {
    for (const { height, blockHash } of EMBEDDED_CHECKPOINTS.slice(1)) {
      expect(height % 1000).toBe(999)
      expect(blockHash).toMatch(/^00000000[0-9a-f]{56}$/)
    }
  })

  it('holds every 50,000-block blob end below the newest, and the head-blob checkpoint 971,999', () => {
    const top = heights[heights.length - 1]
    for (let h = 49_999; h <= top; h += 50_000) expect(heights).toContain(h)
    expect(EMBEDDED_CHECKPOINTS.find((c) => c.height === 971_999)?.blockHash).toBe('00000000000000000000d5c8611c63c98822c10b9ff61cec2d728429a2fd2d82')
  })
})
