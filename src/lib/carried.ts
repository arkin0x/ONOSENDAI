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

import { carriedModel, carriedPayload, carriedTable, carryObject } from 'sno-core/parts'
import { addressesIn, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
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

/**
 * One step into a shard in the workshop's edit view of a placed part (arkinox,
 * 2026-10-25: double-tap a part's box, ROOM > WATER, EXIT returns): the
 * address the placement names, and, for a live link, the object as its
 * author's event has it. A step without `live` is a copy carried in the root
 * shard's own table, and is edited in place.
 */
export interface InsideStep {
  address: string
  /** A live link (FEED, BY ADDRESS): read-only, as fetched. DETACH makes it a copy. */
  live?: ShardModel
}

/** The `d` of an address. */
const dOf = (address: string): string => address.split(':').slice(2).join(':')

/** A copy as a model, once per version of the root's table. */
const focused = new WeakMap<object, Map<string, ShardModel | null>>()

/**
 * The copy at `address` in `root`'s table as a model to edit: its id is its
 * `d`, so `33331:<you>:<id>` is its own address, and it holds the root's whole
 * table, since the root's table answers for its placements at every depth
 * (DECK-0003 §1.10). The same object for the same table. Null when the table
 * does not hold it, or holds one the format refuses.
 */
export function carriedCopy(root: ShardModel, address: string): ShardModel | null {
  const table = root.objects
  if (!table) return null
  let byAddress = focused.get(table)
  if (!byAddress) focused.set(table, (byAddress = new Map()))
  if (byAddress.has(address)) return byAddress.get(address) ?? null
  const m = carriedModel(table, address)
  const model = m ? { ...m, id: dOf(address), objects: table } : null
  byAddress.set(address, model)
  return model
}

/**
 * Where a path into `root` really leads: the steps that still stand (an undo
 * can take a copy away from under the view), and the model the last of them
 * is, or the root itself for none.
 */
export function focusOf(root: ShardModel, path: readonly InsideStep[]): { path: InsideStep[]; model: ShardModel } {
  const kept: InsideStep[] = []
  let model = root
  for (const step of path) {
    const next = step.live ?? carriedCopy(root, step.address)
    if (!next) break
    kept.push(step)
    model = next
  }
  return { path: kept, model }
}

/** The addresses the root's own placements name. */
function placedBy(s: ShardModel): string[] {
  const used = new Set((s.parts ?? []).map((p) => p.ref))
  return (s.refs ?? []).filter((r, i) => used.has(i) && r[0] === 'a').map((r) => r[1])
}

/**
 * `root` with the copy at `address` replaced by `next`, an edit of it. What the
 * edit did to the table (a copy stamped inside the copy, a placement removed)
 * becomes the root's table, flat, and every entry the root still reaches, from
 * its own placements and through the table, is kept even when the copy no
 * longer places it.
 */
export function writeCopy(root: ShardModel, address: string, next: ShardModel): ShardModel {
  const before = root.objects ?? {}
  const table: Record<string, unknown> = { ...(next.objects ?? before) }
  table[address] = carriedPayload(next)
  const seen = new Set<string>()
  const queue = placedBy(root)
  while (queue.length) {
    const a = queue.pop() as string
    if (seen.has(a)) continue
    seen.add(a)
    if (!(a in table) && a in before) table[a] = before[a]
    if (a in table) queue.push(...addressesIn(table[a]))
  }
  return { ...root, objects: table }
}

/**
 * DETACH: the live link at the end of `path` becomes a copy carried in the
 * shard that places it, keyed under your own pubkey (lib/carried.ts copyInto),
 * and every reference of that shard to the link names the copy instead, so
 * all its placements there follow. The new path ends at the copy, to edit.
 * Null when the path does not end at a live link.
 */
export function detachInto(root: ShardModel, path: readonly InsideStep[], pubkey: string): { root: ShardModel; path: InsideStep[] } | null {
  const top = path[path.length - 1]
  if (!top?.live) return null
  const above = path.slice(0, -1)
  const holder = above.length ? focusOf(root, above).model : root
  const { shard: withCopy, ref } = copyInto(holder, { ...top.live, id: dOf(top.address) }, pubkey)
  // The holder's references, the link's now the copy's, each named once (§1.10).
  const refs: Ref[] = []
  const index = new Map<string, number>()
  const moved = (withCopy.refs ?? []).map((r) => {
    const named = r[1] === top.address ? ref : r
    const key = `${named[0]}:${named[1]}`
    let i = index.get(key)
    if (i === undefined) { i = refs.length; index.set(key, i); refs.push(named) }
    return i
  })
  const next: ShardModel = { ...withCopy, refs, ...(withCopy.parts ? { parts: withCopy.parts.map((p) => ({ ...p, ref: moved[p.ref] })) } : {}) }
  const written = above.length ? writeCopy(root, above[above.length - 1].address, next) : next
  return { root: written, path: [...above, { address: ref[1] }] }
}
