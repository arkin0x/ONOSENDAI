/**
 * useInventory.ts: the ITEMS panel's store, what this identity holds.
 *
 * Keys taken from bags, keys the identity forged, and contents taken out of
 * chests (lib/inventory.ts HeldItem), one row per item, kept in IndexedDB per
 * identity (lib/inventoryDb.ts) so they survive a reload and switching back to
 * an identity brings its items back. Everything held is also here in memory,
 * because the rows, the chest opener and the DISCOVERED panel read them.
 *
 * Nothing found is held until it is taken (arkinox, 2026-10-26): TAKE on
 * a found item (holdFinds) or on a chest's content (take) holds it. Holding
 * is idempotent: a key taken twice is held once (addHeld). A take that
 * lands before the load for this identity has finished is kept and merged
 * when it does, so nothing taken in the first second is lost. Where
 * IndexedDB cannot be opened, items last the session and the panel says so.
 *
 * The identity is watched from load() rather than at module load, because
 * this store sits inside the stores' import cycle (useCyberspace imports the
 * secrets store, which imports the shards store, which imports this one) and
 * a subscription at module evaluation would reach for a store not yet made.
 */

import { create } from 'zustand'
import type { NostrEvent } from '../lib/events'
import type { ChestEntry } from '../lib/chests'
import type { Hidden, KeyItem } from '../lib/hidden'
import { KEY_TEXT_PREFIX, addHeld, heldFromEntry, heldFromFind, heldFromForged, heldFromPasted, holdsModel, parseKeyText, type HeldFrom, type HeldItem, type HeldPlace } from '../lib/inventory'
import { describeError } from '../lib/secrets/db'
import { openInventoryDb, readHeld, writeHeld } from '../lib/inventoryDb'
import { useCyberspace } from './useCyberspace'

export type InventoryStorage = 'loading' | 'indexeddb' | 'memory'

export interface PasteResult {
  ok: boolean
  /** Why the paste was refused, when it was. */
  reason?: string
  /** The key, held now or held already. */
  item?: HeldItem
  already?: boolean
}

interface InventoryState {
  /** The identity whose items these are. */
  owner: string
  /** By item id, this identity's. */
  items: Record<string, HeldItem>
  storage: InventoryStorage
  /** Read this identity's items (the current one when no owner is given), and start following identity changes. */
  load: (owner?: string) => Promise<void>
  /** Hold these; returns what was new. */
  add: (items: HeldItem[]) => HeldItem[]
  /** Resolves once every write so far has reached the database, or failed and been said. */
  flush: () => Promise<void>
  /**
   * TAKE: hold every key among these finds. Found is not held (arkinox,
   * 2026-10-26: "I dont want items to automatically be added to my
   * inventory the moment i decrypt them from a bag. i want to TAKE them"),
   * so a scan never calls this; TAKE on a found item does. `watched` holds
   * a key only Cyberspace TV showed as watched: it opens nothing by itself.
   */
  holdFinds: (finds: Hidden[], watched?: boolean) => HeldItem[]
  /** A scan found these in play: a key held as watched (TV showed it) is an ordinary key from here on. Holds nothing new. */
  markPlayed: (finds: Hidden[]) => void
  /** Hold a key this identity forged and hid, at once (B1 §3.1). */
  holdForged: (event: NostrEvent, key: KeyItem, place: HeldPlace) => HeldItem
  /** TAKE: hold contents out of an opened chest. */
  take: (entries: ChestEntry[], from: HeldFrom, place: HeldPlace | null) => HeldItem[]
  /** Take these rows off the TAKEN list, keeping them held (moved into the workshop, or cleared). */
  clearTaken: (ids: string[]) => void
  /** PASTE: hold a key from its text. */
  paste: (text: string) => PasteResult
  has: (id: string) => boolean
}

let db: Promise<IDBDatabase | null> | null = null

function database(): Promise<IDBDatabase | null> {
  if (!db) {
    db = openInventoryDb().catch((err: unknown) => {
      console.warn(`[inventory] IndexedDB unavailable, items last this session only: ${describeError(err)}`)
      return null
    })
  }
  return db
}

/** The writes so far, one after another, so flush() can wait for every one of them. */
let writes: Promise<void> = Promise.resolve()

/** Write rows, off the frame; a failed write is said once and the rows stay in memory. */
function persist(rows: HeldItem[]): Promise<void> {
  if (rows.length === 0) return writes
  writes = writes
    .then(() => database())
    .then((d) => (d ? writeHeld(d, rows) : undefined))
    .catch((err: unknown) => {
      console.warn(`[inventory] could not write ${rows.length} item${rows.length === 1 ? '' : 's'}: ${describeError(err)}`)
    })
  return writes
}

let watching = false
const now = (): number => Math.floor(Date.now() / 1000)

export const useInventory = create<InventoryState>((set, get) => {
  /**
   * Whose items are being held. Before load() has run (a find in the first
   * moment of a session) the owner is the identity as it stands, adopted here
   * so the hold is shown, and load() for the same identity merges onto it.
   */
  const ownerNow = (): string => {
    const o = get().owner
    if (o) return o
    const who = useCyberspace.getState().identity.pubkey
    set({ owner: who })
    return who
  }

  return {
  owner: '',
  items: {},
  storage: 'loading',

  load: async (owner) => {
    if (!watching) {
      watching = true
      useCyberspace.subscribe((s, prev) => { if (s.identity.pubkey !== prev.identity.pubkey) void get().load(s.identity.pubkey) })
    }
    const who = owner ?? useCyberspace.getState().identity.pubkey
    // A new identity shows nothing of the old one's, from this moment.
    if (who !== get().owner) set({ owner: who, items: {}, storage: 'loading' })
    const d = await database()
    if (get().owner !== who) return
    if (!d) { set({ storage: 'memory' }); return }
    let rows: HeldItem[] = []
    try { rows = await readHeld(d, who) } catch (err) {
      console.warn(`[inventory] could not read items: ${describeError(err)}`)
      set({ storage: 'memory' })
      return
    }
    if (get().owner !== who) return
    // What was held while the read ran (a scan's finds) joins what was on disk
    // and is written, since add() may have run before the database answered.
    const onDisk: Record<string, HeldItem> = {}
    for (const r of rows) onDisk[r.id] = r
    const { items, added } = addHeld(onDisk, Object.values(get().items))
    set({ items, storage: 'indexeddb' })
    void persist(added)
  },

  add: (list) => {
    // Every row is built for the owner as it stands (ownerNow), so all of them are this identity's.
    ownerNow()
    const { items, added } = addHeld(get().items, list)
    if (added.length > 0) set({ items })
    void persist(added)
    return added
  },

  flush: () => writes,

  holdFinds: (finds, watched = false) => {
    const owner = ownerNow()
    const at = now()
    const rows: HeldItem[] = []
    for (const h of finds) {
      const r = heldFromFind(owner, h, at, watched)
      if (r) rows.push(r)
    }
    if (!watched) get().markPlayed(finds)
    return rows.length > 0 ? get().add(rows) : []
  },

  markPlayed: (finds) => {
    // A key TV showed, now found in play: an ordinary key from here on.
    const held = get().items
    const played: HeldItem[] = []
    for (const h of finds) {
      const it = held[h.eventId]
      if (h.type !== 'key' || !it?.watched) continue
      const { watched: _, ...rest } = it
      played.push(rest)
    }
    if (played.length === 0) return
    const items = { ...held }
    for (const r of played) items[r.id] = r
    set({ items })
    void persist(played)
  },

  holdForged: (event, key, place) => {
    const item = heldFromForged(ownerNow(), event, key, place, now())
    get().add([item])
    return get().items[item.id] ?? item
  },

  take: (entries, from, place) => {
    const owner = ownerNow()
    const at = now()
    // One shard per model (arkinox, 2026-10-11): a content whose geometry is
    // already held, under any name, is not taken again, nor twice in one
    // TAKE ALL (a chest's two identical Columns are one shard to take).
    const fresh: HeldItem[] = []
    let seen = get().items
    for (const e of entries) {
      if (e.body.type === 'shard' && e.body.shard && holdsModel(seen, e.body.shard)) continue
      const row = heldFromEntry(owner, e, from, place, at)
      if (row.shard) seen = { ...seen, [row.id]: row }
      fresh.push(row)
    }
    return get().add(fresh)
  },

  clearTaken: (ids) => {
    const at = now()
    const items = { ...get().items }
    const changed: HeldItem[] = []
    for (const id of ids) {
      const it = items[id]
      if (!it || it.type === 'key' || it.cleared) continue
      items[id] = { ...it, cleared: at }
      changed.push(items[id])
    }
    if (changed.length === 0) return
    set({ items })
    void persist(changed)
  },

  paste: (text) => {
    const parsed = parseKeyText(text)
    if (!parsed) return { ok: false, reason: `Not an item. An item copied from ITEMS begins with ${KEY_TEXT_PREFIX} and carries the item's event as JSON.` }
    const owner = ownerNow()
    const held = get().items[parsed.event.id]
    if (held) return { ok: true, item: held, already: true }
    const item = heldFromPasted(owner, parsed.event, parsed.key, parsed.verified, now())
    get().add([item])
    return { ok: true, item, already: false }
  },

  has: (id) => !!get().items[id],
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __inventory?: unknown }).__inventory = useInventory
}
