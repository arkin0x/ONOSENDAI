/**
 * nearbyTabs.ts: the tabs of DISCOVERED NEARBY, left to right (arkinox,
 * 2026-11-01): ITEMS, CHESTS, DOORS, MESSAGES, SOUNDS, SHARDS. A door is a
 * chest with a `door` tag and counts only under DOORS. The list opens on the
 * first tab, left to right, with anything in it (firstFilledTab); on ITEMS
 * when every tab is empty.
 */

import { isDoor } from './looks'

export type NearbyTab = 'items' | 'shards' | 'sounds' | 'chests' | 'doors' | 'messages'

export const NEARBY_TABS: ReadonlyArray<{ id: NearbyTab; label: string }> = [
  { id: 'items', label: 'ITEMS' },
  { id: 'chests', label: 'CHESTS' },
  { id: 'doors', label: 'DOORS' },
  { id: 'messages', label: 'MESSAGES' },
  { id: 'sounds', label: 'SOUNDS' },
  { id: 'shards', label: 'SHARDS' },
]

/** The tab the list opens on when every tab is empty. */
export const DEFAULT_NEARBY_TAB: NearbyTab = 'items'

/** The first tab, left to right, with more than 0 in it; DEFAULT_NEARBY_TAB when none has. */
export function firstFilledTab(counts: Record<NearbyTab, number>): NearbyTab {
  return NEARBY_TABS.find(({ id }) => counts[id] > 0)?.id ?? DEFAULT_NEARBY_TAB
}

/** The one tab a thing is listed under; what fits no other is under MESSAGES, never nowhere. */
export function tabOf(item: { type: string; event?: { tags?: readonly unknown[] } }): NearbyTab {
  switch (item.type) {
    case 'key': return 'items'
    case 'shard': return 'shards'
    // A seed's bloom is a SNO object, so it lists with the shards.
    case 'seed': return 'shards'
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
