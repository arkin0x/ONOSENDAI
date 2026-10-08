/**
 * rosterCache.ts - the Avatars list kept on this device, so a reload paints
 * it at once and then only asks the relays for what is newer.
 *
 * What is kept is one snapshot: each listed pubkey's newest placing action,
 * as the signed event the relay sent (not the parsed row, so a later change
 * to how actions are read reaches the cached ones too), and, per relay, the
 * created_at its next catch-up starts from (store/useRoster.ts). At most
 * ROSTER_KEPT events of about a kilobyte each, so half a megabyte at the
 * outside: IndexedDB rather than localStorage, where the chains and the
 * profiles already spend most of the few megabytes there are.
 *
 * One record, written whole: the snapshot is small, a write is one put in
 * one transaction, and there are no rows to delete when a pubkey drops off
 * the end. Every call is wrapped: private mode, a blocked upgrade or a full
 * disk leaves the list working from the relays alone.
 */

import { META_STORE, getMeta, openDatabase, putMeta } from './idb'
import type { NostrEvent } from './events'

export const ROSTER_DB = 'onosendai:roster'
const DB_VERSION = 1
const SNAPSHOT_KEY = 'snapshot'
/** The snapshot's own version: a snapshot of another shape is not read. */
const SNAPSHOT_VERSION = 1

export interface RosterSnapshot {
  /** Each pubkey's newest placing action, as signed. */
  events: NostrEvent[]
  /** Per relay (normalized URL), the created_at its next catch-up asks from, inclusive. */
  cursors: Record<string, number>
}

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDatabase(ROSTER_DB, DB_VERSION, [[META_STORE, 'key']]).catch((err) => {
    dbPromise = null
    throw err
  })
  return dbPromise
}

/** The snapshot kept, or null when there is none or it cannot be read. */
export async function readRoster(): Promise<RosterSnapshot | null> {
  try {
    if (typeof indexedDB === 'undefined') return null
    const raw = (await getMeta(await db(), SNAPSHOT_KEY)) as { v?: number; events?: unknown; cursors?: unknown } | undefined
    if (!raw || raw.v !== SNAPSHOT_VERSION || !Array.isArray(raw.events)) return null
    const events = raw.events.filter((e): e is NostrEvent => !!e && typeof e === 'object' && typeof (e as NostrEvent).id === 'string' && typeof (e as NostrEvent).created_at === 'number')
    const cursors: Record<string, number> = {}
    if (raw.cursors && typeof raw.cursors === 'object') {
      for (const [url, at] of Object.entries(raw.cursors as Record<string, unknown>)) if (typeof at === 'number' && Number.isFinite(at)) cursors[url] = at
    }
    return { events, cursors }
  } catch {
    return null
  }
}

/** Keep this snapshot in place of the last one. Resolves false when it could not be written. */
export async function writeRoster(snapshot: RosterSnapshot): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false
    await putMeta(await db(), SNAPSHOT_KEY, { v: SNAPSHOT_VERSION, events: snapshot.events, cursors: snapshot.cursors })
    return true
  } catch {
    return false
  }
}

/** For tests: forget the open connection, as a reload does. */
export function closeRosterDb(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
}
