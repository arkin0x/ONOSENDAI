/**
 * commentSubjects.ts: which thread an item's COMMENT opens, from every place
 * the item is listed (owner, 2026-11-15: "we should be able to comment on key
 * items we find and take").
 *
 * One rule for every surface, so a comment made on a key item before it is
 * taken (its card in the world, its DISCOVERED NEARBY row, its row in an
 * opened chest) and one made after (KEY ITEMS > MINE) land in one thread, and
 * everyone who reached the bag reads both. The thread hangs on the copy that
 * was found: its bag by address (`A` 33330:<bag author>:<lookup id>) and the
 * item's own inner event by its lineage (`e`, `k` 3340), sealed under the
 * key that opened the bag (lib/comments.ts). Never on the item's public
 * ITEM FEED listing (kind 33340): comments on a hidden item are sealed to its
 * place, and the listing is at no place, so its comments would have to be
 * public, a different rule; and a listing is not the thing anyone found.
 *
 * Nothing secret goes into a subject: no key item's private key, no door
 * secret. The bag's key is looked up on this device when the thread opens
 * (store/bagKeys.ts), never stored here. A thing a tutorial guide key sealed
 * has no thread (tutorial/guideBags.ts): its bag was never on a relay, and a
 * comment would name the device's guide key in public.
 */

import type { CommentSubject } from './comments'
import { itemTargetOf } from './comments'
import { itemLineage, type Hidden } from './hidden'
import type { HeldItem } from './inventory'
import type { Position } from './space'
import { isGuideAuthor } from '../tutorial/guideBags'
import { storedGuidePubkey } from '../tutorial/guide'

/** A tutorial guide key: one staged this visit, or the one this device keeps. */
export function isGuideKey(pubkey: string | null | undefined): boolean {
  if (!pubkey) return false
  return isGuideAuthor(pubkey) || storedGuidePubkey() === pubkey
}

/** What of a thing in the world a subject reads (store/useShards WorldItem). */
export interface WorldSubjectSource {
  key: string
  type: CommentSubject['type']
  author?: string
  lookupId?: string
  lineage?: string
  target?: CommentSubject['target']
  at: Position
  height: number
  bagKeyHex?: string
}

/** The thread of a thing in the world, as its card opens it (SecretModal), or null when it has none. */
export function subjectOfWorldItem(item: WorldSubjectSource): CommentSubject | null {
  if (!item.author || !item.lookupId || isGuideKey(item.author)) return null
  return {
    author: item.author,
    lookupId: item.lookupId,
    itemId: item.lineage ?? item.key,
    type: item.type,
    target: item.target,
    at: item.at,
    height: item.height,
    ...(item.bagKeyHex ? { bagKeyHex: item.bagKeyHex } : {}),
  }
}

/** The same for a find as the scan keeps it, mapped as the world maps it (useShards worldOf). */
export function subjectOfHidden(h: Hidden): CommentSubject | null {
  const lineage = h.ref ? null : itemLineage(h.inner)
  return subjectOfWorldItem({
    key: h.eventId,
    type: h.type,
    author: h.author,
    lookupId: h.lookupId,
    ...(lineage ? { lineage } : {}),
    target: itemTargetOf(h.inner, h.ref),
    at: h.at,
    height: h.height,
    ...(h.keyHex ? { bagKeyHex: h.keyHex } : {}),
  })
}

/** What heldBagAuthor reads of the finds and deployments here. */
interface BagLookup {
  discovered: Record<string, Pick<Hidden, 'author' | 'bagId' | 'chestId'>>
  mine: ReadonlyArray<{ eventId: string; bagId: string | null }>
  me: string
}

/**
 * Who signed the bag a held key item was found in: who the in-world card
 * names as its author (Hidden `author`), so the row's thread is the card's.
 * Kept with the place since it was taken (HeldPlace `author`). For a row
 * held before then: the chest it came out of as found here, a bag found or
 * hidden here with the same id, or, for an item found inline or forged, its
 * own signer, who is the bag's (a bag's inline items are its author's,
 * hidden.ts innerAuthentic). Null when it cannot be told: something taken
 * out of a chest no longer here may be another's than the chest's hider.
 */
export function heldBagAuthor(item: Pick<HeldItem, 'place' | 'from' | 'source' | 'event'>, at: BagLookup): string | null {
  const place = item.place
  if (!place?.lookupId) return null
  if (place.author) return place.author
  if (item.from) {
    const chest = at.discovered[item.from.chestId]
    if (chest) return chest.author
    if (at.mine.some((d) => d.eventId === item.from!.chestId)) return at.me
    return null
  }
  if (place.bagId) {
    for (const h of Object.values(at.discovered)) if (h.bagId === place.bagId && !h.chestId) return h.author
    if (at.mine.some((d) => d.bagId === place.bagId)) return at.me
  }
  return item.source === 'found' || item.source === 'forged' ? item.event.pubkey : null
}

/**
 * The thread of a key item held in ITEMS, the same as its card's where it
 * was found (subjectOfWorldItem): its bag, and its lineage. Null for anything
 * but a key item, one pasted from another device (no place), one whose bag's
 * author cannot be told, and one a tutorial guide sealed (said at TAKE, or
 * told now).
 */
export function subjectOfHeld(item: Pick<HeldItem, 'id' | 'type' | 'event' | 'place'>, bagAuthor: string | null): CommentSubject | null {
  const place = item.place
  if (item.type !== 'key' || !place?.lookupId || place.guide || !bagAuthor) return null
  const at = positionOfPlace(place.at)
  if (!at) return null
  return subjectOfWorldItem({
    key: item.id,
    type: 'key',
    author: bagAuthor,
    lookupId: place.lookupId,
    lineage: itemLineage(item.event) ?? undefined,
    at,
    height: place.height,
  })
}

function positionOfPlace(at: { x: string; y: string; z: string }): Position | null {
  try { return { x: BigInt(at.x), y: BigInt(at.y), z: BigInt(at.z) } } catch { return null }
}
