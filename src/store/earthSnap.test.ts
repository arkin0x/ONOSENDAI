/**
 * earthSnap.test.ts — a shard stood on the ground, and what the wire carries.
 *
 * A shard is built on cyberspace axes, and cyberspace Y is the planet's polar
 * axis, so a shard built upright stands upright only at the poles. SNAP TO
 * EARTH turns it to the ground under it: bottom to Earth, +Z facing a compass
 * bearing (lib/pose.ts). These prove the pose reaches the payload when it is
 * offered, never reaches it when it is not, and never carries from one deploy
 * into the next.
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

import { newShard, type ShardModel, type ShardPayload } from '../lib/shards'
import { SNAP_MIN_HEIGHT } from '../lib/pose'
import { useCyberspace } from './useCyberspace'
import { useSecrets } from './useSecrets'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Obelisk'),
    unit: 12,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], c: [0, 1, 0] },
      { p: [0, 3, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

function deployedPayload(): ShardPayload {
  const mine = useShards.getState().mine
  expect(mine).toHaveLength(1)
  return JSON.parse(mine[0].inner.content) as ShardPayload
}

/**
 * A deploy at `height` with the pose set. Above this machine's ceiling the key
 * comes from HOSAKA, so `buy` stands in for the purchase; the pose is decided
 * before any of that and is what these assert.
 */
async function deployAt(height: number, plane: 0 | 1, up: boolean, spin: number): Promise<void> {
  useCyberspace.setState({ plane })
  useShards.setState({ deployHeight: height, deployUp: up, deploySpin: spin })
  await useShards.getState().deploy(true)
}

beforeEach(() => {
  useShards.setState({
    mine: [], deleted: {}, discovered: {}, pending: null,
    deployHeight: 0, deployUnit: 0, deployUp: false, deploySpin: 0, deployFollow: false,
    deployStatus: 'idle', deployError: null,
  })
  useCyberspace.setState({
    live: false,
    plane: 0,
    cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'ask' },
    cloud: { ...useCyberspace.getState().cloud, limits: { max_hop_height: 30 } as never },
  })
  // The key HOSAKA would have sold, so the deploy can finish without one.
  useSecrets.setState({ buy: async () => ({ keyHex: 'ab'.repeat(32), lookupId: 'cd'.repeat(32) }) as never })
})

describe('SNAP TO EARTH travels with the shard', () => {
  it('carries the pose into the payload at the height it is offered', async () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await deployAt(SNAP_MIN_HEIGHT, 0, true, 135)

    expect(useShards.getState().deployStatus).toBe('done')
    const p = deployedPayload()
    expect(p.up).toBe(true)
    expect(p.spin).toBe(135)
    // And the bench is untouched, as with the size.
    expect(useWorkshop.getState().shards[0].up).toBe(false)
    expect(useWorkshop.getState().shards[0].spin).toBe(0)
  })

  it('carries nothing below the height that offers it, even asked for', async () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await deployAt(SNAP_MIN_HEIGHT - 1, 0, true, 90)

    const p = deployedPayload()
    expect('up' in p).toBe(false)
    expect('spin' in p).toBe(false)
  })

  it('carries nothing in cyberspace, where there is no planet to stand on', async () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await deployAt(SNAP_MIN_HEIGHT, 1, true, 90)

    const p = deployedPayload()
    expect('up' in p).toBe(false)
    expect('spin' in p).toBe(false)
  })

  it('wraps the bearing it sends', async () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await deployAt(SNAP_MIN_HEIGHT, 0, true, 365)
    expect(deployedPayload().spin).toBe(5)
  })
})

describe('the pose is a choice made per deploy', () => {
  it('starts flat, aimed north, with the camera not driving', () => {
    const shard = benchShard()
    useShards.setState({ deployUp: true, deploySpin: 200, deployFollow: true })
    useShards.getState().startDeployShard(shard.id)
    expect(useShards.getState().deployUp).toBe(false)
    expect(useShards.getState().deploySpin).toBe(0)
    expect(useShards.getState().deployFollow).toBe(false)
  })

  it('drops the snap when the height falls below what offers it', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    useShards.setState({ deployUp: true, deployFollow: true })
    useShards.getState().setDeployHeight(SNAP_MIN_HEIGHT - 1)
    expect(useShards.getState().deployUp).toBe(false)
    expect(useShards.getState().deployFollow).toBe(false)
  })

  it('takes the spin back from the camera when the shard lies down', () => {
    useShards.setState({ deployUp: true, deployFollow: true })
    useShards.getState().setDeployUp(false)
    expect(useShards.getState().deployFollow).toBe(false)
  })

  it('wraps the bearing the control sets, in both directions', () => {
    useShards.getState().setDeploySpin(-1)
    expect(useShards.getState().deploySpin).toBe(359)
    useShards.getState().setDeploySpin(360)
    expect(useShards.getState().deploySpin).toBe(0)
  })
})
