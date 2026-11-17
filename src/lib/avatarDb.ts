/**
 * avatarDb.ts - avatar events kept on this device, in IndexedDB, never in
 * localStorage (arkinox, 2026-11-17: "i dont want to use local storage if we
 * can avoid it, it fills up too fast"; an avatar may be 128 KB).
 *
 * Its own small database, as the sound mutes, the found bags and the shard
 * folders have, and not `onosendai:events`: that one is reached through the
 * event worker, kept off WebKit until its trial, and switchable off by the
 * deploy, all for the chain's sake; an avatar is wanted on every browser at
 * once, the first moment of a load, without waiting behind a chain's reads.
 *
 *   avatars  { pubkey, event, published, mine, at }   one row per pubkey
 *
 * One row per pubkey, the newest avatar event seen for it (lib/avatar
 * avatarReplaces: the later `created_at`, the lower id on a tie, NIP-01), so
 * an older copy never replaces a newer one here either, and superseded
 * versions take no room. `published` says a relay took it or answered with
 * it, which lets an avatar adopted while LOCAL still offer BROADCAST after a
 * reload. `mine` rows (an identity of this device) are never trimmed;
 * everyone else's are, the least recently seen first, past AVATARS_KEPT rows, and
 * one not seen for AVATARS_MAX_AGE_MS is not drawn from here.
 *
 * Everything here is best effort: no IndexedDB, or a failure, reads as
 * nothing kept and writes nothing.
 */

import { AVATAR_KIND, avatarReplaces } from './avatar'
import type { NostrEvent } from './events'
import { openDatabase, request } from './idb'

export const AVATAR_DB = 'onosendai:avatars'
const DB_VERSION = 1
const AVATARS = 'avatars'
const BY_AT = 'byAt'
const OPEN_TIMEOUT_MS = 8000

/** The most rows kept, up to 128 KB each. Past it, everyone else's are trimmed; your own never are. */
export const AVATARS_KEPT = 200
/** What a trim brings the rows down to. */
export const AVATARS_TRIM_TO = 175
/** A row seen this recently is not rewritten only to say it was seen again. */
const SEEN_FRESH_MS = 60 * 60 * 1000
/** Someone else's avatar not seen for this long is not drawn from the device. */
export const AVATARS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface AvatarRow { pubkey: string; event: NostrEvent; published: boolean; mine: boolean; at: number }

/** An avatar event kept here, and whether a relay is known to have it. */
export interface KeptAvatarEvent { event: NostrEvent; published: boolean }

let dbPromise: Promise<IDBDatabase> | null = null

function openAvatarDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = openDatabase(AVATAR_DB, DB_VERSION, [[AVATARS, 'pubkey', [{ name: BY_AT, keyPath: 'at' }]]])
    // As the sound mutes do: a blocked upgrade or a browser that never
    // answers must not hold the avatars, and a connection that arrives late is closed.
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, OPEN_TIMEOUT_MS)
    })
    opening.then((db) => {
      if (timedOut) { db.close(); return }
      db.onversionchange = () => { db.close(); if (dbPromise === raced) dbPromise = null }
      db.onclose = () => { if (dbPromise === raced) dbPromise = null }
    }, () => { /* the race reports it */ })
    const raced = Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
    raced.catch(() => { if (dbPromise === raced) dbPromise = null })
    dbPromise = raced
  }
  return dbPromise
}

/** For tests: forget the open connection, as a reload does. */
export function closeAvatarDb(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
}

const available = (): boolean => typeof indexedDB !== 'undefined'

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** A full disk stays full: not worth a second connection. */
const isQuotaError = (err: unknown): boolean => {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

/**
 * `run` on the open database; on a failure other than a full disk, once more
 * on a fresh connection: a browser can drop the one in hand without saying so
 * (Safari's "Connection to Indexed Database server lost"), as eventDb/connection.ts has it.
 */
async function withAvatarDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const first = openAvatarDb()
  try {
    return await run(await first)
  } catch (err) {
    if (isQuotaError(err)) throw err
    if (dbPromise === first) dbPromise = null
    return run(await openAvatarDb())
  }
}

/** Keep each event in one transaction, newest wins per pubkey; the same event again only raises `published` and `mine`. */
async function putAll(db: IDBDatabase, items: Array<{ event: NostrEvent; mine: boolean; published: boolean }>, now: number): Promise<void> {
  const tx = db.transaction(AVATARS, 'readwrite')
  const os = tx.objectStore(AVATARS)
  const finished = done(tx)
  // A request failing below rejects this too, before anyone awaits it.
  finished.catch(() => {})
  let added = false
  for (const { event, mine, published } of items) {
    const had = await request(os.get(event.pubkey)) as AvatarRow | undefined
    if (had && (had.event.id === event.id || avatarReplaces(had.event, event))) {
      // Kept already, or older than what is kept: the row stays, its flags
      // only rise, and it is marked seen, but not rewritten (up to 128 KB)
      // for a time that is fresh enough.
      const same = had.event.id === event.id
      const next: AvatarRow = { ...had, published: had.published || (same && published), mine: had.mine || mine, at: now }
      if (next.published !== had.published || next.mine !== had.mine || !(now - had.at < SEEN_FRESH_MS)) os.put(next)
    } else {
      os.put({ pubkey: event.pubkey, event, published, mine: mine || !!had?.mine, at: now } satisfies AvatarRow)
      if (!had) added = true
    }
  }
  // Past AVATARS_KEPT rows, everyone else's go, the least recently seen
  // first, down to AVATARS_TRIM_TO, so a full store is not trimmed on every
  // write. Counted first: nothing is read to find there is nothing to do.
  if (added) {
    let over = (await request(os.count())) - AVATARS_TRIM_TO
    if (over > AVATARS_KEPT - AVATARS_TRIM_TO) {
      await new Promise<void>((resolve, reject) => {
        const walk = os.index(BY_AT).openCursor()
        walk.onerror = () => reject(walk.error ?? new Error('IndexedDB read failed'))
        walk.onsuccess = () => {
          const c = walk.result
          if (!c || over <= 0) { resolve(); return }
          if (!(c.value as AvatarRow).mine) { c.delete(); over -= 1 }
          c.continue()
        }
      })
    }
  }
  await finished
}

/** Keep `event` as its author's avatar when it is the newest kept for them. `mine`: an identity of this device, never trimmed. */
export async function keepAvatarEvent(event: NostrEvent, opts: { mine: boolean; published: boolean }, now = Date.now()): Promise<void> {
  if (!available() || event.kind !== AVATAR_KIND) return
  try {
    await migrateAvatarStorage()
    await withAvatarDb((db) => putAll(db, [{ event, ...opts }], now))
  } catch { /* a full disk or no database: drawn all the same */ }
}

/** The newest avatar event this device keeps for `pubkey`, or null. */
export async function readKeptAvatar(pubkey: string, now = Date.now()): Promise<KeptAvatarEvent | null> {
  if (!available()) return null
  try {
    // What localStorage held is read too, once it has moved in.
    await migrateAvatarStorage()
    const row = await withAvatarDb((db) => request(db.transaction(AVATARS, 'readonly').objectStore(AVATARS).get(pubkey)) as Promise<AvatarRow | undefined>)
    if (!row || row.event?.pubkey !== pubkey || row.event.kind !== AVATAR_KIND) return null
    if (!row.mine && !(now - row.at <= AVATARS_MAX_AGE_MS)) return null
    return { event: row.event, published: row.published }
  } catch { return null }
}

/** Where avatars were kept in localStorage before: your own (`{ pubkey, payload, event, published }`), and everyone else's. */
export const LEGACY_MINE_KEY = 'onosendai:avatar'
export const LEGACY_OTHERS_KEY = 'onosendai:avatars'

let migrating: Promise<void> | null = null

/**
 * Once per page: move the avatars localStorage held into this database, then
 * clear those keys. A key is cleared only after what it holds is in, so a
 * failure leaves it to be moved on the next load: an avatar adopted while
 * LOCAL may exist nowhere else. A copy kept before the event was (a payload
 * only) is moved nowhere; it was published as it was adopted, so the relays
 * have it, and it is cleared unless it says otherwise.
 */
export function migrateAvatarStorage(): Promise<void> {
  migrating ??= (async () => {
    try { if (!available() || typeof localStorage === 'undefined') return } catch { return }
    const read = (key: string): unknown => {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
    }
    const isAvatar = (e: unknown): e is NostrEvent => !!e && typeof e === 'object' && (e as NostrEvent).kind === AVATAR_KIND && typeof (e as NostrEvent).pubkey === 'string' && typeof (e as NostrEvent).id === 'string'
    // Your own: the one slot, and one per identity where a build kept them so.
    const mineKeys: string[] = [LEGACY_MINE_KEY]
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(`${LEGACY_MINE_KEY}:`)) mineKeys.push(key)
      }
    } catch { /* no storage to list */ }
    for (const key of mineKeys) {
      try {
        const kept = read(key) as { event?: unknown; published?: boolean } | null
        if (!kept) continue
        if (isAvatar(kept.event)) await withAvatarDb((db) => putAll(db, [{ event: kept.event as NostrEvent, mine: true, published: kept.published ?? true }], Date.now()))
        else if (kept.published === false) continue
        localStorage.removeItem(key)
      } catch { /* left for the next load */ }
    }
    try {
      const others = read(LEGACY_OTHERS_KEY) as Record<string, { event?: unknown; at?: number }> | null
      if (others) {
        const items = Object.values(others).filter((k) => isAvatar(k?.event)).map((k) => ({ event: k.event as NostrEvent, mine: false, published: true }))
        if (items.length > 0) await withAvatarDb((db) => putAll(db, items, Date.now()))
        localStorage.removeItem(LEGACY_OTHERS_KEY)
      }
    } catch { /* left for the next load */ }
  })()
  return migrating
}

/** For tests: let the migration run again, as a reload does. */
export function resetAvatarMigration(): void { migrating = null }
