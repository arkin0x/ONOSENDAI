/**
 * deployScale.test.ts — the size a deployment goes out at.
 *
 * A shard's `unit` says how big one model unit is in the world: one unit is
 * 2^unit gibsons, and a gibson is 2^-33 meters. The workshop sets it as DEPLOY
 * SCALE MULTIPLIER; the deploy bar's SCALE row sets it for one deployment,
 * without writing back to the model on the bench. These prove the deployed
 * payload carries the chosen unit, the workshop's copy does not move, the
 * control starts at the shard's own unit, and the bounds hold.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores keep shards and deployments in localStorage; the test runs where
// there is none.
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

import { MAX_UNIT, newShard, type ShardModel, type ShardPayload } from '../lib/shards'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

/** A shard on the bench at a known size, with enough geometry to be deployable. */
function benchShard(unit: number): ShardModel {
  const shard: ShardModel = {
    ...newShard('Crucifix'),
    unit,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], t: [0, 60, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

/** The wire payload of the one deployment the store just made. */
function deployedPayload(): ShardPayload {
  const mine = useShards.getState().mine
  expect(mine).toHaveLength(1)
  return JSON.parse(mine[0].inner.content) as ShardPayload
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
})

describe('the deploy bar sets the size this deployment goes out at', () => {
  it('starts at the shard\'s own unit, so a deploy that ignores the control is unchanged', () => {
    const shard = benchShard(12)
    useShards.getState().startDeployShard(shard.id)
    expect(useShards.getState().deployUnit).toBe(12)
  })

  it('carries the chosen unit into the deployed payload and leaves the workshop model alone', async () => {
    const shard = benchShard(12)
    useShards.getState().startDeployShard(shard.id)
    useShards.getState().setDeployUnit(20)
    await useShards.getState().deploy()

    expect(useShards.getState().deployStatus).toBe('done')
    // 2^20 gibsons is what the wire carries, and what the deployment draws at.
    expect(deployedPayload().unit).toBe(20)
    expect(useShards.getState().mine[0].shard?.unit).toBe(20)
    // The bench is exactly as it was: same object, same unit.
    expect(useWorkshop.getState().shards[0].unit).toBe(12)
    expect(useWorkshop.getState().shards[0]).toBe(shard)
  })

  it('deploys the same shard twice at two sizes, the model still at its own', async () => {
    const shard = benchShard(12)

    useShards.getState().startDeployShard(shard.id)
    useShards.getState().setDeployUnit(4)
    await useShards.getState().deploy()

    useShards.getState().startDeployShard(shard.id)
    useShards.getState().setDeployUnit(30)
    await useShards.getState().deploy()

    const units = useShards.getState().mine.map((d) => (JSON.parse(d.inner.content) as ShardPayload).unit)
    expect(units).toEqual([4, 30])
    expect(useWorkshop.getState().shards[0].unit).toBe(12)
  })

  it('leaves the payload at the shard\'s unit when the control is never touched', async () => {
    const shard = benchShard(7)
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(deployedPayload().unit).toBe(7)
    // Untouched means untouched: the deployment holds the bench's own object.
    expect(useShards.getState().mine[0].shard).toBe(shard)
  })

  it('resets to the shard\'s own unit when a new deploy begins', () => {
    const big = benchShard(12)
    useShards.getState().startDeployShard(big.id)
    useShards.getState().setDeployUnit(40)
    useShards.getState().cancelDeploy()

    const small: ShardModel = { ...newShard('Pebble'), id: 'pebble', unit: 3, vertices: big.vertices, faces: big.faces }
    useWorkshop.setState({ shards: [big, small], currentId: small.id })
    useShards.getState().startDeployShard('pebble')
    // Not 40: the last deploy's choice does not carry into this one.
    expect(useShards.getState().deployUnit).toBe(3)
  })

  it('holds the same bounds as the workshop: 0 to MAX_UNIT, whole numbers', () => {
    const s = useShards.getState()
    s.setDeployUnit(-5)
    expect(useShards.getState().deployUnit).toBe(0)
    s.setDeployUnit(MAX_UNIT + 10)
    expect(useShards.getState().deployUnit).toBe(MAX_UNIT)
    s.setDeployUnit(12.6)
    expect(useShards.getState().deployUnit).toBe(13)

    // The workshop clamps identically, which is the point of sharing clampUnit.
    const shard = benchShard(0)
    useWorkshop.getState().select(shard.id)
    useWorkshop.getState().setUnit(MAX_UNIT + 10)
    expect(useWorkshop.getState().shards[0].unit).toBe(MAX_UNIT)
    useWorkshop.getState().setUnit(-5)
    expect(useWorkshop.getState().shards[0].unit).toBe(0)
  })

  it('offers nothing to set for a message, which has no size', () => {
    benchShard(12)
    useShards.getState().startDeployMessage('chalk on the wall')
    expect(useShards.getState().pending).toEqual({ type: 'message', text: 'chalk on the wall' })
    expect(useShards.getState().deployUnit).toBe(0)
  })
})
