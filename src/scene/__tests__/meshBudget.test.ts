/**
 * meshBudget.test.ts - the scene's budget of placed objects (scene/meshBudget.ts,
 * ShardMesh budgeted): by trust, nearest first, each placement whole, and a
 * stranger never spending what is reserved for you and those you follow.
 */
import { describe, expect, it } from 'vitest'
import { newShard, type Part, type ShardModel } from 'sno-core/shards'
import { SCENE_STRANGER, SCENE_STRANGER_SHARD, SCENE_TRUSTED, allocate, type Demand } from '../meshBudget'
import { budgeted, placementSizes } from '../ShardMesh'
import type { Resolved } from '../../lib/parts'

const d = (demand: number, trusted: boolean, distance: number): Demand => ({ demand, trusted, distance })

describe('allocate', () => {
  it('gives your shards and those you follow what they ask, nearest first, from the reserved share', () => {
    const got = allocate(new Map([['far', d(3_000, true, 50)], ['near', d(3_000, true, 5)]]))
    expect(got.get('near')).toBe(3_000)
    expect(got.get('far')).toBe(SCENE_TRUSTED - 3_000)
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
