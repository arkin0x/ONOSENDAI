/**
 * shardEvents.test.ts - a deployed shard event carries the spec tags and gives
 * its shard back only to whoever has the region.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from './shards'
import { regionKeyAt } from './shardCrypto'
import { ENCRYPTED_KIND, ciphertextOf, decodeShard, deployTemplate, heightHint } from './shardEvents'

const sk = generateSecretKey()
const at = { x: 40_000n, y: 12_000n, z: 7n }
const shard: ShardModel = {
  ...newShard('prism'),
  mode: 'lines',
  unit: 5,
  vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 1, 0], c: [0, 1, 0] }],
  faces: [],
}

describe('deploy', () => {
  it('builds a kind 33330 event with d = lookup_id, encrypted, version and h', async () => {
    const { template, lookupId } = await deployTemplate({ shard, at, plane: 0, height: 6, createdAt: 1, maxComputeHeight: 20 })
    expect(template.kind).toBe(ENCRYPTED_KIND)
    expect(template.tags.find((t) => t[0] === 'd')).toEqual(['d', lookupId])
    expect(template.tags.find((t) => t[0] === 'encrypted')?.[1]).toBe('aes-256-gcm')
    expect(template.tags.find((t) => t[0] === 'version')).toEqual(['version', '2'])
    expect(template.tags.find((t) => t[0] === 'h')).toEqual(['h', '6'])
    expect(lookupId).toBe(regionKeyAt(at, 6, 20).lookupId)
  })

  it('comes back to a discoverer who computes the same region', async () => {
    const { template } = await deployTemplate({ shard, at, plane: 0, height: 6, createdAt: 2, maxComputeHeight: 20 })
    const event = finalizeEvent(template, sk)
    expect(ciphertextOf(event)).not.toBeNull()
    expect(heightHint(event)).toBe(6)
    // A fresh key derived from the coordinate, as a discoverer would.
    const discovered = regionKeyAt(at, 6, 20).key
    const decoded = await decodeShard(event, discovered)
    expect(decoded).not.toBeNull()
    expect(decoded!.at).toEqual(at)
    expect(decoded!.plane).toBe(0)
    expect(decoded!.shard.mode).toBe('lines')
    expect(decoded!.shard.unit).toBe(5)
    expect(decoded!.shard.vertices).toEqual(shard.vertices)
  })

  it('stays shut to the wrong region', async () => {
    const { template } = await deployTemplate({ shard, at, plane: 0, height: 6, createdAt: 3, maxComputeHeight: 20 })
    const event = finalizeEvent(template, sk)
    const wrong = regionKeyAt({ ...at, x: at.x + (1n << 6n) }, 6, 20).key
    expect(await decodeShard(event, wrong)).toBeNull()
  })
})
