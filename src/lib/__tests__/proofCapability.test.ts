import { describe, expect, it } from 'vitest'
import { AXIS_CENTER, computeHopProof, terrainK } from 'cyberspace-core'
import { axisComputeCeiling, cantorTreeBits, FIREFOX_BIGINT_BITS, movementCapabilityIssue } from '../proofCapability'

const limit = FIREFOX_BIGINT_BITS
const a = AXIS_CENTER
const from = { x: a + 123456n, y: a + 123456n, z: a + 123456n }

describe('browser proof allocation preflight', () => {
  it('checks the combined hop, not just the individual axis trees', () => {
    const to = { ...from, x: from.x + (1n << 9n) }
    expect(cantorTreeBits(11)).toBeLessThan(limit)
    expect(movementCapabilityIssue('hop', from, to, 0, 'local', limit)).toContain('cannot compute')
    expect(movementCapabilityIssue('hop', from, to, 0, 'local', Infinity)).toBeNull()
  })

  it('permits a small proof that the protocol can compute', () => {
    const to = { ...from, x: from.x + 1n }
    expect(movementCapabilityIssue('hop', from, to, 0, 'local', limit)).toBeNull()
    expect(computeHopProof(from.x, from.y, from.z, to.x, to.y, to.z, 0, 'ab'.repeat(32), 20).proofHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('blocks even a one-unit move with high terrain before cloud payment', () => {
    // Terrain is constant within its smallest (8-unit) cells. Search bounded
    // deterministic cells to exercise both local proving and cloud verification.
    let to = { x: a, y: a, z: a }
    for (let i = 0n; i < 100_000n; i += 8n) {
      to = { x: a + i, y: a, z: a }
      if (terrainK(to.x, to.y, to.z, 0) >= 14) break
    }
    expect(terrainK(to.x, to.y, to.z, 0)).toBeGreaterThanOrEqual(14)
    const start = { ...to, x: to.x - 1n }
    for (const mode of ['hop', 'sidestep'] as const) {
      expect(movementCapabilityIssue(mode, start, to, 0, 'local', limit)).toContain('BigInt')
      expect(movementCapabilityIssue(mode, start, to, 0, 'cloud', limit)).toContain('cannot verify')
    }
  })

  it('allows cloud hop envelopes when only spatial combination exceeds the limit', () => {
    const to = { ...from, x: from.x + (1n << 9n) }
    expect(movementCapabilityIssue('hop', from, to, 0, 'cloud', limit)).toBeNull()
    expect(axisComputeCeiling(20, limit)).toBe(13)
    expect(axisComputeCeiling(20, Infinity)).toBe(20)
  })
})
