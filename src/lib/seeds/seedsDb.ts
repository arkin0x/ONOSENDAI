/**
 * seedsDb.ts - the one IndexedDB database seeds keep: `onosendai-seeds`.
 *
 *   - `dna`: the DNAs relays gave (dnaStore.ts idbDnaCache), keyed by id.
 *   - `headers`: the Bitcoin headers the seeds clock has verified (headerBook.ts
 *     headerOfAnchor: signed by NTH, hashing to its `H`, meeting its own
 *     target), keyed by height: `{ height, hash, time }`. A refresh reads them
 *     back, so the clock and every planted height and bloom it settled last
 *     time are there at once, and only blocks newer than these are fetched.
 *
 * Only headers that were checked go in, and NTH anchors a block only once it
 * is 6 deep (seedClock clockAtAnchor), which is as deep as DECK-0008 §4.1 and
 * §10 let a reorganization reach. A fresh anchor for a height held here, with
 * another header, replaces it (HeaderBook.add tells the sink), so this store
 * follows NTH, never the other way.
 *
 * Size: a header row is about 100 bytes. HEADERS_KEPT rows (about seven months
 * of blocks, about 3 MB) at most; past that the lowest heights go first, and a
 * seed that needs one again fetches it again.
 */

import { openDatabase, request, putMany } from '../idb'

export const SEEDS_DB = 'onosendai-seeds'
/** 1: dna. 2: headers, planted. */
const SEEDS_DB_VERSION = 2
export const DNA_STORE = 'dna'
export const HEADERS_STORE = 'headers'
export const PLANTED_STORE = 'planted'

/** The most header rows kept; the lowest heights are dropped past this. */
export const HEADERS_KEPT = 30_000
/** The most settled planted heights kept (about 120 bytes each); those settled at the lowest clocks go first. */
export const PLANTED_KEPT = 5_000

/** One verified header as kept: the shape HeaderBook.add takes. */
export interface HeaderRow { height: number; hash: string; time: number }

let dbOpen: Promise<IDBDatabase | null> | null = null

/**
 * The seeds database, or null where IndexedDB is missing or will not open
 * (then nothing is kept, and seeds and DNAs come from the relays as before).
 * A tab still on an older build holds version 1 open and never lets go, so an
 * open it blocks fails at once rather than waiting (failWhenBlocked), and is
 * tried again on a later call; this build's own connection closes when a
 * newer build asks to upgrade.
 */
export function seedsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbOpen) return dbOpen
  const opening: Promise<IDBDatabase | null> = openDatabase(SEEDS_DB, SEEDS_DB_VERSION, [[DNA_STORE, 'id'], [HEADERS_STORE, 'height'], [PLANTED_STORE, 'id']], undefined, { failWhenBlocked: true })
    .then((d) => {
      d.onversionchange = () => { d.close(); if (dbOpen === opening) dbOpen = null }
      return d
    })
    .catch(() => {
      if (dbOpen === opening) dbOpen = null
      return null
    })
  dbOpen = opening
  return opening
}

const HEX64 = /^[0-9a-f]{64}$/

function isRow(r: unknown): r is HeaderRow {
  const x = r as HeaderRow
  return !!x && Number.isSafeInteger(x.height) && x.height >= 0 && typeof x.hash === 'string' && HEX64.test(x.hash) && Number.isSafeInteger(x.time) && x.time > 0
}

/**
 * Every header kept, in height order, after dropping the lowest past
 * HEADERS_KEPT. Best effort: a failed read is an empty book, which is a first
 * visit, never an error.
 */
export async function loadHeaders(kept = HEADERS_KEPT): Promise<HeaderRow[]> {
  const d = await seedsDb()
  if (!d) return []
  try {
    const rows = (await request(d.transaction(HEADERS_STORE, 'readonly').objectStore(HEADERS_STORE).getAll())) as unknown[]
    const good = rows.filter(isRow).sort((a, b) => a.height - b.height)
    if (good.length > kept) {
      const cut = good[good.length - kept].height
      try {
        const tx = d.transaction(HEADERS_STORE, 'readwrite')
        tx.objectStore(HEADERS_STORE).delete(IDBKeyRange.upperBound(cut, true))
      } catch { /* trimmed next time */ }
      return good.slice(good.length - kept)
    }
    return good
  } catch {
    return []
  }
}

/** Keep these headers. Best effort: a failed write is only a slower next refresh. */
export async function saveHeaders(rows: HeaderRow[]): Promise<void> {
  if (rows.length === 0) return
  const d = await seedsDb()
  if (!d) return
  try { await putMany(d, HEADERS_STORE, rows) } catch { /* best effort */ }
}

/** A seed's settled planted height (seedClock settlePlanted), and the clock it was settled at. */
export interface PlantedRow { id: string; height: number; E: number | null; F: number; clock: number }

function isPlanted(r: unknown): r is PlantedRow {
  const x = r as PlantedRow
  return !!x && typeof x.id === 'string' && HEX64.test(x.id) && Number.isSafeInteger(x.height) && Number.isSafeInteger(x.F) && Number.isSafeInteger(x.clock)
    && (x.E === null || Number.isSafeInteger(x.E)) && x.height <= x.F && x.F <= x.clock && (x.E === null || x.E <= x.height)
}

/** Every settled planted height kept, after dropping those settled at the lowest clocks past PLANTED_KEPT. Best effort. */
export async function loadPlanted(kept = PLANTED_KEPT): Promise<PlantedRow[]> {
  const d = await seedsDb()
  if (!d) return []
  try {
    const rows = ((await request(d.transaction(PLANTED_STORE, 'readonly').objectStore(PLANTED_STORE).getAll())) as unknown[]).filter(isPlanted)
    if (rows.length <= kept) return rows
    rows.sort((a, b) => b.clock - a.clock)
    const drop = rows.slice(kept)
    try {
      const os = d.transaction(PLANTED_STORE, 'readwrite').objectStore(PLANTED_STORE)
      for (const r of drop) os.delete(r.id)
    } catch { /* trimmed next time */ }
    return rows.slice(0, kept)
  } catch {
    return []
  }
}

/** Keep these settled planted heights. Best effort. */
export async function savePlanted(rows: PlantedRow[]): Promise<void> {
  if (rows.length === 0) return
  const d = await seedsDb()
  if (!d) return
  try { await putMany(d, PLANTED_STORE, rows) } catch { /* best effort */ }
}

/** Tests: forget the open connection, so the next call opens afresh. */
export function resetSeedsDbForTest(): void {
  dbOpen = null
}
