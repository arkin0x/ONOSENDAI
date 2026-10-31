/**
 * store.ts - the rules of `events`: what happens when an event arrives, and
 * how one is found again. Plain functions on an open database, so the event
 * worker and the fallback on the main thread run the same code.
 *
 * Every arrival, in one transaction with whatever it decides:
 * - A kind that is not kept, or an event past its NIP-40 expiration, is refused.
 * - An event already here keeps its row. Its `seen` gains the relay, and the
 *   nip01 flag can only rise: a check that passed is never forgotten.
 * - An event a valid deletion already named is refused.
 * - Replaceable and addressable: the newer `created_at` wins, and on a tie the
 *   lower id (NIP-01). The winner carries `addr`. The loser keeps its row
 *   without it, because something may place that version by `e`.
 * - Kind 5 is kept as a row. For each `e` and `a` it names, a `deletions` row
 *   is written, by its author's own authority only: an `e` is keyed with the
 *   deleter's pubkey, so it can only ever match that author's event; an `a`
 *   only counts when the address names the deleter. The target row goes,
 *   unless it is pinned, and then it is marked and stays. A later version of
 *   a deleted address, newer than the deletion, is accepted (NIP-09).
 */

import { request } from '../idb'
import type { NostrEvent } from '../events'
import {
  BUDGET_KEY, DELETIONS, EMPTY_BUDGET, EVENTS, META,
  addressOf, eventOf, expirationOf, keptKind, rowOf,
  type BudgetTotals, type EventRow, type Nip01Flag,
} from './schema'

/** One event handed in. */
export interface IngestItem {
  event: NostrEvent
  /** What has been checked of it already; a row that failed a check is never handed in. */
  nip01: Nip01Flag
  relay?: string
  pin?: boolean
}

export interface IngestResult {
  /** New rows. */
  added: string[]
  /** Rows that were here, that this arrival may have added a relay or a flag to. */
  known: string[]
  /** Not kept: the kind, an expiration in the past, a deletion that named it, an older version of an address that keeps nothing. */
  refused: string[]
}

/** Resolves when the transaction has committed; rejects with what stopped it. */
export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * Run `body` inside `tx`, and resolve once the transaction has committed. When
 * the body fails the transaction is aborted, so none of it lands, and what
 * rejects is what the transaction itself reports (a full disk, by name) when
 * it reports anything.
 */
export async function inTransaction<T>(tx: IDBTransaction, body: () => Promise<T>): Promise<T> {
  const done = committed(tx)
  done.catch(() => { /* heard below, in both branches */ })
  try {
    const value = await body()
    await done
    return value
  } catch (err) {
    try { tx.abort() } catch { /* it has already ended */ }
    await done.catch(() => {})
    throw tx.error ?? err
  }
}

/** Keep a running budget in step with a row added or taken away. */
export function countRow(totals: BudgetTotals, row: Pick<EventRow, 'pin' | 'bytes'>, sign: 1 | -1): void {
  if (row.pin === 1) {
    totals.pinnedBytes = Math.max(0, totals.pinnedBytes + sign * row.bytes)
    totals.pinnedRows = Math.max(0, totals.pinnedRows + sign)
  } else {
    totals.unpinnedBytes = Math.max(0, totals.unpinnedBytes + sign * row.bytes)
    totals.unpinnedRows = Math.max(0, totals.unpinnedRows + sign)
  }
}

const eTarget = (pubkey: string, id: string): string => `e:${pubkey}:${id}`
const aTarget = (addr: string): string => `a:${addr}`

interface Tombstone { target: string; by: string; pubkey: string; created_at: number }

/** Apply a kind 5, inside the arrival's transaction. */
async function applyDeletion(deletion: NostrEvent, events: IDBObjectStore, deletions: IDBObjectStore, totals: BudgetTotals): Promise<void> {
  const write = async (target: string): Promise<void> => {
    const had = await request(deletions.get(target)) as Tombstone | undefined
    if (!had || had.created_at < deletion.created_at) deletions.put({ target, by: deletion.id, pubkey: deletion.pubkey, created_at: deletion.created_at } satisfies Tombstone)
  }
  const strike = async (row: EventRow): Promise<void> => {
    if (row.id === deletion.id) return
    if (row.pin === 1) { events.put({ ...row, deleted: 1 }); return }
    countRow(totals, row, -1)
    events.delete(row.id)
  }
  for (const t of deletion.tags) {
    if (t[0] === 'e' && typeof t[1] === 'string') {
      await write(eTarget(deletion.pubkey, t[1]))
      const row = await request(events.get(t[1])) as EventRow | undefined
      if (row && row.pubkey === deletion.pubkey) await strike(row)
    } else if (t[0] === 'a' && typeof t[1] === 'string') {
      // The address names its author, and only that author can delete it.
      if (t[1].split(':')[1] !== deletion.pubkey) continue
      await write(aTarget(t[1]))
      const row = await request(events.index('byAddr').get(t[1])) as EventRow | undefined
      if (row && row.created_at <= deletion.created_at) await strike(row)
    }
  }
}

/** Whether a valid deletion already names this arrival. */
async function struck(event: NostrEvent, deletions: IDBObjectStore): Promise<boolean> {
  if (await request(deletions.get(eTarget(event.pubkey, event.id)))) return true
  const addr = addressOf(event)
  if (addr === undefined) return false
  const tomb = await request(deletions.get(aTarget(addr))) as Tombstone | undefined
  return tomb !== undefined && tomb.created_at >= event.created_at
}

/** The rows' arrival, in one transaction. A failure (a full disk) writes none of it, and rejects. */
export async function ingest(db: IDBDatabase, items: IngestItem[], now = Date.now()): Promise<IngestResult> {
  const result: IngestResult = { added: [], known: [], refused: [] }
  const tx = db.transaction([EVENTS, DELETIONS, META], 'readwrite')
  return inTransaction(tx, async () => {
    const events = tx.objectStore(EVENTS)
    const deletions = tx.objectStore(DELETIONS)
    const meta = tx.objectStore(META)
    const stored = await request(meta.get(BUDGET_KEY)) as { value?: BudgetTotals } | undefined
    const totals: BudgetTotals = { ...EMPTY_BUDGET, ...stored?.value }
    const seconds = Math.floor(now / 1000)
    for (const item of items) {
      const { event } = item
      const expires = expirationOf(event)
      if (!keptKind(event.kind) || (expires !== null && expires <= seconds)) { result.refused.push(event.id); continue }
      const had = await request(events.get(event.id)) as EventRow | undefined
      if (had) {
        const seen = item.relay && !had.seen.includes(item.relay) ? [...had.seen, item.relay] : had.seen
        const nip01 = item.nip01 > had.nip01 ? item.nip01 : had.nip01
        const pin = item.pin && had.pin !== 1 ? 1 : had.pin
        if (seen !== had.seen || nip01 !== had.nip01 || pin !== had.pin) {
          if (pin !== had.pin) { countRow(totals, had, -1); countRow(totals, { pin, bytes: had.bytes }, 1) }
          events.put({ ...had, seen, nip01, pin })
        }
        result.known.push(event.id)
        continue
      }
      if (await struck(event, deletions)) { result.refused.push(event.id); continue }
      const row = rowOf(event, { nip01: item.nip01, pin: item.pin, relay: item.relay }, now)
      if (row.addr !== undefined) {
        const current = await request(events.index('byAddr').get(row.addr)) as EventRow | undefined
        if (current) {
          const newer = row.created_at > current.created_at || (row.created_at === current.created_at && row.id < current.id)
          if (newer) {
            const { addr: _gone, ...superseded } = current
            void _gone
            events.put(superseded)
          } else {
            delete row.addr
          }
        }
      }
      countRow(totals, row, 1)
      events.put(row)
      if (event.kind === 5) await applyDeletion(event, events, deletions, totals)
      result.added.push(event.id)
    }
    meta.put({ key: BUDGET_KEY, value: totals })
    return result
  })
}

/** The rows of these ids that are here, in the order asked. */
export async function getRows(db: IDBDatabase, ids: string[]): Promise<EventRow[]> {
  const os = db.transaction(EVENTS, 'readonly').objectStore(EVENTS)
  const rows = await Promise.all(ids.map((id) => request(os.get(id)) as Promise<EventRow | undefined>))
  return rows.filter((r): r is EventRow => r !== undefined)
}

function alive(row: EventRow, seconds: number): boolean {
  const expires = expirationOf(row)
  return row.deleted !== 1 && (expires === null || expires > seconds)
}

/** Rows from `index` over `range`, newest key first, up to `limit`; what has expired or been deleted is not handed out. */
async function newestFrom(db: IDBDatabase, index: string, range: IDBKeyRange, limit: number, now: number): Promise<NostrEvent[]> {
  const seconds = Math.floor(now / 1000)
  const os = db.transaction(EVENTS, 'readonly').objectStore(EVENTS).index(index)
  return new Promise((resolve, reject) => {
    const out: NostrEvent[] = []
    const req = os.openCursor(range, 'prev')
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => {
      const c = req.result
      if (!c || out.length >= limit) { resolve(out); return }
      const row = c.value as EventRow
      if (alive(row, seconds)) out.push(eventOf(row))
      c.continue()
    }
  })
}

/** One author's events of one kind, newest first. */
export function byAuthorKind(db: IDBDatabase, pubkey: string, kind: number, limit = Infinity, now = Date.now()): Promise<NostrEvent[]> {
  return newestFrom(db, 'byAuthorKind', IDBKeyRange.bound([pubkey, kind, -Infinity], [pubkey, kind, Infinity]), limit, now)
}

/** Everyone's events of one kind, newest first. */
export function byKind(db: IDBDatabase, kind: number, limit = Infinity, now = Date.now()): Promise<NostrEvent[]> {
  return newestFrom(db, 'byKind', IDBKeyRange.bound([kind, -Infinity], [kind, Infinity]), limit, now)
}

/** The events carrying one tag value (`letter:value`, TAG_INDEX); newest key is not an order here, so they are sorted by time. */
export async function byTag(db: IDBDatabase, tag: string, limit = Infinity, now = Date.now()): Promise<NostrEvent[]> {
  const found = await newestFrom(db, 'byTag', IDBKeyRange.only(tag), Infinity, now)
  found.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
  return Number.isFinite(limit) ? found.slice(0, limit) : found
}

/** The current version at an address, when it is here and alive. */
export async function byAddress(db: IDBDatabase, addr: string, now = Date.now()): Promise<NostrEvent | null> {
  const found = await newestFrom(db, 'byAddr', IDBKeyRange.only(addr), 1, now)
  return found[0] ?? null
}

/** The running totals of the budget. */
export async function budget(db: IDBDatabase): Promise<BudgetTotals> {
  const os = db.transaction(META, 'readonly').objectStore(META)
  const row = await request(os.get(BUDGET_KEY)) as { value?: BudgetTotals } | undefined
  return { ...EMPTY_BUDGET, ...row?.value }
}
