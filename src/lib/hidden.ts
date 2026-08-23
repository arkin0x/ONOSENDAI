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
 * Two inner kinds so far:
 *   - a shard, kind 3330 (v1's shard kind), geometry in the content;
 *   - a message, kind 1, text in the content.
 * Both carry their coordinate in a `C` tag, decoded on discovery.
 *
 * The envelope carries the NIP-70 `-` tag: a relay that honours it will accept
 * the event only from its author, so no one else can republish your chalk.
 *
 * Pure: signing happens in the store, which holds the key. This sees templates
 * and finished events only.
 */

import { verifyEvent } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord, type Plane } from 'cyberspace-core'
import { positionHex, type EventTemplate, type NostrEvent } from './events'
import { fromPayload, toPayload, type ShardModel } from './shards'
import { ALGO, decryptForRegion, encryptForRegion } from './shardCrypto'
import type { Position } from './space'

/** The location-encrypted envelope (spec §8.6). */
export const HIDDEN_KIND = 33330
/** A shard, inside the envelope (v1's shard kind). */
export const SHARD_KIND = 3330
/** A plain note, inside the envelope. */
export const MESSAGE_KIND = 1

/** Longest hidden message; the whole event still has to fit a relay's limit. */
export const MAX_MESSAGE_LENGTH = 2000

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
  /** The envelope (bag) currently holding it; changes when the bag is rewritten. */
  bagId: string
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
export async function bagTemplate(inners: NostrEvent[], regionKey: Uint8Array, lookupId: string, height: number, createdAt: number): Promise<EventTemplate> {
  const ciphertext = await encryptForRegion(regionKey, JSON.stringify(inners))
  return {
    kind: HIDDEN_KIND,
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
  if (ev.kind !== HIDDEN_KIND) return null
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  return enc[2]
}

export function heightHint(ev: NostrEvent): number {
  const h = tag(ev, 'h')
  const n = h === undefined ? 0 : Number(h)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** One inner event of a bag -> a Hidden, or null if it does not verify. */
function fromInner(inner: NostrEvent, outer: NostrEvent): Hidden | null {
  // The inner event must be genuinely signed, and by the same key that wrapped
  // it: an envelope carrying someone else's event is not theirs to place.
  if (!inner || typeof inner.kind !== 'number' || inner.pubkey !== outer.pubkey) return null
  if (!verifyEvent(inner)) return null

  const coordHex = tag(inner, 'C')
  if (!coordHex) return null
  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const base = {
    eventId: inner.id,
    bagId: outer.id,
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
export async function unbag(outer: NostrEvent, regionKey: Uint8Array): Promise<Hidden[]> {
  const ct = ciphertextOf(outer)
  if (!ct) return []
  const json = await decryptForRegion(regionKey, ct)
  if (!json) return []
  let inners: unknown
  try { inners = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(inners)) return []
  const out: Hidden[] = []
  for (const inner of inners) {
    const h = fromInner(inner as NostrEvent, outer)
    if (h) out.push(h)
  }
  return out
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
