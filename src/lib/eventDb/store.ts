/**
 * store.ts - the rules of `events`: what happens when an event arrives, and
 * how one is found again. Plain functions on an open database, so the event
 * worker and the fallback on the main thread run the same code.
 *
 * Every arrival, in one transaction with whatever it decides:
 * - Something not shaped like an event is refused alone. So is a kind that is
 *   not kept, anything with a `secret` tag, an event past its NIP-40
 *   expiration, and one more than an hour ahead of this clock (your own rows
 *   and movement actions excepted: a chain's clock is its own).
 * - An event already here keeps its row, its `seen` gains the relay, and its
 *   pin only rises. An arrival whose NIP-01 flag outranks the row's replaces
 *   the row's bytes, so a flag always describes the bytes beside it.
 * - A deletion or an address kind only acts when its signature was checked: a
 *   row nobody checked can never take something from one somebody did.
 * - An event a valid deletion already named is refused, or stored marked when
 *   it is pinned.
 * - Replaceable and addressable: the newer `created_at` wins, and on a tie the
 *   lower id (NIP-01). The winner carries `addr`. The loser keeps its row
 *   without it, because something may place that version by `e`, and reads do
 *   not hand it out.
 * - Kind 5 is kept as a row, up to DELETION_TARGETS_MAX targets. For each `e`
 *   and `a` it names, a `deletions` row is written, by its author's own
 *   authority only: an `e` is keyed with the deleter's pubkey, so it can only
 *   ever match that author's event; an `a` only counts when the address names
 *   the deleter. The target row goes, unless it is pinned, and then it is
 *   marked and stays. A later version of a deleted address, newer than the
 *   deletion, is accepted (NIP-09). A deletion does nothing to another
 *   deletion, and nothing to a movement action: relays and verifiers still see
 *   a fork, and a fork ends a chain (FORK = DEAD).
 */

import { request } from '../idb'
import type { NostrEvent } from '../events'
import {
  BUDGET_KEY, DELETIONS, EMPTY_BUDGET, EVENTS, META, MOVEMENT_KIND,
  addressOf, eventOf, expirationOf, isAddressKind, isEventShape, keptEvent, nip01Rank, rowOf, utf8Bytes,
  type BudgetTotals, type EventRow, type Nip01Flag,
} from './schema'

/** How many targets one deletion may name. Past this it is refused: one small event must not write thousands of rows. */
export const DELETION_TARGETS_MAX = 500
/** How far ahead of this clock an event may claim to be (seconds). */
const FUTURE_SLACK_S = 3_600
/** How many rows a read hands out when it does not say. */
export const READ_LIMIT_DEFAULT = 500

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
  /** Not kept: its shape, its kind, a `secret` tag, its time, a check it needs and has not had, a deletion that named it. */
  refused: string[]
  /** Rows a deletion in this batch took away or marked. */
  struck: string[]
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

/** Apply a kind 5, inside the arrival's transaction. Returns the rows it took away or marked. */
async function applyDeletion(deletion: NostrEvent, events: IDBObjectStore, deletions: IDBObjectStore, totals: BudgetTotals): Promise<string[]> {
  const out: string[] = []
  const write = async (target: string): Promise<void> => {
    const had = await request(deletions.get(target)) as Tombstone | undefined
    if (had && had.created_at >= deletion.created_at) return
    const tomb: Tombstone = { target, by: deletion.id, pubkey: deletion.pubkey, created_at: deletion.created_at }
    if (had) totals.tombstoneBytes = Math.max(0, totals.tombstoneBytes - utf8Bytes(had))
    totals.tombstoneBytes += utf8Bytes(tomb)
    deletions.put(tomb)
  }
  const strike = (row: EventRow): void => {
    if (row.kind === 5 || row.kind === MOVEMENT_KIND) return
    out.push(row.id)
    if (row.pin === 1) {
      const { addr: _gone, ...marked } = row
      void _gone
      events.put({ ...marked, deleted: 1 })
      return
    }
    countRow(totals, row, -1)
    events.delete(row.id)
  }
  for (const t of deletion.tags) {
    if (t[0] === 'e' && typeof t[1] === 'string') {
      const row = await request(events.get(t[1])) as EventRow | undefined
      // A deletion does nothing to another deletion (NIP-09).
      if (row?.kind === 5) continue
      await write(eTarget(deletion.pubkey, t[1]))
      if (row && row.pubkey === deletion.pubkey) strike(row)
    } else if (t[0] === 'a' && typeof t[1] === 'string') {
      // The address names its author, and only that author can delete it.
      const [kind, author] = t[1].split(':')
      if (author !== deletion.pubkey || kind === '5') continue
      await write(aTarget(t[1]))
      const row = await request(events.index('byAddr').get(t[1])) as EventRow | undefined
      if (row && row.created_at <= deletion.created_at) strike(row)
    }
  }
  return out
}

/** Whether a valid deletion already names this arrival. Never a movement action or a deletion, which a deletion cannot touch. */
async function struck(event: NostrEvent, deletions: IDBObjectStore): Promise<boolean> {
  if (event.kind === MOVEMENT_KIND || event.kind === 5) return false
  if (await request(deletions.get(eTarget(event.pubkey, event.id)))) return true
  const addr = addressOf(event)
  if (addr === undefined) return false
  const tomb = await request(deletions.get(aTarget(addr))) as Tombstone | undefined
  return tomb !== undefined && tomb.created_at >= event.created_at
}

/** What a row replacing a lower-ranked one of the same id keeps of it: everything but the event and what is read from the event. */
function carried(had: EventRow): Partial<EventRow> {
  const { seen, pin, usedAt, savedAt, proof, proofRev, chain, chainEpoch, chainRev, breakAt, acked, deleted, chainOf, chainN } = had
  return {
    seen, pin, usedAt, savedAt, proof, chain,
    ...(proofRev !== undefined ? { proofRev } : {}),
    ...(chainEpoch !== undefined ? { chainEpoch } : {}),
    ...(chainRev !== undefined ? { chainRev } : {}),
    ...(breakAt !== undefined ? { breakAt } : {}),
    ...(acked !== undefined ? { acked } : {}),
    ...(deleted !== undefined ? { deleted } : {}),
    ...(chainOf !== undefined ? { chainOf } : {}),
    ...(chainN !== undefined ? { chainN } : {}),
  }
}

/** The rows' arrival, in one transaction. A failure (a full disk) writes none of it, and rejects. */
export async function ingest(db: IDBDatabase, items: IngestItem[], now = Date.now()): Promise<IngestResult> {
  const result: IngestResult = { added: [], known: [], refused: [], struck: [] }
  const tx = db.transaction([EVENTS, DELETIONS, META], 'readwrite')
  return inTransaction(tx, async () => {
    const events = tx.objectStore(EVENTS)
    const deletions = tx.objectStore(DELETIONS)
    const meta = tx.objectStore(META)
    const stored = await request(meta.get(BUDGET_KEY)) as { value?: BudgetTotals } | undefined
    const totals: BudgetTotals = { ...EMPTY_BUDGET, ...stored?.value }
    const seconds = Math.floor(now / 1000)
    for (const item of items) {
      const event: NostrEvent = item?.event
      if (!isEventShape(event)) { result.refused.push(String((event as { id?: unknown } | undefined)?.id ?? '')); continue }
      const expires = expirationOf(event)
      const farAhead = event.created_at > seconds + FUTURE_SLACK_S && !item.pin && event.kind !== MOVEMENT_KIND
      if (!keptEvent(event) || (expires !== null && expires <= seconds) || farAhead) { result.refused.push(event.id); continue }
      const had = await request(events.get(event.id)) as EventRow | undefined
      const relay = item.relay
      if (had && nip01Rank(item.nip01) <= nip01Rank(had.nip01)) {
        const seen = relay && !had.seen.includes(relay) ? [...had.seen, relay] : had.seen
        const pin = item.pin && had.pin !== 1 ? 1 : had.pin
        if (seen !== had.seen || pin !== had.pin) {
          if (pin !== had.pin) { countRow(totals, had, -1); countRow(totals, { pin, bytes: had.bytes }, 1) }
          events.put({ ...had, seen, pin })
        }
        result.known.push(event.id)
        continue
      }
      // A row here or not, what follows acts on this event's bytes, so it needs its own check.
      const targets = event.kind === 5 ? event.tags.filter((t) => t[0] === 'e' || t[0] === 'a').length : 0
      if (((event.kind === 5 || isAddressKind(event.kind)) && item.nip01 !== 1) || targets > DELETION_TARGETS_MAX) { result.refused.push(event.id); continue }
      const pinned = item.pin === true || had?.pin === 1
      const isStruck = await struck(event, deletions)
      if (isStruck && !pinned) {
        // A row of the same id that nobody had checked does not outlive the event it claimed to be.
        if (had) { countRow(totals, had, -1); events.delete(had.id) }
        result.refused.push(event.id)
        continue
      }
      const row: EventRow = { ...rowOf(event, { nip01: item.nip01, pin: pinned, relay }, now), ...(had ? carried(had) : {}) }
      if (had) row.pin = pinned ? 1 : 0
      if (had && relay && !row.seen.includes(relay)) row.seen = [...row.seen, relay]
      if (isStruck) { row.deleted = 1; delete row.addr }
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
      if (had) countRow(totals, had, -1)
      countRow(totals, row, 1)
      events.put(row)
      if (event.kind === 5) result.struck.push(...await applyDeletion(event, events, deletions, totals))
      if (had) result.known.push(event.id)
      else result.added.push(event.id)
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

/**
 * Whether a read may hand this row out as the event it is: not deleted or
 * expired, checked, and the current version of its address. A row nobody has
 * checked yet, or an older version kept by id, is only found by asking for it
 * (getRows, and a chain's own read).
 */
function alive(row: EventRow, seconds: number): boolean {
  const expires = expirationOf(row)
  return row.deleted !== 1 && row.nip01 !== 0 && (expires === null || expires > seconds) && (addressOf(row) === undefined || row.addr !== undefined)
}

/**
 * Rows from `index` over `range`, newest key first, up to `limit`; it stops
 * there, and reads no further. Within one second the higher id comes first, the
 * order of the keys. NIP-01 says the lowest, and nothing here needs it, because
 * a limited read is never a whole answer: fresh-dated spam can still fill a
 * limit, so a caller never treats one as complete.
 */
async function newestFrom(db: IDBDatabase, index: string, range: IDBKeyRange, limit: number, now: number): Promise<NostrEvent[]> {
  const seconds = Math.floor(now / 1000)
  const os = db.transaction(EVENTS, 'readonly').objectStore(EVENTS).index(index)
  return new Promise((resolve, reject) => {
    const out: NostrEvent[] = []
    if (limit <= 0) { resolve(out); return }
    const req = os.openCursor(range, 'prev')
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => {
      const c = req.result
      if (!c) { resolve(out); return }
      const row = c.value as EventRow
      if (alive(row, seconds)) out.push(eventOf(row))
      if (out.length >= limit) { resolve(out); return }
      c.continue()
    }
  })
}

/** One author's events of one kind, newest first. */
export function byAuthorKind(db: IDBDatabase, pubkey: string, kind: number, limit = READ_LIMIT_DEFAULT, now = Date.now()): Promise<NostrEvent[]> {
  return newestFrom(db, 'byAuthorKind', IDBKeyRange.bound([pubkey, kind, -Infinity], [pubkey, kind, Infinity]), limit, now)
}

/**
 * The newest second a read of everyone's events looks at. A movement action may
 * claim any time (a chain has its own clock), so one dated far ahead by a
 * throwaway key would otherwise sit on top of every limited read forever.
 */
const readCeiling = (now: number): number => Math.floor(now / 1000) + FUTURE_SLACK_S

/** Everyone's events of one kind, newest first, none dated past the ceiling. */
export function byKind(db: IDBDatabase, kind: number, limit = READ_LIMIT_DEFAULT, now = Date.now()): Promise<NostrEvent[]> {
  return newestFrom(db, 'byKind', IDBKeyRange.bound([kind, -Infinity], [kind, readCeiling(now)]), limit, now)
}

/** The events carrying one tag value (`letter:value`, TAG_INDEX), newest first, none dated past the ceiling. */
export function byTag(db: IDBDatabase, tag: string, limit = READ_LIMIT_DEFAULT, now = Date.now()): Promise<NostrEvent[]> {
  return newestFrom(db, 'byTag', IDBKeyRange.bound([tag, -Infinity], [tag, readCeiling(now)]), limit, now)
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
