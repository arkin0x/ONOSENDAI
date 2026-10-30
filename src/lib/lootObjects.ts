/**
 * lootObjects.ts: which 3D objects float out of an opened chest (arkinox,
 * 2026-10-30):
 *
 *   "3D objects float out of the chest corresponding to the contents. if
 *   there is one or more messages, a scroll object comes out. if an object
 *   is inside, scale it so it looks small enough to fit in the chest and
 *   then have that float out. if the chest contains an Item, and the item
 *   has a model, make that model float out; if not, have a generic item
 *   object float out. one loot object can represent multiple enclosed
 *   objects (ex. 1 scroll means 1 or more messages.)"
 *
 *   "if an item is in your inventory and in the chest, hide it on the chest
 *   so it feels like you took it."
 *
 * So, from what a chest holds:
 *   - every message, Cashu coins included, and every hidden audio: one
 *     SCROLL for them all (audio is words of another kind, sealed as a
 *     message is; the ruling names messages only, so this is a choice);
 *   - every object (shard): itself, one per model, as TAKE takes one shard
 *     per model (lib/inventory.ts holdsModel);
 *   - every item (key): the model it wears, else the generic ITEM;
 *   - every chest inside: a small treasure chest.
 * What is held already is left out, and a loot object left with nothing to
 * stand for goes. Pure: the scene draws them (scene/ChestLoot.tsx).
 */

import type { ShardModel } from 'sno-core/shards'
import { placeOf, type ChestEntry } from './chests'
import type { LookName } from './looks'
import type { Position } from './space'
import { modelPrint } from './inventory'
import type { ItemModelRef } from './itemModel'

/** What a loot object is drawn as. */
export type LootKind = 'scroll' | 'shard' | 'item' | 'chest'

/** One object floating out of a chest, standing for one or more of its contents. */
export interface LootObject {
  /** Stable while it stands for the same things: the first content's id, by kind. */
  key: string
  kind: LootKind
  /** The contents it stands for, by id. */
  ids: string[]
  /** For a shard: its model. */
  shard?: ShardModel
  /** For an item that wears a model: the model, fetched as an item's is (hooks/useItemModel). */
  model?: ItemModelRef
}

/** The order they come out in: words first, then items, objects, chests. */
const ORDER: Record<LootKind, number> = { scroll: 0, item: 1, shard: 2, chest: 3 }

/** The loot objects for a chest's contents, leaving out what `held` says is already held. */
export function lootOf(entries: readonly ChestEntry[], held: (e: ChestEntry) => boolean): LootObject[] {
  const out: LootObject[] = []
  let scroll: LootObject | null = null
  const byModel = new Map<string, LootObject>()
  for (const e of entries) {
    if (held(e)) continue
    const body = e.body
    if (body.type === 'message' || body.type === 'audio') {
      if (!scroll) out.push(scroll = { key: `scroll:${e.id}`, kind: 'scroll', ids: [] })
      scroll.ids.push(e.id)
    } else if (body.type === 'shard' && body.shard) {
      const print = modelPrint(body.shard)
      const same = byModel.get(print)
      if (same) { same.ids.push(e.id); continue }
      const o: LootObject = { key: `shard:${e.id}`, kind: 'shard', ids: [e.id], shard: body.shard }
      byModel.set(print, o)
      out.push(o)
    } else if (body.type === 'key' && body.key) {
      out.push({ key: `item:${e.id}`, kind: 'item', ids: [e.id], ...(body.key.model ? { model: body.key.model } : {}) })
    } else if (body.type === 'chest' && body.chest) {
      out.push({ key: `chest:${e.id}`, kind: 'chest', ids: [e.id] })
    }
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
}

/**
 * Whether a content is aimed at its own point inside the chest's region: it
 * is drawn there in the world (lib/chests.ts revealedIn, lib/looks.ts
 * keptInChest), so it does not also float out as loot (review of #534).
 */
export function aimedElsewhere(e: ChestEntry, chest: { at: Position; plane: number; height: number }): boolean {
  const own = placeOf(e.event)
  if (!own || own.plane !== chest.plane) return false
  const h = BigInt(chest.height)
  const inRegion = (['x', 'y', 'z'] as const).every((a) => (own.at[a] >> h) === (chest.at[a] >> h))
  const same = own.at.x === chest.at.x && own.at.y === chest.at.y && own.at.z === chest.at.z
  return inRegion && !same
}

/**
 * The loot over an opened chest as the world draws it: none over a door (a
 * room is not treasure, and what is behind it stands in the room), none
 * while this identity's ITEMS are still loading (or every held thing would
 * float out for a moment after an identity switch), and otherwise lootOf,
 * less what is aimed at its own point in the region.
 */
export function chestLoot(o: {
  look: LookName
  entries: readonly ChestEntry[] | undefined
  held: (e: ChestEntry) => boolean
  chest: { at: Position; plane: number; height: number }
  itemsReady: boolean
}): LootObject[] {
  if (o.look !== 'treasure' || !o.entries || !o.itemsReady) return []
  return lootOf(o.entries.filter((e) => !aimedElsewhere(e, o.chest)), o.held)
}
