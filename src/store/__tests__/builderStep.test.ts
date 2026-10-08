/**
 * builderStep.test.ts - the build STEP: placing finer than the zoom
 * (store/buildStep.ts, arkinox 2026-10-08).
 *
 * Zoomed out to 2^15 in BUILD mode, an object could only sit at the center of
 * a 2^15 cube, because the build cursor stepped and the placement snapped by
 * the zoom. STEP sets both, finer than the zoom, while a deploy is lined up,
 * and leaves the camera's zoom alone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { positionOf, regionOf, useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useBuilder } from '../useBuilder'
import { stepBuild } from '../buildStep'
import { buildCursorOf, buildStepOf } from '../../lib/buildCursor'
import { alignTo, deployPoint, type Position } from '../../lib/space'

const S = () => useCyberspace.getState()
const D = () => useShards.getState()

/** A spot with bits set all the way down, so no cell's center is it by accident. */
const SPOT: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4c3n, z: (1n << 72n) + 0x7e5a1n }

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Disco floor'),
    unit: 0,
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

/** Zoomed out to `zoom` at SPOT, a shard lined up to hide at `height`. */
function lineUp(zoom: number, height: number): void {
  useCyberspace.setState({ scaleExp: zoom })
  D().startDeployShard(benchShard().id)
  useShards.setState({ deployHeight: height, deployHeightAuto: false })
}

/** Lower (or raise) STEP until it reads `to`. */
function stepTo(to: number): void {
  while (buildStepOf(S()) > to) stepBuild(-1)
  while (buildStepOf(S()) < to) stepBuild(1)
}

const placed = (): Position => deployPoint(S().cursor, buildStepOf(S()), D().deployHeight)

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  S().clearFocus()
  useCyberspace.setState({ live: false, position: SPOT, anchor: SPOT, cursor: SPOT, scaleExp: 0, buildStep: null, spectate: null, exploreIndex: null, transit: null })
})

afterEach(() => {
  useShards.setState({ pending: null, deployStatus: 'idle' })
  useBuilder.getState().exit()
  S().clearFocus()
})

describe('STEP', () => {
  it('starts at the zoom, so a move steps the zoom and the placement is the cube center', () => {
    lineUp(15, 20)
    expect(useBuilder.getState().active).toBe(true)
    expect(S().buildStep).toBeNull()
    expect(buildStepOf(S())).toBe(15)
    expect(placed()).toEqual(deployPoint(SPOT, 15, 20))
    const x = S().cursor.x
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x - x).toBe(1n << 15n)
  })

  it('lowered, one move steps 2^STEP and the placement snaps to that cell center inside the zoom cell', () => {
    lineUp(15, 20)
    const cube = { x: alignTo(SPOT.x, 15), y: alignTo(SPOT.y, 15), z: alignTo(SPOT.z, 15) }
    stepTo(10)
    expect(buildStepOf(S())).toBe(10)
    // The camera's zoom is untouched.
    expect(S().scaleExp).toBe(15)

    // Lowering brought the cursor to where the placement was, the cube's
    // center gibson, and the 2^10 cell holding it sits inside the cube.
    const center = cube.x + (1n << 14n)
    expect(S().cursor.x).toBe(center)
    const p = placed()
    for (const a of ['x', 'y', 'z'] as const) {
      expect(alignTo(p[a], 15)).toBe(cube[a])
      expect(p[a]).toBe(alignTo(S().cursor[a], 10) + (1n << 9n))
    }
    // Not the cube's center any more: finer than the zoom.
    expect(p).not.toEqual(deployPoint(SPOT, 15, 20))

    const before = { ...S().cursor }
    S().moveCursor({ axis: 'y', dir: -1 })
    expect(before.y - S().cursor.y).toBe(1n << 10n)
    expect(placed().y).toBe(p.y - (1n << 10n))
    expect(S().scaleExp).toBe(15)
  })

  it('at 2^0 the placement is a single gibson, and a run of lowerings closes in on the cube center rather than drifting', () => {
    lineUp(15, 20)
    stepTo(0)
    const center = deployPoint(SPOT, 15, 20)
    expect(S().cursor).toEqual(center)
    expect(placed()).toEqual(center)
    S().moveCursor({ axis: 'z', dir: 1 })
    expect(placed().z).toBe(center.z + 1n)
  })

  it('never exceeds the zoom: + stops at the zoom, and zooming in below it brings it down', () => {
    lineUp(15, 20)
    stepBuild(1)
    expect(buildStepOf(S())).toBe(15)
    expect(S().buildStep).toBeNull()

    stepTo(10)
    S().adjustScale(-7)
    expect(S().scaleExp).toBe(8)
    expect(buildStepOf(S())).toBe(8)
    expect(S().buildStep).toBeNull()
    const x = S().cursor.x
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x - x).toBe(1n << 8n)
    // Even a stored step past the zoom reads as the zoom.
    expect(buildStepOf({ scaleExp: 4, buildStep: 9 })).toBe(4)
  })

  it('leaves the hide height and its region alone', () => {
    lineUp(15, 20)
    const plane = buildCursorOf(S()).plane
    const region = regionOf(placed(), plane, 20)
    stepTo(3)
    expect(D().deployHeight).toBe(20)
    expect(regionOf(placed(), plane, 20)).toBe(region)
  })

  it('goes back to the zoom when the deploy ends, canceled or hidden', async () => {
    lineUp(15, 20)
    stepTo(10)
    D().cancelDeploy()
    expect(S().buildStep).toBeNull()
    expect(buildStepOf(S())).toBe(15)

    lineUp(6, 6)
    expect(buildStepOf(S())).toBe(6)
    stepTo(2)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(S().buildStep).toBeNull()
    // Outside a deploy STEP does nothing.
    stepBuild(-1)
    expect(S().buildStep).toBeNull()
  })

  it('deploying lands at the snapped point', async () => {
    lineUp(6, 6)
    stepTo(2)
    S().moveCursor({ axis: 'x', dir: 1 })
    S().moveCursor({ axis: 'z', dir: -1 })
    const want = placed()
    expect(want).not.toEqual(deployPoint(S().cursor, 6, 6))
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(want)
  })

  // Review of #237, 2026-10-08: STEP moved the movement cursor after BUILD
  // ended mid-hide, and Space then hopped there.
  it('does nothing while hiding, and nothing once BUILD mode has ended, even with the bar still up', () => {
    lineUp(15, 20)
    stepTo(12)
    const aim = { ...S().cursor }
    useShards.setState({ deployStatus: 'working' })
    stepBuild(-1)
    stepBuild(1)
    expect(buildStepOf(S())).toBe(12)
    expect(S().cursor).toEqual(aim)

    // The view moves away (a tap on Earth, a stop, a deployment): BUILD ends,
    // the hide goes on, and STEP goes with the mode.
    S().clearFocus()
    expect(useBuilder.getState().active).toBe(false)
    expect(D().pending).not.toBeNull()
    expect(S().buildStep).toBeNull()
    const head = { ...S().cursor }
    stepBuild(-1)
    useShards.setState({ deployStatus: 'idle' })
    stepBuild(-1)
    expect(S().cursor).toEqual(head)
    expect(S().buildStep).toBeNull()
    // At your head a move is one cell of the zoom, never a STEP.
    useCyberspace.setState({ buildStep: 3 })
    const x = S().cursor.x
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x - x).toBe(1n << 15n)
  })

  it('touching STEP on your avatar is not leaving it: CANCEL still ends BUILD mode, on your avatar', () => {
    useCyberspace.setState({ scaleExp: 15 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 20 })
    expect(useBuilder.getState().via).toBe('deploy')
    stepBuild(-1)
    expect(S().cursor).not.toEqual(S().position)
    stepBuild(1)
    expect(useBuilder.getState().leftAvatar).toBe(false)
    D().cancelDeploy()
    expect(useBuilder.getState().active).toBe(false)
    expect(S().cursor).toEqual(S().position)

    // Lowered and left lowered, the same.
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 20 })
    stepTo(4)
    expect(S().cursor).not.toEqual(S().position)
    expect(useBuilder.getState().leftAvatar).toBe(false)
    D().cancelDeploy()
    expect(useBuilder.getState().active).toBe(false)
    expect(S().cursor).toEqual(S().position)

    // A move after STEP is leaving it, and the mode stays.
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 20 })
    stepTo(4)
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(useBuilder.getState().leftAvatar).toBe(true)
    D().cancelDeploy()
    expect(useBuilder.getState().active).toBe(true)
  })

  it('the box never lands in the other half of the cube after STEP went back to the zoom', () => {
    lineUp(15, 20)
    stepTo(14)
    stepTo(15)
    S().adjustScale(3)
    stepTo(17)
    // Re-centered on the 2^18 cube's center, not left where 2^15 put it.
    expect(S().cursor).toEqual(deployPoint(SPOT, 18, 20))

    // Lowered, canceled, and deployed again at another zoom: the same.
    D().cancelDeploy()
    expect(S().cursor).toEqual(SPOT)
    useBuilder.getState().toAvatar()
    lineUp(12, 20)
    stepTo(11)
    expect(S().cursor).toEqual(deployPoint(SPOT, 12, 20))
  })

  it('a zoom changed without the pad or keys (a focus, a hyperspace view) still brings STEP down for good', () => {
    lineUp(15, 20)
    stepTo(10)
    useCyberspace.setState({ scaleExp: 8 })
    expect(S().buildStep).toBeNull()
    useCyberspace.setState({ scaleExp: 15 })
    expect(buildStepOf(S())).toBe(15)
  })

  it('snaps a message the same way', () => {
    useCyberspace.setState({ scaleExp: 12 })
    D().startDeployMessage('under the floor')
    useShards.setState({ deployHeight: 20 })
    stepTo(5)
    const p = placed()
    for (const a of ['x', 'y', 'z'] as const) expect(p[a]).toBe(alignTo(S().cursor[a], 5) + (1n << 4n))
    expect(alignTo(p.x, 12)).toBe(alignTo(SPOT.x, 12))
  })
})
