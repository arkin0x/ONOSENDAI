/**
 * inventory.ts: what an identity holds, as pure shapes and functions.
 *
 * Items are knowledge (quests design F5, ruled): a key is held by whoever has
 * read its private key, and a chest's contents by whoever opened it and took
 * them. So the inventory is a local list, kept per identity in IndexedDB like
 * region keys (store/useInventory.ts), and this file is everything about it
 * that does not touch a database: the row shape, how a find, a forging, a
 * taking or a paste becomes a row, the text a key travels as between devices,
 * and the split between the DISCOVERED panel (what the identity's keys have
 * opened, where it stands) and the LOOT panel (what the identity holds).
 *
 * The key text is `cyberspace-key:` followed by the key item's event as JSON,
 * so the same bytes that sat in the bag are what another device reads, name,
 * item public key, signature and hider included. A pasted key verifies its
 * signature when it has one and its secret against its `item` tag either way.
 */

import type { Plane } from 'cyberspace-core'
import { getEventHash, verifyEvent } from 'nostr-tools/pure'
import type { ShardModel } from 'sno-core/shards'
import type { NostrEvent } from './events'
import type { ChestEntry, OpeningKey } from './chests'
import { KEY_KIND, hiddenLabel, keyItemOf, type ChestItem, type Hidden, type HiddenType, type ItemBody, type KeyItem } from './hidden'

/** What a key looks like as text, for COPY and PASTE across devices. */
export const KEY_TEXT_PREFIX = 'cyberspace-key:'

/** How a held item came to be held. */
export type HeldSource = 'forged' | 'found' | 'taken' | 'pasted'

/** Where a held item was found: the bag it was in and the point it was placed at. */
export interface HeldPlace {
  lookupId: string
  bagId: string
  at: { x: string; y: string; z: string }
  plane: Plane
  height: number
}

/** The chest a taken item came out of. */
export interface HeldFrom {
  chestId: string
  chestName: string
}

/** One held item: a key, or a content taken from a chest. One row per item per identity. */
export interface HeldItem {
  /** The IndexedDB key: `${owner}/${id}`. */
  rowKey: string
  /** The identity that holds it. */
  owner: string
  /** The item event's id, which is what makes a second read of the same key the same row. */
  id: string
  type: HiddenType
  name: string
  /** The item's event as it was read: a key's signed event (or unsigned when pasted so), a taken content's event. */
  event: NostrEvent
  /** Who made it: the event's pubkey (the hider, for a key they forged). A claim unless `verified`. */
  author: string
  /** The event carried a signature that checked out (spec §7.6: an unsigned item's author is a claim, never a fact). */
  verified: boolean
  source: HeldSource
  /** Where it was found, or null for a key pasted from another device. */
  place: HeldPlace | null
  from: HeldFrom | null
  /** Unix seconds when this identity came to hold it. */
  at: number
  key?: KeyItem
  chest?: ChestItem
  text?: string
  shard?: ShardModel
}

export function rowKeyOf(owner: string, id: string): string {
  return `${owner}/${id}`
}

/** A found item's place, as the inventory keeps it. */
export function placeOf(h: Pick<Hidden, 'lookupId' | 'bagId' | 'at' | 'plane' | 'height'>): HeldPlace {
  return { lookupId: h.lookupId, bagId: h.bagId, at: { x: h.at.x.toString(), y: h.at.y.toString(), z: h.at.z.toString() }, plane: h.plane, height: h.height }
}

function row(owner: string, event: NostrEvent, body: ItemBody, verified: boolean, source: HeldSource, place: HeldPlace | null, from: HeldFrom | null, at: number): HeldItem {
  return {
    rowKey: rowKeyOf(owner, event.id),
    owner,
    id: event.id,
    type: body.type,
    name: hiddenLabel(body, 48),
    event,
    author: event.pubkey,
    verified,
    source,
    place,
    from,
    at,
    ...(body.key ? { key: body.key } : {}),
    ...(body.chest ? { chest: body.chest } : {}),
    ...(body.text !== undefined ? { text: body.text } : {}),
    ...(body.shard ? { shard: body.shard } : {}),
  }
}

/**
 * A key found in a bag, held (B1 §2.1: reading the item is holding it). Null
 * for anything that is not a key with its event: the ceremony's preview items
 * come out of no bag and carry none.
 */
export function heldFromFind(owner: string, h: Hidden, at: number): HeldItem | null {
  if (h.type !== 'key' || !h.key || !h.inner) return null
  // A bag's items are verified against the bag's author before they are found at all (hidden.ts fromInner).
  return row(owner, h.inner, { type: 'key', key: h.key }, true, 'found', placeOf(h), null, at)
}

/** A key the identity forged and hid, held at once so chests can be sealed to it (B1 §3.1). */
export function heldFromForged(owner: string, event: NostrEvent, key: KeyItem, place: HeldPlace, at: number): HeldItem {
  return row(owner, event, { type: 'key', key }, true, 'forged', place, null, at)
}

/** A content taken out of an opened chest. */
export function heldFromEntry(owner: string, entry: ChestEntry, from: HeldFrom, place: HeldPlace | null, at: number): HeldItem {
  return row(owner, entry.event, entry.body, entry.verified, 'taken', place, from, at)
}

/** A key pasted as text from another device; `verified` is parseKeyText's word on its signature. */
export function heldFromPasted(owner: string, event: NostrEvent, key: KeyItem, verified: boolean, at: number): HeldItem {
  return row(owner, event, { type: 'key', key }, verified, 'pasted', null, null, at)
}

/**
 * Hold more items. One row per id: an item already held keeps its row, so a
 * key read twice (a rescan, a second device's bag) is held once, and the
 * place and time of the first holding stand. Returns what was new.
 */
export function addHeld(items: Record<string, HeldItem>, add: HeldItem[]): { items: Record<string, HeldItem>; added: HeldItem[] } {
  const added: HeldItem[] = []
  let next = items
  for (const item of add) {
    if (next[item.id]) continue
    if (next === items) next = { ...items }
    next[item.id] = item
    added.push(item)
  }
  return { items: next, added }
}

/** A held key as text to carry to another device: the prefix and the key item's event. */
export function keyText(item: Pick<HeldItem, 'event'>): string {
  return KEY_TEXT_PREFIX + JSON.stringify(item.event)
}

const HEX_64 = /^[0-9a-f]{64}$/

/**
 * A key read back from its text, or null when the text is not one: not the
 * prefix, not JSON, not a key item, a secret that does not match its `item`
 * tag, or a signature that does not verify. An unsigned key (no `sig`) is
 * read, with its hider a claim, as §7.6 allows of any unsigned item; its id
 * is its hash, whatever the text claimed, so it can never stand in the
 * inventory for a real key's row. `verified` is whether a signature was
 * there and checked out.
 */
export function parseKeyText(text: string): { event: NostrEvent; key: KeyItem; verified: boolean } | null {
  const t = text.trim()
  if (!t.startsWith(KEY_TEXT_PREFIX)) return null
  let parsed: unknown
  try { parsed = JSON.parse(t.slice(KEY_TEXT_PREFIX.length)) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const ev = parsed as Partial<NostrEvent>
  if (ev.kind !== KEY_KIND || typeof ev.content !== 'string' || !Array.isArray(ev.tags) || typeof ev.pubkey !== 'string' || !HEX_64.test(ev.pubkey)) return null
  if (!ev.tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))) return null
  const plain = { pubkey: ev.pubkey, created_at: typeof ev.created_at === 'number' ? ev.created_at : 0, kind: ev.kind, tags: ev.tags, content: ev.content }
  const signed = typeof ev.sig === 'string' && ev.sig.length > 0
  let event: NostrEvent
  try {
    if (signed) {
      if (typeof ev.id !== 'string' || !HEX_64.test(ev.id)) return null
      event = { ...plain, id: ev.id, sig: ev.sig as string }
      if (!verifyEvent(event)) return null
    } else {
      event = { ...plain, id: getEventHash(plain), sig: '' }
    }
  } catch {
    return null
  }
  const key = keyItemOf(event)
  return key ? { event, key, verified: signed } : null
}

/** The held keys as the opener needs them (lib/chests.ts openerFor). */
export function openingKeys(items: Record<string, HeldItem>): OpeningKey[] {
  const out: OpeningKey[] = []
  for (const it of Object.values(items)) if (it.type === 'key' && it.key) out.push({ id: it.id, itemPubkey: it.key.itemPubkey, secretHex: it.key.secretHex })
  return out
}

/** Which of these chests a key opens: those whose lock is the key's public key. */
export function chestsOpenedBy(key: Pick<KeyItem, 'itemPubkey'>, chests: Array<{ id: string; chest: ChestItem }>): string[] {
  return chests.filter((c) => c.chest.lockPubkey === key.itemPubkey).map((c) => c.id)
}

/** One place in the DISCOVERED panel: a bag this identity's keys have opened, and what was in it. */
export interface DiscoveredPlace {
  bagId: string
  lookupId: string
  author: string
  height: number
  plane: Plane
  /** The newest item's time, which orders the places. */
  at: number
  /** Newest first. */
  items: Hidden[]
}

/** What the LOOT panel shows: the keys held, and the contents taken from chests. */
export interface Loot {
  /** Newest held first. */
  keys: HeldItem[]
  /** Everything taken that is not a key, newest first. */
  taken: HeldItem[]
}

const newestFirst = <T extends { at: number }>(a: T, b: T): number => b.at - a.at

/**
 * The three-panel model's two local panels, as one pure split (B1 ruling 14):
 * DISCOVERED is everything opened where it stands, grouped by the bag it was
 * in and newest first; LOOT is what is held, keys apart from the rest. A key
 * found is in both, because reading it was holding it; a chest found is in
 * DISCOVERED until something is taken out of it, and what is taken is in LOOT.
 */
export function splitPanels(discovered: Hidden[], held: HeldItem[]): { discovered: DiscoveredPlace[]; loot: Loot } {
  const places = new Map<string, DiscoveredPlace>()
  for (const h of discovered) {
    const p = places.get(h.bagId)
    if (p) {
      p.items.push(h)
      if (h.createdAt > p.at) p.at = h.createdAt
    } else {
      places.set(h.bagId, { bagId: h.bagId, lookupId: h.lookupId, author: h.author, height: h.height, plane: h.plane, at: h.createdAt, items: [h] })
    }
  }
  const grouped = [...places.values()].sort(newestFirst)
  for (const p of grouped) p.items.sort((a, b) => b.createdAt - a.createdAt)
  return {
    discovered: grouped,
    loot: {
      keys: held.filter((it) => it.type === 'key').sort(newestFirst),
      taken: held.filter((it) => it.type !== 'key').sort(newestFirst),
    },
  }
}
