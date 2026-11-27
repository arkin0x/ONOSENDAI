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
 * - meta: the inventory (counts by block id, the hotbar, the chosen slot, the
 *   Quarry Charges), the first-visit hint's progress, and the Quarry Charge's
 *   drops still floating (never published).
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

/**
 * What a builder carries, kept on this device: counts by block id, the nine
 * hotbar slots (a block id, COMPILER_ID, QUARRY_ID, or 0), and the chosen slot.
 * `compiler`: 'made' when this identity made the Compiler from its recipe,
 * 'granted' when a preview build handed it one to test with
 * (lib/blueprint/devGrant.ts; production never does). Once it has, the Compiler
 * always sits in slot 1 (owner, 2026-11-27), and the block slots shift one
 * along: the ninth block slot is pushed off the bar (its blocks stay in the
 * bag).
 * `charges`: how many Quarry Charges it holds, once it has compiled any
 * (DECK-0010 §8.6, owner 2026-11-27): no cap, 7 a compile, 1 a placing. From
 * the first compile on, the charges have the slot after the Compiler for good,
 * shown at 0 and disabled when none are left.
 */
export interface Inventory {
  counts: Record<number, number>
  hotbar: number[]
  slot: number
  compiler?: 'made' | 'granted'
  charges?: number
}

export const HOTBAR_SLOTS = 9
/** The Compiler's place in the hotbar: never a block id (those are 1 to 255). */
export const COMPILER_ID = 1000
/** The Quarry Charges' place in the hotbar: never a block id either. */
export const QUARRY_ID = 1001

/** Whether a hotbar entry is the Compiler. */
export const isCompiler = (id: number): boolean => id === COMPILER_ID
/** Whether a hotbar entry is the Quarry Charges. */
export const isQuarry = (id: number): boolean => id === QUARRY_ID

/** What PLACE would put down from the chosen slot: a block with some left, the charges with some left, or null. */
export function placeable(inv: Inventory): number | null {
  const id = inv.hotbar[inv.slot]
  if (!id || isCompiler(id)) return null
  if (isQuarry(id)) return (inv.charges ?? 0) > 0 ? id : null
  return (inv.counts[id] ?? 0) > 0 ? id : null
}

export function emptyInventory(): Inventory {
  return { counts: {}, hotbar: new Array(HOTBAR_SLOTS).fill(0), slot: 0 }
}

/**
 * The Compiler joins the bar: slot 1, with the block slots shifted one along
 * and the chosen slot following its block. Unchanged when it is already there.
 */
export function withCompiler(inv: Inventory, how: 'made' | 'granted' = 'made'): Inventory {
  // Made beats granted: a Compiler made by hand is kept whatever the preview switch says.
  const compiler = inv.compiler === 'made' ? 'made' : how
  if (isCompiler(inv.hotbar[0]) && !inv.hotbar.slice(1).some(isCompiler)) return inv.compiler === compiler ? inv : { ...inv, compiler }
  const blocks = inv.hotbar.filter((id) => !isCompiler(id))
  const hotbar = [COMPILER_ID, ...blocks].slice(0, HOTBAR_SLOTS)
  const had = inv.hotbar.indexOf(COMPILER_ID)
  const slot = isCompiler(inv.hotbar[inv.slot]) ? 0 : Math.min(HOTBAR_SLOTS - 1, inv.slot + (had >= 0 && had < inv.slot ? 0 : 1))
  return { ...inv, compiler, hotbar, slot }
}

/** The Compiler off the bar (a preview's grant switched off): the block slots shift back. */
export function withoutCompiler(inv: Inventory): Inventory {
  if (!inv.compiler && !inv.hotbar.some(isCompiler)) return inv
  const blocks = inv.hotbar.filter((id) => !isCompiler(id))
  const hotbar = [...blocks, ...new Array(HOTBAR_SLOTS).fill(0)].slice(0, HOTBAR_SLOTS)
  const at = inv.hotbar.indexOf(COMPILER_ID)
  const slot = at >= 0 && inv.slot > at ? inv.slot - 1 : at === inv.slot ? 0 : inv.slot
  // Everything else it holds stays (the charges among it).
  const { compiler: _compiler, ...rest } = inv
  return { ...rest, hotbar, slot }
}

/**
 * The charges in the bar, `charges` of them: in the slot after the Compiler
 * (slot 1 with none), the block slots from there shifted one along, the last
 * pushed off the bar (its blocks stay in the bag), and the chosen slot
 * following what it held. Unchanged but for the count when already there.
 */
export function withCharges(inv: Inventory, charges: number): Inventory {
  const n = Math.max(0, Math.floor(charges))
  const at = isCompiler(inv.hotbar[0]) ? 1 : 0
  if (inv.hotbar[at] === QUARRY_ID && inv.hotbar.indexOf(QUARRY_ID) === at && inv.hotbar.lastIndexOf(QUARRY_ID) === at) return inv.charges === n ? inv : { ...inv, charges: n }
  const hotbar: number[] = inv.hotbar.slice(0, at)
  hotbar.push(QUARRY_ID)
  // Where each old slot lands, so the chosen one follows what it held.
  const moved = new Array<number>(inv.hotbar.length).fill(-1)
  for (let i = 0; i < at; i++) moved[i] = i
  for (let i = at; i < inv.hotbar.length; i++) {
    if (isQuarry(inv.hotbar[i])) { moved[i] = at; continue }
    if (hotbar.length >= HOTBAR_SLOTS) continue
    moved[i] = hotbar.length
    hotbar.push(inv.hotbar[i])
  }
  while (hotbar.length < HOTBAR_SLOTS) hotbar.push(0)
  const to = moved[inv.slot] ?? -1
  const slot = to >= 0 ? to : HOTBAR_SLOTS - 1
  return { ...inv, hotbar, slot, charges: n }
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
const metaKey = (owner: string, what: 'inventory' | 'hint' | 'drops'): string => `${owner}|${what}`

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
  // The charges, once any were compiled: a whole count, 0 or more (DECK-0010 §8.6).
  const charges = Number.isInteger(v.charges) && (v.charges as number) >= 0 ? v.charges as number : null
  const hotbar = new Array(HOTBAR_SLOTS).fill(0).map((_, i) => {
    const id = v.hotbar[i]
    return Number.isInteger(id) && ((id > 0 && id < 256) || (charges !== null && isQuarry(id))) ? id : 0
  })
  const slot = Number.isInteger(v.slot) && v.slot >= 0 && v.slot < HOTBAR_SLOTS ? v.slot : 0
  const tidy: Inventory = { counts, hotbar, slot }
  // The Compiler, once made, is always in slot 1 (withCompiler), whatever was stored.
  const kept = v.compiler !== 'made' && v.compiler !== 'granted' ? tidy
    : withCompiler({ ...tidy, hotbar: v.hotbar.slice(0, HOTBAR_SLOTS).map((id, i) => (i === 0 && isCompiler(id) ? id : hotbar[i])) }, v.compiler)
  // And the charges after it (withCharges).
  return charges === null ? kept : withCharges(kept, charges)
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

/**
 * The Quarry Charge's drops one identity has floating (lib/terrain/quarry.ts),
 * as one row: kept on this device only, never published, so a reload within
 * their ten minutes finds them where they were. Read back raw: the caller
 * tidies them (quarry.ts tidyDrops).
 */
export async function readDrops(db: IDBDatabase, owner: string): Promise<unknown> {
  const row = await request(db.transaction(META, 'readonly').objectStore(META).get(metaKey(owner, 'drops'))) as { value?: unknown } | undefined
  return row?.value
}

export function writeDrops(db: IDBDatabase, owner: string, drops: readonly unknown[]): Promise<void> {
  return putMany(db, META, [{ key: metaKey(owner, 'drops'), value: drops }])
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
