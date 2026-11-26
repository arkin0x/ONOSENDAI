/**
 * itemsSeen.test.ts: which held items are NEW (owner, 2026-11-26), and what a
 * grid of six tiles shows of a list: the newest first, a "+N more" tile when
 * they do not fit, blank tiles when they do.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_SEEN, GRID_SLOTS, SEEN_IDS_MAX, SEEN_SINCE, cleanSeen, gridOf, isNewItem, kindOf, mergeSeen, seeItem, seeKind } from '../itemsSeen'

const loot = (id: string, at: number) => ({ id, type: 'message' as const, at })
const key = (id: string, at: number) => ({ id, type: 'key' as const, at })

describe('NEW', () => {
  it('everything held before NEW began is seen; anything held after it is new, key items and loot alike', () => {
    expect(isNewItem(EMPTY_SEEN, loot('old', SEEN_SINCE - 100))).toBe(false)
    expect(isNewItem(EMPTY_SEEN, loot('at', SEEN_SINCE))).toBe(false)
    expect(isNewItem(EMPTY_SEEN, loot('fresh', SEEN_SINCE + 1))).toBe(true)
    expect(isNewItem(EMPTY_SEEN, key('fresh-key', SEEN_SINCE + 1))).toBe(true)
    expect(kindOf(key('k', 0))).toBe('keys')
    expect(kindOf({ type: 'shard' })).toBe('loot')
  })

  it('opening a list sees every item in it, and only that kind', () => {
    const items = [loot('a', SEEN_SINCE + 5), loot('b', SEEN_SINCE + 9)]
    const k = key('k', SEEN_SINCE + 7)
    const after = seeKind(EMPTY_SEEN, 'loot', items)
    expect(items.some((it) => isNewItem(after, it))).toBe(false)
    expect(isNewItem(after, k)).toBe(true)
    // Something taken later is new again.
    expect(isNewItem(after, loot('c', SEEN_SINCE + 10))).toBe(true)
    // Nothing newer in the list: the same record, so nothing is written.
    expect(seeKind(after, 'loot', items)).toBe(after)
  })

  it('opening one card sees that item alone; the same record when it was already seen', () => {
    const a = key('a', SEEN_SINCE + 3)
    const b = key('b', SEEN_SINCE + 4)
    const after = seeItem(EMPTY_SEEN, a)
    expect(isNewItem(after, a)).toBe(false)
    expect(isNewItem(after, b)).toBe(true)
    expect(seeItem(after, a)).toBe(after)
    // A list opened later covers it, and its id needs no place of its own.
    const listed = seeKind(after, 'keys', [a, b])
    expect(listed.ids).toEqual([])
    expect(isNewItem(listed, b)).toBe(false)
  })

  it('merges two records losing nothing either saw, and reads back anything malformed as nothing seen', () => {
    const one = { through: { keys: SEEN_SINCE + 10, loot: SEEN_SINCE }, ids: ['x'] }
    const two = { through: { keys: SEEN_SINCE + 2, loot: SEEN_SINCE + 8 }, ids: ['y', 'x'] }
    expect(mergeSeen(one, two)).toEqual({ through: { keys: SEEN_SINCE + 10, loot: SEEN_SINCE + 8 }, ids: ['y', 'x'] })
    expect(cleanSeen(undefined)).toEqual(EMPTY_SEEN)
    expect(cleanSeen({ through: { keys: 'soon', loot: 1 }, ids: [1, 'a', 'a', null] })).toEqual({ through: { keys: SEEN_SINCE, loot: SEEN_SINCE }, ids: ['a'] })
    const many = Array.from({ length: SEEN_IDS_MAX + 20 }, (_, i) => `id${i}`)
    expect(cleanSeen({ ids: many }).ids).toHaveLength(SEEN_IDS_MAX)
  })
})

describe('the grid', () => {
  it('shows every item when they fit, in the order given (newest first), and blank tiles for the rest', () => {
    expect(GRID_SLOTS).toBe(6)
    expect(gridOf(['c', 'b', 'a'])).toEqual({ shown: ['c', 'b', 'a'], more: 0, empty: 3 })
    expect(gridOf(['f', 'e', 'd', 'c', 'b', 'a'])).toEqual({ shown: ['f', 'e', 'd', 'c', 'b', 'a'], more: 0, empty: 0 })
  })

  it('past six, shows the newest five and a last tile counting the rest', () => {
    const items = Array.from({ length: 12 }, (_, i) => `n${12 - i}`)
    const g = gridOf(items)
    expect(g.shown).toEqual(['n12', 'n11', 'n10', 'n9', 'n8'])
    expect(g.more).toBe(7)
    expect(g.empty).toBe(0)
    expect(g.shown.length + 1).toBe(GRID_SLOTS)
  })

  it('an empty list is six blank tiles', () => {
    expect(gridOf([])).toEqual({ shown: [], more: 0, empty: 6 })
  })
})
