/**
 * identitiesDb.ts: every identity this device has held, kept in IndexedDB so
 * a switch of identity never loses one.
 *
 * The owner's ruling (arkinox, 2026-11-19): "we want to preserve local
 * indexdb data for all users. key the user's data by npub so when they login
 * it still exists." Applied to keys, a switch must never lose a key this
 * device held. The signer preference (lib/signers.ts, 'onosendai:signer') is
 * one slot that every switch overwrites, so a pasted key, a NEW RANDOM KEY or
 * the encrypted key behind the lock screen was gone after switching away.
 * This store keeps one row per pubkey beside that slot, and the slot stays as
 * it was: it is still what a reload starts from.
 *
 * What a row keeps, by how the identity was held:
 * - A key this app generated (Signer.minted): its nsec, plain. That is the
 *   same protection it has today, since the app already keeps a generated key
 *   plain in localStorage ('onosendai:nsec' and the signer pref) and treats it
 *   as a full identity with nothing to ask (owner rule, 2026-11-11). Anything
 *   that can read this origin's localStorage can read this store too.
 * - A key someone brought: its ncryptsec only (lib/keyAtRest.ts), never the
 *   key itself. Coming back to it asks for its password.
 * - An extension: its pubkey and kind, nothing secret.
 * - A remote signer (bunker): the same record the signer pref keeps for it
 *   (its URI, and the client key of the session), so it can reconnect.
 *
 * A write is always a merge into the row that is there, in one readwrite
 * transaction (IndexedDB runs those one at a time on a store, across tabs
 * too). A merge never drops a secret the row holds: nothing here deletes a
 * key, and no row is ever deleted. Removing an identity from the device is a
 * later, deliberate control. The one thing taken out of a row is a remote
 * signer's session, by LOG OUT (forgetHeldSession): its client key is this
 * device's pairing with the signer, never the identity's key, and the row
 * stays, offering PAIR AGAIN.
 *
 * Writes go through one queue per page, so they land in the order they were
 * asked, and nothing waits on them: a switch of identity never waits for
 * IndexedDB, and a store that cannot open (a private window that refuses it,
 * a test without IndexedDB) leaves the app as it was before this store.
 */

import { nip19 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { openDatabase, request } from './idb'
import type { SignerKind, SignerPref } from './signers'

export const IDENTITIES_DB = 'onosendai:identities'
export const DB_VERSION = 1
export const IDENTITIES_STORE = 'identities'

/** How long opening may take before this page goes on without the store. */
export const OPEN_TIMEOUT_MS = 8000

/** What a remote signer needs to reconnect: the fields its signer pref keeps. */
export interface HeldBunker {
  bunkerUri: string
  clientNsec?: string
  nostrConnectSession?: boolean
}

/** One identity this device has held, keyed by its pubkey. */
export interface HeldIdentity {
  pubkey: string
  /** How it was held the last time it was in use. */
  kind: SignerKind
  /** Only for a key this app generated (see the header). */
  nsec?: string
  /** A brought key, sealed with its password (NIP-49). */
  ncryptsec?: string
  bunker?: HeldBunker
  /** When it was first recorded here (ms). */
  firstHeld: number
  /** When it was last the identity in use (ms); 0 when only migrated. */
  lastUsed: number
}

/**
 * How the list in the login offers a way back to an identity: 'generated'
 * switches at once, 'password' asks for the password first, 'extension' and
 * 'bunker' reconnect to the signer that holds it, and 'pair' is a remote
 * signer logged out of on this device: PAIR AGAIN opens the QR for it.
 */
export type HeldWay = 'generated' | 'password' | 'extension' | 'bunker' | 'pair'

/** A row as the login shows it: no secret leaves this file through a list. */
export interface HeldEntry {
  pubkey: string
  way: HeldWay
  lastUsed: number
}

const HEX64 = /^[0-9a-f]{64}$/

/** Whether `nsec` is the key of `pubkey`. */
function nsecOf(nsec: unknown, pubkey: string): Uint8Array | null {
  if (typeof nsec !== 'string') return null
  try {
    const { type, data } = nip19.decode(nsec)
    if (type !== 'nsec' || !(data instanceof Uint8Array) || data.length !== 32) return null
    return getPublicKey(data) === pubkey ? data : null
  } catch {
    return null
  }
}

/**
 * What a signer pref says about its identity, as a row to merge. `generated`
 * says whether the app made this key: only then does a plain nsec go in. A
 * plain nsec of a key someone brought (a pref saved before keys were sealed)
 * is never copied here; that identity is recorded by its pubkey alone until
 * it gets a password. Null for a pref that names no real key.
 */
export function heldFromPref(pref: SignerPref | null | undefined, generated: boolean, lastUsed?: number): Partial<HeldIdentity> & { pubkey: string } | null {
  if (!pref || typeof pref.pubkey !== 'string' || !HEX64.test(pref.pubkey)) return null
  const row: Partial<HeldIdentity> & { pubkey: string } = { pubkey: pref.pubkey, kind: pref.kind }
  if (pref.kind === 'local') {
    if (typeof pref.ncryptsec === 'string' && pref.ncryptsec.startsWith('ncryptsec1')) row.ncryptsec = pref.ncryptsec
    if (generated && nsecOf(pref.nsec, pref.pubkey)) row.nsec = pref.nsec
  }
  if (pref.kind === 'nip46' && typeof pref.bunkerUri === 'string') {
    row.bunker = { bunkerUri: pref.bunkerUri }
    if (pref.clientNsec) row.bunker.clientNsec = pref.clientNsec
    if (pref.nostrConnectSession) row.bunker.nostrConnectSession = true
  }
  if (lastUsed !== undefined) row.lastUsed = lastUsed
  return row
}

/**
 * The row after `next` lands on `old`. A secret `next` does not carry is kept
 * from `old`. One it carries replaces it only when `replace` is set: the
 * identity in use, or a key just sealed with a new password, is the newest
 * copy (the same key sealed again still opens to the same key). Anything else
 * (the identity a switch left, the copy behind a lock, what a load copies in)
 * may be older than the row, from a tab that loaded before the password was
 * changed in another, and only fills what the row lacks: it never puts an
 * old password's copy over the new one. The kind is the newest; the last use
 * moves only forward. Whatever a later build keeps beside these is kept.
 */
export function mergeHeld(old: HeldIdentity | undefined, next: Partial<HeldIdentity> & { pubkey: string }, now: number, replace = true): HeldIdentity {
  const kept: Partial<HeldIdentity> = old && typeof old === 'object' ? old : {}
  const merged: HeldIdentity = {
    ...kept,
    pubkey: next.pubkey,
    kind: next.kind ?? kept.kind ?? 'local',
    firstHeld: kept.firstHeld ?? now,
    lastUsed: Math.max(kept.lastUsed ?? 0, next.lastUsed ?? 0),
  }
  const nsec = replace ? next.nsec ?? kept.nsec : kept.nsec ?? next.nsec
  const ncryptsec = replace ? next.ncryptsec ?? kept.ncryptsec : kept.ncryptsec ?? next.ncryptsec
  const bunker = replace ? next.bunker ?? kept.bunker : kept.bunker ?? next.bunker
  if (nsec) merged.nsec = nsec
  if (ncryptsec) merged.ncryptsec = ncryptsec
  if (bunker) merged.bunker = bunker
  return merged
}

/**
 * The way back to a row, or null when the device holds no way back (a key
 * that was used for one visit and never kept). A generated key comes first:
 * it is the full identity with nothing to ask.
 */
export function heldWay(row: HeldIdentity): HeldWay | null {
  if (nsecOf(row.nsec, row.pubkey)) return 'generated'
  if (typeof row.ncryptsec === 'string' && row.ncryptsec.startsWith('ncryptsec1')) return 'password'
  if (row.kind === 'nip07') return 'extension'
  if (row.kind === 'nip46' && row.bunker?.bunkerUri) return 'bunker'
  if (row.kind === 'nip46') return 'pair'
  return null
}

let opening: Promise<IDBDatabase> | null = null
/**
 * Set when an open ran out of time: this page then goes on without the store,
 * and the next load tries again. Without it every queued write waited out its
 * own timeout, and a paste that looks a key up behind them waited for all of
 * them (review of #824). An open that fails at once is tried again.
 */
let gaveUp = false

/** The store, opened once per page; a failed open is tried again by the next call, a slow one is not. */
function db(): Promise<IDBDatabase> {
  if (opening) return opening
  if (gaveUp) return Promise.reject(new Error('IndexedDB did not open in time'))
  const attempt = ((): Promise<IDBDatabase> => {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'))
    let opened: Promise<IDBDatabase>
    try { opened = openDatabase(IDENTITIES_DB, DB_VERSION, [[IDENTITIES_STORE, 'pubkey']]) } catch (err) { return Promise.reject(err) }
    // As the shard folders do: a browser that never answers must not hold
    // the queue, and a connection that arrives late is closed, not leaked.
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; gaveUp = true; reject(new Error('IndexedDB did not open in time')) }, OPEN_TIMEOUT_MS)
    })
    opened.then((d) => { if (timedOut) d.close() }, () => { /* the race reports it */ })
    return Promise.race([opened, timeout]).finally(() => clearTimeout(timer))
  })()
  opening = attempt
  attempt.then((d) => {
    // Another tab upgrading (or clearing) this database: let go of it, and
    // open it again on the next call, rather than block that tab.
    d.onversionchange = () => { d.close(); if (opening === attempt) opening = null }
  }, () => { if (opening === attempt) opening = null })
  return attempt
}

/** One merge, in one readwrite transaction; resolves with the row as committed. */
function mergeInto(d: IDBDatabase, next: Partial<HeldIdentity> & { pubkey: string }, replace: boolean): Promise<HeldIdentity> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDENTITIES_STORE, 'readwrite')
    const os = tx.objectStore(IDENTITIES_STORE)
    let row: HeldIdentity | null = null
    const got = os.get(next.pubkey)
    got.onsuccess = () => {
      row = mergeHeld(got.result as HeldIdentity | undefined, next, Date.now(), replace)
      os.put(row)
    }
    tx.oncomplete = () => resolve(row as HeldIdentity)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** The write queue: each write starts when the one before it has settled. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Record `next`, merged into its row, after every write asked before it.
 * `replace`: its secrets are the newest copy and replace the row's (mergeHeld);
 * otherwise they only fill what the row lacks. Resolves true once it is
 * committed, false when the store could not take it. Never rejects, so a
 * caller may leave it running.
 */
export function recordHeld(next: Partial<HeldIdentity> & { pubkey: string } | null, replace = false): Promise<boolean> {
  if (!next || !HEX64.test(next.pubkey)) return Promise.resolve(false)
  const done = queue.then(async () => {
    try {
      await mergeInto(await db(), next, replace)
      return true
    } catch {
      return false
    }
  })
  queue = done
  return done
}

/**
 * LOG OUT of a remote signer: its session (the bunker URI and this device's
 * client key for it) leaves the row, after every write asked before it, and
 * the row stays with everything else it holds. A row that is not a remote
 * signer's is left as it is. Resolves true once committed (or nothing to
 * take), false when the store could not be written. Never rejects.
 */
export function forgetHeldSession(pubkey: string): Promise<boolean> {
  if (!HEX64.test(pubkey)) return Promise.resolve(false)
  const done = queue.then(async () => {
    try {
      const d = await db()
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(IDENTITIES_STORE, 'readwrite')
        const os = tx.objectStore(IDENTITIES_STORE)
        const got = os.get(pubkey)
        got.onsuccess = () => {
          const row = got.result as HeldIdentity | undefined
          if (!row || row.kind !== 'nip46' || !row.bunker) return
          const { bunker: _session, ...kept } = row
          os.put(kept)
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
      })
      return true
    } catch {
      return false
    }
  })
  queue = done
  return done
}

/** Resolves when every write asked so far has settled. */
export function heldSettled(): Promise<void> {
  return queue.then(() => undefined)
}

/** One row, or null when there is none or the store cannot be read. */
export async function readHeld(pubkey: string): Promise<HeldIdentity | null> {
  await heldSettled()
  try {
    const d = await db()
    const row = await request(d.transaction(IDENTITIES_STORE, 'readonly').objectStore(IDENTITIES_STORE).get(pubkey)) as HeldIdentity | undefined
    return row && typeof row === 'object' && row.pubkey === pubkey ? row : null
  } catch {
    return null
  }
}

/**
 * readHeld, but answering null after `ms`: for a lookup a person is waiting
 * on (a paste), which then goes the safe way, as a key with no row here.
 */
export function readHeldWithin(pubkey: string, ms: number): Promise<HeldIdentity | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([readHeld(pubkey), late]).finally(() => clearTimeout(timer))
}

/** The key of a row this app generated, checked against its pubkey; null for any other row. */
export function generatedKeyOf(row: HeldIdentity | null): Uint8Array | null {
  return row ? nsecOf(row.nsec, row.pubkey) : null
}

/** The last list read, so the login draws it at once on opening (no jump when it arrives). */
let lastList: HeldEntry[] = []
/** Whether a list has been read (or failed to be) on this page yet. */
let listed = false

export function cachedHeld(): HeldEntry[] {
  return lastList
}

export function heldListed(): boolean {
  return listed
}

/**
 * Every identity with a way back, most recently used first. Empty when the
 * store cannot be read: the login then shows only its other options.
 */
export async function listHeld(): Promise<HeldEntry[]> {
  await heldSettled()
  let rows: HeldIdentity[]
  try {
    const d = await db()
    rows = await request(d.transaction(IDENTITIES_STORE, 'readonly').objectStore(IDENTITIES_STORE).getAll()) as HeldIdentity[]
  } catch {
    // Unreadable now: nothing is claimed as kept, rather than an older list.
    lastList = []
    listed = true
    return lastList
  }
  const list: HeldEntry[] = []
  for (const row of rows) {
    if (!row || typeof row.pubkey !== 'string') continue
    const way = heldWay(row)
    if (way) list.push({ pubkey: row.pubkey, way, lastUsed: row.lastUsed ?? 0 })
  }
  list.sort((a, b) => b.lastUsed - a.lastUsed || a.pubkey.localeCompare(b.pubkey))
  lastList = list
  listed = true
  return list
}

/**
 * The first load with this store: copy in what localStorage holds, which is
 * the identities a device kept before the store existed. It runs on every
 * load, not once: every write is a merge that keeps what is there, so a
 * migration a closed page or a failed write cut short is simply done again
 * on the next load, and one that already ran changes nothing. localStorage
 * is only read here, never written or cleared: the originals stay where they
 * were whatever happens to this copy.
 *
 * `firstNsec` is this device's first generated key ('onosendai:nsec');
 * `prefs` are the signer pref and the signer in use, each with whether the
 * app generated its key and when it was last used. Resolves true when every
 * row was written and read back holding what it should.
 */
export async function seedHeld(
  firstNsec: string | null,
  prefs: Array<{ pref: SignerPref | null; generated: boolean; lastUsed?: number }>,
): Promise<boolean> {
  const rows: Array<Partial<HeldIdentity> & { pubkey: string }> = []
  if (firstNsec) {
    try {
      const { type, data } = nip19.decode(firstNsec)
      if (type === 'nsec' && data instanceof Uint8Array && data.length === 32) rows.push({ pubkey: getPublicKey(data), kind: 'local', nsec: firstNsec })
    } catch { /* corrupt: nothing to copy */ }
  }
  for (const { pref, generated, lastUsed } of prefs) {
    const row = heldFromPref(pref, generated, lastUsed)
    if (row) rows.push(row)
  }
  const written = await Promise.all(rows.map((row) => recordHeld(row)))
  if (written.some((ok) => !ok)) return false
  // Read back: a row is confirmed only when it holds the secret it was given.
  for (const row of rows) {
    const stored = await readHeld(row.pubkey)
    if (!stored) return false
    if (row.nsec && stored.nsec !== row.nsec) return false
    if (row.ncryptsec && !stored.ncryptsec) return false
  }
  await listHeld()
  return true
}
