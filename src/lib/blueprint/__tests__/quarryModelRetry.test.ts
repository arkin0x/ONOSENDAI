/**
 * quarryModelRetry.test.ts - a look that fails to read is not kept failed
 * (review of #962): the next use reads it again; and the charges drawn in a
 * field are its identity's and plane's first, then capped.
 */

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ reads: 0 }))
vi.mock('../quarryTriPackArmed.sno.json', () => { h.reads++; return { default: { not: 'a shard' } } })

import { quarryArmedModel, quarryModelNow } from '../quarryModel'
import { shownCharges } from '../../../scene/QuarryFx'

describe('a look that fails to read', () => {
  it('comes back as none, and is asked for again next time (not kept failed)', async () => {
    const first = quarryArmedModel()
    expect(await first).toBeNull()
    const second = quarryArmedModel()
    expect(second).not.toBe(first)
    expect(await second).toBeNull()
    expect(quarryModelNow('armed')).toBeNull()
  })
})

describe('the charges drawn in a field', () => {
  it('are its identity\'s and plane\'s, filtered before the cap of 8', () => {
    const mine = Array.from({ length: 9 }, (_, i) => ({ id: i, owner: 'a', plane: 0 }))
    const others = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, owner: 'b', plane: 0 }))
    const otherPlane = Array.from({ length: 3 }, (_, i) => ({ id: 200 + i, owner: 'a', plane: 1 }))
    const shown = shownCharges([...others, ...otherPlane, ...mine], { owner: 'a', plane: 0 })
    expect(shown.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(shownCharges(mine, null)).toEqual([])
  })
})
