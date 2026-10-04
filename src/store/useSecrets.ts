/**
 * useSecrets.ts — the regions you can open.
 *
 * A region key is not a password you are given, it is a number you computed:
 * the Cantor root of an aligned region, hashed once for the key and twice for
 * the lookup id it is published under (spec §7.2). Holding it means two
 * things at once, and only for that exact region: you can ask the relay what
 * is hidden there, and you can read what comes back.
 *
 * Keys are not hierarchical. A key for a region a mile wide tells you nothing
 * about the block inside it: the child has its own root, and sha256 leaves no
 * ladder between them. So this is a list, not a tree, and standing somewhere
 * new adds the nested cubes you now stand in rather than refining an old key.
 *
 * What is kept is small: the key is 32 bytes and the rest is where and when.
 * The regions themselves are never stored, only the numbers that open them.
 *
 * Beside the keys are the places: every coordinate you stood on at your own
 * head, with the thirteen cube keys the scan had there (lib/secrets/places).
 * They are not held keys and are not drawn; they are what RESCAN ALL asks
 * the relays about again later.
 *
 * Kept in IndexedDB (lib/secrets/db), one row per key and per place, written
 * as each one changes, under a byte budget (lib/secrets/budget) that never
 * drops a bought key. The held keys are also all here in memory, because the
 * list, the scene and the chain read them from here. The places are not: there
 * can be a hundred thousand of them, so memory has only their counts and the
 * byte total, the list pages through them in the database, and RESCAN ALL
 * reads their keys a batch at a time. Where IndexedDB cannot be opened (some
 * private modes, a browser that refuses it), the keys fall back to
 * localStorage, and places last only as long as the page. Every bought key is
 * also copied to a localStorage backstop (lib/secrets/backstop), whichever of
 * these is in use. The old localStorage list is never written again: it is
 * read once to copy it in, and on each load for keys a tab still running an
 * older build has added to it since (db.syncLegacy).
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import type { Position } from '../lib/space'
import { EVICT_PLACES_PER_PASS, EVICT_TO, SECRETS_BUDGET_BYTES, bytesOfAll, earnedToEvict, trimByCount } from '../lib/secrets/budget'
import {
  describeError, evictPlaces, forgetPlace as forgetPlaceRow, forgetPlacesUpTo, migrateFromLocalStorage, openSecretsDb,
  readKeys, readLegacyList, readTotals, recordPlace as recordPlaceRow, syncLegacy, writeKeys, type Totals,
} from '../lib/secrets/db'
import { clearForgets, dropApplied, noteFallback, readBought, readFallback, updateBought } from '../lib/secrets/backstop'
import { attach, backendNow, fallBack, memory, run } from '../lib/secrets/vault'
import { placeOf, type ScanKey } from '../lib/secrets/places'

export { bytesOf } from '../lib/secrets/budget'
export type { Place, PlaceKey, ScanKey } from '../lib/secrets/places'

/**
 * How many keys the localStorage fallback keeps before the oldest opened or
 * crossed ones are dropped. IndexedDB has a byte budget instead.
 */
export const SECRETS_MAX = 400

export interface HeldKey {
  /** What the relay knows the region as: sha256 of the key. */
  lookupId: string
  /** The key itself, 32 bytes as hex. */
  keyHex: string
  /**
   * How wide the region is. A hiding place is a cube, so one height covers it;
   * a movement's region is a box, its three axes at their own crossing
   * heights, and `heights` carries those. `height` is the largest either way.
   */
  height: number
  heights?: { x: number; y: number; z: number }
  /** The region's aligned corner, as decimal strings. */
  base: { x: string; y: string; z: string }
  plane: Plane
  /**
   * How it was come by: a hop of your own, which grants the region it crossed;
   * a scan that opened something where you stood; or a purchase from HOSAKA.
   */
  source: 'hop' | 'scan' | 'cloud'
  /** The action that bought it, for the chain overlay's key marker. */
  eventId?: string
  /** First held, in seconds since the epoch. */
  at: number
}

/** A key being bought: what it is for, and how far along. */
export interface Buying {
  height: number
  status: 'submitting' | 'computing'
  costMsats: number
  /** The provider's own estimate for the job, in seconds. */
  estSeconds: number | null
  startedAt: number
}

/** A region key the machine has for where you are, this moment. */
export interface CurrentKey { keyHex: string; height: number }

/** Where the keys and places are kept, and how safe that is. */
export interface SecretsStorage {
  /**
   * `loading` until the first load settles; then `indexeddb`, or `local` when
   * IndexedDB could not be opened and the keys went back to localStorage.
   */
  mode: 'loading' | 'indexeddb' | 'local'
  /** Why IndexedDB is not in use, in a sentence, when it is not. */
  reason: string | null
  /**
   * What the kept rows take, serialized. In IndexedDB this is the database's
   * own running total, which every write updates in its transaction.
   */
  bytes: number
  /** How many places, and how many distinct cube keys they refer to. */
  places: number
  placeKeys: number
  /** The byte budget held keys and places share. */
  budget: number
  /**
   * Whether the browser agreed to keep this storage (navigator.storage.persist):
   * `granted`; `denied`; `unasked` until the first write of a session asks;
   * `unsupported` where the browser has no such call.
   */
  persisted: 'granted' | 'denied' | 'unasked' | 'unsupported'
  /** The last write that failed, if one did; the rows stay in memory either way. */
  error: string | null
  /** Why a bought key could not be copied to the localStorage backstop, if one could not. */
  backstopError: string | null
}

/** RESCAN ALL, while it runs and after. */
export interface RescanStatus {
  running: boolean
  /** Requests answered so far, of `requests`. */
  done: number
  requests: number
  /** Distinct lookup ids asked about. */
  asked: number
  /** Items opened in all, and how many of those were never opened on this device before. */
  found: number
  fresh: number
  /** Place keys that opened something and are held keys now. */
  held: number
  /** Why the run stopped, when it did not finish. */
  error: string | null
  /**
   * What was not fully answered, by relay and reason, with how many lookup
   * ids each covers. Empty when every relay answered every request in full.
   */
  skipped: Array<{ relay: string; why: string; ids: number }>
}

interface SecretsState {
  keys: Record<string, HeldKey>
  storage: SecretsStorage
  /**
   * Bumped whenever this tab changes the places, so a list showing them
   * reads them again. The places themselves are not held in memory.
   */
  placesVersion: number
  rescan: RescanStatus | null
  setRescan: (rescan: RescanStatus | null) => void
  /**
   * The keys of every region the anchor is standing in, all scan heights,
   * replaced whole on each passive scan. Not held and not persisted: they are
   * the thirteen cubes around you, recomputed the moment you cross into new
   * ones, and they are what opens an ephemeral envelope said in one of them.
   */
  current: Record<string, CurrentKey>
  setCurrent: (current: Record<string, CurrentKey>) => void
  /**
   * The keys of the 26 cubes of side 2^SCAN_MAX_HEIGHT around the one you are
   * in, so a line said one cube over is heard across the wall. Replaced whole
   * when you cross into a new cube of that size. Not held, not persisted.
   */
  neighbors: Record<string, CurrentKey>
  setNeighbors: (neighbors: Record<string, CurrentKey>) => void
  /** The purchase in flight, or null. */
  buying: Buying | null
  /** The region the list last sent you to look at: drawn bright, the rest dimmed. */
  focused: string | null
  focus: (lookupId: string | null) => void
  /** Whether the list is on screen. In the store, so RETURN can bring it back. */
  open: boolean
  setOpen: (open: boolean) => void
  /** How the list is ordered; kept while the modal is closed. */
  sort: SecretsSort
  setSort: (sort: SecretsSort) => void
  /** Why the last purchase did not happen. */
  buyError: string | null
  /** Note a key you now hold; keeps the one already held rather than replacing it. */
  hold: (keys: HeldKey[]) => void
  /** Forget one region. The key is gone; standing there again recomputes it. */
  forget: (lookupId: string) => void
  /**
   * Forget every key this tab holds, bought ones included: the panel asks
   * first and says how many were bought. A key another tab holds and this one
   * has not loaded is not touched.
   */
  forgetAll: () => void
  /**
   * Note where you stand at your own head, with the cube keys the scan had
   * there. The same spot again moves its time; keys other places share are
   * stored once.
   */
  recordPlace: (position: Position, plane: Plane, scan: ScanKey[]) => Promise<void>
  /** Forget one place, and the cube keys no other place refers to. Held keys are untouched. */
  forgetPlace: (id: string) => Promise<void>
  /**
   * Forget every place stood on up to now, and the cube keys no remaining
   * place refers to. Held keys are untouched.
   */
  forgetAllPlaces: () => Promise<void>
  /**
   * Open the store: IndexedDB, copying the localStorage keys in the first
   * time, else localStorage as before. Runs once; later calls get the same promise.
   */
  load: () => Promise<void>
  /**
   * Buy the key to the aligned cube of side 2^height around a coordinate.
   *
   * The work is three axis subtrees at that height, which is a hop's work and
   * is priced as one; this machine can do the small ones for itself as it
   * moves, so this is for the heights it cannot. Paid from the HOSAKA balance:
   * with nothing in it the purchase stops and says so, since topping up is the
   * Cloud panel's business and not a thing to do behind a modal.
   */
  /** Buy the key from HOSAKA; resolves to the held key, or null with buyError set. */
  buy: (at: { x: bigint; y: bigint; z: bigint }, plane: Plane, height: number) => Promise<HeldKey | null>
}

/** How the list is ordered. */
export type SecretsSort = 'recent' | 'volume'

/**
 * How much space a region covers, as the exponent of its volume in gibsons
 * cubed: a cube of side 2^8 is 2^24, and a bar of 2^8 x 2^0 x 2^0 is 2^8.
 * Kept as the exponent because the volumes themselves run past what a number
 * can hold, and the order is all that is being asked for.
 */
export function volumeExponent(k: HeldKey): number {
  return k.heights ? k.heights.x + k.heights.y + k.heights.z : k.height * 3
}

/** The regions held, newest first or largest first. */
export function heldList(keys: Record<string, HeldKey>, sort: SecretsSort = 'recent'): HeldKey[] {
  const list = Object.values(keys)
  return sort === 'volume'
    ? list.sort((a, b) => volumeExponent(b) - volumeExponent(a) || b.at - a.at)
    : list.sort((a, b) => b.at - a.at || volumeExponent(b) - volumeExponent(a))
}

export const useSecrets = create<SecretsState>((set, get) => ({
  keys: {},
  storage: { mode: 'loading', reason: null, bytes: 0, places: 0, placeKeys: 0, budget: SECRETS_BUDGET_BYTES, persisted: 'unasked', error: null, backstopError: null },
  placesVersion: 0,
  rescan: null,
  buying: null,
  buyError: null,
  focused: null,
  current: {},
  neighbors: {},
  open: false,
  sort: 'recent',

  hold: (incoming) => {
    if (incoming.length === 0) return
    // Before anything else can fail: a bought key is never only in memory.
    // Offered even when already held: buying a key again after another tab
    // forgot it (which took it out of the backstop) must put it back, or the
    // next load would apply that forget (review of #219, S1).
    backstop(incoming, [])
    // And a forget recorded without IndexedDB no longer applies to them.
    clearForgets(incoming.map((k) => k.lookupId))
    const keys = { ...get().keys }
    const added: HeldKey[] = []
    for (const k of incoming) {
      if (keys[k.lookupId]) continue
      keys[k.lookupId] = k
      added.push(k)
    }
    if (added.length === 0) return
    setKeys(keys)
    saveKeys(added, [])
  },

  forget: (lookupId) => {
    const k = get().keys[lookupId]
    if (!k) {
      // Before the load settles the list is empty, so the key is not in it
      // yet; the forget is kept and applied to what the load reads.
      if (backendNow() === 'none') { backstop([], [lookupId]); saveKeys([], [lookupId]) }
      return
    }
    const keys = { ...get().keys }
    delete keys[lookupId]
    // Forgetting a bought key is asked for by name, on its own row: it leaves
    // the backstop too, or it would come back on the next load.
    if (k.source === 'cloud') backstop([], [lookupId])
    setKeys(keys)
    saveKeys([], [lookupId])
  },

  forgetAll: () => {
    const all = Object.values(get().keys)
    if (all.length === 0) return
    // Only what this tab holds, by id: clearing the store would also take a
    // key another tab bought after this one loaded, which nobody confirmed.
    backstop([], all.filter((k) => k.source === 'cloud').map((k) => k.lookupId))
    setKeys({})
    saveKeys([], all.map((k) => k.lookupId))
  },

  recordPlace: async (position, plane, scan) => {
    const next = placeOf(position, plane, scan, Math.floor(Date.now() / 1000))
    if (!next) return
    if (backendNow() === 'idb') {
      // Straight to the database: one transaction of a few reads and writes,
      // whatever the number of places already kept.
      await persist((db) => recordPlaceRow(db, next.place, next.keys))
    } else {
      memory.record(next.place, next.keys)
      memoryTotals()
    }
    placesChanged()
  },

  forgetPlace: async (id) => {
    if (backendNow() === 'idb') await persist((db) => forgetPlaceRow(db, id))
    else { memory.forget(id); memoryTotals() }
    placesChanged()
  },

  forgetAllPlaces: async () => {
    const now = Math.floor(Date.now() / 1000)
    if (backendNow() === 'idb') await persist((db) => forgetPlacesUpTo(db, now))
    else { memory.forgetUpTo(now); memoryTotals() }
    placesChanged()
  },

  setRescan: (rescan) => set({ rescan }),

  focus: (lookupId) => set({ focused: lookupId }),

  setCurrent: (current) => set({ current }),

  setNeighbors: (neighbors) => set({ neighbors }),

  setOpen: (open) => set({ open }),

  setSort: (sort) => set({ sort }),

  buy: async (at, plane, height) => {
    if (get().buying) return null
    const cs = useCyberspace.getState()
    set({ buying: { height, status: 'submitting', costMsats: 0, estSeconds: null, startedAt: Date.now() }, buyError: null })
    // The store's job driver: a short balance gets the job's own invoice in
    // the invoice modal, and the job starts when it settles.
    const outcome = await cs.buyRegionKey(at, plane, height)
    if (!outcome.ok) {
      set({ buying: null, buyError: outcome.error })
      return null
    }
    const r = outcome.result
    const held: HeldKey = {
      lookupId: r.lookup_id,
      keyHex: r.secret_key,
      height: r.height ?? height,
      base: {
        x: String(r.base?.x ?? (at.x >> BigInt(height)) << BigInt(height)),
        y: String(r.base?.y ?? (at.y >> BigInt(height)) << BigInt(height)),
        z: String(r.base?.z ?? (at.z >> BigInt(height)) << BigInt(height)),
      },
      plane,
      source: 'cloud',
      at: Math.floor(Date.now() / 1000),
    }
    get().hold([held])
    set({ buying: null })
    // What was bought is worth looking in at once.
    void useShards.getState().rescan(r.lookup_id, r.secret_key)
    return held
  },

  load: () => {
    loading ??= (async () => {
      if (typeof indexedDB === 'undefined') {
        fallBackToLocal('This browser has no IndexedDB here, which private browsing and some embedded browsers turn off.')
      } else {
        let opened: IDBDatabase | null = null
        try {
          opened = await openSecretsDb()
          // The totals first: a database whose record is missing is measured
          // before the copy below adds to a record that would start at zero.
          await readTotals(opened)
          await migrateFromLocalStorage(opened, localStore())
          await syncLegacy(opened, localStore())
          const stored = await readKeys(opened)
          const totals = await readTotals(opened)
          await adopt(opened, stored, totals)
        } catch (err) {
          console.warn('[secrets] IndexedDB unavailable, keeping keys in localStorage:', err)
          if (backendNow() !== 'idb') {
            try { opened?.close() } catch { /* already closed */ }
            fallBackToLocal(`The browser refused IndexedDB (${describeError(err)}).`)
          }
        }
      }
      void checkPersisted()
    })()
    return loading
  },
}))

/*
 * Where the rows go: lib/secrets/vault knows which of IndexedDB, the
 * localStorage fallback, or nothing yet (before load settles) is in use, and
 * holds the connection. A key held before load is kept in memory and written
 * once load knows where; a place recorded then waits in vault's memory store.
 */
let loading: Promise<void> | null = null
let persistAsked = false
let evicting = false
/**
 * Keys forgotten before the load settled. The list was empty then, so the
 * forget had nothing to remove; load removes them from what it reads.
 */
const forgottenEarly = new Set<string>()

/** Put a new key list in the state: the fallback keeps its old count cap, IndexedDB a byte budget. */
function setKeys(keys: Record<string, HeldKey>): void {
  const kept = backendNow() === 'local' ? trimByCount(keys, SECRETS_MAX) : keys
  useSecrets.setState({ keys: kept })
  if (backendNow() !== 'idb') memoryTotals()
}

/**
 * Save a change to the held keys wherever they are kept. Before load, holds
 * wait in memory and forgets in `forgottenEarly`; load applies both.
 */
function saveKeys(puts: HeldKey[], deletes: string[]): void {
  const backend = backendNow()
  if (backend === 'idb') {
    void persist((db) => writeKeys(db, puts, deletes))
  } else if (backend === 'local') {
    // Only what this session did, in its own record: the next session that
    // opens IndexedDB applies it and nothing else from localStorage.
    askToPersist()
    const failed = noteFallback(puts, deletes)
    if (failed) useSecrets.setState((s) => ({ storage: { ...s.storage, error: `Could not save to localStorage: ${failed}` } }))
  } else {
    for (const k of puts) forgottenEarly.delete(k.lookupId)
    for (const id of deletes) forgottenEarly.add(id)
  }
}

/**
 * Keep the backstop in step with bought keys held and forgotten, and say so
 * in the panel when it cannot be written. Once a write lands again after one
 * failed, every bought key held is offered again, so the one that missed it
 * is not left out.
 */
function backstop(add: HeldKey[], remove: string[]): void {
  let failed = updateBought(add, remove)
  if (!failed && useSecrets.getState().storage.backstopError) failed = updateBought(Object.values(useSecrets.getState().keys))
  if (failed !== useSecrets.getState().storage.backstopError) useSecrets.setState((s) => ({ storage: { ...s.storage, backstopError: failed } }))
}

/**
 * Run a write against IndexedDB (vault.run reopens and retries once), and
 * take the totals it left. Resolves to whether it landed; a failure is shown
 * in the panel rather than thrown.
 */
async function persist(op: (db: IDBDatabase) => Promise<Totals>): Promise<boolean> {
  askToPersist()
  try {
    applyTotals(await run(op))
    return true
  } catch (err) {
    const message = describeError(err)
    console.warn('[secrets] write failed:', message)
    useSecrets.setState((s) => ({ storage: { ...s.storage, error: message } }))
    return false
  }
}

function applyTotals(t: Totals): void {
  useSecrets.setState((s) => ({ storage: { ...s.storage, bytes: t.bytes, places: t.places, placeKeys: t.placeKeys, error: null } }))
  const { bytes, budget } = useSecrets.getState().storage
  if (bytes > budget) void evict()
}

/** Outside IndexedDB, the totals are the held keys and the places in memory, both small. */
function memoryTotals(): void {
  const places = memory.totals()
  const keyBytes = bytesOfAll(Object.values(useSecrets.getState().keys))
  useSecrets.setState((s) => ({ storage: { ...s.storage, bytes: keyBytes + places.bytes, places: places.places, placeKeys: places.placeKeys } }))
}

function placesChanged(): void {
  useSecrets.setState((s) => ({ placesVersion: s.placesVersion + 1 }))
}

/**
 * Over the budget: evict down to EVICT_TO of it in one pass (budget.ts says
 * the order). Places a few hundred at a time from the oldest end of their
 * time index, then opened and crossed keys oldest first, never bought keys.
 * One pass at a time; a write that lands meanwhile is counted by the next.
 */
async function evict(): Promise<void> {
  if (evicting || backendNow() !== 'idb') return
  evicting = true
  try {
    const target = Math.floor(useSecrets.getState().storage.budget * EVICT_TO)
    for (;;) {
      const { bytes, places } = useSecrets.getState().storage
      const need = bytes - target
      if (need <= 0) break
      if (places > 0) {
        const { totals, removed } = await run((db) => evictPlaces(db, need, EVICT_PLACES_PER_PASS))
        useSecrets.setState((s) => ({ storage: { ...s.storage, bytes: totals.bytes, places: totals.places, placeKeys: totals.placeKeys } }))
        placesChanged()
        if (removed > 0) continue
      }
      const drop = earnedToEvict(useSecrets.getState().keys, need)
      // Only bought keys left: they stay, and the total stays over.
      if (drop.length === 0) break
      const keys = { ...useSecrets.getState().keys }
      for (const k of drop) delete keys[k.lookupId]
      useSecrets.setState({ keys })
      const totals = await run((db) => writeKeys(db, [], drop.map((k) => k.lookupId)))
      useSecrets.setState((s) => ({ storage: { ...s.storage, bytes: totals.bytes, places: totals.places, placeKeys: totals.placeKeys } }))
    }
  } catch (err) {
    const message = describeError(err)
    useSecrets.setState((s) => ({ storage: { ...s.storage, error: message } }))
  } finally {
    evicting = false
  }
}

/** localStorage, or null where touching it throws. */
function localStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * IndexedDB is open. Take its keys, and settle what happened elsewhere:
 * - keys this session held before the load finished fill gaps, and keys it
 *   forgot then are removed;
 * - bought keys from the backstop fill gaps, so one bought while IndexedDB
 *   was out (or whose write never landed) is held again;
 * - what fallback sessions did since IndexedDB last loaded: their holds fill
 *   gaps and their forgets are removed, then their record is cleared.
 * A row already in the database is never replaced by any of these copies.
 * Every bought key held is offered to the backstop, which is never cleared.
 * Places recorded before the load are moved in.
 */
async function adopt(opened: IDBDatabase, stored: HeldKey[], totals: Totals): Promise<void> {
  const keys: Record<string, HeldKey> = {}
  for (const k of stored) keys[k.lookupId] = k
  const byId: Record<string, HeldKey> = { ...keys }
  const missing = new Map<string, HeldKey>()
  const take = (k: HeldKey): void => {
    if (keys[k.lookupId]) return
    keys[k.lookupId] = k
    missing.set(k.lookupId, k)
  }
  const early = useSecrets.getState().keys
  for (const k of Object.values(early)) take(k)
  const bought = readBought()
  for (const k of Object.values(bought)) take(k)
  const fallback = readFallback()
  for (const k of Object.values(fallback.held)) take(k)
  // A fallback forget no longer applies when the key was held again since:
  // - held by this session before the load, which is later than any forget;
  // - in the backstop, which every forget of a bought key empties, so it was
  //   bought again after it (review of #219, S1);
  // - a row here first held after the forget, as when a hop crosses the
  //   region again, or this record survived a load whose write failed.
  const stillApplies = (f: { id: string; at: number }): boolean => {
    const row = byId[f.id]
    return !early[f.id] && !bought[f.id] && !(row && row.at >= f.at)
  }
  const applied = fallback.forgotten.filter(stillApplies)
  const forgets = new Set([...applied.map((f) => f.id), ...forgottenEarly])
  forgottenEarly.clear()
  for (const id of forgets) { delete keys[id]; missing.delete(id) }
  const places = memory.drain()
  // In one step, so nothing held from here on can miss both the merge and the database.
  attach(opened)
  useSecrets.setState((s) => ({
    keys,
    storage: { ...s.storage, mode: 'indexeddb', reason: null, bytes: totals.bytes, places: totals.places, placeKeys: totals.placeKeys },
  }))
  backstop(Object.values(keys), [])
  const settled = (missing.size === 0 && forgets.size === 0) || await persist((db) => writeKeys(db, [...missing.values()], [...forgets]))
  // Only what was read and applied leaves the record: a fallback tab still
  // open may have added to it meanwhile (review of #219, N1). A forget that
  // no longer applied is done with too.
  if (settled && (Object.keys(fallback.held).length > 0 || fallback.forgotten.length > 0)) dropApplied(fallback)
  for (const { place, keys: placeKeys } of places) await persist((db) => recordPlaceRow(db, place, placeKeys))
  if (places.length > 0) placesChanged()
}

/**
 * IndexedDB is out for this session. The list shown is the best this browser
 * has: the old localStorage list (read, never written), with what earlier
 * fallback sessions held and forgot applied, and the bought keys from the
 * backstop. Nothing is written until this session holds or forgets a key, and
 * then only to its own record (saveKeys), so a session that does nothing
 * cannot bring back a key forgotten in IndexedDB.
 */
function fallBackToLocal(reason: string): void {
  fallBack()
  const early = useSecrets.getState().keys
  const fallback = readFallback()
  const keys = readLegacyList(localStore())?.keys ?? {}
  for (const f of fallback.forgotten) delete keys[f.id]
  for (const k of [...Object.values(fallback.held), ...Object.values(readBought()), ...Object.values(early)]) {
    if (!keys[k.lookupId]) keys[k.lookupId] = k
  }
  const forgets = [...forgottenEarly]
  forgottenEarly.clear()
  for (const id of forgets) delete keys[id]
  useSecrets.setState((s) => ({ storage: { ...s.storage, mode: 'local', reason } }))
  setKeys(keys)
  // What this session did before the load settled is this session's to record.
  saveKeys(Object.values(early).filter((k) => keys[k.lookupId]), forgets)
}

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

function setPersisted(persisted: SecretsStorage['persisted']): void {
  useSecrets.setState((s) => ({ storage: { ...s.storage, persisted } }))
}

/** What the browser has already agreed to, read at load without asking for anything. */
async function checkPersisted(): Promise<void> {
  const sm = storageManager()
  if (!sm || typeof sm.persist !== 'function') { setPersisted('unsupported'); return }
  try { if (await sm.persisted?.()) setPersisted('granted') } catch { /* stays unasked */ }
}

/**
 * Ask the browser to keep this storage, once a session, at the first write:
 * asking on page load would ask before there is anything worth keeping, and
 * Firefox asks the person, which is a prompt they should see for a reason.
 */
function askToPersist(): void {
  if (persistAsked) return
  persistAsked = true
  const sm = storageManager()
  if (!sm || typeof sm.persist !== 'function') { setPersisted('unsupported'); return }
  void (async () => {
    try {
      const granted = (await sm.persisted?.()) || await sm.persist()
      setPersisted(granted ? 'granted' : 'denied')
    } catch {
      setPersisted('denied')
    }
  })()
}

/**
 * Leaving a region goes back to the list.
 *
 * A view can end several ways: RETURN on the bar, a hyperspace exit, walking
 * the chain, a respawn. Rather than teach each of them about the Secrets list,
 * this watches the focus itself: when a view that came from the list ends, the
 * list comes back and nothing is left highlighted in the scene.
 *
 * Started from the app rather than at import: these two stores import each
 * other, and subscribing at module scope reached for the other one before it
 * existed.
 */
export function watchFocus(): () => void {
  return useCyberspace.subscribe((state, previous) => {
    if (previous.focus === null || state.focus !== null) return
    const { focused, focus, setOpen } = useSecrets.getState()
    if (focused === null) return
    focus(null)
    setOpen(true)
  })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __secrets?: unknown }).__secrets = useSecrets
}

/** Whether a chain action left you a region key, and whether you still hold it. */
export type KeyState = 'none' | 'held' | 'gone'

/**
 * What an action yielded.
 *
 * A hop computes the Cantor root of the region it crossed, which is the key to
 * whatever is hidden there (spec §7). A sidestep computes a Merkle path across
 * one boundary and no root at all, which is the whole difference between
 * unlocking a wall and bypassing it. A spawn comes from nowhere and crosses
 * nothing.
 *
 * `gone` means the key is not in the list any more: forgotten here, or never
 * kept because the region is larger than this machine sweeps.
 */
export function keyStateForAction(
  action: { type: string; position: { x: bigint; y: bigint; z: bigint }; plane: Plane },
  previous: { position: { x: bigint; y: bigint; z: bigint } } | null,
  keys: Record<string, HeldKey>,
  lcaHeight: (a: bigint, b: bigint) => number,
): { state: KeyState; height: number | null } {
  if (action.type !== 'hop' || !previous) return { state: 'none', height: null }
  const height = Math.max(
    lcaHeight(previous.position.x, action.position.x),
    lcaHeight(previous.position.y, action.position.y),
    lcaHeight(previous.position.z, action.position.z),
  )
  if (height <= 0) return { state: 'none', height: null }
  const h = BigInt(height)
  const base = {
    x: String((action.position.x >> h) << h),
    y: String((action.position.y >> h) << h),
    z: String((action.position.z >> h) << h),
  }
  for (const k of Object.values(keys)) {
    if (k.height !== height || k.plane !== action.plane) continue
    if (k.base.x === base.x && k.base.y === base.y && k.base.z === base.z) return { state: 'held', height }
  }
  return { state: 'gone', height }
}
