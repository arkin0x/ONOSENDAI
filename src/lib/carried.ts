/**
 * carried.ts - the objects an object carries inside its own payload
 * (DECK-0003 §1.10, `objects`), as ONOSENDAI reads them.
 *
 * A build whose pieces were never published carries them in its payload, keyed
 * by the address each placement names, so a finder draws the pieces from the
 * bag instead of asking relays for names nobody published ("we never published
 * the parts and i dont want to", arkinox 2026-10-25). sno-core reads the table
 * and resolves placements from it first (sno-core/parts resolveParts); this is
 * the part that depends on where an object came from.
 */

import { carriedPayload, carriedTable, carryObject, withAuthor } from 'sno-core/parts'
import { toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { withAuthoredConstrain } from './walkConstrain'

/**
 * `model` as read from an event whose pubkey is `pubkey`: its author set
 * (sno-core withAuthor, local only, never written) and only the carried
 * objects keyed under that pubkey kept. A key under anyone else's is ignored,
 * and its address fetched as though the table did not hold it (D5, arkinox
 * 2026-10-25; the spec's "keys are under the author's own pubkey"). With no
 * pubkey to check against, nothing carried is honoured. Applied wherever an
 * object is read from its event; for an unsigned item, the pubkey is the bag's
 * or the chest's signer, never the item's own claim.
 */
export function keepOwnTable(model: ShardModel, pubkey: string | null | undefined): ShardModel {
  return withAuthor(model, pubkey ?? null)
}

/**
 * `model` with only the carried objects keyed under `pubkey` (or none at all
 * without one), and no author: what comes into your workshop from anywhere (a
 * copy from the feed or a bag, PASTE, an import, an avatar), so that a key
 * someone else wrote under your name can never be published again as yours.
 */
export function ownTableOnly(model: ShardModel, pubkey: string | null): ShardModel {
  const { author: _was, ...bare } = model
  if (!model.objects) return model.author === undefined ? model : bare
  const kept = carriedTable(model, pubkey)
  const { objects: _all, ...rest } = bare
  return Object.keys(kept).length ? { ...rest, objects: kept } : rest
}

/** Who "you" are, for a model made here (store/localObjects.ts wires it): null when no one is signed in. */
let localAuthor: () => string | null = () => null

/** Say who you are (store/localObjects.ts), or stop (null). */
export function setLocalAuthor(get: (() => string | null) | null): void {
  localAuthor = get ?? (() => null)
}

/** You, or null. */
export function you(): string | null {
  return localAuthor()
}

/**
 * Whose keys of `model`'s table count (DECK-0003 §1.10): the pubkey of the
 * event it was read from (keepOwnTable), or, for a model with none, yours,
 * since every model read from an event has one and so a model without one was
 * made here, by you. Never every key.
 */
export function authorOf(model: Pick<ShardModel, 'author'>): string | null {
  return model.author ?? localAuthor()
}

/**
 * The most a payload carrying pieces may be, in bytes: a relay that takes
 * 131,072 bytes holds about this much once it is base64'd inside an encrypted
 * event (DECK-0003 §1.10 Size). Every piece of the Maze Kit fits.
 */
export const CARRY_BUDGET_BYTES = 98_304

/** The size of the payload a hide writes for `shard`, in bytes (OPAQUE where its author never chose, as every hide writes it). */
export function payloadBytes(shard: ShardModel): number {
  return new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(shard)))).length
}

/**
 * Why a shard carrying pieces is not hidden, or null when it fits (D3,
 * arkinox 2026-10-25, his words). Kilobytes rounded up, so a payload just
 * over the budget never reads as 96. Only a shard that carries something is
 * held to it: one that carries nothing goes as it always has, inline or by
 * reference.
 */
export function carryRefusal(shard: ShardModel): string | null {
  if (!shard.objects || Object.keys(shard.objects).length === 0) return null
  const bytes = payloadBytes(shard)
  if (bytes <= CARRY_BUDGET_BYTES) return null
  return `${Math.ceil(bytes / 1024)}kb of ${CARRY_BUDGET_BYTES / 1024}kb may be larger than relays will accept. Keep this part separate.`
}

/** Sixteen random hex digits: a copy's `d`, which says nothing about it. */
function quietD(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * `parent` carrying a copy of `source`, a piece of your workshop, and the
 * reference a placement of it names (STAMP > OBJECT, YOURS; arkinox
 * 2026-10-25: "once copied we should just edit the copy directly").
 *
 * The copy is keyed under a `d` of its own, sixteen random hex digits, never
 * under the source's own address, and never one that names it:
 * - every reader that does not know `objects` asks public relays for that
 *   address, so the `d` says nothing about the piece (DECK-0003 §1.10, "What an
 *   older reader asks relays for"), and finds nothing there, rather than the
 *   source as it is published today;
 * - the workshop never answers for it (lib/parts.ts fetchOwnFirst), so the
 *   bench draws the copy, which is the parent's own data;
 * - stamping the source again after the copy was edited makes a new copy
 *   rather than another placement of the edited one;
 * - two parents' copies of one piece, made at different times, never collide
 *   when both are carried in one hide (a writer flattens into one table).
 *
 * A copy of the source exactly as it is now, already in this parent under your
 * key, is used again, so a piece stamped ten times in one parent travels once
 * and its placements edit together. The copy keeps the source's name, as a
 * label, sealed inside with the payload. Written as a hide writes it (OPAQUE
 * where never chosen), and what the source itself carries joins the parent's
 * one table.
 */
export function copyInto(parent: ShardModel, source: ShardModel, pubkey: string): { shard: ShardModel; ref: Ref } {
  const written = withAuthoredConstrain(source)
  const text = JSON.stringify(carriedPayload(written))
  const mine = `33331:${pubkey}:`
  for (const [key, entry] of Object.entries(parent.objects ?? {})) {
    if (key.startsWith(mine) && JSON.stringify(entry) === text) return { shard: parent, ref: ['a', key] }
  }
  const address = `${mine}${quietD()}`
  return { shard: carryObject(parent, address, written), ref: ['a', address] }
}
