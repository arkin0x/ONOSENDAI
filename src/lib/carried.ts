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
import type { ShardModel } from 'sno-core/shards'

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
