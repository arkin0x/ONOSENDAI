/**
 * A model stored past 64 units reads the same to a stale tab on sno-core 0.1.33
 * or older (review of #555): its legacy-ticks test must not fire on it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { newShard, normalizeStored, ticksOf, vertexAt, type ShardModel } from 'sno-core/shards'
import { forOlderReaders } from '../olderReaders'
import { storedMine } from '../useShards'

/** sno-core 0.1.33's normalizeStored test, verbatim: what a stale tab runs on every stored model. */
const olderReadsAsTicks = (m: ShardModel): boolean => m.vertices.some((v) => v.t === undefined && v.p.some((c) => Math.abs(c) > 64))

const model = (units: Array<[number, number, number]>): ShardModel =>
  ({ ...newShard('m'), extent: 4096, vertices: units.map((u) => vertexAt([u[0] * 120, u[1] * 120, u[2] * 120], [1, 1, 1])) })

describe('forOlderReaders', () => {
  it('stores a whole-unit vertex past 64 units so an older tab does not read it as ticks', () => {
    const m = model([[100, 0, 0], [3, 4, 5], [-4096, 0, 4096]])
    expect(olderReadsAsTicks(m)).toBe(true)
    const stored = JSON.parse(JSON.stringify(forOlderReaders(m))) as ShardModel
    expect(olderReadsAsTicks(stored)).toBe(false)
    // The same positions to every version, and to this one after a reload.
    expect(stored.vertices.map(ticksOf)).toEqual(m.vertices.map(ticksOf))
    expect(normalizeStored(stored).vertices.map(ticksOf)).toEqual(m.vertices.map(ticksOf))
    // Only the vertices that need it carry the marker.
    expect(stored.vertices[1].t).toBeUndefined()
  })

  it('leaves a shard within 64 units exactly as it was, the same object', () => {
    const m = model([[64, -64, 0], [1, 2, 3]])
    expect(forOlderReaders(m)).toBe(m)
  })

  it('never touches the model in memory', () => {
    const m = model([[100, 0, 0]])
    forOlderReaders(m)
    expect(m.vertices[0].t).toBeUndefined()
  })

  it('is applied where the deployments list is written', () => {
    const row = { shard: model([[200, 0, 0]]) } as unknown as Parameters<typeof storedMine>[0][number]
    const back = JSON.parse(storedMine([row])) as Array<{ shard: ShardModel }>
    expect(olderReadsAsTicks(back[0].shard)).toBe(false)
  })

  it('is applied where the workshop library is written, in both stores', () => {
    const src = readFileSync('src/store/workshopStorage.ts', 'utf8')
    expect(src).toMatch(/kvSet\(LOCAL_KEY, JSON\.stringify\(list\.map\(forOlderReaders\)\)\)/)
    expect(src).toMatch(/json: JSON\.stringify\(forOlderReaders\(m\)\)/)
  })
})
