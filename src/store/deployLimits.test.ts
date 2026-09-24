/**
 * deployLimits.test.ts - a shard the format refuses never leaves the device.
 *
 * A bag is opened with sno-core's fromPayload on every client, and an item it
 * refuses is dropped in silence. A 516-vertex floor was sealed, published,
 * shown to its author from this device, and opened as nothing for everyone
 * else (arkinox, 2026-09-24). Now deploy makes the reader's round trip first
 * and stops with the count and the limit in words.
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

import { MAX_VERTICES, newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

function benchShard(vertexCount: number): ShardModel {
  const shard: ShardModel = {
    ...newShard('Disco Floor 1'),
    unit: 1,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
})

describe('deploy refuses a shard the format refuses', () => {
  it('stops at 513 vertices, says so in numbers, and seals nothing', async () => {
    const shard = benchShard(MAX_VERTICES + 1)
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toBe(`This shard has 513 vertices and the format holds ${MAX_VERTICES}. Remove 1 and try again.`)
    expect(useShards.getState().mine).toHaveLength(0)
  })

  it('deploys at exactly 512', async () => {
    const shard = benchShard(MAX_VERTICES)
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    expect(useShards.getState().mine).toHaveLength(1)
  })
})
