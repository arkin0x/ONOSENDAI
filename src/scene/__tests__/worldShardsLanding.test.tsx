/**
 * worldShardsLanding.test.tsx: a landing moves every world shard's group and
 * re-renders none of what the shard draws (arkinox, 2026-11-19: WALK
 * "unbearable" on his phone).
 *
 * Every landing moves the anchor, and with it every placed shard's centre.
 * PlacedShard handed the new centre to the shard's budget, so the whole of
 * every shard in the world rendered again, ShardMesh, its wall hint and its
 * tap target, two or three times a landing. Measured on a production build
 * (scripts/walk-fps-probe.mjs, a spot of 120 shards, 30 s of fluid WALK):
 * 5,805 ShardMeshBody renders. Only the group's position follows the anchor
 * now. A shard that places objects still re-renders, since the scene's budget
 * keeps the nearest of its placements by where it stands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const rendered = vi.hoisted(() => ({ mesh: 0, hint: 0, tap: 0, made: 0, gone: 0 }))
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))
vi.mock('../ShardMesh', async () => {
  const { createElement, useEffect } = await import('react')
  return { CUBE_EDGES: 'outline', ShardMesh: (props: object) => { rendered.mesh++; useEffect(() => { rendered.made++; return () => { rendered.gone++ } }, []); return createElement('shardmesh', props) } }
})
vi.mock('../WalkContactHint', () => ({ WalkContactHint: () => { rendered.hint++; return null } }))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => { rendered.tap++; return null } }))

import { createElement, useState, useSyncExternalStore } from 'react'
import { followsVersion, onFollows, setFollows } from '../../lib/trust'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { KEEP_MS, PlacedShard, budgetCentre, keptReach, keptWithin, type PlacedShardDraw } from '../WorldShards'

function cube(name: string): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

/** A shard that places another object (DECK-0003 §1.10). */
function placing(name: string): ShardModel {
  return { ...cube(name), parts: [{ ref: 'a:33331:' + 'f'.repeat(64) + ':other', at: [1, 0, 0] }] } as unknown as ShardModel
}

const clip = { min: [-9, -9, -9] as [number, number, number], max: [9, 9, 9] as [number, number, number] }
const pose = [1, 0, 0, 0, 1, 0, 0, 0, 1] as never

/** The shard as the world places it after the anchor moved to `x`: a new centre, the same model, cut and pose (WorldShards steadied). */
function at(shard: ShardModel, x: number): PlacedShardDraw {
  return { key: shard.id, shard, centre: [x, 0, -4], scale: 1, clip, pose }
}

/** A PlacedShard whose placement a test changes, as WorldShards hands a new one at each landing. */
async function placed(first: PlacedShardDraw): Promise<{ m: Mounted; place: (w: PlacedShardDraw) => Promise<void> }> {
  let set: (w: PlacedShardDraw) => void = () => undefined
  function World(): JSX.Element {
    const [w, setW] = useState(first)
    set = setW
    // A follows version, as WorldShards subscribes to it: whom you follow decides a shard's trust.
    useSyncExternalStore(onFollows, followsVersion)
    return createElement(PlacedShard, { w, birth: undefined, occludes: true })
  }
  const m = await mount(createElement(World))
  return { m, place: async (w) => { set(w); await settled() } }
}

const group = (m: Mounted): Host => m.all().find((h) => h.type === 'group' && h.props.position !== undefined)!
const budgetOf = (m: Mounted): { centre: number[] } => (m.all().find((h) => h.type === 'shardmesh')!.props as { budget: { centre: number[] } }).budget

afterEach(() => {
  rendered.mesh = 0
  rendered.hint = 0
  rendered.tap = 0
  rendered.made = 0
  rendered.gone = 0
})

describe('a landing, for a world shard that places nothing', () => {
  it('moves its group and renders nothing it draws again', async () => {
    const shard = cube('room')
    const { m, place } = await placed(at(shard, 10))
    expect([rendered.mesh, rendered.hint, rendered.tap]).toEqual([1, 1, 1])
    for (let x = 9; x >= 0; x--) {
      await place(at(shard, x))
      expect(group(m).props.position).toEqual([x, 0, -4])
    }
    expect([rendered.mesh, rendered.hint, rendered.tap]).toEqual([1, 1, 1])
    await m.unmount()
  })

  it('still renders again for a new model', async () => {
    const shard = cube('room')
    const { m, place } = await placed(at(shard, 10))
    await place(at({ ...shard, vertices: [...shard.vertices] }, 9))
    expect(rendered.mesh).toBe(2)
    await m.unmount()
  })
})

describe('what the parent still decides on every render', () => {
  it('a follow makes a stranger\'s shard trusted in its budget', async () => {
    const stranger = 'e'.repeat(64)
    setFollows([])
    const { m } = await placed({ ...at(cube('room'), 10), author: stranger, container: stranger })
    const trusted = (): boolean => (m.all().find((h) => h.type === 'shardmesh')!.props as { budget: { trusted: boolean } }).budget.trusted
    expect(trusted()).toBe(false)
    setFollows([stranger])
    await settled()
    expect(trusted()).toBe(true)
    setFollows([])
    await m.unmount()
  })
})

describe('a landing, for a world shard that places objects', () => {
  it('hands its budget the new centre, so its nearest placements are kept', async () => {
    const shard = placing('arch')
    const { m, place } = await placed(at(shard, 10))
    await place(at(shard, 3))
    expect(budgetOf(m).centre).toEqual([3, 0, -4])
    expect(rendered.mesh).toBe(2)
    await m.unmount()
  })
})

describe('budgetCentre', () => {
  it('keeps the first centre of a shard that places nothing, and follows one that places objects', () => {
    const was: [number, number, number] = [1, 2, 3]
    const now: [number, number, number] = [400, 2, 3]
    expect(budgetCentre(was, now, cube('room'))).toBe(was)
    expect(budgetCentre(was, now, placing('arch'))).toBe(now)
  })
})

describe('past the reach: hidden, not taken down (owner\'s phone diag, 2026-11-22: 2,477 objects to 959 and back on going into WALK and out)', () => {
  it('a shard hidden and shown again is never taken down: its group only turns invisible, and takes no taps meanwhile', async () => {
    const shard = cube('room')
    let set: (h: boolean) => void = () => undefined
    function World(): JSX.Element {
      const [hidden, setH] = useState(false)
      set = setH
      return createElement(PlacedShard, { w: at(shard, 10), birth: undefined, occludes: true, hidden })
    }
    const m = await mount(createElement(World))
    expect(group(m).props.visible).toBe(true)
    const taps = rendered.tap
    set(true)
    await settled()
    expect(group(m).props.visible).toBe(false)
    // No tap target while hidden: what renders inside is only the mesh's own update.
    expect(m.all().some((h) => h.type === 'taptarget')).toBe(false)
    expect(rendered.tap).toBe(taps)
    set(false)
    await settled()
    expect(group(m).props.visible).toBe(true)
    // The mesh was made once and never taken down: its cut and buffers stay (ShardMesh keys them on the same clip and pose).
    expect(rendered.made).toBe(1)
    expect(rendered.gone).toBe(0)
    await m.unmount()
  })

  it('keeps the largest reach it went out to for KEEP_MS from the moment the reach fell, then follows the reach again', () => {
    let k = keptReach(null, 1536, 0)
    // Five idle minutes in the orbit: nothing falls, nothing is counted.
    k = keptReach(k, 1536, KEEP_MS * 2)
    k = keptReach(k, 384, KEEP_MS * 2 + 1)
    expect(k.reach).toBe(1536)
    k = keptReach(k, 384, KEEP_MS * 3)
    expect(k.reach).toBe(1536)
    k = keptReach(k, 384, KEEP_MS * 3 + 2)
    expect(k.reach).toBe(384)
    k = keptReach(k, 6144, KEEP_MS * 3 + 3)
    expect(k.reach).toBe(6144)
  })

  it('keeps every shard within the reach and the nearest few already mounted past it, and mounts nothing new past it', () => {
    const near = at(cube('a'), 10)
    const far = [500, 900, 700].map((x, i) => at(cube(`f${i}`), x))
    const mountedAll = new Set([near, ...far].map((w) => w.key))
    expect(keptWithin([near, ...far], 384, 2, mountedAll).map((w) => w.centre[0])).toEqual([10, 500, 700])
    // Not mounted before: not built where it cannot be seen.
    expect(keptWithin([near, ...far], 384, 2, new Set([near.key, far[1].key])).map((w) => w.centre[0])).toEqual([10, 900])
    expect(keptWithin([near], 384, 0, new Set())).toEqual([near])
  })
})
