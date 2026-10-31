/**
 * Standing inside a big shard must not cull it (review of #555). The reach test
 * read the shard's centre only, and on a large grid the centre can be far past
 * the limit while the shard stands all around you.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shardReach } from '../WorldShards'

describe('shardReach', () => {
  it('is the corner of the grid, at the shard\'s scale', () => {
    expect(shardReach(8, 1)).toBeCloseTo(Math.sqrt(3) * 8)
    expect(shardReach(4096, 0.5)).toBeCloseTo(Math.sqrt(3) * 2048)
  })
  it('counts toward the limit, so a shard around you is drawn', () => {
    const src = readFileSync('src/scene/WorldShards.tsx', 'utf8')
    expect(src).toMatch(/Math\.hypot\(\.\.\.w\.centre\) <= REACH \+ shardReach\(w\.shard!\.extent, w\.scale\)/)
  })
})
