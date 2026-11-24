/**
 * terrainDb.ts - what TERRAIN mode keeps on the device, in IndexedDB, per identity.
 *
 * All local data per npub, in IndexedDB, and a switch never deletes (arkinox,
 * 2026-11-19). One database, four stores, every row carrying its owner (the
 * identity's pubkey) and indexed by it, so one identity's rows are read in
 * one request and another identity's are never touched:
 *
 * - ops: the op log, one row per mine or place, in order, not yet folded
 *   into a layer. Applied over the generated ground and the layer, it is what
 *   you see; it survives a reload.
 * - layers: per chunk, the changes folded so far (layer.ts: the diff from the
 *   generated ground, or the whole chunk when smaller). Folding happens when a
 *   chunk's log reaches FOLD_AT and when TERRAIN closes, in one transaction
 *   with the removal of the ops it folded, so nothing is ever lost between.
 * - surveyed: the chunks this identity has surveyed. The ground itself is
 *   never stored: everyone computes it again.
 * - meta: the inventory (counts by block id, the hotbar, the chosen slot) and
 *   the first-visit hint's progress.
 *
 * Nothing here is published. The same promise wrapper as the rest of the app
 * (lib/idb.ts); nothing here knows about zustand.
 */

import { openDatabase, putMany, request } from '../idb'
import { isLayer, type Layer } from './layer'

export const TERRAIN_DB = 'onosendai:terrain'
export const DB_VERSION = 1
export const OPS = 'ops'
export const LAYERS = 'layers'
export const SURVEYED = 'surveyed'
export const META = 'meta'
const BY_OWNER = 'byOwner'
/** Ops by identity and chunk, so a visit reads only the log of its own 27 chunks. */
const BY_OWNER_CHUNK = 'byOwnerChunk'

/** A chunk's log is folded into its layer once it holds this many changes (decision D12's 200). */
export const FOLD_AT = 200

/** How long opening may take before TERRAIN keeps everything in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

/** One mine or place. `id` is what the cell holds after it: 0 for a mine. */
export interface OpRow {
  rowKey: string
  owner: string
  chunk: string
  seq: number
  cell: number
  id: number
  t: number
}

export interface LayerRow {
  rowKey: string
  owner: string
  chunk: string
  layer: Layer
  t: number
}

export interface SurveyedRow {
  rowKey: string
  owner: string
  chunk: string
  t: number
}

/** What a builder carries, kept on this device: counts by block id, the nine hotbar slots (a block id or 0), and the chosen slot. */
export interface Inventory {
  counts: Record<number, number>
  hotbar: number[]
  slot: number
}

export const HOTBAR_SLOTS = 9

export function emptyInventory(): Inventory {
  return { counts: {}, hotbar: new Array(HOTBAR_SLOTS).fill(0), slot: 0 }
}

/** Everything one identity has kept. */
export interface Kept {
  ops: OpRow[]
  layers: LayerRow[]
  surveyed: SurveyedRow[]
  inventory: Inventory
  hint: number
  /** Past the identity's newest op anywhere. */
  nextSeq: number
}

const pad = (n: number): string => n.toString().padStart(12, '0')
export const opKey = (owner: string, seq: number): string => `${owner}|${pad(seq)}`
export const chunkRowKey = (owner: string, chunk: string): string => `${owner}|${chunk}`
const metaKey = (owner: string, what: 'inventory' | 'hint'): string => `${owner}|${what}`

export function openTerrainDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(TERRAIN_DB, DB_VERSION, [
    [OPS, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }, { name: BY_OWNER_CHUNK, keyPath: ['owner', 'chunk'] }]],
    [LAYERS, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
    [SURVEYED, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
    [META, 'key'],
  ])
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

function isInventory(v: unknown): v is Inventory {
  const i = v as Inventory | null
  return !!i && typeof i === 'object' && !!i.counts && typeof i.counts === 'object' && Array.isArray(i.hotbar) && typeof i.slot === 'number'
}

/** Clean an inventory read from storage: counts whole and positive, nine slots, a slot in range. */
export function tidyInventory(v: unknown): Inventory {
  if (!isInventory(v)) return emptyInventory()
  const counts: Record<number, number> = {}
  for (const [k, n] of Object.entries(v.counts)) {
    const id = Number(k)
    if (Number.isInteger(id) && id > 0 && id < 256 && Number.isInteger(n) && n > 0) counts[id] = n
  }
  const hotbar = new Array(HOTBAR_SLOTS).fill(0).map((_, i) => {
    const id = v.hotbar[i]
    return Number.isInteger(id) && id > 0 && id < 256 ? id : 0
  })
  const slot = Number.isInteger(v.slot) && v.slot >= 0 && v.slot < HOTBAR_SLOTS ? v.slot : 0
  return { counts, hotbar, slot }
}

/**
 * What one identity kept for the chunks of one visit (their keys), read row
 * by row, so a visit costs the same however much the identity built
 * elsewhere. The log comes back in order; `nextSeq` is past the identity's
 * last op anywhere, so a new op never takes an old one's key.
 */
export async function readKept(db: IDBDatabase, owner: string, chunks: readonly string[]): Promise<Kept> {
  const tx = db.transaction([OPS, LAYERS, SURVEYED, META], 'readonly')
  const opsIndex = tx.objectStore(OPS).index(BY_OWNER_CHUNK)
  const [opLists, layers, surveyed, inv, hint, last] = await Promise.all([
    Promise.all(chunks.map((c) => request(opsIndex.getAll([owner, c])) as Promise<OpRow[]>)),
    Promise.all(chunks.map((c) => request(tx.objectStore(LAYERS).get(chunkRowKey(owner, c))) as Promise<LayerRow | undefined>)),
    Promise.all(chunks.map((c) => request(tx.objectStore(SURVEYED).get(chunkRowKey(owner, c))) as Promise<SurveyedRow | undefined>)),
    request(tx.objectStore(META).get(metaKey(owner, 'inventory'))) as Promise<{ value?: unknown } | undefined>,
    request(tx.objectStore(META).get(metaKey(owner, 'hint'))) as Promise<{ value?: unknown } | undefined>,
    // The identity's newest op key: rowKeys are owner|seq, padded, so the last in the owner's range is the newest.
    request(tx.objectStore(OPS).openCursor(IDBKeyRange.bound(`${owner}|`, `${owner}|~`), 'prev')) as Promise<IDBCursorWithValue | null>,
  ])
  const ops = opLists.flat()
  const lastSeq = last && typeof (last.value as OpRow).seq === 'number' ? (last.value as OpRow).seq : 0
  return {
    ops: ops.filter((o) => typeof o.chunk === 'string' && Number.isInteger(o.cell) && Number.isInteger(o.id) && Number.isInteger(o.seq)).sort((a, b) => a.seq - b.seq),
    layers: layers.filter((l): l is LayerRow => !!l && typeof l.chunk === 'string' && isLayer(l.layer)),
    surveyed: surveyed.filter((r): r is SurveyedRow => !!r && typeof r.chunk === 'string'),
    inventory: tidyInventory(inv?.value),
    hint: typeof hint?.value === 'number' ? hint.value : 0,
    nextSeq: lastSeq + 1,
  }
}

/** What one identity kept that is not per chunk: every chunk it surveyed (keys), the inventory, the hint, and past its newest op. */
export async function readOwner(db: IDBDatabase, owner: string): Promise<{ surveyed: string[]; inventory: Inventory; hint: number; nextSeq: number }> {
  const tx = db.transaction([OPS, SURVEYED, META], 'readonly')
  const [rows, inv, hint, last] = await Promise.all([
    request(tx.objectStore(SURVEYED).index(BY_OWNER).getAll(owner)) as Promise<SurveyedRow[]>,
    request(tx.objectStore(META).get(metaKey(owner, 'inventory'))) as Promise<{ value?: unknown } | undefined>,
    request(tx.objectStore(META).get(metaKey(owner, 'hint'))) as Promise<{ value?: unknown } | undefined>,
    request(tx.objectStore(OPS).openCursor(IDBKeyRange.bound(`${owner}|`, `${owner}|~`), 'prev')) as Promise<IDBCursorWithValue | null>,
  ])
  const lastSeq = last && typeof (last.value as OpRow).seq === 'number' ? (last.value as OpRow).seq : 0
  return {
    surveyed: rows.filter((r) => r && typeof r.chunk === 'string').map((r) => r.chunk),
    inventory: tidyInventory(inv?.value),
    hint: typeof hint?.value === 'number' ? hint.value : 0,
    nextSeq: lastSeq + 1,
  }
}

export function writeOps(db: IDBDatabase, rows: OpRow[]): Promise<void> {
  return rows.length === 0 ? Promise.resolve() : putMany(db, OPS, rows)
}

export function writeSurveyed(db: IDBDatabase, owner: string, chunk: string, t: number): Promise<void> {
  return putMany(db, SURVEYED, [{ rowKey: chunkRowKey(owner, chunk), owner, chunk, t } satisfies SurveyedRow])
}

export function writeInventory(db: IDBDatabase, owner: string, inv: Inventory): Promise<void> {
  return putMany(db, META, [{ key: metaKey(owner, 'inventory'), value: inv }])
}

export function writeHint(db: IDBDatabase, owner: string, step: number): Promise<void> {
  return putMany(db, META, [{ key: metaKey(owner, 'hint'), value: step }])
}

/**
 * Fold: write a chunk's layer and remove the ops it now holds, in one
 * transaction, so a crash leaves either the old layer and its ops or the new
 * layer alone, never a gap.
 */
export function foldChunk(db: IDBDatabase, owner: string, chunk: string, layer: Layer, folded: number[], t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LAYERS, OPS], 'readwrite')
    tx.objectStore(LAYERS).put({ rowKey: chunkRowKey(owner, chunk), owner, chunk, layer, t } satisfies LayerRow)
    const ops = tx.objectStore(OPS)
    for (const seq of folded) ops.delete(opKey(owner, seq))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB fold failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB fold aborted'))
  })
}
