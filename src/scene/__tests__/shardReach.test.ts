/**
 * Standing inside a big shard must not cull it (review of #555). The reach test
 * read the shard's centre only, and on a large grid the centre can be far past
 * the limit while the shard stands all around you.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { newShard, vertexAt, type ShardModel } from 'sno-core/shards'
import { shardReach } from '../WorldShards'

/** A shard declaring `extent`, with one point `reach` units out. */
function shard(extent: number, reach: number): ShardModel {
  return { ...newShard('t'), extent, vertices: [vertexAt([reach * 120, 0, 0], [1, 1, 1])] }
}

describe('shardReach', () => {
  it('is the corner of what the shard holds, at its scale', () => {
    expect(shardReach(shard(4096, 4096), 1)).toBeCloseTo(Math.sqrt(3) * 4096)
    expect(shardReach(shard(4096, 4096), 0.5)).toBeCloseTo(Math.sqrt(3) * 2048)
  })
  it('does not believe a declared extent: a tiny object declaring 4,096 reaches what it holds', () => {
    expect(shardReach(shard(4096, 2), 1)).toBeCloseTo(Math.sqrt(3) * 2)
  })
  it('widens nothing for an ordinary shard past what it holds', () => {
    expect(shardReach(shard(8, 1), 1)).toBeCloseTo(Math.sqrt(3))
  })
  it('walks a model once', () => {
    const m = shard(4096, 2)
    const first = shardReach(m, 1)
    // Changing the array in place is not something the app does; here it shows the answer was kept.
    m.vertices.push(vertexAt([1000 * 120, 0, 0], [1, 1, 1]))
    expect(shardReach(m, 1)).toBe(first)
  })
  it('counts toward the limit, so a shard around you is drawn', () => {
    const src = readFileSync('src/scene/WorldShards.tsx', 'utf8')
    expect(src).toMatch(/Math\.hypot\(\.\.\.w\.centre\) <= REACH \+ shardReach\(w\.shard!, w\.scale\)/)
  })
})
