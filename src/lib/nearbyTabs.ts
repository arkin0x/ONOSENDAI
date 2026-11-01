/**
 * nearbyTabs.ts: the tabs of DISCOVERED NEARBY (arkinox, 2026-11-01): items
 * first and by default, then shards, sounds, chests and doors. A door is a
 * chest with a `door` tag and counts only under DOORS. Messages have no tab
 * of his, so they keep one of their own at the end: every kind is reachable.
 */

import { isDoor } from './looks'

export type NearbyTab = 'items' | 'shards' | 'sounds' | 'chests' | 'doors' | 'messages'

export const NEARBY_TABS: ReadonlyArray<{ id: NearbyTab; label: string }> = [
  { id: 'items', label: 'ITEMS' },
  { id: 'shards', label: 'SHARDS' },
  { id: 'sounds', label: 'SOUNDS' },
  { id: 'chests', label: 'CHESTS' },
  { id: 'doors', label: 'DOORS' },
  { id: 'messages', label: 'MESSAGES' },
]

export const DEFAULT_NEARBY_TAB: NearbyTab = 'items'

/** The one tab a thing is listed under; what fits no other is under MESSAGES, never nowhere. */
export function tabOf(item: { type: string; event?: { tags?: readonly unknown[] } }): NearbyTab {
  switch (item.type) {
    case 'key': return 'items'
    case 'shard': return 'shards'
    case 'audio': return 'sounds'
    case 'chest': return isDoor(item.event?.tags) ? 'doors' : 'chests'
    default: return 'messages'
  }
}

/** The list cut into tabs, keeping its order. */
export function byTab<T extends { type: string; event?: { tags?: readonly unknown[] } }>(list: readonly T[]): Record<NearbyTab, T[]> {
  const out: Record<NearbyTab, T[]> = { items: [], shards: [], sounds: [], chests: [], doors: [], messages: [] }
  for (const item of list) out[tabOf(item)].push(item)
  return out
}
