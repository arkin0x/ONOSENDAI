/**
 * builderZoomDrift.test.ts - a zoom never moves a lined-up placement.
 *
 * arkinox, 2026-11-11: "if I position a shard for placement in build, and
 * then I zoom out, when I zoom back in sometimes the shard has changed
 * position. We can't have this happening. Otherwise, I might zoom out to
 * line it up with a different view, and then placing the shard ends up in
 * the wrong place." The zoom changes the view only: the build STEP the
 * placement snaps by holds while anything is lined up (store/buildStep.ts).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { positionOf, useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useBuilder } from '../useBuilder'
import { stepBuild } from '../buildStep'
import { buildStepOf } from '../../lib/buildCursor'
import { deployPoint, type Position } from '../../lib/space'

const S = () => useCyberspace.getState()
const D = () => useShards.getState()

/** Bits set all the way down, so no cell's center is it by accident. */
const SPOT: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4c3n, z: (1n << 72n) + 0x7e5a1n }
/** Exactly the center of a 2^12 cell: the coarse snap and the fine one agree only by luck elsewhere. */
const CENTRE: Position = { x: (5n << 40n) + (1n << 11n), y: (3n << 30n) + (1n << 11n), z: (7n << 50n) + (1n << 11n) }

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Disco floor'),
    unit: 0,
    vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

const placed = (): Position => deployPoint(S().cursor, buildStepOf(S()), D().deployHeight)

function at(spot: Position): void {
  useCyberspace.setState({ position: spot, anchor: spot, cursor: spot })
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  S().clearFocus()
  useCyberspace.setState({ live: false, position: SPOT, anchor: SPOT, cursor: SPOT, scaleExp: 0, buildStep: null, buildSettle: null, spectate: null, exploreIndex: null, transit: null })
})

afterEach(() => {
  useShards.setState({ pending: null, deployStatus: 'idle' })
  useBuilder.getState().exit()
  S().clearFocus()
})

/** Zoom by `delta` one press at a time, as the pad and Q / E do. */
function zoom(delta: number): void {
  for (let i = 0; i < Math.abs(delta); i++) S().adjustScale(delta > 0 ? 1 : -1)
}

describe('a zoom never moves a lined-up placement', () => {
  const cases: Array<[string, Position, number]> = [
    ['an arbitrary spot at 2^10', SPOT, 10],
    ['an arbitrary spot at 2^3', SPOT, 3],
    ['a coarse cell center at 2^12', CENTRE, 12],
    ['an arbitrary spot at 2^0', SPOT, 0],
  ]

  for (const [name, spot, z] of cases) {
    it(`out N then in N, and in N then out N, leaves it bit for bit (${name})`, () => {
      at(spot)
      useCyberspace.setState({ scaleExp: z })
      D().startDeployShard(benchShard().id)
      useShards.setState({ deployHeight: 40, deployHeightAuto: false })
      S().moveCursor({ axis: 'x', dir: 1 })
      const want = placed()
      const cursor = { ...S().cursor }
      for (const n of [1, 2, 5, 9]) {
        zoom(n)
        expect(placed()).toEqual(want)
        zoom(-n)
        expect(S().scaleExp).toBe(z)
        expect(placed()).toEqual(want)
        if (z >= n) {
          zoom(-n)
          expect(placed()).toEqual(want)
          zoom(n)
          expect(placed()).toEqual(want)
        }
      }
      // The cursor itself was never touched by a zoom.
      expect(S().cursor).toEqual(cursor)
    })
  }

  it('holds with STEP lowered, through zooming in to it and past it', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 15 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    while (buildStepOf(S()) > 9) stepBuild(-1)
    S().moveCursor({ axis: 'y', dir: -1 })
    const want = placed()
    zoom(3); expect(placed()).toEqual(want)
    zoom(-3); expect(placed()).toEqual(want)
    zoom(-6); expect(placed()).toEqual(want)
    zoom(-4); expect(placed()).toEqual(want)
    zoom(10); expect(placed()).toEqual(want)
    zoom(-2); expect(placed()).toEqual(want)
    zoom(2); expect(placed()).toEqual(want)
  })

  it('placing after zooming out uses the position lined up, not the coarse cell', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 3 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 8, deployHeightAuto: false })
    S().moveCursor({ axis: 'z', dir: 1 })
    const want = placed()
    zoom(4)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(want)
  })

  it('placing after zooming out and back in uses the position lined up', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 6 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 8, deployHeightAuto: false })
    while (buildStepOf(S()) > 3) stepBuild(-1)
    S().moveCursor({ axis: 'x', dir: -1 })
    const want = placed()
    zoom(2); zoom(-5); zoom(3)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(want)
  })

  it('holds for a message and a door the same way', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 9 })
    D().startDeployMessage('under the floor')
    useShards.setState({ deployHeight: 30 })
    let want = placed()
    zoom(4); expect(placed()).toEqual(want)
    zoom(-7); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
    D().cancelDeploy()

    useCyberspace.setState({ scaleExp: 9 })
    D().startPlaceDoor()
    useShards.setState({ deployHeight: 30, deployHeightAuto: false })
    want = placed()
    zoom(5); expect(placed()).toEqual(want)
    zoom(-8); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
  })

  it('a placement lined up again after one is placed holds too', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 5 })
    D().startDeployMessage('again')
    useShards.setState({ deployHeight: 8 })
    // Off your avatar, so the mode outlives the placement and lines it up again.
    S().moveCursor({ axis: 'y', dir: 1 })
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(D().pending).not.toBeNull()
    S().moveCursor({ axis: 'x', dir: 1 })
    const want = placed()
    zoom(3); expect(placed()).toEqual(want)
    zoom(-6); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
  })

  it('with nothing lined up the step still follows the zoom', () => {
    useCyberspace.setState({ scaleExp: 9 })
    useBuilder.getState().enter('build')
    zoom(3)
    expect(S().buildStep).toBeNull()
    expect(buildStepOf(S())).toBe(12)
  })
})
