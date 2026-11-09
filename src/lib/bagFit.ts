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
 * shard's content is exactly that payload. Other kinds stay inline until their
 * referenced form is specified (REFERENCEABLE_KINDS).
 *
 * Pure. Sizes are measured without sealing anything: AES-GCM's ciphertext
 * length follows the plaintext's (sealedLength), so a bag's signed size is
 * known from its entries alone, exactly.
 */

import { bagSizeRefusal, signedBytes } from './bagSize'
import { bagTemplateAround, entryKey, isReference, OBJECT_KIND, SHARD_KIND, HIDDEN_KIND, type BagEntry, type BagPlace, type BagSettings, type Reference } from './hidden'

/** The inline kinds a write may move by reference to fit a bag: the shard, whose referenced form is the kind 33331 object. */
export const REFERENCEABLE_KINDS: ReadonlySet<number> = new Set([SHARD_KIND])

/** The base64 length of `nonce || ciphertext || tag` for this plaintext (spec §7.6 cipher): 12 + its UTF-8 bytes + 16, padded. */
export function sealedLength(plaintext: string): number {
  return 4 * Math.ceil((12 + new TextEncoder().encode(plaintext).length + 16) / 3)
}

/** A bag's signed size from its entries, without encrypting them: lib/hidden.ts bagTemplate around a stand-in of the same length. */
export function bagBytes(entries: readonly BagEntry[], lookupId: string, height: number, settings: BagSettings, place?: BagPlace, createdAt = Math.floor(Date.now() / 1000)): number {
  const template = bagTemplateAround(entries, 'A'.repeat(sealedLength(JSON.stringify(entries))), lookupId, height, createdAt, HIDDEN_KIND, settings, place)
  return signedBytes(template)
}

/**
 * Why a bag of these entries is not written, or null: what signBag refuses,
 * past the cap and larger than the bag it replaces (`before`), so a write that
 * shrinks a bag already past it still goes.
 */
export function growthRefusal(entries: readonly BagEntry[], before: readonly BagEntry[], bytes: number): string | null {
  const tooBig = bagSizeRefusal(bytes)
  return tooBig && JSON.stringify(entries).length > JSON.stringify(before).length ? tooBig : null
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
  return { key: entry.id, bytes: JSON.stringify(entry).length, ref: ['a', `${OBJECT_KIND}:${owner}:${d}`, relayHint, at], d }
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
