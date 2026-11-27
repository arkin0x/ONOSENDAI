/**
 * chainOrphans.ts - which of your own incoming events can change the chain
 * in hand, decided by looking ids up, never by building the chain.
 *
 * The owner's tablet, 2026-11-27: about 3,800 moves made on the phone, and
 * the live watch on the tablet's own chain handed over the newest 500 of
 * them. None named a move the tablet had as its previous one, so none could
 * change anything, but each was folded on its own, and each fold built the
 * whole 11,000-event chain twice (the divergence check and the merge) before
 * deciding so: about 197 ms apiece on a server, minutes on a tablet, with the
 * page frozen and the self-check's replies waiting behind it.
 *
 * An event of the chain whose previous event is neither in hand nor among
 * the events arriving with it (an orphan here) cannot be reached from the
 * spawn, so building the chain with it gives the same chain as without it,
 * and it cannot fork the chain in hand either (a fork names an event in
 * hand). It is set aside, and the stretch it hangs from is fetched once, as
 * a whole (lib/selfSync.ts catch-up). A spawn always counts: a newer one
 * takes over. An event of a chain that neither the hand nor the batch has
 * the spawn of changes nothing.
 *
 * Pure, so every row is a test.
 */

import { actionLink, type NostrEvent } from './events'

/** The ids of `events`, kept per array: the store replaces its array on every change, so one Set serves every fold in between. */
const idSets = new WeakMap<readonly NostrEvent[], ReadonlySet<string>>()

export function idsOf(events: readonly NostrEvent[]): ReadonlySet<string> {
  let ids = idSets.get(events)
  if (!ids) {
    ids = new Set(events.map((e) => e.id))
    idSets.set(events, ids)
  }
  return ids
}

function isSpawn(ev: NostrEvent): boolean {
  return Array.isArray(ev.tags) && ev.tags.some((t) => t[0] === 'A' && t[1] === 'spawn')
}

export interface Sorted {
  /** What may change the chain: new spawns, and events that link to the hand or to another of these. */
  linked: NostrEvent[]
  /** Events of the chain in hand (or of a spawn in the batch) whose previous event is nowhere here. */
  orphans: NostrEvent[]
  /** New events of nothing here (another chain, no links): they change nothing. */
  other: NostrEvent[]
}

/**
 * Sort `incoming` (already only `pubkey`'s, and not in hand) by what it can
 * do to the chain in hand, whose spawn is `genesisId`. Linear in the batch:
 * the links are followed oldest first, so a run of moves that extends the
 * head is linked in one pass, and anything left over is looked at again
 * until nothing more links.
 */
export function sortIncoming(incoming: readonly NostrEvent[], inHand: ReadonlySet<string>, genesisId: string): Sorted {
  const out: Sorted = { linked: [], orphans: [], other: [] }
  const reached = new Set<string>()
  const geneses = new Set<string>(genesisId ? [genesisId] : [])
  let waiting: NostrEvent[] = []
  for (const ev of incoming) {
    if (isSpawn(ev)) {
      out.linked.push(ev)
      reached.add(ev.id)
      geneses.add(ev.id)
    } else {
      waiting.push(ev)
    }
  }
  waiting.sort((a, b) => a.created_at - b.created_at)
  for (;;) {
    const next: NostrEvent[] = []
    for (const ev of waiting) {
      const link = actionLink(ev)
      if (!link || !geneses.has(link.genesisId)) { out.other.push(ev); continue }
      if (inHand.has(link.previousId) || reached.has(link.previousId)) {
        out.linked.push(ev)
        reached.add(ev.id)
      } else {
        next.push(ev)
      }
    }
    if (next.length === waiting.length) { out.orphans.push(...next); break }
    waiting = next
    if (waiting.length === 0) break
  }
  return out
}

/**
 * The newest of `orphans` on the chain `genesisId`, if it is newer than the
 * head in hand (`headAt`, its created_at): where another device of yours
 * has got to, to show at once while the stretch before it is fetched.
 */
export function newestOrphan(orphans: readonly NostrEvent[], genesisId: string, headAt: number): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const ev of orphans) {
    const link = actionLink(ev)
    if (!link || link.genesisId !== genesisId || ev.created_at < headAt) continue
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id > best.id)) best = ev
  }
  return best
}
