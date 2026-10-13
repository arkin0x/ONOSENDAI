/**
 * foundCache.ts: what makes a find survive a relay that stops answering.
 *
 * A scan opens a bag with a region key and draws what is inside. Until now
 * that lived only in memory, so after a reload the finds came back only if a
 * relay answered again: a relay that went quiet or started asking to sign in
 * took them off the screen (arkinox, 2026-10-13). Every bag that opens now
 * goes to IndexedDB (lib/foundDb.ts) as it came from the relay, signed, with
 * its region key and whatever its references resolved to, and on the next
 * load it is opened again from there, before any relay is asked.
 *
 * Opened again, not shown again: a stored row is held to the same standard
 * as a fresh find. The bag's signature is checked, its contents are
 * decrypted with the stored key and every item inside verified by unbag, and
 * a reference resolves only to the stored event it named, verified. A row
 * that fails any of it is dropped, never drawn.
 *
 * The pure half is here and tested on its own; store/useFound.ts owns the
 * database, the identity and the budget. The discovery paths call
 * unbagRemembered in place of unbag, and the store registers where a bag
 * that opened goes (setFoundSink), so this file imports no store.
 */

import { verifyEvent } from 'nostr-tools/pure'
import { HIDDEN_KIND, entryKey, unbag, type Hidden, type Reference, type RegionOrigin, type ResolveReference } from './hidden'
import { bytesToHex, hexToBytes } from './events'
import type { NostrEvent } from './events'
import type { FoundBag, FoundOrigin } from './foundDb'
import { bytesOf } from './secrets/budget'

/**
 * The most the found bags of one identity may take. A bag is a few hundred
 * bytes to a few kilobytes, a referenced object up to the 64 KB a relay
 * takes, so this is thousands of finds; past it the oldest seen go first.
 */
export const FOUND_BUDGET_BYTES = 50 * 1024 * 1024

/**
 * verifyEvent on a fresh copy of the event's fields. nostr-tools remembers a
 * verification on the event object itself, under a symbol that an object
 * spread carries along, so an event edited after it was once verified would
 * pass on the memory alone. A row read back from IndexedDB has no symbol,
 * but nothing here should depend on how a row arrived.
 */
export function verifiedFresh(e: NostrEvent): boolean {
  if (!e || typeof e !== 'object') return false
  const { id, pubkey, created_at, kind, tags, content, sig } = e
  return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })
}

/** A bag's lookup id, its `d` tag. */
export function lookupOf(outer: Pick<NostrEvent, 'tags'>): string | null {
  return outer.tags.find((t) => t[0] === 'd')?.[1] ?? null
}

/** The row for a bag: one per bag address per identity, so a newer version replaces it. */
export function rowKeyOf(owner: string, outer: Pick<NostrEvent, 'pubkey' | 'tags'>): string | null {
  const d = lookupOf(outer)
  return d === null ? null : `${owner}/${outer.pubkey}:${d}`
}

/** Whether `a` is the version to keep over `b`: newer, and on a tie the larger id, so every device keeps the same one. */
export function keepsOver(a: Pick<NostrEvent, 'created_at' | 'id'>, b: Pick<NostrEvent, 'created_at' | 'id'>): boolean {
  return a.created_at !== b.created_at ? a.created_at > b.created_at : a.id > b.id
}

function originOut(o: RegionOrigin | undefined): FoundOrigin | undefined {
  return o ? { at: { x: String(o.at.x), y: String(o.at.y), z: String(o.at.z) }, plane: o.plane as 0 | 1 } : undefined
}

function originIn(o: FoundOrigin | undefined): RegionOrigin | undefined {
  if (!o) return undefined
  try { return { at: { x: BigInt(o.at.x), y: BigInt(o.at.y), z: BigInt(o.at.z) }, plane: o.plane } } catch { return undefined }
}

/** The row for a bag that opened to `items`. */
export function foundRow(owner: string, outer: NostrEvent, keyHex: string, items: Hidden[], refs: Record<string, NostrEvent>, height: number | undefined, origin: RegionOrigin | undefined, seenAt: number): FoundBag | null {
  const rowKey = rowKeyOf(owner, outer)
  if (!rowKey) return null
  return { rowKey, owner, outer, keyHex, ...(height !== undefined ? { height } : {}), ...(origin ? { origin: originOut(origin) } : {}), refs, itemIds: items.map((h) => h.eventId), seenAt }
}

/**
 * Open a stored row again, as a fresh find is opened: null when it no longer
 * holds up (a bag that is not one, a signature that fails, a key that no
 * longer opens it, nothing inside that verifies), and the row is then dropped.
 */
export async function openRow(row: FoundBag, open: typeof unbag = unbag): Promise<Hidden[] | null> {
  const { outer } = row
  if (!outer || outer.kind !== HIDDEN_KIND || !verifiedFresh(outer)) return null
  if (rowKeyOf(row.owner, outer) !== row.rowKey) return null
  if (!/^[0-9a-f]{64}$/.test(row.keyHex)) return null
  // A reference opens only to the event stored for it, which unbag checks
  // names the reference and opens with this bag's key; checked here too, so
  // a tampered object never reaches it.
  const resolve: ResolveReference = async (ref: Reference) => {
    const ev = row.refs[entryKey(ref)]
    return ev && verifiedFresh(ev) ? ev : null
  }
  let items: Hidden[]
  try {
    items = await open(outer, hexToBytes(row.keyHex), resolve, originIn(row.origin), row.height)
  } catch {
    return null
  }
  return items.length > 0 ? items : null
}

/**
 * The rows a set of deletion requests (kind 5, NIP-09) removes: signed by the
 * bag's own author, naming the bag by id, or by its address at a time no
 * earlier than this version. Anyone else's deletion is ignored, and so is a
 * relay that simply does not send the bag: silence removes nothing.
 */
export function deletedRows(rows: FoundBag[], deletions: NostrEvent[]): string[] {
  const valid = deletions.filter((d) => d.kind === 5 && verifiedFresh(d))
  const out: string[] = []
  for (const row of rows) {
    const { outer } = row
    const address = `${HIDDEN_KIND}:${outer.pubkey}:${lookupOf(outer) ?? ''}`
    const gone = valid.some((d) => d.pubkey === outer.pubkey && d.tags.some((t) =>
      (t[0] === 'e' && t[1] === outer.id) || (t[0] === 'a' && t[1] === address && d.created_at >= outer.created_at)))
    if (gone) out.push(row.rowKey)
  }
  return out
}

/**
 * Which rows to evict to bring the total under `budget`: the oldest seen
 * first, never one `exempt` keeps (something starred, something held).
 */
export function toEvict(rows: FoundBag[], budget: number, exempt: (row: FoundBag) => boolean): string[] {
  let total = 0
  for (const r of rows) total += bytesOf(r)
  if (total <= budget) return []
  const out: string[] = []
  for (const r of [...rows].filter((x) => !exempt(x)).sort((a, b) => a.seenAt - b.seenAt || (a.rowKey < b.rowKey ? -1 : 1))) {
    if (total <= budget) break
    total -= bytesOf(r)
    out.push(r.rowKey)
  }
  return out
}

/** Where a bag that opened goes: set by store/useFound.ts, and nothing until it is. */
export type FoundSink = (outer: NostrEvent, keyHex: string, items: Hidden[], refs: Record<string, NostrEvent>, height: number | undefined, origin: RegionOrigin | undefined) => void
let sink: FoundSink | null = null
export function setFoundSink(fn: FoundSink | null): void { sink = fn }

/**
 * unbag, and the bag kept when it opened: the events its references resolved
 * to are recorded on the way through, so the row can be opened again later
 * without asking anyone for them.
 */
export async function unbagRemembered(outer: NostrEvent, regionKey: Uint8Array, resolve?: ResolveReference, origin?: RegionOrigin, height?: number): Promise<Hidden[]> {
  const refs: Record<string, NostrEvent> = {}
  const recording: ResolveReference | undefined = resolve
    ? async (ref) => {
      const ev = await resolve(ref)
      if (ev) refs[entryKey(ref)] = ev
      return ev
    }
    : undefined
  const items = await unbag(outer, regionKey, recording, origin, height)
  if (items.length > 0 && sink) {
    try { sink(outer, bytesToHex(regionKey), items, refs, height, origin) } catch { /* a cache that fails never fails a find */ }
  }
  return items
}
