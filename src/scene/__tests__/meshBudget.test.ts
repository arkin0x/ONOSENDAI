/**
 * meshBudget.test.ts - the scene's budget of placed objects (scene/meshBudget.ts,
 * ShardMesh budgeted): by trust, nearest first, each placement whole, and a
 * stranger never spending what is reserved for you and those you follow.
 */
import { describe, expect, it, vi } from 'vitest'

const contacts = vi.hoisted(() => ({ read: async (_pubkey: string): Promise<string[]> => [] }))
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: (pk: string) => contacts.read(pk), fetchContacts: async () => [] }))

import { Vector3 } from 'three'
import { newShard, toRender, type Part, type ShardModel } from 'sno-core/shards'
import { HYSTERESIS_DOUBLINGS, SCENE_STRANGER, SCENE_STRANGER_SHARD, SCENE_TRUSTED, allocate, allowanceOf, clearMeshBudget, flushMeshBudget, provisional, setDemand, type Demand } from '../meshBudget'
import { budgeted, placementSizes } from '../ShardMesh'
import type { Resolved } from '../../lib/parts'
import { placedPose, renderPose } from '../../lib/pose'
import type { ViewAxes } from '../../lib/space'
import { setLocalAuthor } from '../../lib/carried'
import { chargeByTrust, readFollows, resetFollows, setFollows, trustedAuthor, trustedPlacement } from '../../lib/trust'

const d = (demand: number, trusted: boolean, distance: number): Demand => ({ demand, trusted, distance })

describe('allocate', () => {
  it('gives your shards and those you follow what they ask, nearest first, from the reserved share', () => {
    const got = allocate(new Map([['far', d(1_500, true, 50)], ['near', d(1_500, true, 5)]]))
    expect(got.get('near')).toBe(1_500)
    expect(got.get('far')).toBe(SCENE_TRUSTED - 1_500)
  })

  it('caps every stranger\'s shard, and strangers together, nearest first', () => {
    const all = new Map(Array.from({ length: 8 }, (_, i) => [`s${i}`, d(10_000, false, i)] as [string, Demand]))
    const got = allocate(all)
    expect(got.get('s0')).toBe(SCENE_STRANGER_SHARD)
    expect([...got.values()].reduce((a, b) => a + b, 0)).toBe(SCENE_STRANGER)
    expect(got.get('s7')).toBe(0)
  })

  it('five hostile strangers nearer the camera never take what is yours', () => {
    const all = new Map<string, Demand>([...Array.from({ length: 5 }, (_, i) => [`h${i}`, d(1_000_000, false, 0)] as [string, Demand]), ['mine', d(2_000, true, 100)]])
    expect(allocate(all).get('mine')).toBe(2_000)
  })
})

describe('a shard within its allowance', () => {
  // A resolved object of `n` placed objects in all: one with n - 1 children of its own.
  const tree = (n: number): Resolved => ({ model: newShard('t'), children: Array.from({ length: n - 1 }, () => ({ part: { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, ref: ['a', 'x'], model: newShard('c'), children: [] })) })
  const placements = (count: number, each: number): { shard: ShardModel; byRef: Map<string, Resolved> } => {
    const ref = `33331:${'a'.repeat(64)}:obj`
    const parts: Part[] = Array.from({ length: count }, (_, i) => ({ ref: 0, at: [i * 120, 0, 0], turn: [0, 0, 0], step: 0 }))
    return { shard: { ...newShard('Fan-out'), refs: [['a', ref]], parts }, byRef: new Map([[`a:${ref}`, tree(each)]]) }
  }

  it('says what it would draw: every placement with its whole tree', () => {
    const { shard, byRef } = placements(100, 21)
    expect(placementSizes(shard, byRef).reduce((a, b) => a + b, 0)).toBe(2_100)
  })

  it('draws everything within its allowance, and the nearest whole placements past it', () => {
    const { shard, byRef } = placements(100, 21)
    const list = (shard.parts ?? []).map((part) => ({ part, r: byRef.get(`a:33331:${'a'.repeat(64)}:obj`) }))
    expect(budgeted(list, 2_100)).toBeNull()
    expect(budgeted(list, undefined)).toBeNull()
    // 250 objects: eleven whole placements of 21, the eleven nearest the anchor (placement 0 is at it).
    const keep = budgeted(list, 250, { centre: [0, 0, 0], scale: 1 })!
    expect([...keep].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // Seen from the other end, the far ones are nearest.
    const other = budgeted(list, 250, { centre: [-99, 0, 0], scale: 1 })!
    expect(Math.min(...other)).toBe(89)
    expect(budgeted(list, 0)!.size).toBe(0)
  })
})

describe('the review of #511', () => {
  it('one anchor step of many shards costs one allocation, in time that grows with the shards and no faster', () => {
    const step = (n: number): number => {
      clearMeshBudget()
      for (let i = 0; i < n; i++) setDemand(`k${i}`, { demand: 3, trusted: i % 2 === 0, distance: i })
      flushMeshBudget()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) setDemand(`k${i}`, { demand: 3, trusted: i % 2 === 0, distance: i + 0.5 })
      flushMeshBudget()
      const ms = performance.now() - t0
      expect(allowanceOf('k0')).toBe(3)
      return ms
    }
    step(300)
    const big = step(3_000)
    // Was 1.9 s at 3,000 (a reallocation per report); one reallocation is a few milliseconds.
    expect(big).toBeLessThan(250)
    clearMeshBudget()
  })

  it('a shard that asks for nothing takes no part', () => {
    expect(allocate(new Map([['none', d(0, false, 0)], ['some', d(10, false, 1)]])).has('none')).toBe(false)
  })

  it('a shard drawing keeps its share against one up to a fifth nearer, at every distance, and gives it up to one nearer than that', () => {
    // Distances are doublings: a fifth nearer is HYSTERESIS_DOUBLINGS (about 0.32) less, near or far.
    for (const D of [1, 4, 10, 40]) {
      const scene = (da: number, db: number, held?: Map<string, number>): Map<string, number> => allocate(new Map<string, Demand>([
        ...Array.from({ length: 3 }, (_, i) => [`x${i}`, d(250, false, i / 10)] as [string, Demand]),
        ['A', d(250, false, da)],
        ['B', d(250, false, db)],
      ]), held)
      const first = scene(D, D + 0.001)
      expect([first.get('A'), first.get('B')]).toEqual([250, 0])
      // B up to a fifth nearer: A keeps it.
      const close = scene(D, D - (HYSTERESIS_DOUBLINGS - 0.01), first)
      expect([D, close.get('A'), close.get('B')]).toEqual([D, 250, 0])
      // B more than a fifth nearer: B takes it.
      const nearer = scene(D, D - (HYSTERESIS_DOUBLINGS + 0.01), first)
      expect([D, nearer.get('A'), nearer.get('B')]).toEqual([D, 0, 250])
    }
  })

  it('a shard that places nothing costs provisional nothing', () => {
    expect(provisional(d(0, true, 0))).toBe(0)
    expect(provisional(d(0, false, 0))).toBe(0)
  })

  it('a shard not yet allocated may draw what is left of its pool, so its first frame is not an outline', () => {
    clearMeshBudget()
    expect(provisional(d(500, true, 0))).toBe(500)
    setDemand('big', d(SCENE_TRUSTED - 100, true, 0))
    flushMeshBudget()
    expect(provisional(d(500, true, 1))).toBe(100)
    expect(provisional(d(500, false, 1))).toBe(SCENE_STRANGER_SHARD)
    clearMeshBudget()
  })

  // The reviewer's cases: four placements 10 units out each way, the shard 5 out along +z and 3 along +x.
  const parts: Part[] = [[0, 0, 1200], [0, 0, -1200], [1200, 0, 0], [-1200, 0, 0]].map((at) => ({ ref: 0, at: at as [number, number, number], turn: [0, 0, 0], step: 0 }))
  const list = parts.map((part) => ({ part, r: { model: newShard('t'), children: [] } as Resolved }))
  const views: Record<string, ViewAxes> = {
    default: { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } },
    outNeg: { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } },
    side: { right: { axis: 'z', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'x', dir: 1 } },
  }
  for (const [name, axes] of Object.entries(views)) {
    it(`keeps the truly nearest placement through the shard's pose (${name} view)`, () => {
      const pose = placedPose(axes)
      const turn = renderPose(pose)
      const centre: [number, number, number] = [3, 0, 5]
      const real = (p: Part): number => new Vector3(...toRender(p.at)).applyMatrix4(turn).add(new Vector3(...centre)).length()
      const truly = parts.map((p, i) => [real(p), i] as const).sort((a, b) => a[0] - b[0])[0][1]
      expect([...budgeted(list, 1, { centre, scale: 1, pose })!]).toEqual([truly])
    })
  }

  it('trusts a shard only when both whoever put it there and the author of what it draws are trusted', () => {
    const ME = 'a'.repeat(64), FRIEND = 'f'.repeat(64), THEM = 'e'.repeat(64)
    setLocalAuthor(() => ME)
    setFollows([FRIEND])
    try {
      // A stranger's bag of live links to your public object: the stranger's.
      expect(trustedPlacement(THEM, ME)).toBe(false)
      // A live link in your bag to a stranger's object: the stranger's.
      expect(trustedPlacement(ME, THEM)).toBe(false)
      // Yours, a friend's, and a friend's link to yours: trusted.
      expect(trustedPlacement(ME, ME)).toBe(true)
      expect(trustedPlacement(FRIEND, FRIEND)).toBe(true)
      expect(trustedPlacement(FRIEND, ME)).toBe(true)
      // Made here: no container, no author.
      expect(trustedPlacement(undefined, undefined)).toBe(true)
    } finally {
      setLocalAuthor(null)
      resetFollows()
    }
  })

  it('reads the follows again for whoever is signed in, and forgets the last identity\'s', async () => {
    const A = 'a'.repeat(64), B = 'b'.repeat(64), FRIEND = 'f'.repeat(64)
    resetFollows()
    contacts.read = async (pk) => (pk === A ? [FRIEND] : [])
    let me: string | null = null
    setLocalAuthor(() => me)
    try {
      readFollows()
      me = A
      readFollows()
      await new Promise((r) => setTimeout(r, 0))
      expect(trustedAuthor(FRIEND)).toBe(true)
      me = B
      readFollows()
      expect(trustedAuthor(FRIEND)).toBe(false)
      // Signed out: none count, then back in as A, read again.
      me = A
      readFollows()
      await new Promise((r) => setTimeout(r, 0))
      expect(trustedAuthor(FRIEND)).toBe(true)
      me = null
      readFollows()
      setLocalAuthor(() => A)
      expect(trustedAuthor(FRIEND)).toBe(false)
    } finally {
      setLocalAuthor(null)
      resetFollows()
    }
  })

  it("chargeByTrust: yours to yours, a stranger's and everything under it to theirs, asked for only when needed", () => {
    const ME = 'a'.repeat(64), THEM = 'e'.repeat(64)
    setLocalAuthor(() => ME)
    try {
      const T = { left: 10 }
      let asked = 0
      const S = { left: 10 }
      const charge = chargeByTrust(T, () => { asked++; return S })
      expect(charge(ME, T)).toBe(T)
      expect(asked).toBe(0)
      expect(charge(THEM, T)).toBe(S)
      // Under a stranger's, even your own object stays theirs.
      expect(charge(ME, S)).toBe(S)
      // An `e`, whose author is not known, is a stranger's.
      expect(charge(null, T)).toBe(S)
      expect(asked).toBe(1)
    } finally {
      setLocalAuthor(null)
    }
  })

})
