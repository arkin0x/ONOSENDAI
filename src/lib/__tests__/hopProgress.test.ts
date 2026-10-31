/**
 * hopProgress.test.ts - the bar of a version 2 hop follows time, and its
 * stage boundaries are core's own.
 *
 * The boundaries in core's fraction are copied from computeHopProofV2 and
 * proveHopResidues at the pinned commit, so a real run is the check: core
 * reports exactly those fractions at the ends of the stages that announce
 * themselves (the region pairings, the primes, the residues, the seal).
 */

import { describe, expect, it } from 'vitest'
import { computeHopProofV2, estimateHopCost } from 'cyberspace-core'
import { hopProgressPlan } from '../hopProgress'

describe('hopProgressPlan', () => {
  it('maps 0 to 0, climbs, and leaves room for the region key at the end', () => {
    const plan = hopProgressPlan({ x: 14, y: 3, z: 0, K: 9 })
    expect(plan.remap(0)).toBe(0)
    let last = 0
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const t = plan.remap(f)
      expect(t).toBeGreaterThanOrEqual(last)
      last = t
    }
    expect(plan.remap(1)).toBeLessThan(1)
    expect(plan.remap(1)).toBe(plan.time[plan.time.length - 1])
  })

  it('gives the residue extension the share it takes in a browser (Phase 0, h20 one axis)', () => {
    const plan = hopProgressPlan({ x: 20, y: 0, z: 0, K: 0 })
    // Stages 6 to 10 are the extension; it took 11.5 s of about 20.3 s.
    const extension = plan.time[10] - plan.time[5]
    expect(extension).toBeGreaterThan(0.5)
    expect(extension).toBeLessThan(0.6)
    // Core's own weights would have given it under a fifth of the bar.
    expect(plan.core[10] - plan.core[5]).toBeLessThan(0.2)
  })

  it('has core\'s stage boundaries, as a real proof reports them', () => {
    const from = { x: 1n << 33n, y: 0n, z: 0n }
    const to = { x: from.x ^ (1n << 9n), y: 2n, z: 0n }
    const prev = '3c'.repeat(32)
    const e = estimateHopCost(from.x, from.y, from.z, to.x, to.y, to.z, 0)
    const plan = hopProgressPlan({ x: e.lcaX, y: e.lcaY, z: e.lcaZ, K: e.terrainK })
    const seen: number[] = []
    computeHopProofV2(from.x, from.y, from.z, to.x, to.y, to.z, 0, prev, { onProgress: (f) => seen.push(f) })
    // The ends of the xy pairing, the z pairing, the primes, the residues and the seal.
    for (const i of [4, 5, 6, 7, 8]) {
      expect(seen.some((f) => Math.abs(f - plan.core[i]) < 1e-9)).toBe(true)
    }
  })
})
