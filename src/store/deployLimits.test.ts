/**
 * deployLimits.test.ts - a shard the reader would refuse never leaves the
 * device, and size is not a reason.
 *
 * A bag is opened with sno-core's fromPayload on every client, and an item it
 * refuses is dropped in silence. Deploy makes the reader's round trip first
 * and stops with the reason. The format sets no ceiling on vertices or faces
 * (DECK-0003 §1.8, 2026-09-24): a 516-vertex floor, once refused by every
 * reader, deploys.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

function benchShard(vertexCount: number, faces: ShardModel['faces'] = [[0, 1, 2]]): ShardModel {
  const shard: ShardModel = {
    ...newShard('Disco Floor 1'),
    unit: 1,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces,
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
})

describe('deploy and the reader agree', () => {
  it('deploys a 516-vertex floor, and a 3,000-vertex one', async () => {
    for (const n of [516, 3000]) {
      useShards.setState({ mine: [] })
      const shard = benchShard(n)
      useShards.getState().startDeployShard(shard.id)
      await useShards.getState().deploy()
      expect(useShards.getState().deployStatus).toBe('done')
      expect(useShards.getState().mine).toHaveLength(1)
    }
  })

  it('stops a shard the reader would refuse, and says so, sealing nothing', async () => {
    const shard = benchShard(3, [[0, 1, 9]])
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toMatch(/refuses this shard/)
    expect(useShards.getState().mine).toHaveLength(0)
  })
})
