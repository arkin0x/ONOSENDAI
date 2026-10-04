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
 * - keys: the held keys (HeldKey), by lookup id. What the Region keys list
 *   shows and the scene draws.
 * - places: where you stood at your own head (Place), by place id.
 * - placeKeys: the cube keys places refer to (PlaceKey), by lookup id,
 *   stored once however many places share one.
 * - meta: one record per key; today only whether the localStorage keys
 *   were copied in.
 *
 * Nothing here knows about zustand; useSecrets owns the state and calls in.
 */

import { META_STORE, getAllKeys, getAllPaged, getMeta, metaOp, openDatabase, writeBatch, type WriteOp } from '../idb'
import type { HeldKey } from '../../store/useSecrets'
import type { Place, PlaceKey } from './places'

export const SECRETS_DB = 'onosendai:secrets'
const DB_VERSION = 1
export const KEYS_STORE = 'keys'
export const PLACES_STORE = 'places'
export const PLACE_KEYS_STORE = 'placeKeys'

/** Where the keys were kept before this database; read once, never written here. */
export const LEGACY_KEY = 'onosendai:secrets'
/** Meta: the copy from LEGACY_KEY happened, when, and how many keys it brought. */
export const MIGRATED_META = 'migratedFromLocalStorage'

/** How long opening may take before the app gives up on it and falls back. */
const OPEN_TIMEOUT_MS = 8000

/** Rows read per request at load, so a large store does not land in one allocation. */
const READ_CHUNK = 2000

export function openSecretsDb(): Promise<IDBDatabase> {
  const opening = openDatabase(SECRETS_DB, DB_VERSION, [
    [KEYS_STORE, 'lookupId'],
    [PLACES_STORE, 'id'],
    [PLACE_KEYS_STORE, 'lookupId'],
    [META_STORE, 'key'],
  ])
  // An open can wait forever on a blocked upgrade or a browser that never
  // answers; the app is better off on the fallback than waiting with it.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('IndexedDB did not open in time')), OPEN_TIMEOUT_MS)
  })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** Whether a stored value is a key this app can use: the shape the list and the scene read. */
export function isHeldKey(v: unknown): v is HeldKey {
  const k = v as HeldKey | null
  return !!k && typeof k === 'object' && typeof k.lookupId === 'string' && typeof k.keyHex === 'string' && typeof k.height === 'number' && !!k.base
}

/**
 * The keys in the legacy localStorage string, by lookup id. Anything that
 * does not parse, or a row missing what the list needs, is skipped rather
 * than failing the rest.
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

/**
 * Copy the keys localStorage holds into the database, once.
 *
 * The copy and the record that it happened commit in one transaction, so a
 * tab closed halfway leaves neither and the next load tries again. A key the
 * database already holds keeps its own row: the first holding is kept, as
 * `hold` does. localStorage itself is only read. Its entry stays exactly as
 * it was, for a later release to remove once this has been out long enough.
 *
 * Resolves to how many keys were copied, or null when the copy had already
 * been done and nothing was read.
 */
export async function migrateFromLocalStorage(db: IDBDatabase, storage: Pick<Storage, 'getItem'> | null): Promise<number | null> {
  if (await getMeta(db, MIGRATED_META)) return null
  let raw: string | null = null
  try { raw = storage?.getItem(LEGACY_KEY) ?? null } catch { /* storage refused: nothing to copy */ }
  const legacy = parseLegacy(raw)
  const have = new Set((await getAllKeys(db, KEYS_STORE)).map(String))
  const ops: WriteOp[] = []
  for (const k of Object.values(legacy)) if (!have.has(k.lookupId)) ops.push({ store: KEYS_STORE, put: k })
  const copied = ops.length
  ops.push(metaOp(MIGRATED_META, { at: Math.floor(Date.now() / 1000), copied }))
  await writeBatch(db, ops)
  return copied
}

export interface Stored {
  keys: HeldKey[]
  places: Place[]
  placeKeys: PlaceKey[]
}

/** Everything kept, read once at load, a chunk at a time. */
export async function readAll(db: IDBDatabase): Promise<Stored> {
  const out: Stored = { keys: [], places: [], placeKeys: [] }
  await getAllPaged<HeldKey>(db, KEYS_STORE, READ_CHUNK, (r) => r.lookupId, (rows) => { for (const r of rows) if (isHeldKey(r)) out.keys.push(r) })
  await getAllPaged<Place>(db, PLACES_STORE, READ_CHUNK, (r) => r.id, (rows) => { for (const r of rows) if (r && Array.isArray(r.keys)) out.places.push(r) })
  await getAllPaged<PlaceKey>(db, PLACE_KEYS_STORE, READ_CHUNK, (r) => r.lookupId, (rows) => { for (const r of rows) if (r && typeof r.keyHex === 'string') out.placeKeys.push(r) })
  return out
}
