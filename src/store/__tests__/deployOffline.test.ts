/**
 * deployOffline.test.ts - a deploy made with no network, with the switch on
 * LIVE, is sealed and kept here as a LOCAL one, for BROADCAST later.
 *
 * What would go wrong silently: the deploy computes the region key (which
 * can take a while), then fails at the first publish, losing the work; or
 * it tries the relays and records the item as published when nothing went.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const relay = vi.hoisted(() => ({ sent: 0, queried: 0 }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => { relay.sent++; return { ok: false, reason: 'offline' } }),
  query: vi.fn(async () => { relay.queried++; return [] }),
  relaySet: () => ['wss://relay.test'],
}))

/** Makes the signer one that cannot sign now (a remote signer offline). */
const later = vi.hoisted(() => ({ force: false }))
vi.mock('../../lib/signLater', async (orig) => {
  const actual = await orig() as typeof import('../../lib/signLater')
  return { ...actual, signsLater: (kind: Parameters<typeof actual.signsLater>[0], online: boolean) => later.force || actual.signsLater(kind, online) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { DEPLOY_NEEDS_SIGNER, useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Lantern'),
    unit: 12,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

beforeEach(() => {
  relay.sent = 0
  relay.queried = 0
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: true })
})

afterEach(() => {
  later.force = false
  vi.unstubAllGlobals()
  useCyberspace.setState({ live: false })
})

describe('deploying offline', () => {
  it('on LIVE with no network: done, kept here unpublished, and no relay asked', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    expect(useShards.getState().deployStatus).toBe('done')
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    expect(mine[0].published).toBe(false)
    expect(relay.sent).toBe(0)
    expect(relay.queried).toBe(0)
  })

  it('on LIVE online, the relays are still used: a refusal is still a failure', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(relay.sent).toBeGreaterThan(0)
    expect(useShards.getState().mine.some((d) => d.published)).toBe(false)
  })

  it('with a remote signer that cannot be reached, it says so at once: nothing computed, signed or kept', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    later.force = true
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toBe(DEPLOY_NEEDS_SIGNER)
    expect(useShards.getState().mine).toHaveLength(0)
    expect(relay.sent).toBe(0)
  })
})
