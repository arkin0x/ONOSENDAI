/** opacityStep.test.ts - the workshop's OPACITY stepper moves in fives between the floor and solid, and its slider and # in whole percent. */

import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { clampOpacity, dragHistory, opacityAt, opacityFraction, opacityPercent, stepOpacity, withOpacity } from '../opacityStep'

describe('the OPACITY stepper', () => {
  it('reads no opacity as solid', () => {
    expect(opacityPercent(undefined)).toBe(100)
    expect(opacityPercent(40)).toBe(40)
    // A stored 1 to 9 reads as the floor it is drawn at.
    expect(opacityPercent(5)).toBe(10)
  })

  it('steps in fives, and stops at the floor and at solid', () => {
    expect(stepOpacity(undefined, -1)).toBe(95)
    expect(stepOpacity(95, 1)).toBe(100)
    expect(stepOpacity(100, 1)).toBe(100)
    expect(stepOpacity(15, -1)).toBe(10)
    expect(stepOpacity(10, -1)).toBe(10)
  })

  it('takes a value off the fives to the next five in the direction asked', () => {
    expect(stepOpacity(33, 1)).toBe(35)
    expect(stepOpacity(33, -1)).toBe(30)
    expect(stepOpacity(3, 1)).toBe(15)
    expect(stepOpacity(3, -1)).toBe(10)
  })
})

describe('setting an opacity (withOpacity)', () => {
  const base: ShardModel = newShard('Water')

  it('keeps a percent between the floor and 99, and stores solid as none', () => {
    expect(withOpacity(base, 40).opacity).toBe(40)
    expect(withOpacity(base, 3).opacity).toBe(10)
    expect(withOpacity(withOpacity(base, 40), 100)).not.toHaveProperty('opacity')
    expect(withOpacity(base, Number.NaN)).not.toHaveProperty('opacity')
  })

  it('drops an opacity an older sno-core carried in extra, and extra with it when it empties', () => {
    const old: ShardModel = { ...base, extra: { opacity: 30 } }
    expect(withOpacity(old, 60)).not.toHaveProperty('extra')
    expect(withOpacity(old, 60).opacity).toBe(60)
    expect(withOpacity(old, 100)).not.toHaveProperty('extra')
    expect(withOpacity(old, 100)).not.toHaveProperty('opacity')
  })

  it('keeps every other carried field', () => {
    const old: ShardModel = { ...base, extra: { opacity: 30, sheen: 2 } }
    expect(withOpacity(old, 60).extra).toEqual({ sheen: 2 })
  })
})

describe('the OPACITY slider and its #', () => {
  it('clamps a typed percent to the floor and 100, in whole percent', () => {
    expect(clampOpacity(0)).toBe(10)
    expect(clampOpacity(9)).toBe(10)
    expect(clampOpacity(10)).toBe(10)
    expect(clampOpacity(55)).toBe(55)
    expect(clampOpacity(54.6)).toBe(55)
    expect(clampOpacity(100)).toBe(100)
    expect(clampOpacity(999)).toBe(100)
    expect(clampOpacity(Number.NaN)).toBeNull()
    expect(clampOpacity(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('runs the rail from the floor at its left end to solid at its right', () => {
    expect(opacityAt(0)).toBe(10)
    expect(opacityAt(1)).toBe(100)
    expect(opacityAt(0.5)).toBe(55)
    // Past either end of the rail (a drag that left it) holds at the end.
    expect(opacityAt(-0.4)).toBe(10)
    expect(opacityAt(1.7)).toBe(100)
    expect(opacityAt(Number.NaN)).toBe(10)
    for (let p = 10; p <= 100; p++) expect(opacityAt(opacityFraction(p))).toBe(p)
    expect(opacityFraction(10)).toBe(0)
    expect(opacityFraction(100)).toBe(1)
    expect(opacityFraction(5)).toBe(0)
  })

  it('leaves the history of one edit after a drag of many', () => {
    // Under the cap: what was there, then the shard before the drag.
    expect(dragHistory(['a', 'b'], 'S', ['a', 'b', 'S', 's1', 's2'])).toEqual(['a', 'b', 'S'])
    // A one-step drag is already one edit.
    expect(dragHistory(['a'], 'S', ['a', 'S'])).toEqual(['a', 'S'])
    // At the cap (4 here), the oldest goes, as one edit at a full history does.
    expect(dragHistory(['a', 'b', 'c', 'd'], 'S', ['d', 'S', 's1', 's2'])).toEqual(['b', 'c', 'd', 'S'])
    // A drag longer than the whole history still ends as one edit.
    expect(dragHistory(['a', 'b', 'c', 'd'], 'S', ['s1', 's2', 's3', 's4'])).toEqual(['b', 'c', 'd', 'S'])
  })
})
