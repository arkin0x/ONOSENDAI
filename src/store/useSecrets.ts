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
 * drops a bought key. The state here is the whole of it in memory, so every
 * reader keeps reading `keys` as before. Where IndexedDB cannot be opened
 * (some private modes, a browser that refuses it), the keys fall back to
 * localStorage as they were kept before, the 400 newest, and places last only
 * as long as the page.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { writeBatch, type WriteOp } from '../lib/idb'
import type { Position } from '../lib/space'
import { SECRETS_BUDGET_BYTES, bytesOf, bytesOfAll, planEviction, trimByCount, type Kept } from '../lib/secrets/budget'
import { KEYS_STORE, LEGACY_KEY, PLACES_STORE, PLACE_KEYS_STORE, migrateFromLocalStorage, openSecretsDb, parseLegacy, readAll, type Stored } from '../lib/secrets/db'
import { mergePlace, orphanedBy, placeOf, type Place, type PlaceKey, type ScanKey } from '../lib/secrets/places'

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
  /** What the kept rows take, serialized: a running total, measured whole only at load. */
  bytes: number
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
}

interface SecretsState {
  keys: Record<string, HeldKey>
  /** Where you stood at your own head, by place id. Not drawn and not in the key list. */
  places: Record<string, Place>
  /** The cube keys places refer to, by lookup id, each stored once. */
  placeKeys: Record<string, PlaceKey>
  storage: SecretsStorage
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
  /** Forget every held key, bought ones included: the panel asks first and says so. */
  forgetAll: () => void
  /**
   * Note where you stand at your own head, with the cube keys the scan had
   * there. The same spot again moves its time; keys other places share are
   * stored once.
   */
  recordPlace: (position: Position, plane: Plane, scan: ScanKey[]) => void
  /** Forget one place, and the cube keys no other place refers to. Held keys are untouched. */
  forgetPlace: (id: string) => void
  /** Forget every place and every place key. Held keys are untouched. */
  forgetAllPlaces: () => void
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
  places: {},
  placeKeys: {},
  storage: { mode: 'loading', reason: null, bytes: 0, budget: SECRETS_BUDGET_BYTES, persisted: 'unasked', error: null },
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
    const keys = { ...get().keys }
    const ops: WriteOp[] = []
    let total = get().storage.bytes
    for (const k of incoming) {
      if (keys[k.lookupId]) continue
      keys[k.lookupId] = k
      ops.push({ store: KEYS_STORE, put: k })
      total += bytesOf(k)
    }
    if (ops.length === 0) return
    commit({ ...kept(), keys }, total, ops)
  },

  forget: (lookupId) => {
    const k = get().keys[lookupId]
    if (!k) return
    const keys = { ...get().keys }
    delete keys[lookupId]
    commit({ ...kept(), keys }, get().storage.bytes - bytesOf(k), [{ store: KEYS_STORE, delete: lookupId }])
  },

  forgetAll: () => {
    const freed = bytesOfAll(Object.values(get().keys))
    commit({ ...kept(), keys: {} }, get().storage.bytes - freed, [{ store: KEYS_STORE, clear: true }])
  },

  recordPlace: (position, plane, scan) => {
    const next = placeOf(position, plane, scan, Math.floor(Date.now() / 1000))
    if (!next) return
    const { places, placeKeys, storage } = get()
    const { place, newKeys, previous } = mergePlace(places, placeKeys, next)
    // The same spot in the same second: nothing to say.
    if (previous && previous.at === place.at) return
    const ops: WriteOp[] = [{ store: PLACES_STORE, put: place }]
    let total = storage.bytes + bytesOf(place) - (previous ? bytesOf(previous) : 0)
    const nextKeys = newKeys.length > 0 ? { ...placeKeys } : placeKeys
    for (const k of newKeys) {
      nextKeys[k.lookupId] = k
      ops.push({ store: PLACE_KEYS_STORE, put: k })
      total += bytesOf(k)
    }
    commit({ ...kept(), places: { ...places, [place.id]: place }, placeKeys: nextKeys }, total, ops)
  },

  forgetPlace: (id) => {
    const { places, placeKeys, storage } = get()
    const place = places[id]
    if (!place) return
    const rest = { ...places }
    delete rest[id]
    const nextKeys = { ...placeKeys }
    const ops: WriteOp[] = [{ store: PLACES_STORE, delete: id }]
    let freed = bytesOf(place)
    for (const orphan of orphanedBy([place], places)) {
      const k = nextKeys[orphan]
      if (!k) continue
      delete nextKeys[orphan]
      ops.push({ store: PLACE_KEYS_STORE, delete: orphan })
      freed += bytesOf(k)
    }
    commit({ ...kept(), places: rest, placeKeys: nextKeys }, storage.bytes - freed, ops)
  },

  forgetAllPlaces: () => {
    const { places, placeKeys, storage } = get()
    const freed = bytesOfAll(Object.values(places)) + bytesOfAll(Object.values(placeKeys))
    commit({ ...kept(), places: {}, placeKeys: {} }, storage.bytes - freed, [
      { store: PLACES_STORE, clear: true },
      { store: PLACE_KEYS_STORE, clear: true },
    ])
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
        return
      }
      try {
        const opened = await openSecretsDb()
        await migrateFromLocalStorage(opened, localStore())
        adopt(opened, await readAll(opened))
      } catch (err) {
        console.warn('[secrets] IndexedDB unavailable, keeping keys in localStorage:', err)
        fallBackToLocal(`The browser refused IndexedDB (${err instanceof Error ? err.message : String(err)}).`)
      }
      void checkPersisted()
    })()
    return loading
  },
}))

/*
 * Where the rows go.
 *
 * `none` until load settles: a key held before then stays in memory, and the
 * load writes it once it knows where to. `idb` writes each change as its own
 * transaction, fired and not awaited; transactions commit in the order they
 * are created, so a put and a later delete of the same row land in that
 * order. `local` is the old way: the whole key list as one string, and no
 * places at all.
 */
let backend: 'none' | 'idb' | 'local' = 'none'
let db: IDBDatabase | null = null
let loading: Promise<void> | null = null
let persistAsked = false

function kept(): Kept {
  const { keys, places, placeKeys } = useSecrets.getState()
  return { keys, places, placeKeys }
}

/**
 * Settle a change: drop what no longer fits, put the result in the state, and
 * write the change and the drops together.
 */
function commit(next: Kept, total: number, ops: WriteOp[]): void {
  const settled = fit(next, total)
  useSecrets.setState((s) => ({ ...settled.kept, storage: { ...s.storage, bytes: settled.total } }))
  write([...ops, ...settled.ops])
}

/**
 * Bring what is kept within its limit: the byte budget in IndexedDB (and in
 * memory before load, which is where it is headed), the old count in
 * localStorage. Returns the rows left, the new total, and the deletes to write.
 */
function fit(next: Kept, total: number): { kept: Kept; total: number; ops: WriteOp[] } {
  if (backend === 'local') {
    const keys = trimByCount(next.keys, SECRETS_MAX)
    if (keys === next.keys) return { kept: next, total, ops: [] }
    let freed = 0
    for (const [id, k] of Object.entries(next.keys)) if (!keys[id]) freed += bytesOf(k)
    return { kept: { ...next, keys }, total: total - freed, ops: [] }
  }
  const plan = planEviction(next, total, useSecrets.getState().storage.budget)
  if (plan.places.length + plan.placeKeys.length + plan.keys.length === 0) return { kept: next, total, ops: [] }
  const keys = { ...next.keys }
  const places = { ...next.places }
  const placeKeys = { ...next.placeKeys }
  const ops: WriteOp[] = []
  for (const id of plan.places) { delete places[id]; ops.push({ store: PLACES_STORE, delete: id }) }
  for (const id of plan.placeKeys) { delete placeKeys[id]; ops.push({ store: PLACE_KEYS_STORE, delete: id }) }
  for (const id of plan.keys) { delete keys[id]; ops.push({ store: KEYS_STORE, delete: id }) }
  return { kept: { keys, places, placeKeys }, total: total - plan.bytes, ops }
}

function write(ops: WriteOp[]): void {
  if (ops.length === 0) return
  if (backend === 'idb' && db) {
    askToPersist()
    writeBatch(db, ops).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[secrets] write failed:', message)
      useSecrets.setState((s) => ({ storage: { ...s.storage, error: message } }))
    })
  } else if (backend === 'local' && ops.some((op) => op.store === KEYS_STORE)) {
    askToPersist()
    try { localStorage.setItem(LEGACY_KEY, JSON.stringify(useSecrets.getState().keys)) } catch { /* private mode */ }
  }
}

/** localStorage, or null where touching it throws. */
function localStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * IndexedDB is open: take what it holds, add what this session held before
 * the load finished, and write those additions. The one place the whole
 * store is measured.
 */
function adopt(opened: IDBDatabase, stored: Stored): void {
  const mem = useSecrets.getState()
  const ops: WriteOp[] = []
  const keys: Record<string, HeldKey> = {}
  for (const k of stored.keys) keys[k.lookupId] = k
  for (const k of Object.values(mem.keys)) {
    if (keys[k.lookupId]) continue
    keys[k.lookupId] = k
    ops.push({ store: KEYS_STORE, put: k })
  }
  const places: Record<string, Place> = {}
  for (const p of stored.places) places[p.id] = p
  for (const p of Object.values(mem.places)) {
    const was = places[p.id]
    if (was && was.at >= p.at) continue
    places[p.id] = was ? { ...p, first: Math.min(was.first, p.first) } : p
    ops.push({ store: PLACES_STORE, put: places[p.id] })
  }
  const placeKeys: Record<string, PlaceKey> = {}
  for (const k of stored.placeKeys) placeKeys[k.lookupId] = k
  for (const k of Object.values(mem.placeKeys)) {
    if (placeKeys[k.lookupId]) continue
    placeKeys[k.lookupId] = k
    ops.push({ store: PLACE_KEYS_STORE, put: k })
  }
  // A newer version of this database opened in another tab waits on every
  // older connection; this one steps aside instead of blocking it, and later
  // writes here fail into storage.error rather than hang.
  opened.onversionchange = () => opened.close()
  db = opened
  backend = 'idb'
  const total = bytesOfAll(Object.values(keys)) + bytesOfAll(Object.values(places)) + bytesOfAll(Object.values(placeKeys))
  useSecrets.setState((s) => ({ storage: { ...s.storage, mode: 'indexeddb', reason: null } }))
  commit({ keys, places, placeKeys }, total, ops)
}

/** IndexedDB is out: the keys come from and go to localStorage, as before this database. */
function fallBackToLocal(reason: string): void {
  backend = 'local'
  const mem = useSecrets.getState()
  const keys = parseLegacy(localStore()?.getItem(LEGACY_KEY) ?? null)
  // What this session held before the load settled; writing any of it
  // rewrites the whole list, which is how localStorage was always written.
  const ops: WriteOp[] = []
  for (const k of Object.values(mem.keys)) {
    if (keys[k.lookupId]) continue
    keys[k.lookupId] = k
    ops.push({ store: KEYS_STORE, put: k })
  }
  const total = bytesOfAll(Object.values(keys)) + bytesOfAll(Object.values(mem.places)) + bytesOfAll(Object.values(mem.placeKeys))
  useSecrets.setState((s) => ({ storage: { ...s.storage, mode: 'local', reason } }))
  commit({ keys, places: mem.places, placeKeys: mem.placeKeys }, total, ops)
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
