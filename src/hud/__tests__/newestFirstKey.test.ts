/**
 * newestFirstKey.test.ts: useNewestFirst's stability key, pinned down so a
 * caller that re-renders with a fresh-but-equal items array or used map
 * cannot force the sort (and everything downstream that is kept by the
 * array's own identity) to run again.
 *
 * arkinox, 2026-10-23: opening the workshop bench on a Maze Kit Basilica
 * piece and tapping it once, with a 138-shard library open, re-sorted the
 * whole library on every one of roughly 280 re-renders that single tap set
 * off in Workshop.tsx — none of them a change to a shard or a folder — for
 * seconds of blocked main thread.
 */
import { describe, expect, it } from 'vitest'
import { newestFirstKey } from '../ShardFolders'

interface Item { id: string; updatedAt: number }
const refOf = (i: Item): string => i.id
const editedAt = (i: Item): number => i.updatedAt

describe('newestFirstKey', () => {
  it('is equal for a fresh copy of the same items and the same used entries', () => {
    const a: Item[] = [{ id: 'oak', updatedAt: 10 }, { id: 'pond', updatedAt: 20 }]
    const b: Item[] = a.map((i) => ({ ...i })) // same content, every object and the array itself a new reference
    const usedA = { oak: 5 }
    const usedB = { oak: 5 } // same entries, a new object
    expect(a).not.toBe(b)
    expect(usedA).not.toBe(usedB)
    expect(newestFirstKey(a, refOf, editedAt, usedA)).toBe(newestFirstKey(b, refOf, editedAt, usedB))
  })

  it('is equal when used is undefined both times', () => {
    const items: Item[] = [{ id: 'gate', updatedAt: 1 }]
    expect(newestFirstKey(items, refOf, editedAt, undefined)).toBe(newestFirstKey([...items], refOf, editedAt, undefined))
  })

  it('does not depend on the used map\'s own key order', () => {
    const items: Item[] = [{ id: 'oak', updatedAt: 1 }]
    const used1 = { oak: 1, pond: 2 }
    const used2 = { pond: 2, oak: 1 }
    expect(newestFirstKey(items, refOf, editedAt, used1)).toBe(newestFirstKey(items, refOf, editedAt, used2))
  })

  it('changes when an item is added, removed, or reordered', () => {
    const base: Item[] = [{ id: 'oak', updatedAt: 1 }, { id: 'pond', updatedAt: 2 }]
    const added = [...base, { id: 'gate', updatedAt: 3 }]
    const reordered = [base[1], base[0]]
    const removed = [base[0]]
    const baseKey = newestFirstKey(base, refOf, editedAt, undefined)
    expect(newestFirstKey(added, refOf, editedAt, undefined)).not.toBe(baseKey)
    expect(newestFirstKey(reordered, refOf, editedAt, undefined)).not.toBe(baseKey)
    expect(newestFirstKey(removed, refOf, editedAt, undefined)).not.toBe(baseKey)
  })

  it('changes when an item\'s own edited time changes', () => {
    const items: Item[] = [{ id: 'oak', updatedAt: 1 }]
    const touched: Item[] = [{ id: 'oak', updatedAt: 2 }]
    expect(newestFirstKey(items, refOf, editedAt, undefined)).not.toBe(newestFirstKey(touched, refOf, editedAt, undefined))
  })

  it('changes when the used map gains, loses, or changes an entry', () => {
    const items: Item[] = [{ id: 'oak', updatedAt: 1 }]
    const baseKey = newestFirstKey(items, refOf, editedAt, { oak: 5 })
    expect(newestFirstKey(items, refOf, editedAt, { oak: 5, pond: 9 })).not.toBe(baseKey)
    expect(newestFirstKey(items, refOf, editedAt, { oak: 6 })).not.toBe(baseKey)
    expect(newestFirstKey(items, refOf, editedAt, undefined)).not.toBe(baseKey)
  })
})
