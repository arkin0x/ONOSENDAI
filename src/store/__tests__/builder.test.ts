/**
 * builder.test.ts - BUILD mode and its build cursor (store/useBuilder.ts).
 *
 * arkinox, 2026-10-07 (R5, R6): deploying uses the Builder instead of the
 * avatar's position; DEPLOY centers the Builder on the avatar; the controls
 * and the zoom move the build cursor; the Position panel jumps it; exiting
 * is like the workshop's and leaves the view where it is. And building
 * never moves you: nothing in BUILD mode proposes, computes or signs a move.
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
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { BUILD_FOCUS_LABEL, useBuilder } from '../useBuilder'
import { escapeTop, topEscape } from '../../hooks/useEscape'
import { ACTION_KIND, type EventTemplate } from '../../lib/events'
import { deployPoint, type Position } from '../../lib/space'
import { buildCursorOf } from '../../lib/buildCursor'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

/** A shard on the bench with enough geometry to deploy. */
function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Beacon'),
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

/** Everything about you that a move would change. */
function chainSnapshot() {
  const s = S()
  return { position: { ...s.position }, events: s.events.length, prev: s.prevEventId, headPlane: s.headPlane, plan: s.plan, pendingTarget: s.pendingTarget, proof: s.proof.status }
}

/** Every template signed while the spy is on. */
let signed: EventTemplate[] = []
let realSign: ReturnType<typeof S>['signEvent']

beforeEach(() => {
  useBuilder.getState().exit()
  S().clearFocus()
  S().adjustScale(-S().scaleExp)
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
  signed = []
  realSign = S().signEvent
  useCyberspace.setState({ signEvent: async (t, patience) => { signed.push(t); return realSign(t, patience) } })
})

afterEach(() => {
  useCyberspace.setState({ signEvent: realSign })
  useBuilder.getState().exit()
  S().clearFocus()
})

describe('entering BUILD mode', () => {
  it('from the BUILD control at your head puts the build cursor on your avatar, off your head', () => {
    // A move lined up at your head is not where building starts.
    S().moveCursor({ axis: 'x', dir: 1 })
    B().enter('build')
    expect(B().active).toBe(true)
    expect(B().via).toBe('build')
    expect(S().cursor).toEqual(S().position)
    expect(buildCursorOf(S()).plane).toBe(S().plane)
    expect(S().focus?.drive).toBe(true)
    expect(S().focus?.label).toBe(BUILD_FOCUS_LABEL)
    // Not your head: no commit, no route, no next action from here.
    expect(S().atHead()).toBe(false)
    expect(S().canDrive()).toBe(true)
  })

  it('from the BUILD control in a free view keeps the place you went to', () => {
    const there: Position = { x: S().position.x + 5000n, y: S().position.y, z: S().position.z }
    S().focusOn(there, S().plane, 'there', undefined, true)
    B().enter('build')
    expect(S().cursor).toEqual(there)
  })

  it('from DEPLOY centers the build cursor on your avatar, even from a view somewhere else', () => {
    const shard = benchShard()
    const there: Position = { x: S().position.x + 5000n, y: S().position.y, z: S().position.z }
    S().focusOn(there, S().plane, 'there', undefined, true)
    useShards.getState().startDeployShard(shard.id)
    expect(B().active).toBe(true)
    expect(B().via).toBe('deploy')
    expect(S().cursor).toEqual(S().position)
    expect(S().anchor).toEqual(S().position)
  })

  it('a DEPLOY started while building lands where the build cursor already is', () => {
    const shard = benchShard()
    B().enter('build')
    S().moveCursor({ axis: 'y', dir: 1 })
    const aim = { ...S().cursor }
    useShards.getState().startDeployShard(shard.id)
    expect(B().via).toBe('build')
    expect(S().cursor).toEqual(aim)
  })
})

describe('the build cursor', () => {
  it('moves with the controls and never moves the avatar, the chain, or signs anything', async () => {
    const before = chainSnapshot()
    B().enter('build')
    for (const axis of ['x', 'y', 'z'] as const) {
      S().moveCursor({ axis, dir: 1 })
      S().moveCursor({ axis, dir: 1 })
    }
    expect(S().cursor).toEqual({ x: before.position.x + 2n, y: before.position.y + 2n, z: before.position.z + 2n })
    // COMMIT (Space at your head) while building: nothing is computed or signed.
    await S().commit()
    expect(chainSnapshot()).toEqual(before)
    expect(signed).toEqual([])
  })

  it('steps one cell of the zoom: zoomed out to 2^6 a step is 64 gibsons', () => {
    B().enter('build')
    const start = { ...S().cursor }
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x - start.x).toBe(1n)
    S().adjustScale(6)
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x - start.x).toBe(1n + 64n)
    // Still building, still not your head.
    expect(B().active).toBe(true)
    expect(S().atHead()).toBe(false)
  })

  it('jumps with the Position panel VIEW, which is a driven focus, and stays in BUILD mode', () => {
    B().enter('build')
    const target: Position = { x: 123456789n, y: 987654321n, z: 55555n }
    // What the Position panel's VIEW and RECENT do (Hud.tsx `look`).
    S().focusOn(target, 1, 'a typed place', 12, true)
    expect(B().active).toBe(true)
    expect(S().cursor).toEqual(target)
    expect(buildCursorOf(S())).toEqual({ position: target, plane: 1 })
    expect(S().scaleExp).toBe(12)
  })

  it('P switches the plane you build in and leaves the plane lined up at your head alone', () => {
    const headPlane = S().plane
    B().enter('build')
    S().togglePlane()
    expect(buildCursorOf(S()).plane).toBe(headPlane === 0 ? 1 : 0)
    expect(S().plane).toBe(headPlane)
  })

  it('RETURN TO AVATAR brings the build cursor back and keeps building', () => {
    B().enter('build')
    S().adjustScale(4)
    S().moveCursor({ axis: 'z', dir: 1 })
    B().toAvatar()
    expect(B().active).toBe(true)
    expect(S().cursor).toEqual(S().position)
    expect(S().anchor).toEqual(S().position)
    expect(S().scaleExp).toBe(4)
  })
})

describe('leaving BUILD mode', () => {
  it('EXIT leaves the view exactly where it is, as a free view with its RETURN', () => {
    B().enter('build')
    S().adjustScale(3)
    for (let i = 0; i < 5; i++) S().moveCursor({ axis: 'x', dir: 1 })
    const view = { cursor: { ...S().cursor }, anchor: { ...S().anchor }, scaleExp: S().scaleExp, plane: S().anchorPlane }
    B().exit()
    expect(B().active).toBe(false)
    expect(S().focus?.drive).toBe(true)
    expect({ cursor: S().cursor, anchor: S().anchor, scaleExp: S().scaleExp, plane: S().anchorPlane }).toEqual(view)
    expect(S().atHead()).toBe(false)
  })

  it('EXIT on your avatar ends the view at the zoom you are at, since the picture is the same', () => {
    B().enter('build')
    S().adjustScale(9)
    B().exit()
    expect(S().atHead()).toBe(true)
    expect(S().scaleExp).toBe(9)
  })

  it('Escape exits, after a deploy opened inside the mode', () => {
    B().enter('build')
    expect(topEscape()?.layer).toBe('chip')
    expect(escapeTop()).toBe(true)
    expect(B().active).toBe(false)
    // Off the stack once off.
    expect(topEscape()).toBeNull()
  })

  it('ends with the view it rides, and cancels a deploy lined up at its cursor', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    expect(B().active).toBe(true)
    // A plain focus (a deployment tapped in the stash) is not a build cursor.
    S().focusOn({ x: 1n, y: 2n, z: 3n }, 0, 'a shard')
    expect(B().active).toBe(false)
    expect(useShards.getState().pending).toBeNull()
  })
})

describe('DEPLOY in BUILD mode', () => {
  it('hides a single shard at the build cursor, not at the avatar, and moves nothing', async () => {
    const shard = benchShard()
    const before = chainSnapshot()
    B().enter('build')
    S().adjustScale(6)
    for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'x', dir: 1 })
    S().moveCursor({ axis: 'z', dir: -1 })
    const aim = { ...S().cursor }
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()

    expect(useShards.getState().deployStatus).toBe('done')
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    // The center of the build cursor's 2^6 cell (deployPoint), at height 0.
    const want = deployPoint(aim, 6, 0)
    expect(mine[0].at).toEqual({ x: want.x.toString(), y: want.y.toString(), z: want.z.toString() })
    expect(mine[0].plane).toBe(before.headPlane)
    // Hiding signs the item and its bag; never a movement action.
    expect(signed.length).toBeGreaterThan(0)
    expect(signed.every((t) => t.kind !== ACTION_KIND)).toBe(true)
    expect(chainSnapshot()).toEqual(before)
    // Still building: the next thing can go down too.
    expect(B().active).toBe(true)
  })

  it('lands in the plane the build view shows', async () => {
    const shard = benchShard()
    B().enter('build')
    S().togglePlane()
    const plane = buildCursorOf(S()).plane
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().mine[0].plane).toBe(plane)
  })
})
