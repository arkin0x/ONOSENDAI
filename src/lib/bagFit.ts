/**
 * bagFit.ts: what goes by reference so a bag fits (owner, 2026-11-09).
 *
 * A shard is hidden by reference when it is large by itself (lib/hidden.ts
 * REFERENCE_THRESHOLD_BYTES). A bag of many shards just under that size grows
 * past what one bag may be (lib/bagSize.ts) anyway: a 16,112-byte coil into a
 * room bag already near 236 KB was refused. So a write that would pass the cap
 * stores what it is writing by reference instead, through the same mechanism:
 * a kind 33331 object sealed with the bag's own key, named by an `a` reference
 * (spec §7.6, DECK-0003 §3.4). The largest of the entries being written goes
 * first, then the next, until the bag fits. Only when it still does not fit
 * (the references alone overflow, or other entries fill it) is the write
 * refused, with lib/bagSize's words.
 *
 * Only the entries a write is writing are candidates. Entries already standing
 * in the bag keep their form: one turned into a reference gets a new event id,
 * which its rows, its finds and every comment on it name. A rewrite the person
 * starts of that entry (an EDIT, a move) is a write of it, and is a candidate.
 *
 * Only shards (kind 3330), of the writer's own, signed: a by-reference payload
 * is defined for the kind 33331 object alone (DECK-0003 §3.4), and an inline
 * shard's content is exactly that payload (REFERENCEABLE_KINDS).
 *
 * Every other entry moves out as a sealed entry (kind 33335, spec §7.6 Sealed
 * entries, lib/sealed.ts): its payload is the item itself, byte for byte, so
 * its id, lineage, place and author stay exactly what they were, and an entry
 * already standing in the bag is a candidate too (sealFor), not only what the
 * write is writing. Messages, key items, chests, hidden audio, and a shard
 * already standing (which as a 33331 object would get a new id). Never a door:
 * a door stays inline in the bag that holds it (spec §7.6). A fresh shard
 * still goes as a 33331 object, the form the spec prefers for shards. All
 * candidates go largest first, whichever their form.
 *
 * Pure. Sizes are measured without sealing anything: AES-GCM's ciphertext
 * length follows the plaintext's (sealedLength), so a bag's signed size is
 * known from its entries alone, exactly.
 */

import { bagSizeRefusal, signedBytes } from './bagSize'
import { AUDIO_KIND } from './audioItem'
import { bagTemplateAround, CHEST_KIND, entryKey, isReference, KEY_KIND, MESSAGE_KIND, OBJECT_KIND, SHARD_KIND, HIDDEN_KIND, type BagEntry, type BagPlace, type BagSettings, type Reference, type Rumor } from './hidden'
import { SEALED_KIND, SEALED_PREVIEW, sealedReference, utf8Bytes } from './sealed'

/** The inline kinds a write may move by reference to fit a bag: the shard, whose referenced form is the kind 33331 object. */
export const REFERENCEABLE_KINDS: ReadonlySet<number> = new Set([SHARD_KIND])

/**
 * The inline kinds a write may move out into a sealed entry (spec §7.6, What
 * may be sealed): every kind this client hides. A kind it does not know is
 * carried forward as it stands (Carrying forward), never moved; a door (a
 * chest with a `door` tag) never leaves its bag.
 */
export const SEALABLE_KINDS: ReadonlySet<number> = new Set([SHARD_KIND, MESSAGE_KIND, KEY_KIND, CHEST_KIND, AUDIO_KIND])

/** The items planned sealed entries hold, by address, so a bag's contents are measured as they will be written (§7.7). */
export type HeldItems = ReadonlyMap<string, Pick<Rumor, 'kind' | 'content' | 'tags'>>

/** The base64 length of `nonce || ciphertext || tag` for this plaintext (spec §7.6 cipher): 12 + its UTF-8 bytes + 16, padded. */
export function sealedLength(plaintext: string): number {
  return 4 * Math.ceil((12 + utf8Bytes(plaintext) + 16) / 3)
}

/** A bag's signed size from its entries, without encrypting them: lib/hidden.ts bagTemplate around a stand-in of the same length. `held` names what planned sealed entries hold, for its contents. */
export function bagBytes(entries: readonly BagEntry[], lookupId: string, height: number, settings: BagSettings, place?: BagPlace, createdAt = Math.floor(Date.now() / 1000), held?: HeldItems): number {
  const template = bagTemplateAround(entries, 'A'.repeat(sealedLength(JSON.stringify(entries))), lookupId, height, createdAt, HIDDEN_KIND, settings, place, held)
  return signedBytes(template)
}

/**
 * Why a bag of these entries is not written, or null: what signBag refuses,
 * past the cap and larger than the bag it replaces (`before`), so a write that
 * shrinks a bag already past it still goes. Larger in UTF-8 bytes, as a relay
 * counts: a string's length counts a multibyte character as one.
 */
export function growthRefusal(entries: readonly BagEntry[], before: readonly BagEntry[], bytes: number): string | null {
  const tooBig = bagSizeRefusal(bytes)
  return tooBig && utf8Bytes(JSON.stringify(entries)) > utf8Bytes(JSON.stringify(before)) ? tooBig : null
}

/** One entry being written, and the reference it becomes if it goes by reference. */
export interface FitCandidate {
  /** Its entryKey: the inline event's id. */
  key: string
  /** Its size inline, as JSON. */
  bytes: number
  ref: Reference
  /** The `d` of the object the reference names. */
  d: string
  /** What it becomes: a kind 33331 object (referenceFor), or a sealed entry holding the item (sealFor). */
  form: 'object' | 'sealed'
  /** For a sealed entry, the item it will hold: the inline entry itself. */
  item?: Rumor
}

/**
 * The reference an inline entry would become, under `d`, or null when it is
 * not one a write may move: a shard (REFERENCEABLE_KINDS) of `owner`'s, signed,
 * with its point. The point is its `C`, as referenceTo writes it.
 */
export function referenceFor(entry: BagEntry, owner: string, d: string, relayHint: string): FitCandidate | null {
  if (isReference(entry) || !REFERENCEABLE_KINDS.has(entry.kind) || entry.pubkey !== owner) return null
  if (typeof entry.sig !== 'string' || entry.sig.length === 0 || typeof entry.content !== 'string') return null
  const at = entry.tags.find((t) => t[0] === 'C')?.[1]
  if (!at) return null
  return { key: entry.id, bytes: utf8Bytes(JSON.stringify(entry)), ref: ['a', `${OBJECT_KIND}:${owner}:${d}`, relayHint, at], d, form: 'object' }
}

/**
 * The sealed entry an inline entry would move out into, under `d`, or null
 * when it is not one a write may move (spec §7.6 Sealed entries): an item of
 * `owner`'s, of a kind this client hides (SEALABLE_KINDS), with its point,
 * never a door, and smaller as a reference than inline (a sealed entry never
 * makes its bag larger), and small enough to be an event of its own under the
 * cap (lib/bagSize.ts). A shard only when it already stands in the bag
 * (`standing`), or the caller forces it: a fresh one goes as a 33331 object
 * (referenceFor), the form the spec prefers. The reference's coordinate is the
 * item's own `C`, as the spec asks.
 */
export function sealFor(entry: BagEntry, owner: string, d: string, relayHint: string, standing: ReadonlySet<string>, force = false): FitCandidate | null {
  if (isReference(entry) || !SEALABLE_KINDS.has(entry.kind) || entry.pubkey !== owner || typeof entry.id !== 'string') return null
  if (entry.kind === CHEST_KIND && entry.tags.some((t) => t[0] === 'door')) return null
  if (entry.kind === SHARD_KIND && !standing.has(entry.id) && !force) return null
  const at = entry.tags.find((t) => t[0] === 'C')?.[1]
  if (!at) return null
  const ref = sealedReference(owner, d, relayHint, at)
  const json = JSON.stringify(entry)
  const bytes = utf8Bytes(json)
  if (!force && bytes <= utf8Bytes(JSON.stringify(ref))) return null
  // An entry too large for one event cannot be stored sealed either (spec §7.6 Size): it stays, and the bag says why.
  if (bagSizeRefusal(signedBytes({ kind: SEALED_KIND, created_at: 0, content: SEALED_PREVIEW, tags: [['d', d], ['encrypted', 'aes-256-gcm', 'A'.repeat(sealedLength(json)), 'cyberspace:region'], ['alt', SEALED_PREVIEW]] }))) return null
  return { key: entry.id, bytes, ref, d, form: 'sealed', item: entry as Rumor }
}

/** The items the sealed candidates among these hold, by the address each reference names. */
export function heldBy(candidates: Iterable<FitCandidate>): Map<string, Rumor> {
  const out = new Map<string, Rumor>()
  for (const c of candidates) if (c.form === 'sealed' && c.item) out.set(c.ref[1], c.item)
  return out
}

/** The entries with these candidates in their reference form. */
export function withReferences(entries: readonly BagEntry[], refs: ReadonlyMap<string, FitCandidate>): BagEntry[] {
  if (refs.size === 0) return [...entries]
  return entries.map((e) => (isReference(e) ? e : refs.get(entryKey(e))?.ref ?? e))
}

/**
 * Which candidates go by reference so the bag fits: none when it fits as it
 * is, else the largest first, one at a time, until `refused` says it fits.
 * `refusal` is the words when even all of them by reference do not fit; the
 * write is refused then, before anything is signed.
 */
export function planFit(entries: readonly BagEntry[], candidates: readonly FitCandidate[], refused: (entries: readonly BagEntry[]) => string | null): { convert: Map<string, FitCandidate>; refusal: string | null } {
  const convert = new Map<string, FitCandidate>()
  let why = refused(entries)
  if (!why) return { convert, refusal: null }
  for (const c of [...candidates].sort((a, b) => b.bytes - a.bytes)) {
    convert.set(c.key, c)
    why = refused(withReferences(entries, convert))
    if (!why) return { convert, refusal: null }
  }
  return { convert, refusal: why }
}
