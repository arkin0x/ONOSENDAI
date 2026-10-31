/**
 * chainStore.ts - the page's side of the chain's rows: what has committed,
 * what is on its way, and what a tab does when a write cannot land.
 *
 * Writes go one at a time per identity, newest wins: a save names the whole
 * chain as the store holds it, and what is sent is only what differs from what
 * has committed, usually one row. There is no pause, because there is nothing
 * to save up: a row costs a few kilobytes off the main thread.
 *
 * The publisher waits for an action to land before it sends it (chainLanded).
 * That is the moment a loser of a race between two tabs is found: its action
 * has never left this device, and the store takes it back (onChainLost).
 *
 * Nothing here can cost the chain in memory. A commit that fails leaves the
 * chain in hand where it is, and what has not landed is kept in a small
 * localStorage key, the actions not yet in the rows and nothing else, until a
 * later commit takes them: a full disk, a private window that refuses
 * IndexedDB, a page closed with a write on its way. That key is not a copy of
 * the chain. It holds what no other store has, and only while that is so.
 */

import { TAB_ID, callEventDb, eventDbAvailable } from './eventDb/client'
import type { ChainCommit, ChainRead, ChainRecord, ChainSource, MigrationResult } from './eventDb/chainRows'
import type { Nip01Flag } from './eventDb/schema'
import { CHAIN_STORE_VERSION } from './chainStoreVersion'
import type { NostrEvent } from './events'

/** The patience of a read: the same 3 s the old store's reads have (lib/chainDb.ts). */
let readPatienceMs = 3_000
/** How long the publisher waits for an action to land before it goes on without knowing. */
let landPatienceMs = 3_000
/** How often a write that was refused is tried again while nothing else asks. */
let retryMs = 30_000
/** The worker's patience for a migration, which is a once-per-identity copy of the whole chain. */
const MIGRATE_PATIENCE_MS = 120_000

const markerKey = (pubkey: string): string => `onosendai:chain-rows:${pubkey}`
const tailKey = (pubkey: string): string => `onosendai:chain-unsaved:${pubkey}`

/** Whether this build keeps chains in rows, and this browser can try. */
export function rowsWanted(): boolean {
  return CHAIN_STORE_VERSION === 2 && eventDbAvailable()
}

/**
 * Whether this device has moved `pubkey`'s chain to rows: readable at once,
 * which is what lets a load skip the frozen copy. Its value is the old stores'
 * mark as of then, so a tab of an older build writing them later can be told.
 */
export function rowsMarked(pubkey: string): boolean {
  try { return localStorage.getItem(markerKey(pubkey)) !== null } catch { return false }
}

export function markerValue(pubkey: string): string | null {
  try { return localStorage.getItem(markerKey(pubkey)) } catch { return null }
}

export function setMarker(pubkey: string, legacyMark: string | null): void {
  try { localStorage.setItem(markerKey(pubkey), legacyMark ?? '') } catch { /* private mode: the load reads the rows after the old copy, as a first load does */ }
}

/** What a read found. As with lib/chainDb.ts: `unreadable` and `timeout` are never "none". */
export type RowsRead = ChainRead | null | 'unreadable' | 'timeout'

/** The chain kept in rows for `pubkey`, in at most the read's patience; `onLate` is handed the real answer when that ran out. */
export function readRows(pubkey: string, onLate?: (late: ChainRead | null | 'unreadable') => void): Promise<RowsRead> {
  const read: Promise<ChainRead | null | 'unreadable'> = rowsSettled(pubkey)
    .then(() => callEventDb('readChain', [pubkey], 30_000))
    .catch(() => 'unreadable' as const)
  return new Promise<RowsRead>((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; resolve('timeout') }, readPatienceMs)
    void read.then((r) => {
      if (timedOut) { onLate?.(r); return }
      clearTimeout(timer)
      resolve(r)
    })
  })
}

/** The record alone, or 'unreadable'. Waits for this tab's own writes first, so what it says is about other tabs. */
export async function rowsHead(pubkey: string): Promise<ChainRecord | null | 'unreadable'> {
  try {
    await rowsSettled(pubkey)
    return await callEventDb('chainHead', [pubkey])
  } catch { return 'unreadable' }
}

/** Copy, read back, compare, switch (lib/eventDb/chainRows.ts). Never rejects: 'failed' leaves the old copies in charge. */
export async function migrateToRows(pubkey: string, source: ChainSource, parted: ChainSource[], from: string[]): Promise<MigrationResult | { status: 'failed'; reason: string }> {
  try {
    return await callEventDb('migrateChain', [TAB_ID, { pubkey, source, parted, from }], MIGRATE_PATIENCE_MS)
  } catch (err) {
    return { status: 'failed', reason: (err as { name?: string }).name ?? 'Error' }
  }
}

/** How long the worker gets to check a chain's rows: the first time it may check every signature of a long chain. */
const CHECK_PATIENCE_MS = 180_000

/** Check the chain's rows (lib/eventDb/chainRows.ts checkChainRows). Rejects when the database will not do it, and the caller checks by other means. */
export async function checkRows(pubkey: string): Promise<string[]> {
  await rowsSettled(pubkey)
  return (await callEventDb('checkChainRows', [pubkey], CHECK_PATIENCE_MS)).bad
}

/** Set a branch aside. A failure is said, and the branch's old copy (if any) stands. */
export async function setAsideRows(pubkey: string, branch: ChainSource): Promise<void> {
  try { await callEventDb('setAsideBranch', [pubkey, branch]) } catch (err) { console.warn('[chain] a branch could not be set aside', err) }
}

/** The branches set aside in rows for `pubkey`, oldest first. */
export async function rowsSetAside(pubkey: string): Promise<ChainSource[]> {
  await rowsSettled(pubkey)
  return callEventDb('partedBranches', [pubkey])
}

/** One save, as the store holds the chain. */
export interface ChainWant {
  events: NostrEvent[]
  isPublished: (id: string) => boolean
  nip01Of: (e: NostrEvent) => Nip01Flag
  held: boolean
  stats: Record<string, unknown>
  savedAt: number
}

interface Track {
  /** The ids by place, as last committed or read. */
  committed: string[]
  committedIds: Set<string>
  acked: Set<string>
  wanted: ChainWant | null
  running: Promise<void> | null
  /** The newest want handed to a commit in flight or waiting: what has not landed yet. */
  latest: ChainWant | null
  landers: Map<string, Array<(landed: boolean) => void>>
  retry: ReturnType<typeof setTimeout> | null
  refusedSaid: boolean
}

const tracks = new Map<string, Track>()

function trackOf(pubkey: string): Track {
  let t = tracks.get(pubkey)
  if (!t) {
    t = { committed: [], committedIds: new Set(), acked: new Set(), wanted: null, running: null, latest: null, landers: new Map(), retry: null, refusedSaid: false }
    tracks.set(pubkey, t)
  }
  return t
}

/** Whether this tab writes `pubkey`'s chain to rows: a read of them, or a switch, has been taken in. */
export function inRows(pubkey: string): boolean {
  return tracks.has(pubkey)
}

/** The rows say this: what this tab now takes as committed, whatever it thought before. */
export function noteCommitted(pubkey: string, ids: string[], published: string[]): void {
  const t = trackOf(pubkey)
  t.committed = ids
  t.committedIds = new Set(ids)
  t.acked = new Set(published)
}

/** The head this tab last committed or read, or null. */
export function committedHead(pubkey: string): { headId: string | null; length: number } {
  const t = tracks.get(pubkey)
  return { headId: t?.committed[t.committed.length - 1] ?? null, length: t?.committed.length ?? 0 }
}

/** What the store does when a commit lost to another tab. Installed by the store. */
let lostHandler: ((pubkey: string) => void) | null = null
export function onChainLost(handler: (pubkey: string) => void): void { lostHandler = handler }

/** What the store does when a write was refused: once per identity per page, until one lands. */
let refusedHandler: ((pubkey: string, quota: boolean) => void) | null = null
export function onChainRefused(handler: (pubkey: string, quota: boolean) => void): void { refusedHandler = handler }

/** What differs from what has committed. */
export function commitFor(pubkey: string, t: Pick<Track, 'committed' | 'acked'>, w: ChainWant): ChainCommit {
  let keep = 0
  const n = Math.min(t.committed.length, w.events.length)
  while (keep < n && t.committed[keep] === w.events[keep].id) keep++
  const acks: string[] = []
  for (let i = 0; i < keep; i++) {
    const id = w.events[i].id
    if (w.isPublished(id) && !t.acked.has(id)) acks.push(id)
  }
  return {
    pubkey,
    expectHead: t.committed[t.committed.length - 1] ?? null,
    keep,
    rows: w.events.slice(keep).map((event) => ({ event, nip01: w.nip01Of(event), acked: w.isPublished(event.id) })),
    acks,
    length: w.events.length,
    headId: w.events[w.events.length - 1].id,
    spawnId: w.events[0].id,
    savedAt: w.savedAt,
    held: w.held,
    stats: w.stats,
  }
}

function settleLanders(t: Track, answer: (id: string) => boolean | null): void {
  for (const [id, waiting] of t.landers) {
    const a = answer(id)
    if (a === null) continue
    t.landers.delete(id)
    for (const resolve of waiting) resolve(a)
  }
}

async function run(pubkey: string, t: Track): Promise<void> {
  while (t.wanted) {
    const w = t.wanted
    t.wanted = null
    const commit = commitFor(pubkey, t, w)
    try {
      const result = await callEventDb('commitChain', [TAB_ID, commit])
      if (result.status === 'lost') {
        // Nothing of this landed, and what waits behind it extends the same
        // lost head. The store reads what did land and takes it from there.
        t.wanted = null
        t.latest = null
        const inThis = new Set(w.events.map((e) => e.id))
        settleLanders(t, (id) => (inThis.has(id) && !t.committedIds.has(id) ? false : null))
        lostHandler?.(pubkey)
        return
      }
      t.committed = w.events.map((e) => e.id)
      t.committedIds = new Set(t.committed)
      for (const r of commit.rows) if (r.acked) t.acked.add(r.event.id)
      for (const id of commit.acks) t.acked.add(id)
      t.refusedSaid = false
      if (t.retry) { clearTimeout(t.retry); t.retry = null }
      clearTail(pubkey)
      settleLanders(t, (id) => (t.committedIds.has(id) ? true : null))
    } catch (err) {
      // A full disk, or a database that will not answer. The chain in hand is
      // untouched. An action that cannot be saved may still go to the relays,
      // and there it is safe, so nothing waits on this.
      const name = (err as { name?: string }).name
      console.warn(`[chain] a save could not be written (${name ?? 'error'}): the chain stays in this tab, and it is tried again`)
      const notCommitted = (t.wanted ?? w).events.filter((e) => !t.committedIds.has(e.id))
      writeTail(pubkey, notCommitted)
      settleLanders(t, () => true)
      if (!t.refusedSaid) { t.refusedSaid = true; refusedHandler?.(pubkey, name === 'QuotaExceededError') }
      // What waits is newer, and carries everything this one did: the next
      // try is the newest, a while from now. Not at once: a full disk stays full.
      const again = t.wanted ?? w
      t.wanted = null
      if (!t.retry) t.retry = setTimeout(() => { t.retry = null; saveRows(pubkey, t.latest ?? again) }, retryMs)
      return
    }
  }
  t.latest = null
}

/** Keep the chain as `w` says, in rows. Returns at once. */
export function saveRows(pubkey: string, w: ChainWant): void {
  if (w.events.length === 0) return
  const t = trackOf(pubkey)
  t.wanted = w
  t.latest = w
  if (t.running) return
  const running = run(pubkey, t).finally(() => { if (t.running === running) t.running = null; if (t.wanted) saveRows(pubkey, t.wanted) })
  t.running = running
}

/** Resolves once every write asked for `pubkey` so far has been answered. */
export async function rowsSettled(pubkey: string): Promise<void> {
  const t = tracks.get(pubkey)
  while (t?.running) await t.running
}

/**
 * Whether the publisher may send this action. True once it has landed, or
 * when landing cannot be known (no rows here, a refused write, a database that
 * has not answered in time: the relays are then the safer place for it). False
 * only when another tab's commit won, and the action must never leave this device.
 */
export function chainLanded(pubkey: string, id: string): Promise<boolean> {
  const t = tracks.get(pubkey)
  if (!t || t.committedIds.has(id) || !t.running) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const waiting = t.landers.get(id)
      if (waiting) { t.landers.set(id, waiting.filter((r) => r !== settle)); if (t.landers.get(id)?.length === 0) t.landers.delete(id) }
      console.warn('[chain] an action did not land in time: sending it anyway, as it was before rows')
      resolve(true)
    }, landPatienceMs)
    const settle = (landed: boolean): void => { clearTimeout(timer); resolve(landed) }
    t.landers.set(id, [...(t.landers.get(id) ?? []), settle])
  })
}

/** Actions no store has yet, in one small key, while that is so. */
export function writeTail(pubkey: string, events: NostrEvent[]): void {
  try {
    if (events.length === 0) localStorage.removeItem(tailKey(pubkey))
    else localStorage.setItem(tailKey(pubkey), JSON.stringify(events))
  } catch { /* localStorage is full too: the chain stays in this tab, and the toast has said so */ }
}

export function clearTail(pubkey: string): void {
  try { localStorage.removeItem(tailKey(pubkey)) } catch { /* private mode */ }
}

export function readTail(pubkey: string): NostrEvent[] {
  try {
    const raw = localStorage.getItem(tailKey(pubkey))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as NostrEvent[] : []
  } catch { return [] }
}

/**
 * The page is being hidden or left, and a worker's write may not outlive it:
 * what has not landed goes where a write is done before this returns. A commit
 * that does land makes the key redundant, and the next load clears it.
 */
export function flushRowsToTail(): void {
  for (const [pubkey, t] of tracks) {
    const w = t.latest ?? t.wanted
    if (!w) continue
    const notCommitted = w.events.filter((e) => !t.committedIds.has(e.id))
    if (notCommitted.length > 0) writeTail(pubkey, notCommitted)
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushRowsToTail)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushRowsToTail() })
}

/** For tests: wait for every queued write. */
export async function chainRowsSettled(): Promise<void> {
  for (const pubkey of [...tracks.keys()]) await rowsSettled(pubkey)
}

/** For tests. */
export function setRowsPatience(p: { read?: number; land?: number; retry?: number }): void {
  if (p.read !== undefined) readPatienceMs = p.read
  if (p.land !== undefined) landPatienceMs = p.land
  if (p.retry !== undefined) retryMs = p.retry
}
