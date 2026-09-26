/**
 * hidden.ts — content hidden at a location.
 *
 * A hidden thing is a full signed nostr event, wrapped: the inner event is
 * serialized, encrypted to the region key for where it sits (spec §7), and
 * carried inside a kind:33330 envelope (spec §8.6) whose only public parts are
 * the lookup id and a height hint. Discovery decrypts the envelope, verifies
 * the inner signature, and renders by the inner kind. Nothing about where the
 * thing is, or what it is, leaks: the coordinate lives inside the ciphertext.
 *
 * A bag is a list of entries (spec §7.6). An entry that is an event is an
 * item carried inline; two inner kinds so far:
 *   - a shard, kind 3330 (v1's shard kind), geometry in the content;
 *   - a message, kind 1, text in the content.
 * Both carry their coordinate in a `C` tag, decoded on discovery.
 *
 * An entry that is an array is a reference: `["a", "<kind>:<pubkey>:<d>",
 * relay, coord]` or `["e", id, relay, coord]`, naming an event published on
 * its own. That event is FF-1 partially encrypted: a public preview in
 * `content` and `["encrypted", "aes-256-gcm", ct, "cyberspace:region"]`,
 * sealed with the same region key as the bag and saying nothing about where
 * it is. A large shard is hidden this way, as a kind 33331 object (DECK-0003
 * §3.2, §3.4), so one big shard does not make the whole bag big.
 *
 * The envelope carries the NIP-70 `-` tag: a relay that honours it will accept
 * the event only from its author, so no one else can republish your chalk.
 *
 * Pure: signing happens in the store, which holds the key. This sees templates
 * and finished events only.
 */

import { verifyEvent } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord, type Plane } from 'cyberspace-core'
import { bytesToHex, positionHex, type EventTemplate, type NostrEvent } from './events'
import { fromPayload, toPayload, type ShardModel } from 'sno-core/shards'
import { ALGO, decryptForRegion, encryptForRegion } from './shardCrypto'
import type { Position } from './space'

/** The location-encrypted envelope (spec §8.6). */
export const HIDDEN_KIND = 33330
/**
 * The same envelope in the ephemeral range: a relay hands it to whoever is
 * subscribed at that moment and keeps nothing. Chat lives here. A 23330 is a
 * 33330 in every respect but the kind: same `d`, same `encrypted`, same `h`.
 */
export const CHAT_BAG_KIND = 23330
/** A chat line, inside the ephemeral envelope; the kind other clients use for ephemeral chat. */
export const CHAT_KIND = 23333
/** Longest chat line. Short on purpose: it is a room, not a wall. */
export const MAX_CHAT_LENGTH = 500
/** A shard, inside the envelope (v1's shard kind). */
export const SHARD_KIND = 3330
/** A plain note, inside the envelope. */
export const MESSAGE_KIND = 1
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
/** One entry of a bag's list: an inline item, or a reference. */
export type BagEntry = NostrEvent | Reference
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
  return new TextEncoder().encode(JSON.stringify(toPayload(shard))).length > REFERENCE_THRESHOLD_BYTES
}

/**
 * The kind 33331 object a large shard is hidden as (DECK-0003 §3.4): the
 * payload sealed with the region key, a public preview, and a `d` the caller
 * chooses. The caller passes a fresh random `d` for every placement, because
 * 33331 is addressable: two placements of one shard under one `d` would
 * replace each other on the relay, and each is sealed to a different place.
 * No `name`, `C`, `h`, hint or sector tag: nothing that could say where.
 */
export async function objectTemplate(shard: ShardModel, regionKey: Uint8Array, d: string, createdAt: number): Promise<EventTemplate> {
  const ciphertext = await encryptForRegion(regionKey, JSON.stringify(toPayload(shard)))
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
 * off: cyberspace.nostr1.com (strfry) takes 262,140 bytes of content, and
 * the sealed envelope of a 10,000-character message is under 15 KB. Two
 * thousand was a placeholder, and it cut a Cashu token of six proofs in
 * half as it was pasted; ten thousand leaves room for thirty.
 */
export const MAX_MESSAGE_LENGTH = 10_000

export type HiddenType = 'shard' | 'message'

/** A short one-line look at a message, for a title or a row. */
export function messagePreview(text: string, max = 32): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t || 'empty'
}

/** What a decoded hidden thing carries, ready to render. */
export interface Hidden {
  /** The item's stable identity: its inner event id. */
  eventId: string
  /**
   * The signed inner event itself, verified, and the region key that opened
   * its bag, as hex. Together they let a find of your own become a deployment
   * on this device: enough to rebuild, broadcast or delete the bag from here.
   * Absent on the ceremony's preview items, which came out of no bag.
   */
  inner?: NostrEvent
  keyHex?: string
  /** The envelope (bag) currently holding it; changes when the bag is rewritten. */
  bagId: string
  /** The bag's `d` tag (spec §8.6 lookup id): with the author it is the bag's address. */
  lookupId: string
  /** The author, from the inner (and envelope) pubkey. */
  author: string
  at: Position
  plane: Plane
  /** The height hint on the envelope; the discovery radius. */
  height: number
  /** When the inner event was made. */
  createdAt: number
  type: HiddenType
  shard?: ShardModel
  text?: string
  /**
   * Set when the item was hidden by reference: the entry itself, which is what
   * a rewrite of the bag must carry forward. `inner` is then the referenced
   * event (the kind 33331 object), and its author may differ from `author`,
   * the key that placed it (spec §7.6).
   */
  ref?: Reference
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

/** The inner shard event template (kind 3330), signed by the author. */
export function shardInnerTemplate(shard: ShardModel, at: Position, plane: Plane, createdAt: number): EventTemplate {
  return {
    kind: SHARD_KIND,
    created_at: createdAt,
    content: JSON.stringify(toPayload(shard)),
    tags: [['C', positionHex(at, plane)]],
  }
}

/** The inner message event template (kind 1), signed by the author. */
export function messageInnerTemplate(text: string, at: Position, plane: Plane, createdAt: number): EventTemplate {
  return {
    kind: MESSAGE_KIND,
    created_at: createdAt,
    content: text.slice(0, MAX_MESSAGE_LENGTH),
    tags: [['C', positionHex(at, plane)]],
  }
}

/**
 * The inner chat event template (kind 23333), signed by the author.
 *
 * Never published bare: it only ever travels inside a CHAT_BAG_KIND envelope
 * keyed to the region it was said in, so a relay sees ciphertext and the
 * people standing in that region see the words.
 */
export function chatInnerTemplate(text: string, at: Position, plane: Plane, createdAt: number, lookupId: string): EventTemplate {
  return {
    kind: CHAT_KIND,
    created_at: createdAt,
    content: text.slice(0, MAX_CHAT_LENGTH),
    // `d` names the room the way other ephemeral-chat clients do, and the room
    // is the region: its lookup id. `C` is where the speaker stood.
    tags: [['d', lookupId], ['C', positionHex(at, plane)]],
  }
}

/**
 * Wrap a BAG of signed inner events into one region envelope template.
 *
 * Spec §8.6: the envelope is keyed by `d = lookup_id`, so there is one per
 * (author, region, height). kind 33330 is addressable, so republishing it with
 * more items in the bag replaces the old one — which is how a region
 * accumulates content without a tag per item. The caller signs and publishes.
 * `createdAt` must exceed the previous bag's, so the relay keeps the newer.
 *
 * No NIP-70 `-` (protected) tag: it is only accepted from the authenticated
 * author on relays that support it, is refused outright on ones that do not,
 * and buys little anyway — the location encryption is the real gate, and anyone
 * who can decrypt can re-sign identical content as themselves regardless.
 */
export async function bagTemplate(inners: BagEntry[], regionKey: Uint8Array, lookupId: string, height: number, createdAt: number, kind: number = HIDDEN_KIND): Promise<EventTemplate> {
  const ciphertext = await encryptForRegion(regionKey, JSON.stringify(inners))
  return {
    kind,
    created_at: createdAt,
    content: '',
    tags: [['d', lookupId], ['encrypted', ALGO, ciphertext], ['version', '2'], ['h', String(height)]],
  }
}

function tag(ev: NostrEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

/** The ciphertext out of an envelope, or null if it is not one. */
export function ciphertextOf(ev: NostrEvent): string | null {
  if (ev.kind !== HIDDEN_KIND && ev.kind !== CHAT_BAG_KIND) return null
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  return enc[2]
}

export function heightHint(ev: NostrEvent): number {
  const h = tag(ev, 'h')
  const n = h === undefined ? 0 : Number(h)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** One inner event of a bag -> a Hidden, or null if it does not verify. `keyHex` is the key that opened the bag. */
function fromInner(inner: NostrEvent, outer: NostrEvent, keyHex: string): Hidden | null {
  // The inner event must be genuinely signed, and by the same key that wrapped
  // it: an envelope carrying someone else's event is not theirs to place.
  if (!inner || typeof inner.kind !== 'number' || inner.pubkey !== outer.pubkey) return null
  if (!verifyEvent(inner)) return null

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
    height: heightHint(outer),
    createdAt: inner.created_at,
  }

  if (inner.kind === SHARD_KIND) {
    let raw: unknown
    try { raw = JSON.parse(inner.content) } catch { return null }
    const shard = fromPayload(raw, inner.id)
    if (!shard) return null
    return { ...base, type: 'shard', shard }
  }
  if (inner.kind === MESSAGE_KIND) {
    if (!inner.content) return null
    return { ...base, type: 'message', text: inner.content.slice(0, MAX_MESSAGE_LENGTH) }
  }
  return null
}

/**
 * Decrypt a region envelope and return every item in its bag, verified.
 *
 * Empty covers every way it fails to open for you: not an envelope, the wrong
 * region key, or a bag that is not an array. Each item that does not verify is
 * dropped, not the whole bag.
 */
export async function unbag(outer: NostrEvent, regionKey: Uint8Array, resolve?: ResolveReference, origin?: RegionOrigin): Promise<Hidden[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  let entries: unknown
  try { entries = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(entries)) return []
  const keyHex = bytesToHex(regionKey)
  const out: (Hidden | null)[] = entries.map((entry) => (Array.isArray(entry) ? null : fromInner(entry as NostrEvent, outer, keyHex)))
  // References are fetched a few at a time, and only so many per bag; an
  // entry that cannot be fetched or opened is a missing entry, dropped like
  // an item that fails to verify.
  if (resolve) {
    const refs = entries.map((e, i) => [e, i] as const).filter(([e]) => isReference(e)).slice(0, MAX_REFERENCES_PER_BAG)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < refs.length) {
        const [ref, i] = refs[next++]
        out[i] = await fromReference(ref as Reference, outer, regionKey, keyHex, resolve, origin).catch(() => null)
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFERENCE_CONCURRENCY, refs.length) }, worker))
  }
  return out.filter((h): h is Hidden => h !== null)
}

/**
 * One reference entry of a bag -> a Hidden, or null.
 *
 * The referenced event must verify, must be the one the reference names, and
 * must open with this bag's region key. It may be by another author: placing
 * someone else's object is a placement, attributed to the bag's author, while
 * the content stays that event's own (spec §7.6).
 */
async function fromReference(ref: Reference, outer: NostrEvent, regionKey: Uint8Array, keyHex: string, resolve: ResolveReference, origin?: RegionOrigin): Promise<Hidden | null> {
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
  const enc = target.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  const plain = await decryptForRegion(regionKey, enc[2])
  if (plain === null) return null

  const { x, y, z, plane } = coordHex ? coordToXyz(hexToCoord(coordHex)) : { ...origin!.at, plane: origin!.plane }
  const base = {
    eventId: target.id,
    inner: target,
    keyHex,
    ref,
    bagId: outer.id,
    lookupId: tag(outer, 'd') ?? '',
    author: outer.pubkey,
    at: { x, y, z },
    plane,
    height: heightHint(outer),
    createdAt: target.created_at,
  }
  if (target.kind === OBJECT_KIND) {
    let raw: unknown
    try { raw = JSON.parse(plain) } catch { return null }
    const shard = fromPayload(raw, target.id)
    if (!shard) return null
    return { ...base, type: 'shard', shard }
  }
  if (target.kind === MESSAGE_KIND) {
    if (!plain) return null
    return { ...base, type: 'message', text: plain.slice(0, MAX_MESSAGE_LENGTH) }
  }
  return null
}

/**
 * The chat lines in an ephemeral envelope: every inner that is a CHAT_KIND,
 * verifies, and was signed by the same key that wrapped it. Anything else in
 * the bag is not chat and is left where it is.
 */
export async function chatInners(outer: NostrEvent, regionKey: Uint8Array): Promise<NostrEvent[]> {
  if (outer.kind !== CHAT_BAG_KIND) return []
  const inners = await bagInners(outer, regionKey)
  return inners.filter((e) => e.kind === CHAT_KIND && typeof e.content === 'string' && e.content.length > 0)
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

/** The signed inner events currently in an envelope's bag (unverified passthrough). */
export async function bagInners(outer: NostrEvent, regionKey: Uint8Array): Promise<NostrEvent[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? (arr as NostrEvent[]).filter((e) => e && e.pubkey === outer.pubkey && verifyEvent(e)) : []
  } catch { return [] }
}
