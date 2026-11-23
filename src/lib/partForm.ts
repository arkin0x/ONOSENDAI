/**
 * partForm.ts: whether a placed object is a LINK or SEALED, the one rule the
 * hide (store/useShards.ts) and the workshop's badges (workshop/PartFormBadge)
 * both read, so what the bench shows is what a hide does (owner, 2026-11-22).
 *
 *   link  the placement follows a public object, which every finder fetches:
 *         a ref with a relay hint (the feed, an address), anyone else's object,
 *         or a shard of yours published under your key and unedited since.
 *   sealed  the placement is a copy carried with what you hide: an entry of the
 *         shard's own objects table (DECK-0003 §1.10), or a shard of yours in
 *         the workshop that was never published, or was edited since. A hide
 *         seals it as its own hidden object (lib/pieces.ts), so finders draw
 *         it and nobody else can.
 *
 * Kit pieces are never published, so they are always sealed.
 *
 * The word on the badge was COPY until STAMP's COPY arrived (owner,
 * 2026-11-23), which puts a shard's points and faces in as your own: one word
 * for two things, so the badge says SEALED, what a hide does with it.
 *
 * Pure: the workshop's shards and the publish ledger are passed in.
 */

import { parseAddress } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'
import { publishState, shardFingerprint, type Ledger } from './published'

export type PartForm = 'link' | 'sealed'

/** Whether a shard of yours is published under your key and unedited since: placed, it stays a link to that public object. */
export function stillPublished(shard: ShardModel, ledger: Ledger, me: string | null | undefined): boolean {
  if (!me) return false
  const rec = ledger[shard.id]
  return !!rec && rec.pubkey === me && publishState(rec, shardFingerprint(shard), me) === 'published'
}

/**
 * Whether a hide seals this shard of yours as a piece (lib/pieces.ts) when a
 * shard places it from the workshop: it draws something, it is not one this
 * browser knows was published under another key, and it is not published
 * under yours and unedited. The one test store/useShards.ts and the badges share.
 */
export function sealedAsPiece(shard: ShardModel, ledger: Ledger, me: string | null | undefined): boolean {
  if (!me || (shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0)) return false
  const rec = ledger[shard.id]
  if (rec && rec.pubkey !== me) return false
  return !stillPublished(shard, ledger, me)
}

/** What a shard of yours is when placed from the workshop: sealed when a hide seals it, else a link. */
export function shardForm(shard: ShardModel, ledger: Ledger, me: string | null | undefined): PartForm {
  return sealedAsPiece(shard, ledger, me) ? 'sealed' : 'link'
}

const holds = (table: unknown, key: string): boolean =>
  !!table && typeof table === 'object' && !Array.isArray(table) && Object.prototype.hasOwnProperty.call(table, key)

/**
 * What the placement by `ref` in `parent` is. `find` looks a workshop shard up by
 * id. A ref under your key with no relay hint naming a workshop shard of yours is
 * that shard (lib/parts.ts fetchOwnFirst draws it); one naming no shard here is a
 * link to whatever your key published there.
 */
export function partForm(ref: Ref | undefined, parent: Pick<ShardModel, 'objects'>, me: string | null | undefined, find: (id: string) => ShardModel | undefined, ledger: Ledger): PartForm {
  if (!ref || ref[0] !== 'a' || typeof ref[1] !== 'string') return 'link'
  if (holds(parent.objects, ref[1])) return 'sealed'
  if (typeof ref[2] === 'string' && ref[2].length > 0) return 'link'
  const a = parseAddress(ref[1])
  if (!a || a.kind !== 33331 || !me || a.pubkey !== me) return 'link'
  const own = find(a.d)
  return own ? shardForm(own, ledger, me) : 'link'
}

/** The words a badge says, for its accessible label and its hint. */
export const FORM_LABEL: Record<PartForm, string> = {
  link: 'Linked: follows the public object',
  sealed: 'Sealed: goes inside what you hide, so only those who find it can read it',
}
