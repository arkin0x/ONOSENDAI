/**
 * stampPrepare.ts: a shard chosen in STAMP's library made ready to stamp
 * (workshop/StampLibrary.tsx): everything it places read once, the way the
 * bench reads it (your own pieces from your workshop first, lib/parts.ts
 * fetchOwnFirst, then the relays), and flattened (lib/stampCopy.ts
 * bakeSource) so that every COPY tap afterwards is synchronous.
 *
 * Kept apart from the store, which never imports lib/parts (it loads React,
 * and two store tests mock it away; see store/useShards.ts on pieces).
 */

import { resolveParts, withAuthor } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'
import { fetchOwnFirst, fetchRef } from '../lib/parts'
import { bakeSource, missingIn } from '../lib/stampCopy'
import type { StampObject } from '../store/useWorkshop'

/**
 * The StampObject for `shard` under `ref`: its flattened copy when every
 * object it places could be read (else `copy` null and `missing` how many
 * could not), and its bounds for SNAP TO ITS SIZE whatever was missing.
 * `own`: a shard of yours, whose pieces come from your workshop first.
 */
export async function prepareStamp(shard: ShardModel, ref: Ref, author: string | null, own: boolean): Promise<StampObject & { missing: number }> {
  const model = author ? withAuthor(shard, author) : shard
  const placed = (shard.parts?.length ?? 0) > 0 ? await resolveParts(model, own ? fetchOwnFirst : fetchRef, { self: ref, author }) : []
  const missing = missingIn(placed)
  const copy = missing === 0 ? bakeSource(shard, placed) : null
  const bounds = copy ?? bakeSource(shard, placed, true)
  return {
    ref,
    name: shard.name,
    shard,
    copy,
    size: bounds && bounds.min && bounds.max ? { min: bounds.min, max: bounds.max, unit: bounds.unit } : null,
    local: own,
    missing,
  }
}
