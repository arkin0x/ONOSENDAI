/**
 * db.ts: where region keys and places are kept, in IndexedDB.
 *
 * localStorage held the keys as one JSON string, rewritten whole on every
 * change and capped at 400 keys, because the whole store was a few megabytes
 * and every write blocked the frame. IndexedDB takes one row per key and per
 * place, written on its own and off the frame, so the cap can be a byte
 * budget (budget.ts) instead of a count.
 *
 * Three stores and a meta store:
 * - keys: the held keys (HeldKey), by lookup id. Read whole at load, because
 *   the list, the scene and the chain all read them from memory.
 * - places: where you stood at your own head (Place), by place id. Never read
 *   whole: the list pages through `byTime`, eviction takes the oldest from
 *   it, and `byKey` says which places still use a cube key.
 * - placeKeys: the cube keys places refer to (PlaceKey), by lookup id,
 *   stored once however many places share one.
 * - meta: whether the localStorage keys were copied in, and the totals.
 *
 * The totals (bytes of every row, and how many places and place keys) are a
 * record in meta that every write rewrites in its own transaction, measuring
 * only the rows it touches. Transactions that write the same stores run one
 * after another, so the totals stay exact when two tabs write at once, and
 * nothing is ever measured whole except once, if the record is missing.
 *
 * Nothing here knows about zustand; useSecrets and vault own the state.
 */

import { META_STORE, getAllPaged, openDatabase, request } from '../idb'
import type { HeldKey } from '../../store/useSecrets'
import { bytesOf } from './budget'
import type { Place, PlaceCursor, PlaceKey } from './places'
import { restood } from './places'

export const SECRETS_DB = 'onosendai:secrets'
export const DB_VERSION = 1
export const KEYS_STORE = 'keys'
export const PLACES_STORE = 'places'
export const PLACE_KEYS_STORE = 'placeKeys'
/** Places by [at, id]: oldest first for eviction, newest first for the list, and unique, so a page can start just past the last. */
export const BY_TIME = 'byTime'
/** Places by each lookup id in `keys`, one entry per key: which places still use a cube key. */
export const BY_KEY = 'byKey'

/** Where the keys were kept before this database; read once, never written here. */
export const LEGACY_KEY = 'onosendai:secrets'
/** Meta: the copy from LEGACY_KEY happened, when, and how many keys it brought. */
export const MIGRATED_META = 'migratedFromLocalStorage'
/** Meta: the running totals. */
export const TOTALS_META = 'totals'

/** How long opening may take before the app gives up on it and falls back. */
export const OPEN_TIMEOUT_MS = 8000

/** Rows read per request at load, so a large store does not land in one allocation. */
const READ_CHUNK = 2000

/** What everything kept takes, serialized, and how many places and place keys there are. */
export interface Totals { bytes: number; places: number; placeKeys: number }

export const NO_TOTALS: Totals = { bytes: 0, places: 0, placeKeys: 0 }

export function openSecretsDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(SECRETS_DB, DB_VERSION, [
    [KEYS_STORE, 'lookupId'],
    [PLACES_STORE, 'id', [
      { name: BY_TIME, keyPath: ['at', 'id'] },
      { name: BY_KEY, keyPath: 'keys', multiEntry: true },
    ]],
    [PLACE_KEYS_STORE, 'lookupId'],
    [META_STORE, 'key'],
  ])
  // An open can wait forever on a blocked upgrade or a browser that never
  // answers; the app is better off on the fallback than waiting with it. A
  // connection that does arrive after that is closed at once: left open, it
  // would hold up the next open that asks for a newer version.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** Whether a stored value is a key this app can use: the shape the list and the scene read. */
export function isHeldKey(v: unknown): v is HeldKey {
  const k = v as HeldKey | null
  return !!k && typeof k === 'object' && typeof k.lookupId === 'string' && typeof k.keyHex === 'string' && typeof k.height === 'number' && !!k.base
}

/**
 * The keys in a localStorage string, by lookup id. Anything that does not
 * parse, or a row missing what the list needs, is skipped rather than
 * failing the rest.
 */
export function parseLegacy(raw: string | null): Record<string, HeldKey> {
  const keys: Record<string, HeldKey> = {}
  if (!raw) return keys
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return keys
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      // Rows from before lookupId was stored in the row carry it as the map key.
      const k = v && typeof v === 'object' ? { ...(v as HeldKey), lookupId: (v as HeldKey).lookupId ?? id } : v
      if (isHeldKey(k)) keys[k.lookupId] = k
    }
  } catch { /* nothing usable */ }
  return keys
}

// ---------------------------------------------------------------------------
// Writes: one transaction each, measured as it goes
// ---------------------------------------------------------------------------

/**
 * The handle a write gets inside its transaction. Requests run through `req`
 * (or `each` for a cursor) so the transaction knows when every one of them,
 * and every request their callbacks start, has answered; only then are the
 * totals read and rewritten. Callbacks rather than promises, because a
 * promise between two requests can let a transaction commit early in some
 * browsers.
 */
interface Tally {
  tx: IDBTransaction
  store: (name: string) => IDBObjectStore
  /** Run a request; `then` gets its result and may start more. */
  req: <T>(r: IDBRequest<T>, then?: (result: T) => void) => void
  /** Walk a cursor: `visit` returns whether to go on; `done` runs once it ends. */
  each: (r: IDBRequest<IDBCursorWithValue | null>, visit: (c: IDBCursorWithValue) => boolean, done?: () => void) => void
  /** Put a row, counting it against the row it replaces (none for a new one). */
  put: (store: string, row: unknown, was?: unknown) => void
  /** Delete a row, counting it out. */
  del: (store: string, key: IDBValidKey, was: unknown) => void
}

const counted: Record<string, keyof Omit<Totals, 'bytes'> | undefined> = { [PLACES_STORE]: 'places', [PLACE_KEYS_STORE]: 'placeKeys' }

/**
 * Run one write as a single readwrite transaction over `stores` and meta,
 * and resolve to the totals it left, once it has committed. `durable` asks
 * the browser to flush to disk before saying so, for a transaction holding a
 * bought key, which cannot be computed again.
 */
export function tallied(db: IDBDatabase, stores: string[], durable: boolean, body: (t: Tally) => void): Promise<Totals> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction([...new Set([...stores, META_STORE])], 'readwrite', durable ? { durability: 'strict' } : undefined)
    } catch (err) {
      // A connection closed under us (another tab upgraded it, or the browser
      // dropped it) throws here rather than failing a request.
      reject(err)
      return
    }
    const delta: Totals = { bytes: 0, places: 0, placeKeys: 0 }
    let result: Totals = NO_TOTALS
    let pending = 0
    let sealed = false
    const finish = (): void => {
      const meta = tx.objectStore(META_STORE)
      const r = meta.get(TOTALS_META)
      r.onsuccess = () => {
        const was = (r.result as { value?: Totals } | undefined)?.value ?? NO_TOTALS
        result = {
          bytes: Math.max(0, was.bytes + delta.bytes),
          places: Math.max(0, was.places + delta.places),
          placeKeys: Math.max(0, was.placeKeys + delta.placeKeys),
        }
        meta.put({ key: TOTALS_META, value: result })
      }
    }
    const settle = (): void => { if (--pending === 0 && sealed) finish() }
    const t: Tally = {
      tx,
      store: (name) => tx.objectStore(name),
      req: (r, then) => {
        pending++
        r.onsuccess = () => { try { then?.(r.result) } finally { settle() } }
      },
      each: (r, visit, done) => {
        pending++
        r.onsuccess = () => {
          const c = r.result
          let more = false
          try {
            if (c) more = visit(c)
            if (!c || !more) done?.()
          } finally {
            if (c && more) c.continue()
            else settle()
          }
        }
      },
      put: (store, row, was) => {
        tx.objectStore(store).put(row)
        delta.bytes += bytesOf(row) - (was ? bytesOf(was) : 0)
        const field = counted[store]
        if (field && !was) delta[field]++
      },
      del: (store, key, was) => {
        tx.objectStore(store).delete(key)
        delta.bytes -= bytesOf(was)
        const field = counted[store]
        if (field) delta[field]--
      },
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    try {
      body(t)
    } catch (err) {
      try { tx.abort() } catch { /* already finished */ }
      reject(err)
      return
    }
    sealed = true
    if (pending === 0) finish()
  })
}

/**
 * Hold these keys and drop those. A key already on disk keeps its own row,
 * as `hold` keeps the first holding: another tab may have written it first.
 */
export function writeKeys(db: IDBDatabase, puts: HeldKey[], deletes: string[]): Promise<Totals> {
  const durable = puts.some((k) => k.source === 'cloud')
  return tallied(db, [KEYS_STORE], durable, (t) => {
    const keys = t.store(KEYS_STORE)
    for (const k of puts) t.req(keys.get(k.lookupId), (was) => { if (!was) t.put(KEYS_STORE, k) })
    for (const id of deletes) t.req(keys.get(id), (was) => { if (was) t.del(KEYS_STORE, id, was) })
  })
}

/**
 * Record a place and its keys. Standing on it again moves its time; a key
 * already stored is not stored again, only told the plane it was last
 * stood in.
 */
export function recordPlace(db: IDBDatabase, place: Place, keys: PlaceKey[]): Promise<Totals> {
  return tallied(db, [PLACES_STORE, PLACE_KEYS_STORE], false, (t) => {
    t.req(t.store(PLACES_STORE).get(place.id), (was: Place | undefined) => {
      if (!was) { t.put(PLACES_STORE, place); return }
      const next = restood(was, place)
      if (next) t.put(PLACES_STORE, next, was)
    })
    const pk = t.store(PLACE_KEYS_STORE)
    for (const k of keys) {
      t.req(pk.get(k.lookupId), (was: PlaceKey | undefined) => {
        if (!was) t.put(PLACE_KEYS_STORE, k)
        else if (was.plane !== k.plane) t.put(PLACE_KEYS_STORE, { ...was, plane: k.plane }, was)
      })
    }
  })
}

/**
 * Delete the place keys among `ids` that no place uses any more. Run after
 * the places are deleted in the same transaction, so `byKey` already leaves
 * them out.
 */
function dropOrphans(t: Tally, ids: Iterable<string>): void {
  const byKey = t.store(PLACES_STORE).index(BY_KEY)
  const pk = t.store(PLACE_KEYS_STORE)
  for (const id of new Set(ids)) {
    t.req(byKey.count(id), (n) => {
      if (n > 0) return
      t.req(pk.get(id), (k: PlaceKey | undefined) => { if (k) t.del(PLACE_KEYS_STORE, id, k) })
    })
  }
}

/** Forget one place, and the keys no other place uses. */
export function forgetPlace(db: IDBDatabase, id: string): Promise<Totals> {
  return tallied(db, [PLACES_STORE, PLACE_KEYS_STORE], false, (t) => {
    t.req(t.store(PLACES_STORE).get(id), (was: Place | undefined) => {
      if (!was) return
      t.del(PLACES_STORE, id, was)
      dropOrphans(t, was.keys)
    })
  })
}

/**
 * Forget every place stood on at or before `at`, and the keys no remaining
 * place uses. A place another tab records after the moment you confirmed is
 * not one you were asked about, and stays.
 */
export function forgetPlacesUpTo(db: IDBDatabase, at: number): Promise<Totals> {
  return tallied(db, [PLACES_STORE, PLACE_KEYS_STORE], false, (t) => {
    const gone = new Set<string>()
    const range = IDBKeyRange.upperBound([at, '￿'])
    t.each(t.store(PLACES_STORE).index(BY_TIME).openCursor(range), (c) => {
      const p = c.value as Place
      t.del(PLACES_STORE, p.id, p)
      for (const id of p.keys) gone.add(id)
      return true
    }, () => dropOrphans(t, gone))
  })
}

/**
 * Evict places, the one stood on longest ago first, until `need` bytes of
 * places are gone or `max` places are, with the keys no remaining place
 * uses. Resolves to the totals and how many places went; none means there
 * were none left to take.
 */
export async function evictPlaces(db: IDBDatabase, need: number, max: number): Promise<{ totals: Totals; removed: number }> {
  let removed = 0
  const totals = await tallied(db, [PLACES_STORE, PLACE_KEYS_STORE], false, (t) => {
    const gone = new Set<string>()
    let freed = 0
    t.each(t.store(PLACES_STORE).index(BY_TIME).openCursor(), (c) => {
      const p = c.value as Place
      t.del(PLACES_STORE, p.id, p)
      for (const id of p.keys) gone.add(id)
      freed += bytesOf(p)
      removed++
      return freed < need && removed < max
    }, () => dropOrphans(t, gone))
  })
  return { totals, removed }
}

/**
 * Copy the keys localStorage holds into the database, once.
 *
 * The copy and the record that it happened commit in one transaction, and
 * whether it already happened is asked inside that transaction, so two tabs
 * loading at once copy once. A tab closed halfway leaves neither, and the
 * next load tries again. A key the database already holds keeps its own row.
 * localStorage itself is only read: its entry stays exactly as it was, for a
 * later release to remove once this has been out long enough.
 *
 * Resolves to how many keys were copied, or null when the copy had already
 * been done.
 */
export async function migrateFromLocalStorage(db: IDBDatabase, storage: Pick<Storage, 'getItem'> | null): Promise<number | null> {
  let raw: string | null = null
  try { raw = storage?.getItem(LEGACY_KEY) ?? null } catch { /* storage refused: nothing to copy */ }
  const legacy = Object.values(parseLegacy(raw))
  let copied: number | null = null
  await tallied(db, [KEYS_STORE], legacy.some((k) => k.source === 'cloud'), (t) => {
    t.req(t.store(META_STORE).get(MIGRATED_META), (done) => {
      if (done) return
      copied = 0
      const keys = t.store(KEYS_STORE)
      for (const k of legacy) t.req(keys.get(k.lookupId), (was) => { if (!was) { t.put(KEYS_STORE, k); copied!++ } })
      t.req(keys.count(), () => {
        t.store(META_STORE).put({ key: MIGRATED_META, value: { at: Math.floor(Date.now() / 1000), copied } })
      })
    })
  })
  return copied
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every held key, a chunk at a time. */
export async function readKeys(db: IDBDatabase): Promise<HeldKey[]> {
  const out: HeldKey[] = []
  await getAllPaged<HeldKey>(db, KEYS_STORE, READ_CHUNK, (r) => r.lookupId, (rows) => { for (const r of rows) if (isHeldKey(r)) out.push(r) })
  return out
}

/**
 * The totals record. Written by every write, so it is only missing from a
 * database something else wrote; then everything is measured once and the
 * record written, so it is never measured again.
 */
export async function readTotals(db: IDBDatabase): Promise<Totals> {
  const os = db.transaction(META_STORE, 'readonly').objectStore(META_STORE)
  const row = await request(os.get(TOTALS_META)) as { value?: Totals } | undefined
  if (row?.value) return row.value
  return tallied(db, [KEYS_STORE, PLACES_STORE, PLACE_KEYS_STORE], false, (t) => {
    const measure = { bytes: 0, places: 0, placeKeys: 0 }
    const stores = [[KEYS_STORE, null], [PLACES_STORE, 'places'], [PLACE_KEYS_STORE, 'placeKeys']] as const
    // One store after another, each started when the last one's cursor ends,
    // so the record is written once every row has been measured. The tally
    // then reads it back and adds nothing, since nothing here was put.
    const walk = (i: number): void => {
      if (i === stores.length) { t.store(META_STORE).put({ key: TOTALS_META, value: measure }); return }
      const [store, field] = stores[i]
      t.each(t.store(store).openCursor(), (c) => {
        measure.bytes += bytesOf(c.value)
        if (field) measure[field]++
        return true
      }, () => walk(i + 1))
    }
    walk(0)
  })
}

/** One page of places, newest first, starting just past `after`. */
export function pagePlaces(db: IDBDatabase, after: PlaceCursor | null, limit: number): Promise<Place[]> {
  return new Promise((resolve, reject) => {
    const index = db.transaction(PLACES_STORE, 'readonly').objectStore(PLACES_STORE).index(BY_TIME)
    const range = after ? IDBKeyRange.upperBound([after.at, after.id], true) : null
    const r = index.openCursor(range, 'prev')
    const out: Place[] = []
    r.onsuccess = () => {
      const c = r.result
      if (!c || out.length >= limit) { resolve(out); return }
      out.push(c.value as Place)
      if (out.length >= limit) { resolve(out); return }
      c.continue()
    }
    r.onerror = () => reject(r.error ?? new Error('IndexedDB read failed'))
  })
}

/** One place, or null. */
export async function getPlace(db: IDBDatabase, id: string): Promise<Place | null> {
  const os = db.transaction(PLACES_STORE, 'readonly').objectStore(PLACES_STORE)
  return (await request(os.get(id)) as Place | undefined) ?? null
}

/** These place keys, in one read; a missing one is left out. */
export function getPlaceKeys(db: IDBDatabase, ids: string[]): Promise<PlaceKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLACE_KEYS_STORE, 'readonly')
    const os = tx.objectStore(PLACE_KEYS_STORE)
    const out: PlaceKey[] = []
    for (const id of ids) { const r = os.get(id); r.onsuccess = () => { if (r.result) out.push(r.result as PlaceKey) } }
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
  })
}

/** Every place key, `size` at a time in key order, each page its own short read. */
export async function* placeKeyPages(db: IDBDatabase, size: number): AsyncGenerator<PlaceKey[]> {
  let after: string | null = null
  for (;;) {
    const range = after === null ? null : IDBKeyRange.lowerBound(after, true)
    const os = db.transaction(PLACE_KEYS_STORE, 'readonly').objectStore(PLACE_KEYS_STORE)
    const rows = await request(os.getAll(range, size)) as PlaceKey[]
    if (rows.length === 0) return
    yield rows
    if (rows.length < size) return
    after = rows[rows.length - 1].lookupId
  }
}
