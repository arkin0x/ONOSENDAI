/**
 * nearbyTabs.test.ts: the kinds of DISCOVERED NEARBY (arkinox, 2026-11-01).
 * His order, ITEMS the default; a door only under DOORS; nothing without a tab.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_NEARBY_TAB, NEARBY_TABS, byTab, tabOf } from '../nearbyTabs'

const door = { type: 'chest', event: { tags: [['door', '4']] } }
const chest = { type: 'chest', event: { tags: [['t', 'x']] } }

describe('the tabs', () => {
  it('are in his order with ITEMS first and default, messages after his five', () => {
    expect(NEARBY_TABS.map((t) => t.label)).toEqual(['ITEMS', 'SHARDS', 'SOUNDS', 'CHESTS', 'DOORS', 'MESSAGES'])
    expect(DEFAULT_NEARBY_TAB).toBe('items')
  })

  it('count a chest with a door tag only under DOORS', () => {
    const tabs = byTab([door, chest])
    expect(tabs.doors).toEqual([door])
    expect(tabs.chests).toEqual([chest])
  })

  it('lose nothing: a message, and a kind nobody has named, are reachable', () => {
    const things = ['key', 'shard', 'audio', 'chest', 'message', 'someday'].map((type) => ({ type }))
    const tabs = byTab(things)
    expect(Object.values(tabs).flat()).toHaveLength(things.length)
    expect(tabOf({ type: 'message' })).toBe('messages')
    expect(tabOf({ type: 'someday' })).toBe('messages')
  })
})
