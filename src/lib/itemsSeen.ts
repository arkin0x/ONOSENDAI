/**
 * itemsSeen.ts: which held items are NEW, the ones not looked at yet, for the
 * picture grids under the ITEMS buttons (owner, 2026-11-26: "the number
 * showing the amount of each kind of item isn't sufficient to see if i have
 * anything new or what i even have").
 *
 * An item stops being new when its card is opened, or when the list it is in
 * (KEY ITEMS or OTHER LOOT) is opened. The record is one identity's own
 * (owner ruling, 2026-11-19: all local data in IndexedDB keyed by npub), kept
 * by store/useItemsSeen.ts as a personal list (store/personalLists.ts). It
 * holds, per kind, the newest hold time already seen (`through`: everything
 * held at or before it was in a list that was opened), and the ids of items
 * seen one at a time on their card (`ids`), newest first and capped.
 *
 * BLUEPRINTS keeps a line of its own the same way (`through.blueprints`):
 * a blueprint card is new until the BLUEPRINTS list is opened, by the time
 * this identity came to hold it and its record's id (isNewBlueprint).
 *
 * Everything held before NEW existed (SEEN_SINCE) counts as seen, so the
 * grids do not open covered in NEW marks the first time, and a new identity
 * starts from the same line: what it takes from then on is new.
 *
 * Pure: nothing here reads a store, the clock or IndexedDB.
 */

import { isKeyItem, type HeldItem } from './inventory'

/** The two lists of held items in ITEMS, and the grid under each button. */
export type ItemsKind = 'keys' | 'loot'
/** Every list a NEW mark is kept for: the two of held items, and BLUEPRINTS. */
export type SeenKind = ItemsKind | 'blueprints'

/** Unix seconds: NEW began here (2026-11-26). Anything held before it was never new. */
export const SEEN_SINCE = Date.UTC(2026, 10, 26) / 1000

/** How many items seen on their card are remembered one by one. Older ones are long since behind `through`. */
export const SEEN_IDS_MAX = 400

export interface ItemsSeen {
  /** Per kind, the newest hold time (unix seconds) that was in a list when it was opened. */
  through: Record<SeenKind, number>
  /** Items seen on their card, newest first. */
  ids: string[]
}

export const EMPTY_SEEN: ItemsSeen = { through: { keys: SEEN_SINCE, loot: SEEN_SINCE, blueprints: SEEN_SINCE }, ids: [] }

/** Which list a held item is in. */
export function kindOf(item: Pick<HeldItem, 'type'>): ItemsKind {
  return isKeyItem(item) ? 'keys' : 'loot'
}

const time = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(v, SEEN_SINCE) : SEEN_SINCE)

/** What was read back, as this app can use it: anything malformed is dropped, never thrown. */
export function cleanSeen(raw: unknown): ItemsSeen {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { through?: Partial<Record<SeenKind, unknown>>; ids?: unknown }
  const ids = Array.isArray(r.ids) ? r.ids.filter((id): id is string => typeof id === 'string') : []
  return { through: { keys: time(r.through?.keys), loot: time(r.through?.loot), blueprints: time(r.through?.blueprints) }, ids: [...new Set(ids)].slice(0, SEEN_IDS_MAX) }
}

/** Two records as one, losing nothing either saw: the later line per kind, and every id (`early`'s first). */
export function mergeSeen(stored: ItemsSeen, early: ItemsSeen): ItemsSeen {
  return {
    through: {
      keys: Math.max(stored.through.keys, early.through.keys),
      loot: Math.max(stored.through.loot, early.through.loot),
      blueprints: Math.max(stored.through.blueprints, early.through.blueprints),
    },
    ids: [...new Set([...early.ids, ...stored.ids])].slice(0, SEEN_IDS_MAX),
  }
}

/** Whether a held item is NEW: held after its list was last opened, and its card never opened. */
export function isNewItem(seen: ItemsSeen, item: Pick<HeldItem, 'id' | 'type' | 'at'>): boolean {
  return item.at > seen.through[kindOf(item)] && !seen.ids.includes(item.id)
}

/** A blueprint card as the seen record counts it: its record's id, and when this identity came to hold it. */
export function blueprintSeenAs(card: { record: { id: string }; at: number }): { id: string; at: number } {
  return { id: card.record.id, at: card.at }
}

/** Whether a blueprint card is NEW: held after BLUEPRINTS was last opened. */
export function isNewBlueprint(seen: ItemsSeen, card: { record: { id: string }; at: number }): boolean {
  return card.at > seen.through.blueprints && !seen.ids.includes(card.record.id)
}

/**
 * The list of `kind` was opened showing `items`: every one of them is seen.
 * The same record when nothing changes, so a caller can skip the write.
 */
export function seeKind(seen: ItemsSeen, kind: SeenKind, items: ReadonlyArray<Pick<HeldItem, 'id' | 'at'>>): ItemsSeen {
  const newest = items.reduce((m, it) => Math.max(m, it.at), seen.through[kind])
  if (newest === seen.through[kind]) return seen
  // An id behind the line now needs no place of its own.
  const covered = new Set(items.map((it) => it.id))
  return { through: { ...seen.through, [kind]: newest }, ids: seen.ids.filter((id) => !covered.has(id)) }
}

/** One item's card was opened: it is seen. The same record when it already was. */
export function seeItem(seen: ItemsSeen, item: Pick<HeldItem, 'id' | 'type' | 'at'>): ItemsSeen {
  if (!isNewItem(seen, item)) return seen
  return { through: seen.through, ids: [item.id, ...seen.ids].slice(0, SEEN_IDS_MAX) }
}

/** How many tiles a grid has: two rows of three, always, so it never changes height. */
export const GRID_SLOTS = 6

/**
 * What a grid of `slots` tiles shows of `items` (newest first already): all
 * of them when they fit; otherwise the newest `slots - 1` and a last tile
 * saying how many more. `empty` is how many tiles are left blank.
 */
export function gridOf<T>(items: readonly T[], slots: number = GRID_SLOTS): { shown: T[]; more: number; empty: number } {
  if (items.length <= slots) return { shown: items.slice(), more: 0, empty: slots - items.length }
  const shown = items.slice(0, slots - 1)
  return { shown, more: items.length - shown.length, empty: 0 }
}
