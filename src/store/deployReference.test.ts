/**
 * deployReference.test.ts - a large shard is hidden by reference (spec §7.6,
 * DECK-0003 §3.2 and §3.4): its kind 33331 object goes out before the bag that
 * names it, later rewrites of the bag keep the reference, and deleting it
 * retracts the object as well as the entry.
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

const sent: { kind: number; tags: string[][]; id: string }[] = []
vi.mock('../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string }) => { sent.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'
import { bagEntries, isReference, OBJECT_KIND, HIDDEN_KIND, REGION_KEY_DERIVATION } from '../lib/hidden'
import { hexToBytes, type NostrEvent } from '../lib/events'

function benchShard(vertexCount: number): ShardModel {
  const shard: ShardModel = {
    ...newShard(`bench ${vertexCount}`),
    unit: 1,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

async function deploy(vertexCount: number): Promise<void> {
  const shard = benchShard(vertexCount)
  useShards.getState().startDeployShard(shard.id)
  await useShards.getState().deploy()
  expect(useShards.getState().deployStatus).toBe('done')
}

const lastBag = () => [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent

beforeEach(() => {
  sent.length = 0
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: true })
})

describe('hiding a large shard by reference', () => {
  it('publishes the object first, then a bag that names it', async () => {
    await deploy(3000)
    const [object, bag] = sent
    expect(object.kind).toBe(OBJECT_KIND)
    expect(object.tags.find((t) => t[0] === 'encrypted')?.[3]).toBe(REGION_KEY_DERIVATION)
    expect(bag.kind).toBe(HIDDEN_KIND)
    const dep = useShards.getState().mine[0]
    expect(dep.ref?.[0]).toBe('a')
    expect(dep.inner.id).toBe(object.id)
    const entries = await bagEntries(lastBag(), hexToBytes(dep.keyHex))
    expect(entries).toEqual([dep.ref])
  })

  it('keeps a small shard inline, beside the reference, when the bag is rewritten', async () => {
    await deploy(3000)
    await deploy(3)
    const [big, small] = useShards.getState().mine
    expect(big.ref).toBeDefined()
    expect(small.ref).toBeUndefined()
    const entries = await bagEntries(lastBag(), hexToBytes(small.keyHex))
    expect(entries.filter(isReference)).toEqual([big.ref])
    expect(entries.filter((e) => !isReference(e)).map((e) => (e as NostrEvent).id)).toEqual([small.inner.id])
  })

  it('deleting it rewrites the bag without the reference and retracts the object', async () => {
    await deploy(3000)
    await deploy(3)
    const [big, small] = useShards.getState().mine
    sent.length = 0
    await useShards.getState().deleteInstance(big.eventId)
    const entries = await bagEntries(lastBag(), hexToBytes(small.keyHex))
    expect(entries.some(isReference)).toBe(false)
    const retraction = sent.find((e) => e.kind === 5)!
    expect(retraction.tags).toContainEqual(['k', String(OBJECT_KIND)])
    expect(retraction.tags).toContainEqual(['e', big.inner.id])
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual([small.eventId])
  })
})
