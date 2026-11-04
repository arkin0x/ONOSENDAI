/**
 * bagVersions.ts: which of the bags the relays sent a scan should open.
 *
 * A bag is addressable (kind 33330): one per author and `d`, and a newer one
 * replaces the older. A relay holds whichever version reached it last, so
 * relays disagree: on 2026-11-03 three relays held three versions of one of
 * arkinox's bags (10-23, 10-25 and 11-01). The answers were merged by event
 * id only and every version opened, so a scan drew the union of them, and
 * whatever a later version left out (a chest DELETE took out of a bag that
 * still held other things) came back from an older copy. A relay that kept a
 * bag and dropped or refused its deletion (NIP-09) did the same for a bag
 * taken down whole. Deleting worked on the device that did it, which keeps
 * its own list of what it deleted, and nowhere else (arkinox, 2026-11-03:
 * "Sealed Crawlspace", deleted and hidden again, and both showed).
 *
 * So a scan opens one version per address, the newest, and not even that
 * when its author deleted it: by its id, or by its address at a time no
 * earlier than it. Anyone else's deletion is ignored, and a relay that sends
 * no deletion removes nothing.
 */

import type { Filter } from 'nostr-tools/filter'
import { HIDDEN_KIND } from './hidden'
import type { NostrEvent } from './events'
import { deletedAmong, keepsOver, lookupOf, validDeletions, verifiedFresh } from './foundCache'

/** NIP-09's kind. */
const DELETION = 5
/** Addresses asked about in one deletion question. */
const ADDRESSES_PER_ASK = 100

/** A bag's address, `33330:<author>:<d>`, or null when it has no `d`. */
export function bagAddressOf(bag: Pick<NostrEvent, 'pubkey' | 'tags'>): string | null {
  const d = lookupOf(bag)
  return d === null ? null : `${HIDDEN_KIND}:${bag.pubkey}:${d}`
}

/** When this address's author last retracted it by address, 0 if never. */
export function retractedAt(address: string, deletions: readonly NostrEvent[]): number {
  const author = address.split(':')[1]
  let at = 0
  for (const d of deletions) {
    if (d.kind !== DELETION || d.pubkey !== author || d.created_at <= at) continue
    if (d.tags.some((t) => t[0] === 'a' && t[1] === address) && verifiedFresh(d)) at = d.created_at
  }
  return at
}

/** Whether a bag's own author deleted it: the found cache's rule (foundCache.ts deletedAmong). */
export function bagDeleted(bag: NostrEvent, deletions: readonly NostrEvent[]): boolean {
  return deletedAmong(bag, validDeletions(deletions))
}

/** The newest version of each bag address, in the order first seen; a bag without a `d` is not a bag and is left out. */
export function newestBags(events: readonly NostrEvent[]): NostrEvent[] {
  const by = new Map<string, NostrEvent>()
  for (const e of events) {
    const address = bagAddressOf(e)
    if (address === null) continue
    const had = by.get(address)
    if (!had || keepsOver(e, had)) by.set(address, e)
  }
  return [...by.values()]
}

/** The bags to open: the newest of each address, unless its author deleted it. */
export function currentBags(events: readonly NostrEvent[], deletions: readonly NostrEvent[]): NostrEvent[] {
  const valid = validDeletions(deletions)
  return newestBags(events).filter((b) => !deletedAmong(b, valid))
}

/** One read of the relays, merged (lib/relay query). */
export type AskEvents = (filter: Filter) => Promise<NostrEvent[]>

/**
 * The deletions these bags' authors signed for them, and for `alsoAddresses`
 * (addresses that may have no bag left at all). By address only: every
 * deletion this client signs for a bag names its address, and NIP-09 asks
 * for the address on an addressable kind. A question no relay answers is no
 * deletion: silence removes nothing.
 */
export async function askBagDeletions(bags: readonly NostrEvent[], ask: AskEvents, alsoAddresses: readonly string[] = []): Promise<NostrEvent[]> {
  const addresses = [...new Set([...bags.map(bagAddressOf).filter((a): a is string => a !== null), ...alsoAddresses])]
  const out: NostrEvent[] = []
  for (let i = 0; i < addresses.length; i += ADDRESSES_PER_ASK) {
    const some = addresses.slice(i, i + ADDRESSES_PER_ASK)
    const authors = [...new Set(some.map((a) => a.split(':')[1]))]
    try { out.push(...await ask({ kinds: [DELETION], authors, '#a': some })) } catch { /* silence removes nothing */ }
  }
  return out
}

/** The bags a scan should open out of what the relays sent: one per address, the newest, none its author deleted. */
export async function bagsToOpen(events: readonly NostrEvent[], ask: AskEvents, alsoAddresses: readonly string[] = []): Promise<{ bags: NostrEvent[]; deletions: NostrEvent[] }> {
  const newest = newestBags(events)
  if (newest.length === 0 && alsoAddresses.length === 0) return { bags: [], deletions: [] }
  const deletions = await askBagDeletions(newest, ask, alsoAddresses)
  const valid = validDeletions(deletions)
  return { bags: newest.filter((b) => !deletedAmong(b, valid)), deletions }
}

/** What staleFinds needs of a find (lib/hidden Hidden). */
export interface FindOfBag {
  eventId: string
  author: string
  lookupId: string
  bagId: string
  bagAt?: number
  chestId?: string
  room?: { doorId: string }
}

/**
 * The finds already on screen that a scan's answer takes away: one read from
 * a bag whose address now holds a newer version (the scan opens that one and
 * files again whatever it still holds), or whose author deleted it with no
 * newer version standing. Anything whose address the answer says nothing
 * about stays, since silence removes nothing.
 *
 * `refiled`: the finds the scan read out of the bags it opened, which it
 * files again at once. A chest or a door among them was only re-filed under
 * its newer bag, not taken away, so what is in it stays: the hider changing
 * something else in that bag must not empty a room a finder has open, maybe
 * from inside (a room is read by its door, store/rooms.ts, and reopenRoom
 * does not read it again for minutes). A chest or a door that went and was
 * not re-filed takes what is in it, however deep (review of #593).
 */
export function staleFinds(finds: Readonly<Record<string, FindOfBag>>, bags: readonly NostrEvent[], deletions: readonly NostrEvent[], refiled: ReadonlySet<string>): string[] {
  const current = new Map(bags.map((b) => [bagAddressOf(b), b]))
  const valid = validDeletions(deletions)
  const out = new Set<string>()
  for (const h of Object.values(finds)) {
    if (h.chestId || h.room) continue
    const address = `${HIDDEN_KIND}:${h.author}:${h.lookupId}`
    const now = current.get(address)
    if (now) {
      if (now.id !== h.bagId && now.created_at > (h.bagAt ?? 0)) out.add(h.eventId)
      continue
    }
    // The bag it was read from, as far as the find knows it: the same rule as any bag's.
    if (deletedAmong({ id: h.bagId, pubkey: h.author, created_at: h.bagAt ?? 0, tags: [['d', h.lookupId]] }, valid)) out.add(h.eventId)
  }
  // What came out of a chest that went, or stood behind a door that went,
  // however deep; never through one the newer bag still holds.
  const gone = new Set([...out].filter((id) => !refiled.has(id)))
  for (let grew = gone.size > 0; grew;) {
    grew = false
    for (const h of Object.values(finds)) {
      const holder = h.chestId ?? h.room?.doorId
      if (holder !== undefined && gone.has(holder) && !gone.has(h.eventId)) { gone.add(h.eventId); out.add(h.eventId); grew = true }
    }
  }
  return [...out]
}
