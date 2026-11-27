/**
 * ownBacklog.ts - the stretch of your own chain another device published,
 * kept as it is fetched, so a catch-up that is cut short starts the next one
 * from where it stopped rather than from nothing.
 *
 * The owner's tablet, 2026-11-27: 3,760 moves behind, the self-check paged
 * them backwards until its cap and kept nothing when it ended with a hole,
 * so every retry and every reload fetched the same pages and failed the
 * same way. Now every page a relay sends is kept as it lands:
 *
 * | Where | What | How long |
 * |---|---|---|
 * | this page, per identity | every event of the stretch fetched, by id | until it is in the chain in hand (settleBacklog) |
 * | the event database (lib/eventDb), where your chain's rows are kept (lib/chainStore.ts rowsWanted) | one row per event, pinned (your own events are never evicted), flagged as checked and with the relay that sent it | for good, as every row of your chain; adopted, it becomes a row of the chain in hand |
 *
 * A retry, or the first look after a reload, hands what is kept to the
 * fetch as events it already has (resumeBacklog), so only the part still
 * missing is asked for. Each identity's events are its own; switching never
 * deletes any.
 *
 * Read back, an event is only one some relay sent (the store's `seen`):
 * an unpublished move of this device that a fold dropped stays a row too,
 * and taken back beside the relays' moves it would look like a fork. Its
 * id is recomputed, and its signature, checked when it was kept, is taken
 * as checked (the row's NIP-01 flag; lib/eventDb/chainRows.ts checkChainRows
 * says what that trusts).
 */

import { getEventHash } from 'nostr-tools/pure'
import { normalizeURL } from 'nostr-tools/utils'
import { actionLink, type NostrEvent } from './events'
import type { RelayAnswer } from './relayOutcome'
import { TAB_ID, callEventDb } from './eventDb/client'
import type { IngestItem } from './eventDb/store'
import { rowsWanted } from './chainStore'
import { checkedElsewhere } from './verifiedSigs'
import { countRelay, CYBERSPACE_RELAY } from './relay'

const KIND = 3333
/** The most events kept on this page per identity: a whole 11,000-move chain is 82 MB. */
export const BACKLOG_KEPT_MAX = 15_000
/** How long the canonical relay is given to count the stretch. */
const COUNT_WAIT_MS = 5_000

/** Injected for tests: whether rows are kept, and how the database and the canonical relay are reached. */
export const backlogDeps = {
  rows: (): boolean => rowsWanted(),
  ingest: (items: IngestItem[]): Promise<unknown> => callEventDb('ingest', [TAB_ID, items]),
  seenSince: (pubkey: string, since: number, limit: number): Promise<NostrEvent[]> => callEventDb('seenSince', [pubkey, KIND, since, limit]),
  count: (pubkey: string, genesisId: string, since: number): Promise<number | null> =>
    countRelay(CYBERSPACE_RELAY, { kinds: [KIND], authors: [pubkey], '#e': [genesisId], since }, COUNT_WAIT_MS),
}

/** What this page holds of each identity's stretch, by id. */
const kept = new Map<string, Map<string, NostrEvent>>()
/** Writes to the database, one after another, so a page's rows land in order and a failure never stops the next. */
let writes: Promise<unknown> = Promise.resolve()

function onChain(ev: NostrEvent, pubkey: string, genesisId: string): boolean {
  if (ev.pubkey !== pubkey || ev.kind !== KIND) return false
  const link = actionLink(ev)
  return link !== null && link.genesisId === genesisId
}

function keptFor(pubkey: string): Map<string, NostrEvent> {
  let m = kept.get(pubkey)
  if (!m) { m = new Map(); kept.set(pubkey, m) }
  return m
}

/**
 * Keep what these answers brought of `pubkey`'s chain `genesisId` that is not
 * in hand (`inHand`): on this page at once, and as rows (in the background).
 * Each answer's events were checked before they were handed here (relay.ts
 * ReadOptions onAnswers). Returns how many were new.
 */
export function keepAnswers(pubkey: string, genesisId: string, answers: RelayAnswer[], inHand: ReadonlySet<string>): number {
  if (!genesisId) return 0
  const m = keptFor(pubkey)
  const items: IngestItem[] = []
  let added = 0
  for (const a of answers) {
    let relay: string | undefined
    try { relay = normalizeURL(a.url) } catch { relay = undefined }
    for (const ev of a.events) {
      if (inHand.has(ev.id) || !onChain(ev, pubkey, genesisId)) continue
      if (!m.has(ev.id)) {
        if (m.size >= BACKLOG_KEPT_MAX) continue
        m.set(ev.id, ev)
        added++
      }
      // Every relay that sent it, so a read back knows a relay has it.
      items.push({ event: ev, nip01: 1, pin: true, ...(relay ? { relay } : {}) })
    }
  }
  if (items.length > 0 && backlogDeps.rows()) {
    writes = writes.then(() => backlogDeps.ingest(items)).catch(() => { /* a full disk or a lost worker: this page still has them */ })
  }
  return added
}

/** Keep single events a live subscription delivered (the newest moves of the stretch). */
export function keepEvents(pubkey: string, genesisId: string, events: NostrEvent[], url: string, inHand: ReadonlySet<string>): number {
  return keepAnswers(pubkey, genesisId, [{ url, outcome: 'answered', events }], inHand)
}

/**
 * Everything kept of `pubkey`'s chain `genesisId` from `since` on (the
 * second of the newest event of the chain in hand the relays hold): on this
 * page, and read back from the rows when there are any. Never rejects.
 */
export async function resumeBacklog(pubkey: string, genesisId: string, since: number | undefined): Promise<NostrEvent[]> {
  if (!genesisId) return []
  const m = keptFor(pubkey)
  if (since !== undefined && backlogDeps.rows()) {
    try {
      await writes
      const rows = await backlogDeps.seenSince(pubkey, since, BACKLOG_KEPT_MAX)
      for (const ev of rows) {
        if (m.has(ev.id) || !onChain(ev, pubkey, genesisId)) continue
        let sound = false
        try { sound = getEventHash(ev) === ev.id } catch { sound = false }
        if (!sound) continue
        // Its signature was checked when it was kept (the row's flag).
        checkedElsewhere(ev)
        if (m.size >= BACKLOG_KEPT_MAX) break
        m.set(ev.id, ev)
      }
    } catch { /* unreadable: what this page holds still counts */ }
  }
  const out: NostrEvent[] = []
  for (const ev of m.values()) if (onChain(ev, pubkey, genesisId) && (since === undefined || ev.created_at >= since)) out.push(ev)
  return out
}

/** What this page holds of `pubkey`'s chain `genesisId`, at once (no read of the rows). */
export function backlogEvents(pubkey: string, genesisId: string): NostrEvent[] {
  const m = kept.get(pubkey)
  if (!m || !genesisId) return []
  const out: NostrEvent[] = []
  for (const ev of m.values()) if (onChain(ev, pubkey, genesisId)) out.push(ev)
  return out
}

/** How many events of the stretch this page holds for `pubkey`. */
export function backlogSize(pubkey: string): number {
  return kept.get(pubkey)?.size ?? 0
}

/** Let go of what is now in the chain in hand (or of another chain): its rows stay, as the chain's own. */
export function settleBacklog(pubkey: string, inHand: ReadonlySet<string>, genesisId: string): void {
  const m = kept.get(pubkey)
  if (!m) return
  for (const [id, ev] of m) if (inHand.has(id) || !onChain(ev, pubkey, genesisId)) m.delete(id)
}

/**
 * How many events the stretch from `since` on holds that are not in hand,
 * from one COUNT to the canonical relay, or null when it cannot count (no
 * NIP-45, no answer in time). `atOrAfter` is how many of the chain in hand
 * are dated from `since` on: the count includes them.
 */
export async function countBacklog(pubkey: string, genesisId: string, since: number, atOrAfter: number): Promise<number | null> {
  try {
    const n = await backlogDeps.count(pubkey, genesisId, since)
    return n === null ? null : Math.max(0, n - atOrAfter)
  } catch {
    return null
  }
}

/** Resolves once every row handed to the database so far is written (or failed). */
export function backlogWritten(): Promise<void> {
  return writes.then(() => {}, () => {})
}

/** For tests: forget what this page holds. */
export function resetBacklog(): void {
  kept.clear()
  writes = Promise.resolve()
}
