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

import { carriedTable } from 'sno-core/parts'
import { toPayload, type ShardModel } from 'sno-core/shards'
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
