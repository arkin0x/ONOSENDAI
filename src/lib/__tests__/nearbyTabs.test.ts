/**
 * nearbyTabs.test.ts: the kinds of DISCOVERED NEARBY (arkinox, 2026-11-01).
 * His order, ITEMS, CHESTS, DOORS, MESSAGES, SOUNDS, SHARDS, then SEEDS
 * (arkinox, 2026-11-13); the first tab
 * with anything in it is the one the list opens on; a door only under DOORS;
 * nothing without a tab.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_NEARBY_TAB, NEARBY_TABS, byTab, firstFilledTab, tabOf, type NearbyTab } from '../nearbyTabs'

const door = { type: 'chest', event: { tags: [['door', '4']] } }
const chest = { type: 'chest', event: { tags: [['t', 'x']] } }

describe('the tabs', () => {
  it('are in his order, ITEMS first (arkinox, 2026-11-01), SEEDS last (2026-11-13)', () => {
    expect(NEARBY_TABS.map((t) => t.label)).toEqual(['ITEMS', 'CHESTS', 'DOORS', 'MESSAGES', 'SOUNDS', 'SHARDS', 'SEEDS'])
    expect(DEFAULT_NEARBY_TAB).toBe('items')
  })

  it('open on the first tab, left to right, with more than 0 in it', () => {
    const none: Record<NearbyTab, number> = { items: 0, chests: 0, doors: 0, messages: 0, sounds: 0, shards: 0, seeds: 0 }
    expect(firstFilledTab(none)).toBe('items')
    expect(firstFilledTab({ ...none, items: 2, shards: 5 })).toBe('items')
    expect(firstFilledTab({ ...none, doors: 1, messages: 3 })).toBe('doors')
    expect(firstFilledTab({ ...none, shards: 1, sounds: 1 })).toBe('sounds')
    expect(firstFilledTab({ ...none, shards: 4 })).toBe('shards')
    expect(firstFilledTab({ ...none, seeds: 2 })).toBe('seeds')
    expect(firstFilledTab({ ...none, shards: 1, seeds: 2 })).toBe('shards')
    // Each tab, alone, is the one chosen.
    for (const { id } of NEARBY_TABS) expect(firstFilledTab({ ...none, [id]: 1 })).toBe(id)
  })

  it('count a chest with a door tag only under DOORS', () => {
    const tabs = byTab([door, chest])
    expect(tabs.doors).toEqual([door])
    expect(tabs.chests).toEqual([chest])
  })

  it('list a seed under SEEDS, never SHARDS', () => {
    const tabs = byTab([{ type: 'seed' }, { type: 'shard' }])
    expect(tabs.seeds).toEqual([{ type: 'seed' }])
    expect(tabs.shards).toEqual([{ type: 'shard' }])
  })

  it('lose nothing: a message, and a kind nobody has named, are reachable', () => {
    const things = ['key', 'shard', 'audio', 'chest', 'message', 'seed', 'someday'].map((type) => ({ type }))
    const tabs = byTab(things)
    expect(Object.values(tabs).flat()).toHaveLength(things.length)
    expect(tabOf({ type: 'message' })).toBe('messages')
    expect(tabOf({ type: 'someday' })).toBe('messages')
  })
})
