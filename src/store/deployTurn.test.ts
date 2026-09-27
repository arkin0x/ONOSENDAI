/**
 * deployTurn.test.ts - the deploy bar's TURN row.
 *
 * Quarter turns on X, Y and Z are baked into the deployed copy (lib/turn.ts),
 * the way SCALE sets its size: the payload carries the turned points, the
 * workshop's model never moves, each new deploy starts unturned, and four
 * presses on an axis come back round to zero.
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

import { newShard, ticksOf, type ShardModel, type ShardPayload } from 'sno-core/shards'
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
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
})

describe('the deploy bar turns this deployment by quarter turns', () => {
  it('starts unturned, counts quarters per axis, wraps at four, and resets', () => {
    const shard = benchShard(12)
    const s = useShards.getState()
    s.startDeployShard(shard.id)
    expect(useShards.getState().deployTurn).toEqual([0, 0, 0])
    s.turnDeploy(0); s.turnDeploy(2); s.turnDeploy(2)
    expect(useShards.getState().deployTurn).toEqual([1, 0, 2])
    s.turnDeploy(0); s.turnDeploy(0); s.turnDeploy(0)
    expect(useShards.getState().deployTurn).toEqual([0, 0, 2])
    s.resetDeployTurn()
    expect(useShards.getState().deployTurn).toEqual([0, 0, 0])
  })

  it('carries the turned points into the payload and leaves the workshop model alone', async () => {
    const shard = benchShard(12)
    useShards.getState().startDeployShard(shard.id)
    useShards.getState().turnDeploy(1) // a quarter about Y: +X goes to -Z
    await useShards.getState().deploy()

    expect(useShards.getState().deployStatus).toBe('done')
    const sent = useShards.getState().mine[0].shard!
    expect(ticksOf(sent.vertices[1])).toEqual([0, 60, -120])
    expect(deployedPayload().unit).toBe(12)
    expect(useWorkshop.getState().shards[0]).toBe(shard)
    expect(ticksOf(shard.vertices[1])).toEqual([120, 60, 0])
  })

  it('does not carry a turn into the next deploy', () => {
    const shard = benchShard(12)
    useShards.getState().startDeployShard(shard.id)
    useShards.getState().turnDeploy(1)
    useShards.getState().cancelDeploy()
    useShards.getState().startDeployShard(shard.id)
    expect(useShards.getState().deployTurn).toEqual([0, 0, 0])
  })
})
