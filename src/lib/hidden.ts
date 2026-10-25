/**
 * hidden.ts — content hidden at a location.
 *
 * A hidden thing is a nostr event, wrapped: the inner event is serialized,
 * encrypted to the region key for where it sits (spec §7), and carried inside
 * a kind:33330 envelope (spec §8.6) whose only public parts are the lookup id
 * and a height hint. Discovery decrypts the envelope, checks the inner event
 * against the envelope's signer (innerAuthentic: a signature, or for a
 * message a rumor's id), and renders by the inner kind. Nothing about where the
 * thing is, or what it is, leaks: the coordinate lives inside the ciphertext.
 *
 * A bag is a list of entries (spec §7.6). An entry that is an event is an
 * item carried inline; four inner kinds so far:
 *   - a shard, kind 3330 (v1's shard kind), geometry in the content;
 *   - a message, kind 1, text in the content;
 *   - a key, kind 3340: an item that is a keypair. The content is the item's
 *     private key, so reading it is holding it (Keys and Chests B1, §2.1);
 *   - a chest, kind 3341: a list of entries sealed with NIP-44 v2 to a public
 *     key, an item's or a person's (B1 §2.2). The sealing and opening live in
 *     lib/chests.ts; here the chest is read as an item like any other.
 *   - hidden audio, kind 1063 (DECK-0007): a NIP-94 file event naming an
 *     encrypted file on Blossom, with its key (lib/audioItem.ts).
 * All five carry their coordinate in a `C` tag, decoded on discovery, and the
 * NIP-70 `-` tag (arkinox, 2026-10-20): they only ever live inside bags, and
 * a relay that honours `-` accepts the event only from its author, so no
 * finder can republish one under the hider's name. A message goes further
 * and is sealed as a rumor (rumorOf): an id and no signature, so a copy of it
 * is not a note its hider ever signed; hidden audio is sealed the same way. Who wrote it is vouched for by the
 * envelope, which the hider does sign (innerAuthentic).
 *
 * An entry that is an array is a reference: `["a", "<kind>:<pubkey>:<d>",
 * relay, coord]` or `["e", id, relay, coord]`, naming an event published on
 * its own. That event is FF-1 partially encrypted: a public preview in
 * `content` and `["encrypted", "aes-256-gcm", ct, "cyberspace:region"]`,
 * sealed with the same region key as the bag and saying nothing about where
 * it is. A large shard is hidden this way, as a kind 33331 object (DECK-0003
 * §3.2, §3.4), so one big shard does not make the whole bag big.
 *
 * The envelope does not carry NIP-70's `-` (bagTemplate says why); the items
 * inside it do.
 *
 * Pure: signing happens in the store, which holds the key. This sees templates
 * and finished events only.
 */

import { getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord, type Plane } from 'cyberspace-core'
import { bytesToHex, hexToBytes, positionHex, type EventTemplate, type NostrEvent } from './events'
import { fromPayload, toPayload, type ShardModel } from 'sno-core/shards'
import { withAuthoredConstrain } from './walkConstrain'
import { keepOwnTable } from './carried'
import { creditTags, type Credit } from 'sno-core/feed'
import { ALGO, decryptForRegion, encryptForRegion } from './shardCrypto'
import { hintFits, hintTags, parseHint, type HintHeights } from './hint'
import { imetaTag, pictureOf, type PictureDim } from './itemPicture'
import { animationOf, modelOf, modelTags, type ItemAnimation, type ItemModelRef } from './itemModel'
import type { Position } from './space'
import { mentionTags } from './mentions'
import { cashuTokensAsWritten } from './cashu'
import { countNftLinks, NFT_WORDS, replaceNftLinks } from './nftLink'
import { AUDIO_KIND, audioItemOf, type AudioItem } from './audioItem'

/** The location-encrypted envelope (spec §8.6). */
export const HIDDEN_KIND = 33330
/**
 * The same envelope in the ephemeral range: a relay hands it to whoever is
 * subscribed at that moment and keeps nothing. Chat lives here. A 23330 is a
 * 33330 in every respect but the kind: same `d`, same `encrypted`, same `H`.
 */
export const CHAT_BAG_KIND = 23330
/** A chat line, inside the ephemeral envelope; the kind other clients use for ephemeral chat. */
export const CHAT_KIND = 23333

/**
 * The bag's height tag (spec §8.6): `["H", "<height>"]` on a 33330 bag and a
 * 23330 chat envelope. Uppercase since 2026-10-21 (arkinox), because NIP-29
 * claims `h` on every kind as a group id. `h` is read only on events written
 * before then (heightHint) and never written.
 */
export const HEIGHT_TAG = 'H'
export const LEGACY_HEIGHT_TAG = 'h'
/** Longest chat line. Short on purpose: it is a room, not a wall. */
export const MAX_CHAT_LENGTH = 500
/** A shard, inside the envelope (v1's shard kind). */
export const SHARD_KIND = 3330
/** A plain note, inside the envelope. */
export const MESSAGE_KIND = 1
/**
 * A key, inside the envelope (Keys and Chests B1 §2.1): an item that is a
 * keypair, its private key in the content. A regular kind unused anywhere
 * else in this client; these items are never published on their own, so a
 * collision on a relay could not matter.
 */
export const KEY_KIND = 3340
/** A chest, inside the envelope (B1 §2.2): a list of entries sealed to a public key. */
export const CHEST_KIND = 3341
/** Longest name a key or a chest carries: a label for a row, not a letter. The `requires` label is capped the same. */
export const MAX_ITEM_NAME = 64
/** Longest `about` a key carries: a sentence. */
export const MAX_ABOUT = 280
/** A standalone SNO object (DECK-0003 §3.1); a shard hidden by reference is one of these (§3.4). */
export const OBJECT_KIND = 33331
/** FF-1's key derivation for a key computed from a place rather than served (spec §7.6). */
export const REGION_KEY_DERIVATION = 'cyberspace:region'
/** The public face of an object hidden by reference: what any client that cannot open it shows. */
export const OBJECT_PREVIEW = 'This object is hidden at a place in cyberspace. Find it with ONOSENDAI: https://onosendai.tech'
/**
 * A shard whose payload is larger than this is hidden by reference. Every
 * shard an author hides in one region shares one bag, and the bag is
 * rewritten whole on every change, so a large shard carried inline makes
 * every later change to that region pay for it again. 16 KB is roughly a
 * few hundred vertices; smaller shards stay inline, one fetch instead of two.
 */
export const REFERENCE_THRESHOLD_BYTES = 16_384

/** A reference entry (spec §7.6): ["a" | "e", target, relay hint, coord hex]. */
export type Reference = string[]
/**
 * An event as a bag or a chest carries it: signed, or a rumor with no `sig`
 * (a chat line, and a message since 2026-10-20). A signed event is one of
 * these too.
 */
export type Rumor = Omit<NostrEvent, 'sig'> & { sig?: string }
/** One entry of a bag's list: an inline item, signed or a rumor, or a reference. */
export type BagEntry = NostrEvent | Rumor | Reference
/** Fetches the event a reference names, or null. Injected so this file stays pure. */
export type ResolveReference = (ref: Reference) => Promise<NostrEvent | null>

/** A well-formed reference entry: an `a` or `e` tag of strings. */
export function isReference(x: unknown): x is Reference {
  return Array.isArray(x) && (x[0] === 'a' || x[0] === 'e') && typeof x[1] === 'string' && x[1].length > 0 && x.every((v) => typeof v === 'string')
}

/**
 * A stable identity for an entry, for de-duplicating a bag's list. A
 * reference's point is part of it: one object placed at two points is two
 * entries, and removing one must not remove the other.
 */
export function entryKey(e: BagEntry): string {
  return isReference(e) ? `${e[0]}:${e[1]}@${e[3] ?? ''}` : e.id
}

/**
 * The identity of a LIVE LINK: a reference to a public object (one with no
 * `encrypted` tag, yours or another author's), whose author's edits change
 * its event id. The bag and the entry, `<lookup id>/<entry key>`: the same
 * object at the same point in two bags (two heights, or two hiders) is two
 * items, and one deleted leaves the other (verification review of #233).
 * The deploy and the scan both key it this way.
 */
export function linkKey(lookupId: string, ref: Reference): string {
  return `${lookupId}/${entryKey(ref)}`
}

/**
 * The most references one bag may make this client fetch, and how many at
 * once. Opening a bag is cheap; each reference is a relay query, so a bag
 * stuffed with them must not turn one find into a flood.
 */
export const MAX_REFERENCES_PER_BAG = 64
const REFERENCE_CONCURRENCY = 4

/** Where a reference without its own point is drawn: the base of the region the bag is sealed to. */
export interface RegionOrigin { at: Position; plane: Plane }

/** Whether a shard is large enough to hide by reference. */
export function wantsReference(shard: ShardModel): boolean {
  return new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(shard)))).length > REFERENCE_THRESHOLD_BYTES
}

/**
 * The kind 33331 object a large shard is hidden as (DECK-0003 §3.4): the
 * payload sealed with the region key, a public preview, and a `d` the caller
 * chooses. The caller passes a fresh random `d` for every placement, because
 * 33331 is addressable: two placements of one shard under one `d` would
 * replace each other on the relay, and each is sealed to a different place.
 * No `name`, `C`, height (`H`), hint or sector tag: nothing that could say where.
 */
export async function objectTemplate(shard: ShardModel, regionKey: Uint8Array, d: string, createdAt: number): Promise<EventTemplate> {
  // OPAQUE for a shard whose author never chose (DECK-0003 §1.12), as every hidden shard.
  const ciphertext = await encryptForRegion(regionKey, JSON.stringify(toPayload(withAuthoredConstrain(shard))))
  return {
    kind: OBJECT_KIND,
    created_at: createdAt,
    content: OBJECT_PREVIEW,
    tags: [['d', d], ['alt', OBJECT_PREVIEW], ['encrypted', ALGO, ciphertext, REGION_KEY_DERIVATION]],
  }
}

/** The reference entry that hides a signed object at a point (spec §7.6). */
export function referenceTo(object: NostrEvent, at: Position, plane: Plane, relayHint: string): Reference {
  const d = object.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  return ['a', `${object.kind}:${object.pubkey}:${d}`, relayHint, positionHex(at, plane)]
}

/**
 * Longest hidden message. The relay is the only hard limit and it is far
 * off: the canonical relay (strfry) takes 262,140 bytes of content, and
 * the sealed envelope of a 10,000-character message is under 15 KB. Two
 * thousand was a placeholder, and it cut a Cashu token of six proofs in
 * half as it was pasted; ten thousand leaves room for thirty.
 */
export const MAX_MESSAGE_LENGTH = 10_000

export type HiddenType = 'shard' | 'message' | 'key' | 'chest' | 'audio'

/** What a key item carries, read out of its event (B1 §2.1). */
export interface KeyItem {
  name: string
  /** The hider's sentence about it, or empty. */
  about: string
  /** The item's public key: the lock a chest names when it is sealed to this key. */
  itemPubkey: string
  /** The item's private key, 64 lowercase hex. Holding it is holding the item. */
  secretHex: string
  /**
   * The item's picture (lib/itemPicture.ts): a raster data URI at most 32
   * pixels a side, shown as its icon in ITEMS and wherever it is listed
   * (arkinox, 2026-10-10). Optional; an item without one wears its kind's
   * icon. `imageDim` is its width and height, known when it was forged and
   * carried in the tag's `dim`, so no reader has to decode the picture to
   * know its size. Both are set together or not at all.
   */
  image?: string
  imageDim?: PictureDim
  /**
   * The SNO the item wears in cyberspace, by its address, and how it moves
   * (lib/itemModel.ts, arkinox, 2026-10-21). Optional; an item without a
   * model is drawn as the note's cube. `animation` is only read or written
   * with a model, and is absent when the model stands still.
   */
  model?: ItemModelRef
  animation?: ItemAnimation[]
}

/** What a chest item carries, read out of its event (B1 §2.2); the payload is still sealed. */
export interface ChestItem {
  name: string
  /** The public key the chest is sealed to: an item's, or a person's. */
  lockPubkey: string
  /** The one-time sender key's public half, which the opener needs for the conversation key. */
  senderPubkey: string
  /** The hider's label of what opens it, for a reader who does not hold it. */
  requires: string
  /** The NIP-44 v2 payload, base64, as the chest carries it. */
  payload: string
}

const HEX_64 = /^[0-9a-f]{64}$/

/** Whether an item's content and tags have the shape every reading below assumes: an unsigned entry may have any shape at all. */
function wellShaped(ev: Pick<NostrEvent, 'content' | 'tags'>): boolean {
  return typeof ev.content === 'string' && Array.isArray(ev.tags)
}

/** The first tag of that name's value; a tag that is not an array of strings is passed over. */
function tagValue(tags: string[][], name: string): string | undefined {
  const t = tags.find((t) => Array.isArray(t) && t[0] === name)
  return t && typeof t[1] === 'string' ? t[1] : undefined
}

/** A tag's text as a label: trimmed, one space between words, capped at `max`. */
function capped(tags: string[][], name: string, max: number): string {
  return (tagValue(tags, name) ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

/**
 * A key's or a chest's title, capped; `fallback` when it carries none. The tag
 * is `title`, the one other nostr kinds use for a human name, so a client that
 * knows nothing of keys and chests can still label one (arkinox, 2026-10-09).
 * Items forged before the switch carry `name`, and are still read.
 */
function nameOf(tags: string[][], fallback: string): string {
  return capped(tags, 'title', MAX_ITEM_NAME) || capped(tags, 'name', MAX_ITEM_NAME) || fallback
}

/**
 * A key item out of its event, or null when it is not one this client can
 * hold: the `secret` tag must be a valid 32-byte secret, and an `item` tag,
 * when carried, must be the public key that secret derives, or the item is
 * corrupt and nothing sealed to it could ever be opened with it.
 *
 * Keys forged on 2026-10-09, before the secret moved into its tag, carry it
 * as the content and their sentence in an `about` tag; they are still read.
 */
export function keyItemOf(ev: Pick<NostrEvent, 'kind' | 'content' | 'tags'>): KeyItem | null {
  if (ev.kind !== KEY_KIND || !wellShaped(ev)) return null
  const tagged = tagValue(ev.tags, 'secret')
  const secretHex = (tagged ?? ev.content).trim()
  if (!HEX_64.test(secretHex)) return null
  let itemPubkey: string
  try { itemPubkey = getPublicKey(hexToBytes(secretHex)) } catch { return null }
  const claimed = tagValue(ev.tags, 'item')
  if (claimed !== undefined && claimed !== itemPubkey) return null
  const about = tagged !== undefined
    ? ev.content.trim().replace(/\s+/g, ' ').slice(0, MAX_ABOUT)
    : capped(ev.tags, 'about', MAX_ABOUT)
  // The picture, when the item carries one this client accepts: only a data
  // URI, at most 32 a side (lib/itemPicture pictureOf, and why). An imeta tag
  // that says anything else is passed over, and the item reads as one without.
  const picture = pictureOf(ev.tags)
  // The model and its motions, when the item names a SNO this client can
  // fetch (lib/itemModel.ts); motions with no model move nothing, and are
  // not read.
  const model = modelOf(ev.tags)
  const animation = model ? animationOf(ev.tags) : []
  return {
    name: nameOf(ev.tags, 'key'), about, itemPubkey, secretHex,
    ...(picture ? { image: picture.image, imageDim: picture.dim } : {}),
    ...(model ? { model } : {}),
    ...(animation.length > 0 ? { animation } : {}),
  }
}

/** A chest item out of its event, or null when its lock tag or payload is malformed. */
export function chestItemOf(ev: Pick<NostrEvent, 'kind' | 'content' | 'tags'>): ChestItem | null {
  if (ev.kind !== CHEST_KIND || !wellShaped(ev)) return null
  const lock = ev.tags.find((t) => Array.isArray(t) && t[0] === 'lock')
  if (!lock || typeof lock[1] !== 'string' || typeof lock[2] !== 'string' || !HEX_64.test(lock[1]) || !HEX_64.test(lock[2])) return null
  if (!ev.content) return null
  return { name: nameOf(ev.tags, 'chest'), lockPubkey: lock[1], senderPubkey: lock[2], requires: capped(ev.tags, 'requires', MAX_ITEM_NAME), payload: ev.content }
}

/** What an inline item is, by its kind: the part of a Hidden that is not about where or who. */
export interface ItemBody {
  type: HiddenType
  shard?: ShardModel
  text?: string
  key?: KeyItem
  chest?: ChestItem
  audio?: AudioItem
}

/**
 * Read an inline item by its kind, or null for a kind this client does not
 * know or an item that does not parse (spec §7.6: a reader skips what it
 * cannot read, and only that). The same reading serves a bag's items and a
 * chest's contents, so a key is a key wherever it is found.
 */
export function readItem(inner: Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'id'>, author: string | null): ItemBody | null {
  if (!wellShaped(inner)) return null
  if (inner.kind === SHARD_KIND) {
    let raw: unknown
    try { raw = JSON.parse(inner.content) } catch { return null }
    const shard = fromPayload(raw, inner.id)
    // The pieces it carries count only under `author` (DECK-0003 §1.10): the
    // item's signer, or for an unsigned one the bag's or chest's signer, never
    // the pubkey it claims; null honours none.
    return shard ? { type: 'shard', shard: keepOwnTable(shard, author) } : null
  }
  if (inner.kind === MESSAGE_KIND) {
    return inner.content ? { type: 'message', text: inner.content.slice(0, MAX_MESSAGE_LENGTH) } : null
  }
  if (inner.kind === KEY_KIND) {
    const key = keyItemOf(inner)
    return key ? { type: 'key', key } : null
  }
  if (inner.kind === CHEST_KIND) {
    const chest = chestItemOf(inner)
    return chest ? { type: 'chest', chest } : null
  }
  if (inner.kind === AUDIO_KIND) {
    const audio = audioItemOf(inner)
    return audio ? { type: 'audio', audio } : null
  }
  return null
}

/**
 * A short one-line look at a message, for a title or a row. A nonfungible.cash
 * claim link reads as "NFT link": its key is what claims, so no row, title or
 * label ever shows it (lib/nftLink).
 */
export function messagePreview(text: string, max = 32): string {
  const t = replaceNftLinks(text, NFT_WORDS).trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t || 'empty'
}

/** What a hidden thing is called in a row, a chip or a ghost: a message's preview, else its name. */
export function hiddenLabel(h: Pick<ItemBody, 'type' | 'text' | 'shard' | 'key' | 'chest' | 'audio'>, max = 32): string {
  if (h.type === 'message') return messagePreview(h.text ?? '', max)
  if (h.type === 'audio') return h.audio?.title ?? 'audio'
  if (h.type === 'key') return h.key?.name ?? 'key'
  if (h.type === 'chest') return h.chest?.name ?? 'chest'
  return h.shard?.name ?? 'shard'
}

/** What a decoded hidden thing carries, ready to render. */
export interface Hidden {
  /**
   * The item's stable identity: its inner event id. For a LIVE LINK (a
   * reference to a public object) it is `linkKey`: the bag and the entry.
   */
  eventId: string
  /**
   * The inner event itself, verified (innerAuthentic: a message is a rumor
   * with no `sig`, vouched for by the bag's signature), and the region key
   * that opened its bag, as hex. Together they let a find of your own become a deployment
   * on this device: enough to rebuild, broadcast or delete the bag from here.
   * Absent on the ceremony's preview items, which came out of no bag.
   */
  inner?: Rumor
  keyHex?: string
  /** The envelope (bag) currently holding it; changes when the bag is rewritten. */
  bagId: string
  /** The bag's `d` tag (spec §8.6 lookup id): with the author it is the bag's address. */
  lookupId: string
  /** The author, from the inner (and envelope) pubkey. */
  author: string
  at: Position
  plane: Plane
  /**
   * The height of the bag's region, the discovery radius: the height of the
   * key that opened it when the reader knows it, else the bag's height tag
   * (`H`, or a legacy `h`; heightHint), which is optional (spec §8.6). A bag
   * that omits it still has a height.
   */
  height: number
  /**
   * What the bag says in public: its `H`, its hint, its riddle (BagSettings),
   * shared by every item in it. Absent on the ceremony's preview items, which
   * came out of no bag.
   */
  bag?: BagSettings
  /** When the inner event was made. */
  createdAt: number
  type: HiddenType
  shard?: ShardModel
  text?: string
  key?: KeyItem
  chest?: ChestItem
  audio?: AudioItem
  /**
   * Set when the item was hidden by reference: the entry itself, which is what
   * a rewrite of the bag must carry forward. `inner` is then the referenced
   * event (the kind 33331 object), and its author may differ from `author`,
   * the key that placed it (spec §7.6).
   */
  ref?: Reference
  /**
   * Set when this was revealed from inside a chest: that chest's inner event
   * id. It is then not a bag entry but part of the chest's sealed contents,
   * so taking it out means sealing the chest again without it (useShards
   * removeFromChest), never rewriting the bag's entries directly.
   */
  chestId?: string
  /**
   * Set when this was revealed from inside a chest and its author is a
   * claim (lib/chests.ts readContents): unsigned, and not a rumor of the
   * chest's signer. Never set on a bag's own items, which are checked
   * against the bag's signer or dropped.
   */
  claim?: true
}

/**
 * Why no reader could open this shard, or null when every reader can.
 *
 * A bag is opened with the same `fromPayload` every client runs, and an item
 * it refuses is dropped in silence (fromInner). So the check runs before the
 * seal: the same round trip a stranger's client will make. There is no size
 * in it, because the format has no ceiling (DECK-0003 §1.8); what remains is
 * the malformed and the empty, which the workshop should never produce and
 * which this catches if it ever does.
 */
export function shardRefusal(shard: ShardModel): string | null {
  if (shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0) return 'This shard has no vertices and places nothing.'
  if (!fromPayload(toPayload(shard), shard.id)) return 'The format refuses this shard as it is, so nobody could open it. Check it in the workshop.'
  return null
}

/**
 * NIP-70's protected tag. Every item sealed in a bag or a chest carries it
 * (arkinox, 2026-10-20): a relay that honours it accepts the event only from
 * its author, so a finder cannot republish the hider's item. Never on what
 * is published on its own (a kind 33331 object, which others place by
 * reference), never on the envelope, never on chat.
 */
export const PROTECTED_TAG: readonly string[] = ['-']

/** Whether a list of tags carries NIP-70's `-`. */
export function isProtectedTags(tags: readonly (readonly string[])[]): boolean {
  return tags.some((t) => Array.isArray(t) && t[0] === '-')
}

/** The inner shard event template (kind 3330), signed by the author, with NIP-70's `-`. */
export function shardInnerTemplate(shard: ShardModel, at: Position, plane: Plane, createdAt: number, credit?: Credit): EventTemplate {
  return {
    kind: SHARD_KIND,
    created_at: createdAt,
    // OPAQUE for a shard whose author never chose (DECK-0003 §1.12).
    content: JSON.stringify(toPayload(withAuthoredConstrain(shard))),
    // A copy of someone else's object credits it (sno-core creditTags). The
    // item is sealed in the bag, so the credit is as private as the item.
    tags: [['C', positionHex(at, plane)], ...(credit ? creditTags(credit) : []), [...PROTECTED_TAG]],
  }
}

/**
 * The identity an item keeps across EDIT (arkinox, 2026-10-16: "keep the d
 * tag so comments and reactions aren't lost"). An item carried inline is a
 * regular event, so moving it signs a new one with a new id; the new one
 * carries `["d", <first version's id>]`, and comments and reactions name that
 * id, whichever version they were made on. The tag is sealed in the bag like
 * the rest of the item, so it says nothing to a relay. An item with no `d` is
 * its own first version. A shard hidden by reference is a kind 33331 object
 * with a `d` of its own, which EDIT keeps, so it needs nothing here (null).
 */
export function itemLineage(inner: Pick<NostrEvent, 'id' | 'kind' | 'tags'> | undefined): string | null {
  if (!inner || inner.kind === OBJECT_KIND) return null
  // Only an event id: a `d` of any other shape is not a lineage, and is ignored.
  return inner.tags.find((t) => t[0] === 'd' && /^[0-9a-f]{64}$/.test(t[1] ?? ''))?.[1] ?? inner.id
}

/**
 * An edited item's template: the new place (`C`, from `next`) and the
 * lineage `d`, then every other tag the version it replaces carried (a
 * credit, a picture), so a move changes only where it is. NIP-70's `-` goes
 * out when `next` carries it, so an item hidden before every item carried
 * it gains it on its first move, and never twice.
 */
export function editedTemplate(next: EventTemplate, previous: Pick<NostrEvent, 'id' | 'kind' | 'tags'>): EventTemplate {
  const at = next.tags.find((t) => t[0] === 'C')
  const lineage = itemLineage(previous) ?? previous.id
  const kept = previous.tags.filter((t) => t[0] !== 'C' && t[0] !== 'd')
  const protect = isProtectedTags(next.tags) && !isProtectedTags(kept) ? [[...PROTECTED_TAG]] : []
  return { ...next, tags: [...(at ? [at] : []), ['d', lineage], ...kept, ...protect] }
}

/** The `d` of an addressable event, or ''. */
export function dOf(ev: Pick<NostrEvent, 'tags'>): string {
  return ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}

/**
 * The inner message event template (kind 1), with NIP-70's `-`. It is
 * sealed as a rumor (rumorOf), never signed: a signed kind 1 lifted out of
 * the bag would show anywhere as the hider's own public note, with the exact
 * coordinate it was hidden at, and a rumor proves nothing once copied
 * (arkinox, 2026-10-20). This holds in a chest as in a bag.
 */
export function messageInnerTemplate(text: string, at: Position, plane: Plane, createdAt: number): EventTemplate {
  return {
    kind: MESSAGE_KIND,
    created_at: createdAt,
    content: text.slice(0, MAX_MESSAGE_LENGTH),
    tags: [['C', positionHex(at, plane)], [...PROTECTED_TAG]],
  }
}

/**
 * The inner key event template (kind 3340), signed by the hider (B1 §2.1).
 * The private key rides in a `secret` tag and never in the content: a client
 * that does not know this kind shows an item's content as text, and a secret
 * must not be the thing it shows (arkinox, 2026-10-09). The content is the
 * hider's sentence about the key, or empty. `item` is the public key, so a
 * reader can check one against the other; `-` is NIP-70, so a finder cannot
 * republish the hider's signed item to a compliant relay.
 *
 * A picture rides in NIP-92's `imeta` tag as a data URI with its mime and
 * size (lib/itemPicture.ts, arkinox, 2026-10-10). The tag is optional and a
 * reader that does not know it skips it, so an item with a picture reads the
 * same as one without on a client that only knows the tags above (the MCP
 * server among them). The model and its motions ride the same way, in a
 * `model` and an `animate` tag (lib/itemModel.ts, arkinox, 2026-10-21).
 */
export function keyInnerTemplate(key: KeyItem, at: Position, plane: Plane, createdAt: number): EventTemplate {
  const tags: string[][] = [['C', positionHex(at, plane)], ['title', key.name.slice(0, MAX_ITEM_NAME)], ['item', key.itemPubkey], ['secret', key.secretHex], ['-']]
  const picture = key.image && key.imageDim ? imetaTag(key.image, key.imageDim) : null
  if (picture) tags.push(picture)
  // The SNO it wears and how it moves (lib/itemModel.ts): optional, and
  // skipped by a reader that does not know them, as the picture is.
  tags.push(...modelTags(key.model, key.animation))
  return { kind: KEY_KIND, created_at: createdAt, content: key.about.slice(0, MAX_ABOUT), tags }
}

/**
 * The inner chest event template (kind 3341), signed by the hider (B1 §2.2).
 * The content is the sealed payload (lib/chests.ts sealEntries); `lock` names
 * the public key it is sealed to and the one-time sender's public key, and
 * `requires` is the hider's label of what opens it. `-` is NIP-70, as on
 * every item. A chest stays signed: its signature is what vouches for the
 * messages sealed inside it, which are rumors (lib/chests.ts readContents).
 */
export function chestInnerTemplate(chest: ChestItem, at: Position, plane: Plane, createdAt: number): EventTemplate {
  return {
    kind: CHEST_KIND,
    created_at: createdAt,
    content: chest.payload,
    tags: [['C', positionHex(at, plane)], ['title', chest.name.slice(0, MAX_ITEM_NAME)], ['lock', chest.lockPubkey, chest.senderPubkey], ['requires', chest.requires], [...PROTECTED_TAG]],
  }
}

/**
 * The inner chat event template (kind 23333). It goes out as a rumor
 * (chatRumor): an id and no signature.
 *
 * Never published bare: it only ever travels inside a CHAT_BAG_KIND envelope
 * keyed to the region it was said in, so a relay sees ciphertext and the
 * people standing in that region see the words.
 */
export function chatInnerTemplate(text: string, at: Position, plane: Plane, createdAt: number, lookupId: string, mentions: readonly string[] = []): EventTemplate {
  return {
    kind: CHAT_KIND,
    created_at: createdAt,
    content: text.slice(0, MAX_CHAT_LENGTH),
    // `d` names the room the way other ephemeral-chat clients do, and the room
    // is the region: its lookup id. `C` is where the speaker stood. A `p` per
    // person mentioned follows, after both, so a line with no mentions is
    // exactly what it was before mentions existed (arkinox, 2026-10-11).
    tags: [['d', lookupId], ['C', positionHex(at, plane)], ...mentionTags(mentions)],
  }
}

/**
 * A chat line as it is sealed: an unsigned rumor, the way NIP-17 carries a
 * kind 14 (arkinox, 2026-10-13). Its id is computed, so replies, mentions
 * and the history still name it, but it has no signature: a signed line
 * could be lifted out of the envelope and shown anywhere as standalone proof
 * of who said it, and a rumor cannot be republished as a valid event. Who
 * said it is vouched for by the envelope, which the speaker does sign
 * (chatInners requires the two pubkeys to match).
 */
export type ChatRumor = Rumor

/**
 * Seal-ready rumor of a template, by `pubkey`: its id computed as NIP-01
 * computes it, and no signature. A chat line and a message are sealed this
 * way; `pubkey` must be the key that signs the envelope (or the chest) that
 * carries it, or no reader will accept it.
 */
export function rumorOf(template: EventTemplate, pubkey: string): Rumor {
  const unsigned = { kind: template.kind, created_at: template.created_at, tags: template.tags, content: template.content, pubkey }
  return { ...unsigned, id: getEventHash(unsigned) }
}

/** Seal-ready rumor of a chat template, said by `pubkey`. */
export const chatRumor: (template: EventTemplate, pubkey: string) => ChatRumor = rumorOf

/**
 * Whether a rumor is what it says: its fields have their types and its `id`
 * is the hash of them (NIP-01). Says nothing of who wrote it; that is the
 * signer of whatever carries it.
 */
export function rumorHolds(ev: Partial<Rumor>): boolean {
  if (typeof ev.kind !== 'number' || typeof ev.created_at !== 'number' || typeof ev.content !== 'string' || typeof ev.pubkey !== 'string' || typeof ev.id !== 'string') return false
  if (!Array.isArray(ev.tags) || !ev.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) return false
  try {
    return getEventHash({ kind: ev.kind, created_at: ev.created_at, tags: ev.tags, content: ev.content, pubkey: ev.pubkey }) === ev.id
  } catch { return false }
}

/**
 * The kinds a writer seals as rumors, and so the only unsigned kinds a bag
 * vouches for (spec §7.6 Rumors): a message (arkinox, 2026-10-20) and hidden
 * audio (DECK-0007 §3, 2026-10-23). Both are kinds other clients show in a
 * public feed, where a signed copy lifted out of the bag would read as the
 * hider's own post.
 */
export const RUMOR_KINDS: ReadonlySet<number> = new Set([MESSAGE_KIND, AUDIO_KIND])

/** Whether a kind is written as a rumor (RUMOR_KINDS). */
export function sealedAsRumor(kind: number): boolean {
  return RUMOR_KINDS.has(kind)
}

/**
 * Whether an inline item of a bag is authentic for the key that signed the
 * bag (arkinox, 2026-10-20). Its `pubkey` must be the bag's signer, always:
 * an envelope carrying someone else's event is not theirs to place. Then:
 *   - a message (kind 1) or hidden audio (kind 1063) with no `sig` (or an
 *     empty one) is a rumor, accepted when its id is its hash (rumorHolds),
 *     and its author is the bag's signer, whose signature over the bag
 *     covers it (RUMOR_KINDS);
 *   - anything that carries a `sig` must verify: a signed message from a
 *     client before 2026-10-20 still reads;
 *   - any other kind without a `sig` is dropped, as it always was here.
 */
export function innerAuthentic(inner: Partial<Rumor>, signer: string): boolean {
  if (!inner || typeof inner !== 'object' || Array.isArray(inner) || typeof inner.kind !== 'number' || inner.pubkey !== signer) return false
  // No `sig`, or an empty one, is unsigned (spec 7.6), as the chest reader has it.
  if (inner.sig === undefined || inner.sig === '') return sealedAsRumor(inner.kind) && rumorHolds(inner)
  try { return verifyEvent(inner as NostrEvent) } catch { return false }
}

/**
 * Longest riddle a bag carries in its `content` (spec §7.7 "Riddles"). It is
 * public plaintext that every seeker reads in the HIDDEN BAGS list before finding
 * anything, so it is a clue rather than a letter: 280 characters, a post's
 * length, is room for a riddle of a few lines and keeps the list legible. A
 * longer message belongs inside the bag, where MAX_MESSAGE_LENGTH applies.
 */
export const MAX_RIDDLE_LENGTH = 280

/**
 * What a bag says in public about itself, beyond its lookup id: three choices
 * the hider makes in the deploy bar (arkinox, 2026-10-01). They belong to the
 * BAG, not to any one item: a bag is one addressable event per author and
 * region holding everything hidden there (spec §7.6), so every rewrite of it
 * carries them forward.
 *   - `heightTag`: whether the bag carries its `H` tag (spec §8.6, optional),
 *     which tells seekers what height to compute to.
 *   - `hint`: the hint box's heights (spec §7.7), or null for no hint. The
 *     deploy bar offers the sector hint, 30 on every axis; a finer box another
 *     client wrote is kept as it is.
 *   - `riddle`: the plaintext the bag's `content` carries for humans (§7.7).
 */
export interface BagSettings {
  heightTag: boolean
  hint: HintHeights | null
  riddle: string
  /** Publish what is inside, by kind and count (`contents` tags; bagContentsTags). */
  contents: boolean
  /** Publish that money is inside, when a cashu token is (a `contents` tag for cashu alone). */
  money: boolean
}

/** A bag as this client always wrote one before the choices existed: its height, no hint, no riddle, nothing said of its contents. */
export const DEFAULT_BAG_SETTINGS: BagSettings = { heightTag: true, hint: null, riddle: '', contents: false, money: false }

/**
 * What a bag holds, by kind: shards (in the bag or by reference), messages,
 * keys, chests, hidden audio, and the cashu tokens and nonfungible.cash claim links (NFTs,
 * lib/nftLink) written in its messages.
 */
export interface BagContents { shard: number; message: number; key: number; chest: number; cashu: number; nft: number; audio: number }

export function bagContents(inners: readonly (BagEntry | ChatRumor)[]): BagContents {
  const out: BagContents = { shard: 0, message: 0, key: 0, chest: 0, cashu: 0, nft: 0, audio: 0 }
  for (const e of inners) {
    if (isReference(e)) { out.shard++; continue }
    if (e.kind === SHARD_KIND) out.shard++
    else if (e.kind === MESSAGE_KIND) { out.message++; out.cashu += cashuTokensAsWritten(e.content).length; out.nft += countNftLinks(e.content) }
    else if (e.kind === KEY_KIND) out.key++
    else if (e.kind === CHEST_KIND) out.chest++
    else if (e.kind === AUDIO_KIND) out.audio++
  }
  return out
}

/**
 * The order a bag's `contents` tags are written in, and read in. Hidden audio
 * (DECK-0007) came last, after the money kinds, so every bag written before
 * it keeps the order spec §7.7 gives.
 */
export const CONTENTS_KINDS = ['shard', 'message', 'key', 'chest', 'cashu', 'nft', 'audio'] as const

/**
 * The public tags a bag's contents settings write (arkinox, 2026-10-18:
 * "a hint type that indicates money is hidden" and "an optional contents
 * hint toggle that advertises what is in the bag"). Worked out from what is
 * in the bag each time it is sealed, so they are never stale: with
 * `contents`, one `["contents", kind, count]` per kind present, cashu
 * tokens and NFTs included (arkinox, 2026-10-22: an `nft` count, as the
 * `cashu` one); with `money` alone, `["contents", "cashu"]` while a
 * token is inside, and nothing once none is. Spec §7.7 "Contents" (#75).
 */
export function bagContentsTags(inners: readonly (BagEntry | ChatRumor)[], settings: Pick<BagSettings, 'contents' | 'money'>): string[][] {
  if (!settings.contents && !settings.money) return []
  const c = bagContents(inners)
  if (settings.contents) return CONTENTS_KINDS.filter((k) => c[k] > 0).map((k) => ['contents', k, String(c[k])])
  return c.cashu > 0 ? [['contents', 'cashu']] : []
}

/**
 * A count as spec §7.7 writes one: a positive integer in decimal, with no
 * sign and no leading zeros (the rules of §10), and no cap. "03", "+3",
 * "1e2" and "0" are not counts.
 */
const CONTENTS_COUNT = /^[1-9][0-9]*$/

/** A bag's published counts by kind, each exactly as written (CONTENTS_COUNT), so a count of any size reads as it was written. */
export type ContentsCounts = Partial<Record<keyof BagContents, string>>

/**
 * What a bag's public tags say it holds (spec §7.7 "Reading contents"). A
 * row of a kind this client does not know is ignored, and so is a row whose
 * count is there but is not a count (CONTENTS_COUNT). What is left: whether
 * money is inside (a counted cashu row, or the cashu row with no count, the
 * one form that says only that), whether the money-alone form was chosen
 * (for the bag's settings), whether an NFT is (a counted nft row; there is
 * no NFT-alone form), and the counts when given. A claim, for display only:
 * what the bag holds is its plaintext.
 */
export function readBagContents(tags: string[][]): { money: boolean; moneyAlone: boolean; nft: boolean; counts: ContentsCounts | null } {
  const counts: ContentsCounts = {}
  let counted = false
  let moneyAlone = false
  for (const t of tags) {
    if (t[0] !== 'contents' || !(CONTENTS_KINDS as readonly string[]).includes(t[1] ?? '')) continue
    const kind = t[1] as keyof BagContents
    if (t[2] === undefined) { if (kind === 'cashu') moneyAlone = true; continue }
    if (typeof t[2] !== 'string' || !CONTENTS_COUNT.test(t[2])) continue
    counts[kind] = t[2]
    counted = true
  }
  return { money: moneyAlone || counts.cashu !== undefined, moneyAlone, nft: counts.nft !== undefined, counts: counted ? counts : null }
}

function sameHint(a: HintHeights | null, b: HintHeights | null): boolean {
  return a === null ? b === null : b !== null && a.every((h, i) => h === b[i])
}

/**
 * The settings a rewrite of a bag goes out with, field by field: what the
 * hider changed in the deploy bar (`chosen` differs from `seed`, the values
 * the controls started at) wins; what they left alone takes the bag's
 * `current` value, which may be newer than the seed because another device
 * rewrote the bag since. So a riddle or hint you never touched is carried
 * forward, never silently dropped, and one you cleared on purpose stays
 * cleared. `current` is null for a region with no bag yet. A hint that cannot
 * contain a region of `height` (spec §7.7) is dropped, and the riddle comes
 * out as the bag will carry it, trimmed and capped.
 */
export function resolveBagSettings(chosen: BagSettings, seed: BagSettings, current: BagSettings | null, height: number): BagSettings {
  const now = current ?? chosen
  const hint = sameHint(chosen.hint, seed.hint) ? now.hint : chosen.hint
  return {
    heightTag: chosen.heightTag !== seed.heightTag ? chosen.heightTag : now.heightTag,
    hint: hint && hintFits(hint, height) ? hint : null,
    riddle: (chosen.riddle !== seed.riddle ? chosen.riddle : now.riddle).trim().slice(0, MAX_RIDDLE_LENGTH),
    contents: chosen.contents !== seed.contents ? chosen.contents : now.contents,
    money: chosen.money !== seed.money ? chosen.money : now.money,
  }
}

/**
 * The settings a published bag carries. `height` is the region height the
 * reader knows the bag's key belongs to, used to judge a hint when the bag
 * itself states no height; a hint the spec calls malformed is read as absent
 * (§7.7). A bag read by a legacy `h` reads as `heightTag: true`, so rewriting
 * it carries its height forward as `H`.
 */
export function bagSettingsOf(ev: NostrEvent, height: number): BagSettings {
  const h = heightHint(ev)
  const hint = parseHint(ev.tags, h ?? height)
  const said = readBagContents(ev.tags)
  // Money as a setting only in its own form: a counted cashu row is the
  // contents hint speaking, and reading it as money left a bag announcing
  // cashu after contents was turned off (review of #378).
  return { heightTag: h !== null, hint: hint ? hint.heights : null, riddle: ev.content.slice(0, MAX_RIDDLE_LENGTH), contents: said.counts !== null, money: said.moneyAlone }
}

/** Where a bag's region is, for a hint's base: any point inside the region will do (lib/hint.ts). */
export interface BagPlace { at: Position; plane: Plane }

/**
 * Wrap a BAG of signed inner events into one region envelope template.
 *
 * Spec §8.6: the envelope is keyed by `d = lookup_id`, so there is one per
 * (author, region, height). kind 33330 is addressable, so republishing it with
 * more items in the bag replaces the old one — which is how a region
 * accumulates content without a tag per item. The caller signs and publishes.
 * `createdAt` must exceed the previous bag's, so the relay keeps the newer.
 *
 * `settings` are the bag's public face (BagSettings above). The height goes
 * out as `H` (HEIGHT_TAG) unless the hider turned it off, and never as `h`;
 * chat envelopes (23330) are written here too, so they carry `H` as well.
 * A hint needs `place`, a point in the region, because the hint names the
 * aligned base of its box; it writes the `hint` tag and its sector tags
 * (lib/hint.ts), and a hint smaller than the region could not contain it,
 * so one whose heights are below `height` is refused here rather than
 * published as a claim no reader would accept. The riddle is the `content`,
 * trimmed and capped at MAX_RIDDLE_LENGTH.
 *
 * No NIP-70 `-` (protected) tag: it is only accepted from the authenticated
 * author on relays that support it, is refused outright on ones that do not,
 * and buys little anyway — the location encryption is the real gate, and anyone
 * who can decrypt can re-sign identical content as themselves regardless.
 */
export async function bagTemplate(inners: readonly (BagEntry | ChatRumor)[], regionKey: Uint8Array, lookupId: string, height: number, createdAt: number, kind: number = HIDDEN_KIND, settings: BagSettings = DEFAULT_BAG_SETTINGS, place?: BagPlace): Promise<EventTemplate> {
  const tags: string[][] = [['d', lookupId], ['encrypted', ALGO, await encryptForRegion(regionKey, JSON.stringify(inners))], ['version', '2']]
  if (settings.heightTag) tags.push([HEIGHT_TAG, String(height)])
  if (settings.hint) {
    if (!place) throw new Error('A hint needs the place it points to.')
    if (!hintFits(settings.hint, height)) throw new Error(`A hint box of heights ${settings.hint.join(', ')} cannot contain a height ${height} region.`)
    tags.push(...hintTags(place.at, place.plane, settings.hint))
  }
  tags.push(...bagContentsTags(inners, settings))
  return { kind, created_at: createdAt, content: settings.riddle.trim().slice(0, MAX_RIDDLE_LENGTH), tags }
}

function tag(ev: Pick<NostrEvent, 'tags'>, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

/** The ciphertext out of an envelope, or null if it is not one. */
export function ciphertextOf(ev: NostrEvent): string | null {
  if (ev.kind !== HIDDEN_KIND && ev.kind !== CHAT_BAG_KIND) return null
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  return enc[2]
}

/**
 * The bag's height tag (spec §8.6), or null when it states no height. The tag
 * is optional: a hider may keep the height to themselves (arkinox,
 * 2026-10-01), and a reader that opened the bag knows the height anyway,
 * because it is the height of the key it derived (unbag's `height`).
 *
 * The tag is `H` since 2026-10-21. It was `h`, which NIP-29 reads on an event
 * of any kind as the group the event is posted to, so a NIP-29 relay refused
 * bags and chat envelopes or filed them into a group. The rule (spec §8.6):
 * an event that carries any `H` tag is read by `H` alone, and its `h` tags
 * are ignored; an event without `H` is read by a legacy `h`. The tag read
 * MUST appear exactly once with a canonical decimal value; more than one, or
 * a malformed value, and the bag states no height (it is not invalid).
 */
export function heightHint(ev: Pick<NostrEvent, 'tags'>): number | null {
  const name = ev.tags.some((t) => t[0] === HEIGHT_TAG) ? HEIGHT_TAG : LEGACY_HEIGHT_TAG
  const found = ev.tags.filter((t) => t[0] === name)
  if (found.length !== 1) return null
  const h = found[0][1]
  if (h === undefined || !/^(0|[1-9][0-9]*)$/.test(h)) return null
  return Number(h)
}

/** What every item of one bag shares: its region's height and its public settings. */
interface BagFacts { height: number; bag: BagSettings }

/** One inner event of a bag -> a Hidden, or null if it does not verify. `keyHex` is the key that opened the bag. */
function fromInner(inner: Rumor, outer: NostrEvent, keyHex: string, facts: BagFacts): Hidden | null {
  // By the same key that wrapped it, and signed, or a message sealed as a
  // rumor (innerAuthentic).
  if (!innerAuthentic(inner, outer.pubkey)) return null

  const coordHex = tag(inner, 'C')
  if (!coordHex) return null
  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const base = {
    eventId: inner.id,
    inner,
    keyHex,
    bagId: outer.id,
    lookupId: tag(outer, 'd') ?? '',
    author: outer.pubkey,
    at: { x, y, z },
    plane,
    ...facts,
    createdAt: inner.created_at,
  }

  // innerAuthentic held it to the bag's signer, so that is whose it is.
  const body = readItem(inner, outer.pubkey)
  return body ? { ...base, ...body } : null
}

/**
 * Decrypt a region envelope and return every item in its bag, verified.
 *
 * Empty covers every way it fails to open for you: not an envelope, the wrong
 * region key, or a bag that is not an array. Each item that does not verify is
 * dropped, not the whole bag.
 *
 * `height` is the height of the region `regionKey` was derived for, when the
 * caller knows it, as every scan does. It is the truth about the bag's region
 * (the key opened it), so it wins over the bag's height tag, and it is what
 * keeps a bag whose hider left the height off (arkinox, 2026-10-01) from
 * reading as a single gibson. Without it the height tag is used (heightHint),
 * and 0 when there is none.
 */
/**
 * What opening a bag found, by bag id: how many entries it held and how many
 * this client could read. A bag whose entries were all dropped (an unknown
 * kind, a failed verification, a reference that could not be fetched) was
 * still opened, and the reader is told so rather than shown nothing, as spec
 * §7.6 asks. An opaque payload (not a list of entries) is noted the same way.
 * Session-local, like the scan that fills it; a wrong key is not an opening
 * and leaves no reading.
 */
export interface BagReading {
  entries: number
  readable: number
  opaque: boolean
}
const readings = new Map<string, BagReading>()
const readingListeners = new Set<() => void>()
let readingsVersion = 0
export function bagReading(bagId: string): BagReading | undefined { return readings.get(bagId) }
/** Rises whenever a reading changes, for hooks that subscribe. */
export function bagReadingsVersion(): number { return readingsVersion }
export function onBagReadings(listener: () => void): () => void {
  readingListeners.add(listener)
  return () => { readingListeners.delete(listener) }
}
function noteReading(bagId: string, reading: BagReading): void {
  const prev = readings.get(bagId)
  if (prev && prev.entries === reading.entries && prev.readable === reading.readable && prev.opaque === reading.opaque) return
  readings.set(bagId, reading)
  readingsVersion++
  for (const listener of readingListeners) listener()
}

export async function unbag(outer: NostrEvent, regionKey: Uint8Array, resolve?: ResolveReference, origin?: RegionOrigin, height?: number): Promise<Hidden[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  let entries: unknown
  try { entries = JSON.parse(json) } catch { noteReading(outer.id, { entries: 0, readable: 0, opaque: true }); return [] }
  if (!Array.isArray(entries)) { noteReading(outer.id, { entries: 0, readable: 0, opaque: true }); return [] }
  const keyHex = bytesToHex(regionKey)
  const regionHeight = height ?? heightHint(outer) ?? 0
  const facts: BagFacts = { height: regionHeight, bag: bagSettingsOf(outer, regionHeight) }
  const out: (Hidden | null)[] = entries.map((entry) => (Array.isArray(entry) ? null : fromInner(entry as Rumor, outer, keyHex, facts)))
  // References are fetched a few at a time, and only so many per bag; an
  // entry that cannot be fetched or opened is a missing entry, dropped like
  // an item that fails to verify.
  if (resolve) {
    const refs = entries.map((e, i) => [e, i] as const).filter(([e]) => isReference(e)).slice(0, MAX_REFERENCES_PER_BAG)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < refs.length) {
        const [ref, i] = refs[next++]
        out[i] = await fromReference(ref as Reference, outer, regionKey, keyHex, resolve, facts, origin).catch(() => null)
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFERENCE_CONCURRENCY, refs.length) }, worker))
  }
  const items = out.filter((h): h is Hidden => h !== null)
  noteReading(outer.id, { entries: entries.length, readable: items.length, opaque: false })
  return items
}

/**
 * One reference entry of a bag -> a Hidden, or null.
 *
 * The referenced event must verify, must be the one the reference names, and
 * must open with this bag's region key. It may be by another author: placing
 * someone else's object is a placement, attributed to the bag's author, while
 * the content stays that event's own (spec §7.6).
 */
async function fromReference(ref: Reference, outer: NostrEvent, regionKey: Uint8Array, keyHex: string, resolve: ResolveReference, facts: BagFacts, origin?: RegionOrigin): Promise<Hidden | null> {
  // The point is optional (spec §7.6): without one the entry is located no
  // more precisely than the region, and is drawn at the region's base.
  const coordHex = ref[3]
  if (!coordHex && !origin) return null
  const target = await resolve(ref)
  if (!target || !verifyEvent(target)) return null
  if (ref[0] === 'e' && target.id !== ref[1]) return null
  if (ref[0] === 'a') {
    const [kind, pubkey, ...rest] = ref[1].split(':')
    if (String(target.kind) !== kind || target.pubkey !== pubkey || tag(target, 'd') !== rest.join(':')) return null
  }
  // Sealed to this place (DECK-0003 §3.4), or another author's public object
  // placed by reference (§3.1, §3.2: a LIVE LINK from the Shard Feed), whose
  // payload is its content as published.
  const enc = target.tags.find((t) => t[0] === 'encrypted')
  let plain: string | null
  if (enc) {
    if (enc[1] !== ALGO || !enc[2]) return null
    plain = await decryptForRegion(regionKey, enc[2])
  } else {
    plain = target.kind === OBJECT_KIND ? target.content : null
  }
  if (plain === null) return null

  const { x, y, z, plane } = coordHex ? coordToXyz(hexToCoord(coordHex)) : { ...origin!.at, plane: origin!.plane }
  const base = {
    // A public object (a LIVE LINK, yours or another author's) is keyed by
    // the bag and the entry, which its author's edits do not change; a
    // sealed object of this place keeps its id, as shipped.
    eventId: enc ? target.id : linkKey(tag(outer, 'd') ?? '', ref),
    inner: target,
    keyHex,
    ref,
    bagId: outer.id,
    lookupId: tag(outer, 'd') ?? '',
    author: outer.pubkey,
    at: { x, y, z },
    plane,
    ...facts,
    createdAt: target.created_at,
  }
  if (target.kind === OBJECT_KIND) {
    let raw: unknown
    try { raw = JSON.parse(plain) } catch { return null }
    const shard = fromPayload(raw, target.id)
    if (!shard) return null
    return { ...base, type: 'shard', shard: keepOwnTable(shard, target.pubkey) }
  }
  if (target.kind === MESSAGE_KIND) {
    if (!plain) return null
    return { ...base, type: 'message', text: plain.slice(0, MAX_MESSAGE_LENGTH) }
  }
  return null
}

/**
 * The chat lines in an ephemeral envelope: every inner that is a CHAT_KIND,
 * is said by the key that signed the envelope, and whose id is its own hash.
 * A line is a rumor (chatRumor) and carries no signature; a line from an
 * older client that does carry one must verify (accepted both ways while
 * clients catch up). A `sig` that is the empty string is no signature
 * (DECK-0005 §3.2 rule 5, spec §7.6 Rumors), so that line is read as a
 * rumor. Anything else in the bag is not chat and is left where it is.
 */
export async function chatInners(outer: NostrEvent, regionKey: Uint8Array): Promise<ChatRumor[]> {
  if (outer.kind !== CHAT_BAG_KIND) return []
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  let arr: unknown
  try { arr = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter((e): e is ChatRumor => isChatLine(e, outer.pubkey))
}

/** One sealed chat line, checked as chatInners describes. */
function isChatLine(e: unknown, speaker: string): boolean {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  const ev = e as ChatRumor
  if (ev.kind !== CHAT_KIND || ev.pubkey !== speaker) return false
  if (typeof ev.content !== 'string' || ev.content.length === 0) return false
  if (typeof ev.created_at !== 'number' || !Array.isArray(ev.tags) || typeof ev.id !== 'string') return false
  try {
    if (getEventHash({ kind: ev.kind, created_at: ev.created_at, tags: ev.tags, content: ev.content, pubkey: ev.pubkey }) !== ev.id) return false
  } catch { return false }
  // No `sig`, or an empty one, is unsigned (DECK-0005 §3.2 rule 5), as innerAuthentic has it.
  if (ev.sig === undefined || ev.sig === '') return true
  try { return verifyEvent(ev as NostrEvent) } catch { return false }
}

/**
 * Every entry currently in one of your own envelopes, for rewriting it,
 * carried forward as it is: inline items (whether or not this client could
 * render them, signed or not, since another client writing with the same key
 * may leave items this one does not know) and every well-formed reference.
 * A rewrite that kept only what this client understands would silently drop
 * the rest, which is exactly what happened to references before.
 */
export async function bagEntries(outer: NostrEvent, regionKey: Uint8Array): Promise<BagEntry[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is BagEntry => isReference(e) || (!!e && !Array.isArray(e) && typeof e === 'object' && typeof (e as NostrEvent).kind === 'number'))
  } catch { return [] }
}

/** The inner events currently in an envelope's bag that are authentic for its signer (innerAuthentic), whether or not this client can read them. */
export async function bagInners(outer: NostrEvent, regionKey: Uint8Array): Promise<Rumor[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? (arr as Rumor[]).filter((e) => innerAuthentic(e, outer.pubkey)) : []
  } catch { return [] }
}
