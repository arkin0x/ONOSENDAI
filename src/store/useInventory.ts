/**
 * useInventory.ts: the LOOT panel's store, what this identity holds.
 *
 * Keys read out of bags, keys the identity forged, and contents taken out of
 * chests (lib/inventory.ts HeldItem), one row per item, kept in IndexedDB per
 * identity (lib/inventoryDb.ts) so they survive a reload and switching back to
 * an identity brings its items back. Everything held is also here in memory,
 * because the rows, the chest opener and the DISCOVERED panel read them.
 *
 * Holding is idempotent: a key read twice is held once (addHeld). A read that
 * lands before the load for this identity has finished is kept and merged
 * when it does, so nothing a scan opened in the first second is lost. Where
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
import { KEY_TEXT_PREFIX, addHeld, heldFromEntry, heldFromFind, heldFromForged, heldFromPasted, parseKeyText, type HeldFrom, type HeldItem, type HeldPlace } from '../lib/inventory'
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
  /** Hold these; returns what was new. Rows for another identity than the current owner are written but not shown. */
  add: (items: HeldItem[]) => HeldItem[]
  /** Hold every key among a scan's finds (B1 §2.1: reading a key is holding it). */
  holdFinds: (finds: Hidden[]) => HeldItem[]
  /** Hold a key this identity forged and hid, at once (B1 §3.1). */
  holdForged: (event: NostrEvent, key: KeyItem, place: HeldPlace) => HeldItem
  /** TAKE: hold contents out of an opened chest. */
  take: (entries: ChestEntry[], from: HeldFrom, place: HeldPlace | null) => HeldItem[]
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

/** Write rows, off the frame; a failed write is said once and the rows stay in memory. */
function persist(rows: HeldItem[]): void {
  if (rows.length === 0) return
  void database().then((d) => (d ? writeHeld(d, rows) : undefined)).catch((err: unknown) => {
    console.warn(`[inventory] could not write ${rows.length} item${rows.length === 1 ? '' : 's'}: ${describeError(err)}`)
  })
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
    persist(added)
  },

  add: (list) => {
    const owner = ownerNow()
    const shown = list.filter((it) => it.owner === owner)
    const { items, added } = addHeld(get().items, shown)
    if (added.length > 0) set({ items })
    // Rows for another identity (a find landing as the identity switched) are
    // kept for that identity, not shown here.
    const others = list.filter((it) => it.owner !== owner)
    persist([...added, ...others])
    return added
  },

  holdFinds: (finds) => {
    const owner = ownerNow()
    const at = now()
    const rows: HeldItem[] = []
    for (const h of finds) {
      const r = heldFromFind(owner, h, at)
      if (r) rows.push(r)
    }
    return rows.length > 0 ? get().add(rows) : []
  },

  holdForged: (event, key, place) => {
    const item = heldFromForged(ownerNow(), event, key, place, now())
    get().add([item])
    return get().items[item.id] ?? item
  },

  take: (entries, from, place) => {
    const owner = ownerNow()
    const at = now()
    return get().add(entries.map((e) => heldFromEntry(owner, e, from, place, at)))
  },

  paste: (text) => {
    const parsed = parseKeyText(text)
    if (!parsed) return { ok: false, reason: `Not a key. A key copied from LOOT begins with ${KEY_TEXT_PREFIX} and carries the key item as JSON.` }
    const owner = ownerNow()
    const held = get().items[parsed.event.id]
    if (held) return { ok: true, item: held, already: true }
    const item = heldFromPasted(owner, parsed.event, parsed.key, now())
    get().add([item])
    return { ok: true, item, already: false }
  },

  has: (id) => !!get().items[id],
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __inventory?: unknown }).__inventory = useInventory
}
