/**
 * closedDoors.ts: the doors this identity closed with CLOSE, on this device
 * (arkinox, 2026-11-01).
 *
 * A record per door, per identity, kept beside the door secrets in the hidden
 * store (store/hiddenStorage.ts, IndexedDB `onosendai:hidden`, one record each, so
 * two tabs never overwrite each other and another tab hears of a change), with a
 * copy in localStorage (CLOSED_KEY), merged before each write, which is the store
 * itself in local mode. Never dropped by a cap: a dropped close would open a door
 * nobody tapped.
 *
 * Each record says the door's lock (a new lock is a new door), its room (store/rooms
 * roomKeyOf: one room, one state, §3.7.5, so a door of a closed room that arrives
 * later is closed too), whether it is closed now (`shut`), and whether the doors
 * inside its room are still to be closed as they arrive (`below`, §3.7.6), which
 * outlives OPEN until its room has come back once.
 *
 * Reads are synchronous, from memory. A write is in memory at once and on disk
 * behind it; one that does not reach disk says so in a toast, and holds until reload.
 */

import type { ClosedRecord } from '../lib/hiddenDb'
import type { Hidden } from '../lib/hidden'
import { doorHeightOf } from '../lib/looks'
import { roomKeyOf } from '../lib/doors'
import { doorSecret } from './doorSecrets'
import { openedByHand } from './useOpenedChests'
import { CLOSED_KEY, closedFromLocalStorage, closedOf, dropClosed, hiddenDecided, putClosed, refreshClosed, storageMode } from './hiddenStorage'
import { useToast } from './useToast'

export type { ClosedRecord } from '../lib/hiddenDb'

/** What this session wrote and the store has not confirmed: read before the store. `null` is taken off. */
const unconfirmed = new Map<string, ClosedRecord | null>()
const keyOf = (owner: string, doorId: string): string => `${owner}\0${doorId}`

/** localStorage's records, read once, and again after a write or another tab's (storage event). */
let local: Record<string, Record<string, ClosedRecord>> | null = null

function localRecords(): Record<string, Record<string, ClosedRecord>> {
  if (local) return local
  local = {}
  for (const r of closedFromLocalStorage()) (local[r.owner] ??= {})[r.doorId] = r
  return local
}

/** The store's records for an identity: the database's in IndexedDB mode, else localStorage's. */
function stored(owner: string): Readonly<Record<string, ClosedRecord>> {
  return storageMode() === 'indexeddb' ? closedOf(owner) : localRecords()[owner] ?? {}
}

/** Every record of this identity, this session's writes over the store's. */
function recordsOf(owner: string): ClosedRecord[] {
  const out = new Map(Object.entries(stored(owner)))
  for (const [k, rec] of unconfirmed) {
    const [o, doorId] = k.split('\0')
    if (o !== owner) continue
    if (rec) out.set(doorId, rec)
    else out.delete(doorId)
  }
  return [...out.values()]
}

export function closedRecord(owner: string, doorId: string): ClosedRecord | undefined {
  const k = keyOf(owner, doorId)
  if (unconfirmed.has(k)) return unconfirmed.get(k) ?? undefined
  return stored(owner)[doorId]
}

/** Whether this identity closed this door with CLOSE, under this lock; without a lock, under any. */
export function closedByMe(owner: string, doorId: string, lock?: string): boolean {
  const r = closedRecord(owner, doorId)
  return !!r?.shut && (lock === undefined || r.lock === lock)
}

/** The door ids this identity has closed now, under any lock. */
export function closedDoorIds(owner: string): Set<string> {
  return new Set(recordsOf(owner).filter((r) => r.shut).map((r) => r.doorId))
}

/** Whether any door of this room is closed by this identity (§3.7.5: one room, one state). */
export function roomShut(owner: string, room: string | null): boolean {
  return !!room && recordsOf(owner).some((r) => r.shut && r.room === room)
}

/** Whether the doors inside this room are still to be closed as they arrive (§3.7.6). */
export function belowPending(owner: string, room: string | null): boolean {
  return !!room && recordsOf(owner).some((r) => r.below && r.room === room)
}

/** The records of this room, closed or not. */
export function recordsOfRoom(owner: string, room: string): ClosedRecord[] {
  return recordsOf(owner).filter((r) => r.room === room)
}

/** The copy in localStorage, these records changed, read fresh first so another tab's changes stay. */
function writeLocal(changes: ReadonlyArray<[string, string, ClosedRecord | null]>): boolean {
  local = null
  const all = localRecords()
  for (const [owner, doorId, rec] of changes) {
    const mine = (all[owner] ??= {})
    if (rec) mine[doorId] = rec
    else delete mine[doorId]
  }
  const out: Record<string, Record<string, Omit<ClosedRecord, 'owner' | 'doorId'>>> = {}
  for (const [o, doors] of Object.entries(all)) {
    out[o] = {}
    for (const [id, r] of Object.entries(doors)) out[o][id] = { lock: r.lock, room: r.room, ...(r.shut ? { shut: true as const } : {}), ...(r.below ? { below: true as const } : {}) }
  }
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(out)); return true } catch { local = null; return false }
}

const NOT_KEPT = 'This device could not save that the door is closed. It stays closed only until you reload.'

/**
 * Write these records (a record with neither `shut` nor `below` is taken off): in
 * memory at once, then on disk. Resolves false, and says so in a toast, when the store
 * did not keep a close; what is in memory holds for the session either way.
 */
export async function writeClosed(recs: ClosedRecord[]): Promise<boolean> {
  if (recs.length === 0) return true
  const keeps = recs.map((r) => [r, r.shut || r.below ? r : null] as const)
  for (const [r, keep] of keeps) unconfirmed.set(keyOf(r.owner, r.doorId), keep)
  await hiddenDecided()
  // Something newer for a door written meanwhile is written by its own call.
  const current = keeps.filter(([r, keep]) => unconfirmed.get(keyOf(r.owner, r.doorId)) === keep)
  const copied = writeLocal(current.map(([r, keep]) => [r.owner, r.doorId, keep]))
  const results = await Promise.all(current.map(async ([r, keep]) => {
    const k = keyOf(r.owner, r.doorId)
    const ok = storageMode() === 'indexeddb' ? await (keep ? putClosed(keep) : dropClosed(r.owner, r.doorId)) : copied
    if (ok && unconfirmed.get(k) === keep) unconfirmed.delete(k)
    // Only a close lost matters: an OPEN not kept closes the door again after a reload, which
    // opens nothing. A close the database missed but the copy kept joins it at the next load.
    return ok || copied || !keep?.shut
  }))
  const ok = results.every(Boolean)
  if (!ok) useToast.getState().show({ label: 'CLOSE NOT SAVED', meta: NOT_KEPT, mark: 'build' })
  return ok
}

/**
 * Doors arriving, by a scan or with a room, that must not come in open: a door of a
 * room this identity closed (§3.7.5, one room, one state), or, with `below`, any door
 * at all, since the room they came in had been closed (§3.7.6) and every door inside it
 * starts closed until its own OPEN. Only a door that would otherwise be open here
 * (opened by hand, or its secret kept) needs a record. In memory at once, before
 * anything can open it (store/useShards addDiscovered, store/rooms fillRoom).
 */
export function closeArriving(owner: string, items: readonly Hidden[], how?: { below: true }): Promise<boolean> {
  const recs: ClosedRecord[] = []
  for (const h of items) {
    if (h.type !== 'chest' || !h.chest || h.chestId || typeof doorHeightOf(h.inner?.tags) !== 'number') continue
    const lock = h.chest.lockPubkey
    if (closedByMe(owner, h.eventId, lock)) continue
    const room = roomKeyOf(h)
    if (!how?.below && !roomShut(owner, room)) continue
    if (!openedByHand(owner, h.eventId, lock) && !doorSecret(owner, h.eventId)) continue
    recs.push({ owner, doorId: h.eventId, lock, room: room ?? '', shut: true, below: true })
  }
  return writeClosed(recs)
}

/** Read the store again, as another tab may have closed or opened a door since: before any decision to open one. */
export async function refreshClosedDoors(owner: string): Promise<void> {
  await hiddenDecided()
  if (storageMode() === 'indexeddb') await refreshClosed(owner)
  else local = null
}

/** Another tab wrote localStorage (local mode): read it again. */
export function reloadLocalClosed(): void { local = null }

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key === CLOSED_KEY) local = null })
}

/** For tests: this page's memory gone, as a reload leaves it. Nothing on disk is touched. */
export function resetClosedDoors(): void {
  unconfirmed.clear()
  local = null
}
