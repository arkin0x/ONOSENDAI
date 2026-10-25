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
import { HYSTERESIS_DOUBLINGS, SCENE_STRANGER, SCENE_STRANGER_SHARD, SCENE_TRUSTED, allocate, allowanceOf, clearMeshBudget, flushMeshBudget, provisional, setDemand, type Allowance, type Demand } from '../meshBudget'
import { budgeted, cutOf, placementSizes, placementSplits } from '../ShardMesh'
import type { Resolved } from '../../lib/parts'
import { placedPose, renderPose } from '../../lib/pose'
import type { ViewAxes } from '../../lib/space'
import { setLocalAuthor } from '../../lib/carried'
import { chargeByTrust, readFollows, resetFollows, setFollows, trustedAuthor, trustedPlacement } from '../../lib/trust'

/** A shard asking for `n` objects, all from the trusted pool or all from the strangers'. */
const d = (n: number, trusted: boolean, distance: number): Demand => ({ trusted: trusted ? n : 0, stranger: trusted ? 0 : n, distance })
/** All an allowance lets a shard draw, from both pools. */
const all = (a: Allowance | undefined): number | undefined => (a ? a.trusted + a.stranger : undefined)
/** An allowance of `n` from the strangers' pool: what a list with no references (a stranger's) is drawn within. */
const S = (n: number): Allowance => ({ trusted: 0, stranger: n })

describe('allocate', () => {
  it('gives your shards and those you follow what they ask, nearest first, from the reserved share', () => {
    const got = allocate(new Map([['far', d(1_500, true, 50)], ['near', d(1_500, true, 5)]]))
    expect(all(got.get('near'))).toBe(1_500)
    expect(all(got.get('far'))).toBe(SCENE_TRUSTED - 1_500)
  })

  it('caps every stranger\'s shard, and strangers together, nearest first', () => {
    const every = new Map(Array.from({ length: 8 }, (_, i) => [`s${i}`, d(10_000, false, i)] as [string, Demand]))
    const got = allocate(every)
    expect(all(got.get('s0'))).toBe(SCENE_STRANGER_SHARD)
    expect([...got.values()].reduce((a, b) => a + (all(b) ?? 0), 0)).toBe(SCENE_STRANGER)
    expect(all(got.get('s7'))).toBe(0)
  })

  it('five hostile strangers nearer the camera never take what is yours', () => {
    const every = new Map<string, Demand>([...Array.from({ length: 5 }, (_, i) => [`h${i}`, d(1_000_000, false, 0)] as [string, Demand]), ['mine', d(2_000, true, 100)]])
    expect(all(allocate(every).get('mine'))).toBe(2_000)
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
    expect(budgeted(list, S(2_100))).toBeNull()
    expect(budgeted(list, undefined)).toBeNull()
    // 250 objects: eleven whole placements of 21, the eleven nearest the anchor (placement 0 is at it).
    const keep = budgeted(list, S(250), { centre: [0, 0, 0], scale: 1 })!
    expect([...keep].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // Seen from the other end, the far ones are nearest.
    const other = budgeted(list, S(250), { centre: [-99, 0, 0], scale: 1 })!
    expect(Math.min(...other)).toBe(89)
    expect(budgeted(list, S(0))!.size).toBe(0)
  })
})

describe('the review of #511', () => {
  it('one anchor step of many shards costs one allocation, in time that grows with the shards and no faster', () => {
    const step = (n: number): number => {
      clearMeshBudget()
      for (let i = 0; i < n; i++) setDemand(`k${i}`, d(3, i % 2 === 0, i))
      flushMeshBudget()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) setDemand(`k${i}`, d(3, i % 2 === 0, i + 0.5))
      flushMeshBudget()
      const ms = performance.now() - t0
      expect(all(allowanceOf('k0'))).toBe(3)
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
      const scene = (da: number, db: number, held?: Map<string, Allowance>): Map<string, Allowance> => allocate(new Map<string, Demand>([
        ...Array.from({ length: 3 }, (_, i) => [`x${i}`, d(250, false, i / 10)] as [string, Demand]),
        ['A', d(250, false, da)],
        ['B', d(250, false, db)],
      ]), held)
      const first = scene(D, D + 0.001)
      expect([all(first.get('A')), all(first.get('B'))]).toEqual([250, 0])
      // B up to a fifth nearer: A keeps it.
      const close = scene(D, D - (HYSTERESIS_DOUBLINGS - 0.01), first)
      expect([D, all(close.get('A')), all(close.get('B'))]).toEqual([D, 250, 0])
      // B more than a fifth nearer: B takes it.
      const nearer = scene(D, D - (HYSTERESIS_DOUBLINGS + 0.01), first)
      expect([D, all(nearer.get('A')), all(nearer.get('B'))]).toEqual([D, 0, 250])
    }
  })

  it('provisional grants before a flush never pass the pool: twenty new strangers get 1,000 between them', () => {
    clearMeshBudget()
    let granted = 0
    for (let i = 0; i < 20; i++) granted += all(provisional(d(10_000, false, i)))!
    expect(granted).toBe(SCENE_STRANGER)
    // The next allocation recounts: grants made before it are not carried over.
    setDemand('one', d(10, false, 0))
    flushMeshBudget()
    expect(all(provisional(d(500, false, 1)))).toBe(SCENE_STRANGER_SHARD)
    clearMeshBudget()
  })

  it('a shard that places nothing costs provisional nothing', () => {
    expect(all(provisional(d(0, true, 0)))).toBe(0)
    expect(all(provisional(d(0, false, 0)))).toBe(0)
  })

  it('a shard not yet allocated may draw what is left of its pool, so its first frame is not an outline', () => {
    clearMeshBudget()
    expect(all(provisional(d(500, true, 0)))).toBe(500)
    setDemand('big', d(SCENE_TRUSTED - 100, true, 0))
    flushMeshBudget()
    expect(all(provisional(d(500, true, 1)))).toBe(100)
    expect(all(provisional(d(500, false, 1)))).toBe(SCENE_STRANGER_SHARD)
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
      expect([...budgeted(list, S(1), { centre, scale: 1, pose })!]).toEqual([truly])
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

  it('chargeByTrust asks whom you trust once per author, not once per placement', () => {
    const ME = 'a'.repeat(64), THEM = 'e'.repeat(64)
    let looked = 0
    setLocalAuthor(() => { looked++; return ME })
    try {
      const T = { left: 10 }, S = { left: 10 }
      const charge = chargeByTrust(T, () => S)
      for (let i = 0; i < 1_000; i++) { charge(ME, T); charge(THEM, T) }
      // trustedAuthor reads who you are once per question: one for you, one for them.
      expect(looked).toBe(2)
    } finally {
      setLocalAuthor(null)
    }
  })

})

describe('which share pays for each placement (as WALK charges, lib/trust.ts chargeByTrust)', () => {
  const ME = 'a'.repeat(64), THEM = 'e'.repeat(64)
  const leaf = (): Resolved => ({ model: newShard('leaf'), children: [] })
  const tree = (n: number): Resolved => ({ model: newShard('t'), children: Array.from({ length: n - 1 }, () => ({ part: { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, ref: ['a', 'x'], model: newShard('c'), children: [] })) })
  /** A resolved object by `pk` of one placed child, `child`. */
  const holding = (child: { ref: [string, string]; r: Resolved }): Resolved => ({ model: newShard('holder'), children: [{ part: { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, ref: child.ref as ['a', string], model: child.r.model, children: child.r.children }] })
  const fanOut = (count: number, ref: string, r: Resolved): { shard: ShardModel; byRef: Map<string, Resolved> } => ({
    shard: { ...newShard('root'), refs: [['a', ref]], parts: Array.from({ length: count }, (_, i) => ({ ref: 0, at: [i * 120, 0, 0], turn: [0, 0, 0], step: 0 })) },
    byRef: new Map([[`a:${ref}`, r]]),
  })

  it("a shard of yours placing a stranger's object pays for it, and all under it, from the strangers' pool, capped", () => {
    setLocalAuthor(() => ME)
    try {
      const { shard, byRef } = fanOut(1_000, `33331:${THEM}:obj`, tree(21))
      const split = placementSplits(shard, byRef, true).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0])
      expect(split).toEqual([0, 21_000])
      const got = allocate(new Map([['yours', { trusted: split[0], stranger: split[1], distance: 0 }], ['maze', d(1_500, true, 10)]]))
      expect(got.get('yours')).toEqual({ trusted: 0, stranger: SCENE_STRANGER_SHARD })
      // Your maze still has all of yours.
      expect(got.get('maze')?.trusted).toBe(1_500)
    } finally {
      setLocalAuthor(null)
    }
  })

  it("your own object placing a stranger's charges you for yours and them for theirs; a stranger's shard pays for all of it", () => {
    setLocalAuthor(() => ME)
    try {
      const yours = holding({ ref: ['a', `33331:${THEM}:x`], r: leaf() })
      const { shard, byRef } = fanOut(10, `33331:${ME}:mine`, yours)
      expect(placementSplits(shard, byRef, true).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0])).toEqual([10, 10])
      expect(placementSplits(shard, byRef, false).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0])).toEqual([0, 20])
      // Drawn only where both of a placement's parts fit: 3 of yours and 2 of theirs leave two placements.
      const list = (shard.parts ?? []).map((part) => ({ part, r: yours, ref: shard.refs![0] }))
      expect(budgeted(list, { trusted: 3, stranger: 2 }, { centre: [0, 0, 0], scale: 1 }, true)!.size).toBe(2)
    } finally {
      setLocalAuthor(null)
    }
  })
})

describe("what sno-core could not read ('objects') is the shard's outline, not a cube each", () => {
  it('folds placements cut for reads in with those the budget cut', () => {
    const drawnOne: Resolved = { model: newShard('a'), children: [] }
    const unread: Resolved = { model: null, missing: 'objects', children: [] }
    const gone: Resolved = { model: null, missing: 'unreachable', children: [] }
    const list = [{ r: drawnOne }, { r: unread }, { r: gone }, { r: drawnOne }]
    expect(cutOf(list, null)).toEqual([1])
    expect(cutOf(list, new Set([0, 1, 2]))).toEqual([1, 3])
  })
})
