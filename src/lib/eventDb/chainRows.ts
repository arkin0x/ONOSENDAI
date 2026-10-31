/**
 * chainRows.ts - an identity's chain as rows: one row per action, plus one
 * small record that names the head. Plain functions on an open database, so
 * the event worker and the fallback on the main thread run the same code.
 *
 * A move is one row and one small record in one transaction, whatever the
 * chain's length. A fold that drops actions takes their place in the chain
 * away and leaves the rows, signed facts nothing reads as part of the chain.
 *
 * Two tabs cannot fork here. A commit that changes the chain names the head it
 * extends, and IndexedDB runs read-write transactions on a store one at a
 * time, across tabs too. So of two moves signed from one head the first to
 * commit wins and the second is told `lost`, in the transaction that would
 * have written it, before anything is sent to a relay. There is no window
 * and no expiry: a reader only ever sees what has committed, whole.
 */

import { getEventHash, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import { request } from '../idb'
import type { NostrEvent } from '../events'
import { carried, countRow, inTransaction } from './store'
import { BUDGET_KEY, CHAINS, EMPTY_BUDGET, EVENTS, META, PARTED, eventOf, nip01Rank, rowOf, type BudgetTotals, type EventRow, type Nip01Flag } from './schema'

/** The small record of one identity's chain. */
export interface ChainRecord {
  pubkey: string
  own: boolean
  spawnId: string
  headId: string
  length: number
  /** Rises by one on every change of the chain's actions. */
  generation: number
  /** When the actions last changed (the #528 tiebreak): an acknowledgement keeps it. */
  savedAt: number
  held: boolean
  stats: Record<string, unknown>
}

/** One action as a commit or a copy hands it in. */
export interface ChainRowIn { event: NostrEvent; nip01: Nip01Flag; acked: boolean }

export interface ChainCommit {
  pubkey: string
  /** The head this tab believes it extends; null when it believes there is no chain yet. */
  expectHead: string | null
  /** The places below this are as they were. */
  keep: number
  /** The actions from place `keep` on, in order. */
  rows: ChainRowIn[]
  /** Actions below `keep` that a relay has taken since. */
  acks: string[]
  length: number
  headId: string
  spawnId: string
  savedAt: number
  held: boolean
  stats: Record<string, unknown>
}

export type ChainCommitResult =
  /** `repeated`: this exact commit had landed already (a worker given up on after it finished, a retry). */
  | { status: 'ok'; changed: boolean; repeated: boolean; generation: number }
  /** Another tab's commit got there first. Nothing was written. */
  | { status: 'lost'; record: ChainRecord | null }

const placesFrom = (pubkey: string, n: number): IDBKeyRange => IDBKeyRange.bound([pubkey, n], [pubkey, Infinity])

/**
 * A row taking its place in a chain: the row that is here when there is one.
 * A flag always describes the bytes beside it. When the row's bytes differ from
 * the event handed in (damaged on disk, or nobody had checked them) the event
 * replaces them, unless the row says more about its bytes than the hand does.
 */
function placed(had: EventRow | undefined, r: ChainRowIn, pubkey: string, n: number | undefined, now: number): EventRow {
  const fresh = rowOf(r.event, { nip01: r.nip01, pin: true }, now)
  let row: EventRow
  if (!had) row = fresh
  else if (JSON.stringify(eventOf(had)) === JSON.stringify(eventOf(r.event as EventRow))) row = { ...had, nip01: nip01Rank(r.nip01) > nip01Rank(had.nip01) ? r.nip01 : had.nip01 }
  else if (nip01Rank(r.nip01) >= nip01Rank(had.nip01)) row = { ...fresh, ...carried(had), nip01: r.nip01 }
  else row = had
  row = { ...row, pin: 1 }
  if (r.acked) row.acked = 1
  if (n === undefined) { delete row.chainOf; delete row.chainN } else { row.chainOf = pubkey; row.chainN = n }
  return row
}

/** Keep the totals in step with a row that changed: its pin or its bytes. */
function budgetFor(row: EventRow | undefined, next: EventRow, totals: BudgetTotals): void {
  if (row && row.pin === next.pin && row.bytes === next.bytes) return
  if (row) countRow(totals, row, -1)
  countRow(totals, next, 1)
}

async function readBudget(meta: IDBObjectStore): Promise<BudgetTotals> {
  const stored = await request(meta.get(BUDGET_KEY)) as { value?: BudgetTotals } | undefined
  return { ...EMPTY_BUDGET, ...stored?.value }
}

/**
 * Commit a change of one identity's chain, whole or not at all. Strict: the
 * action may be sent to a relay as soon as this answers, so it must be on disk,
 * not only in the browser's cache, by then.
 */
export async function commitChain(db: IDBDatabase, c: ChainCommit, now = Date.now()): Promise<ChainCommitResult> {
  const tx = db.transaction([EVENTS, CHAINS, META], 'readwrite', { durability: 'strict' })
  return inTransaction<ChainCommitResult>(tx, async () => {
    const events = tx.objectStore(EVENTS)
    const chains = tx.objectStore(CHAINS)
    const meta = tx.objectStore(META)
    const record = await request(chains.get(c.pubkey)) as ChainRecord | undefined
    const at = record?.headId ?? null
    const wantsChange = c.rows.length > 0 || c.length !== (record?.length ?? 0)
    // A commit that already landed, asked again: the worker was given up on
    // after it finished, or a retry. Only the acknowledgements are left to do.
    const already = record !== undefined && at === c.headId && record.length === c.length
    if (wantsChange && at !== c.expectHead && !already) return { status: 'lost', record: record ?? null }
    const totals = await readBudget(meta)
    let changed = false
    if (wantsChange && !already) {
      const stay = new Set(c.rows.map((r) => r.event.id))
      if (record && c.keep < record.length) {
        const old = await request(events.index('byChain').getAll(placesFrom(c.pubkey, c.keep))) as EventRow[]
        for (const row of old) {
          if (stay.has(row.id)) continue
          const { chainOf: _o, chainN: _n, ...out } = row
          void _o; void _n
          events.put(out)
        }
      }
      for (let i = 0; i < c.rows.length; i++) {
        const had = await request(events.get(c.rows[i].event.id)) as EventRow | undefined
        const row = placed(had, c.rows[i], c.pubkey, c.keep + i, now)
        budgetFor(had, row, totals)
        events.put(row)
      }
      changed = true
    }
    for (const id of c.acks) {
      const row = await request(events.get(id)) as EventRow | undefined
      if (row && row.acked !== 1) events.put({ ...row, acked: 1 })
    }
    if (changed) meta.put({ key: BUDGET_KEY, value: totals })
    const generation = (record?.generation ?? 0) + (changed ? 1 : 0)
    // A commit with no change from a tab behind the head (its acknowledgement
    // arrived after another tab moved) leaves the record to the chain's own tab.
    if (changed || at === c.headId) {
      const next: ChainRecord = { pubkey: c.pubkey, own: true, spawnId: c.spawnId, headId: c.headId, length: c.length, generation, savedAt: c.savedAt, held: c.held, stats: c.stats }
      chains.put(next)
    }
    return { status: 'ok', changed, repeated: wantsChange && already, generation }
  })
}

/** The record alone: what a move compares before it signs, about a millisecond. */
export async function chainHead(db: IDBDatabase, pubkey: string): Promise<ChainRecord | null> {
  const os = db.transaction(CHAINS, 'readonly').objectStore(CHAINS)
  return (await request(os.get(pubkey)) as ChainRecord | undefined) ?? null
}

/** A chain as read back. */
export interface ChainRead {
  events: NostrEvent[]
  /** Ids a relay has taken. */
  published: string[]
  /** Ids whose NIP-01 check is on the row. */
  checked: string[]
  stats: Record<string, unknown>
  held: boolean
  savedAt: number
  generation: number
  headId: string
}

/** One identity's chain in order, or null when none is kept. Throws when the rows and the record disagree, which a commit cannot leave. */
export async function readChain(db: IDBDatabase, pubkey: string): Promise<ChainRead | null> {
  const tx = db.transaction([CHAINS, EVENTS], 'readonly')
  const record = await request(tx.objectStore(CHAINS).get(pubkey)) as ChainRecord | undefined
  if (!record) return null
  const rows = await request(tx.objectStore(EVENTS).index('byChain').getAll(placesFrom(pubkey, 0))) as EventRow[]
  if (rows.length !== record.length || rows[rows.length - 1]?.id !== record.headId) {
    throw new Error(`the rows of a chain do not match its record: ${rows.length} rows for ${record.length}`)
  }
  const published: string[] = []
  const checked: string[] = []
  for (const r of rows) {
    if (r.acked === 1) published.push(r.id)
    if (r.nip01 === 1) checked.push(r.id)
  }
  return { events: rows.map(eventOf), published, checked, stats: record.stats, held: record.held, savedAt: record.savedAt, generation: record.generation, headId: record.headId }
}

/** A branch of this device set aside: never written over, read by nothing that reads the chain. */
export interface PartedBranch { pubkey: string; at: number; headId: string; ids: string[]; published: string[]; stats: Record<string, unknown>; held: boolean; savedAt: number }

/** What a chain's old stores held. */
export interface ChainSource { events: NostrEvent[]; published: string[]; stats: Record<string, unknown>; held: boolean; savedAt: number }

const COPY_BATCH = 200

/** Copy rows outside any chain, in one transaction; false when the chain has been switched by another tab meanwhile. Safe to run twice. */
async function copyBatch(db: IDBDatabase, pubkey: string, rows: ChainRowIn[], now: number): Promise<boolean> {
  const tx = db.transaction([EVENTS, CHAINS, META], 'readwrite')
  return inTransaction(tx, async () => {
    const events = tx.objectStore(EVENTS)
    const meta = tx.objectStore(META)
    if (await request(tx.objectStore(CHAINS).get(pubkey))) return false
    const totals = await readBudget(meta)
    for (const r of rows) {
      const had = await request(events.get(r.event.id)) as EventRow | undefined
      // A row already placed by nothing yet: its flags are kept or raised, and it stays outside the chain.
      const row = placed(had, r, pubkey, undefined, now)
      budgetFor(had, row, totals)
      events.put(row)
    }
    meta.put({ key: BUDGET_KEY, value: totals })
    return true
  })
}

const asRows = (s: ChainSource): ChainRowIn[] => {
  const ok = new Set(s.published)
  return s.events.map((event) => ({ event, nip01: 0, acked: ok.has(event.id) }))
}

/** A row reads back exactly as the old store held it. */
const sameEvent = (row: EventRow, source: NostrEvent): boolean => JSON.stringify(eventOf(row)) === JSON.stringify(eventOf(source as EventRow))

export type MigrationResult =
  /** Copied, read back, compared, and the chain now reads from its rows. */
  | { status: 'switched'; rows: number; headId: string }
  /** Another tab switched this identity first. Nothing here was switched. */
  | { status: 'exists' }
  /** A row read back differently, or was missing. Nothing was switched, and the old copies stand. */
  | { status: 'unverified'; id: string }

class Unverified extends Error { constructor(readonly id: string) { super('a copied row does not read back as its source') } }

export interface ChainMigration {
  pubkey: string
  source: ChainSource
  /** Other copies that hold actions the source does not: kept as branches set aside. */
  parted: ChainSource[]
  /** What was migrated from, for the record in `meta`. */
  from: string[]
}

/**
 * Move an identity's chain into rows: copy, read back, compare, switch. The
 * copy lands outside any chain, in small transactions, so a crash or a full
 * disk leaves nothing the chain reads. The switch is one transaction: every
 * row read back and compared with its source, then given its place, then the
 * record that makes the chain readable from here, then the mark. A row that
 * reads back differently aborts all of it. The old stores are not touched,
 * here or later (the removal is a separate PR the owner merges).
 */
export async function migrateChain(db: IDBDatabase, m: ChainMigration, now = Date.now()): Promise<MigrationResult> {
  const { pubkey, source } = m
  const sourceRows = asRows(source)
  const copies = [...sourceRows, ...m.parted.flatMap(asRows)]
  for (let i = 0; i < copies.length; i += COPY_BATCH) {
    if (!await copyBatch(db, pubkey, copies.slice(i, i + COPY_BATCH), now)) return { status: 'exists' }
  }
  const tx = db.transaction([EVENTS, CHAINS, PARTED, META], 'readwrite')
  try {
    return await inTransaction<MigrationResult>(tx, async () => {
      const chains = tx.objectStore(CHAINS)
      const events = tx.objectStore(EVENTS)
      if (await request(chains.get(pubkey))) return { status: 'exists' }
      for (let n = 0; n < source.events.length; n++) {
        const e = source.events[n]
        const row = await request(events.get(e.id)) as EventRow | undefined
        if (!row || !sameEvent(row, e)) throw new Unverified(e.id)
        events.put({ ...row, chainOf: pubkey, chainN: n })
      }
      for (let i = 0; i < m.parted.length; i++) {
        const p = m.parted[i]
        const at = (p.savedAt || now) + i
        tx.objectStore(PARTED).put({ pubkey, at, headId: p.events[p.events.length - 1]?.id ?? '', ids: p.events.map((e) => e.id), published: p.published, stats: p.stats, held: p.held, savedAt: p.savedAt } satisfies PartedBranch)
      }
      const headId = source.events[source.events.length - 1].id
      const record: ChainRecord = { pubkey, own: true, spawnId: source.events[0].id, headId, length: source.events.length, generation: 1, savedAt: source.savedAt, held: source.held, stats: source.stats }
      chains.put(record)
      tx.objectStore(META).put({ key: `migrated:chain:${pubkey}`, value: { at: now, rows: source.events.length, headId, from: m.from, parted: m.parted.length } })
      return { status: 'switched', rows: source.events.length, headId }
    })
  } catch (err) {
    if (err instanceof Unverified) return { status: 'unverified', id: err.id }
    throw err
  }
}

/** Keep a branch beside the chain, rows and all, under a key no save touches. */
export async function setAsideBranch(db: IDBDatabase, pubkey: string, branch: ChainSource, now = Date.now()): Promise<number> {
  const tx = db.transaction([EVENTS, PARTED, META], 'readwrite')
  return inTransaction(tx, async () => {
    const events = tx.objectStore(EVENTS)
    const meta = tx.objectStore(META)
    const totals = await readBudget(meta)
    for (const r of asRows(branch)) {
      const had = await request(events.get(r.event.id)) as EventRow | undefined
      // A row of the chain keeps its place: this only ever adds, and pins.
      const row = had ? { ...had, pin: 1 as const } : placed(undefined, r, pubkey, undefined, now)
      if (!had || had.pin !== 1) { budgetFor(had, row, totals); events.put(row) }
    }
    meta.put({ key: BUDGET_KEY, value: totals })
    tx.objectStore(PARTED).put({ pubkey, at: now, headId: branch.events[branch.events.length - 1]?.id ?? '', ids: branch.events.map((e) => e.id), published: branch.published, stats: branch.stats, held: branch.held, savedAt: branch.savedAt } satisfies PartedBranch)
    return now
  })
}

/** The branches set aside for `pubkey`, oldest first. */
export async function partedBranches(db: IDBDatabase, pubkey: string): Promise<ChainSource[]> {
  const tx = db.transaction([EVENTS, PARTED], 'readonly')
  const branches = await request(tx.objectStore(PARTED).getAll(IDBKeyRange.bound([pubkey, -Infinity, ''], [pubkey, Infinity, '\uffff']))) as PartedBranch[]
  const events = tx.objectStore(EVENTS)
  const out: ChainSource[] = []
  for (const b of branches) {
    const rows = await Promise.all(b.ids.map((id) => request(events.get(id)) as Promise<EventRow | undefined>))
    out.push({ events: rows.filter((r): r is EventRow => r !== undefined).map(eventOf), published: b.published, stats: b.stats, held: b.held, savedAt: b.savedAt })
  }
  return out
}

/** How many rows' flags go down in one transaction. */
const FLAG_BATCH = 100

/** What a check of a chain's rows found. */
export interface ChainCheck {
  /** The ids that failed. Their flags are not raised, and the store cuts the chain at the first. */
  bad: string[]
  /** Rows whose signature was checked here, now flagged: once per row, ever. */
  signed: number
  /** Rows whose flag was trusted: only their id was recomputed. */
  rehashed: number
}

/**
 * The trust boundary of the NIP-01 flag (onosendai/event-db-design.md, 3.4). A
 * row flagged 1 had its signature checked, and that Schnorr check is never run
 * again. Its id is still recomputed on every load, because that costs
 * microseconds and catches a damaged row: the id commits to every field. A row
 * flagged 0 (moved from the old stores, or signed elsewhere and not checked
 * yet) is checked in full here, once, and flagged. What a flag cannot catch is
 * someone rewriting this origin's storage on purpose; such a party already
 * holds the key in localStorage.
 */
export async function checkChainRows(db: IDBDatabase, pubkey: string): Promise<ChainCheck> {
  const os = db.transaction(EVENTS, 'readonly').objectStore(EVENTS)
  const rows = await request(os.index('byChain').getAll(placesFrom(pubkey, 0))) as EventRow[]
  const result: ChainCheck = { bad: [], signed: 0, rehashed: 0 }
  let flips: string[] = []
  const flush = async (): Promise<void> => {
    if (flips.length === 0) return
    const ids = flips
    flips = []
    const tx = db.transaction(EVENTS, 'readwrite')
    await inTransaction(tx, async () => {
      const events = tx.objectStore(EVENTS)
      for (const id of ids) {
        const row = await request(events.get(id)) as EventRow | undefined
        if (row && row.nip01 === 0) events.put({ ...row, nip01: 1 })
      }
    })
  }
  for (const row of rows) {
    const event = eventOf(row)
    if (row.nip01 === 0) {
      if (verifyEvent(event as VerifiedEvent)) { result.signed++; flips.push(row.id) } else result.bad.push(row.id)
      if (flips.length >= FLAG_BATCH) await flush()
    } else {
      result.rehashed++
      if (getEventHash(event) !== row.id) result.bad.push(row.id)
    }
  }
  await flush()
  return result
}
