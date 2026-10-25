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

import { carriedPayload, carriedTable, carryObject } from 'sno-core/parts'
import { toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { withAuthoredConstrain } from './walkConstrain'

/**
 * `model` with only the carried objects keyed under `pubkey`, the author of the
 * event it came in: a key under anyone else's is ignored, and its address
 * fetched as though the table did not hold it (D5, arkinox 2026-10-25; the
 * spec's "keys are under the author's own pubkey"). With no pubkey to check
 * against, nothing carried is honoured. The same model when there is nothing
 * to drop. Applied where an object is read from its event, so every draw
 * after that can take the table as it is.
 */
export function keepOwnTable(model: ShardModel, pubkey: string | undefined): ShardModel {
  if (!model.objects) return model
  const kept = pubkey ? carriedTable(model, pubkey) : {}
  if (Object.keys(kept).length === Object.keys(model.objects).length) return model
  const { objects: _dropped, ...bare } = model
  return Object.keys(kept).length ? { ...bare, objects: kept } : bare
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

/**
 * What separates a copy's own part of its `d` from the id of the piece it was
 * copied from: `<source id>~<8 hex>`.
 */
export const COPY_MARK = '~'

/** Eight random hex digits: a copy's own part of its `d`. */
function nonce(): string {
  const b = new Uint8Array(4)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * The id of the workshop piece a copy was made from, by its address: what is
 * before the last COPY_MARK in its `d`. Provenance only, for a later "update
 * from kit"; nothing is live. Null for an address that is not a copy's.
 */
export function copiedFrom(address: string): string | null {
  const d = address.split(':').slice(2).join(':')
  const i = d.lastIndexOf(COPY_MARK)
  return i > 0 ? d.slice(0, i) : null
}

/**
 * `parent` carrying a copy of `source`, a piece of your workshop, and the
 * reference a placement of it names (STAMP > OBJECT, YOURS; arkinox
 * 2026-10-25: "once copied we should just edit the copy directly").
 *
 * The copy is keyed under a `d` of its own, `<source id>~<8 hex>`, never under
 * the source's own address (DECK-0003 §1.10 allows any `d`, and suggests this):
 * - a reader that does not know `objects` fetches that address and finds
 *   nothing, rather than the source as it is published today;
 * - the workshop never answers for it (lib/parts.ts fetchOwnFirst), so the
 *   bench draws the copy, which is the parent's own data;
 * - stamping the source again after the copy was edited makes a new copy
 *   rather than another placement of the edited one;
 * - two parents' copies of one piece, made at different times, never collide
 *   when both are carried in one hide (a writer flattens into one table).
 *
 * A copy of the source exactly as it is now, already in this parent, is used
 * again, so a piece stamped ten times in one parent travels once and its
 * placements edit together. The copy keeps the source's name, as a label.
 * Written as a hide writes it (OPAQUE where never chosen), and what the source
 * itself carries joins the parent's one table.
 */
export function copyInto(parent: ShardModel, source: ShardModel, pubkey: string): { shard: ShardModel; ref: Ref } {
  const written = withAuthoredConstrain(source)
  const text = JSON.stringify(carriedPayload(written))
  const prefix = `33331:${pubkey}:${source.id}${COPY_MARK}`
  for (const [key, entry] of Object.entries(parent.objects ?? {})) {
    if (key.startsWith(prefix) && key.indexOf(COPY_MARK, prefix.length) < 0 && JSON.stringify(entry) === text) return { shard: parent, ref: ['a', key] }
  }
  const address = `${prefix}${nonce()}`
  return { shard: carryObject(parent, address, written), ref: ['a', address] }
}
