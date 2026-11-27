/**
 * useBlueprints.ts - the blueprints this identity holds, and the prizes it
 * has compiled and not yet taken.
 *
 * Blueprints are the core block economy (owner, 2026-11-26): a stand-alone
 * arrangement of blocks is the key to a prize. This store keeps, per identity
 * (lib/blueprint/blueprintDb.ts):
 *
 * - cards: blueprints made here in BUILD (MINE) and found in the world, in a
 *   chest or behind a door (HELD). Finding one never removes it for anyone
 *   else; the maker's signed record travels with every copy, so a finder who
 *   leaves it somewhere again is shown as "left here by" and the maker keeps
 *   the credit.
 * - records seen on this device, by lookup, which a smash asks first
 *   (lib/blueprint/smash.ts).
 * - toys: prizes compiled and waiting to be taken. The player picks each one
 *   (owner, 2026-11-27: "you choose which shards you take"): a toy waits in
 *   its orbit until it is taken, put away, or left behind, and stays in
 *   BUILT on this device until taken.
 */

import { create } from 'zustand'
import { useCyberspace } from './useCyberspace'
import {
  deleteToys, openBlueprintDb, readCards, readRecords, readToys, writeCards, writeRecords, writeToys,
  type BlueprintCard, type RecordRow, type ToyRow,
} from '../lib/blueprint/blueprintDb'
import { readRecord, recordLookup } from '../lib/blueprint/format'
import type { NostrEvent } from '../lib/events'

interface BlueprintsState {
  owner: string
  /** The identity whose cards have been read from this device (load finished), or ''. */
  loadedFor: string
  cards: BlueprintCard[]
  /** Prizes waiting to be taken (BUILT). */
  toys: ToyRow[]
  /** Toys put away from the scene this session (still in BUILT). */
  putAway: ReadonlySet<string>
  /** Card row keys the player has not looked at yet (the NEW mark). */
  fresh: ReadonlySet<string>
  load: (owner?: string) => Promise<void>
  /** Keep a blueprint this identity made (MINE). */
  addMade: (card: Omit<BlueprintCard, 'rowKey' | 'owner' | 'source' | 'at'>) => BlueprintCard
  /** The game's own blueprint (lib/blueprint/gameBlueprint.ts), kept like any card, marked NEW. */
  addGame: (card: Omit<BlueprintCard, 'rowKey' | 'owner' | 'source' | 'at'>) => BlueprintCard
  /** Keep a blueprint found somewhere (HELD): the maker's record, and who left it there when that was someone else. Null when already held. */
  addFound: (record: NostrEvent, leftBy?: string) => BlueprintCard | null
  /** Records with this lookup: held cards first, then everything this device has seen. */
  recordsFor: (lookup: string) => Promise<NostrEvent[]>
  /** Remember records seen (from found cards or the relay). */
  remember: (records: NostrEvent[]) => void
  addToys: (toys: ToyRow[]) => void
  /** A toy taken (or its prize given): gone from the scene and BUILT. */
  dropToy: (rowKey: string) => void
  /** Put toys away from the scene (they stay in BUILT). */
  putAwayToys: (rowKeys: string[]) => void
  markSeen: (rowKeys?: string[]) => void
  /** One more build of a held blueprint. */
  noteBuilt: (lookup: string) => void
  archive: (rowKey: string, archived: boolean) => void
}

let db: Promise<IDBDatabase | null> | null = null
function database(): Promise<IDBDatabase | null> {
  db ??= openBlueprintDb().catch(() => null)
  return db
}

let watching = false
const now = (): number => Math.floor(Date.now() / 1000)

async function persist(fn: (d: IDBDatabase) => Promise<void>): Promise<void> {
  const d = await database()
  if (d) await fn(d).catch(() => { /* kept in memory for this session */ })
}

/** Memory of records seen while the database is unavailable. */
const seenMemory = new Map<string, NostrEvent>()

export const useBlueprints = create<BlueprintsState>((set, get) => ({
  owner: '',
  loadedFor: '',
  cards: [],
  toys: [],
  putAway: new Set(),
  fresh: new Set(),

  load: async (owner) => {
    if (!watching) {
      watching = true
      useCyberspace.subscribe((s, prev) => { if (s.identity.pubkey !== prev.identity.pubkey) void get().load(s.identity.pubkey) })
    }
    const who = owner ?? useCyberspace.getState().identity.pubkey
    if (who !== get().owner) set({ owner: who, loadedFor: '', cards: [], toys: [], putAway: new Set(), fresh: new Set() })
    const d = await database()
    if (!d || get().owner !== who) return
    const [cards, toys] = await Promise.all([readCards(d, who).catch(() => []), readToys(d, who).catch(() => [])])
    if (get().owner !== who) return
    const byKey = new Map(cards.map((c) => [c.rowKey, c]))
    for (const c of get().cards) byKey.set(c.rowKey, c)
    const toyKeys = new Map(toys.map((t) => [t.rowKey, t]))
    for (const t of get().toys) toyKeys.set(t.rowKey, t)
    set({ cards: [...byKey.values()].sort((a, b) => b.at - a.at), toys: [...toyKeys.values()], loadedFor: who })
  },

  addGame: (c) => {
    const owner = get().owner || useCyberspace.getState().identity.pubkey
    const card: BlueprintCard = { prizeKind: 'tool', ...c, rowKey: `${owner}/${c.record.id}`, owner, source: 'game', at: now() }
    set({ owner, cards: [card, ...get().cards.filter((x) => x.rowKey !== card.rowKey)], fresh: new Set([...get().fresh, card.rowKey]) })
    void persist((d) => writeCards(d, [card]))
    return card
  },

  addMade: (c) => {
    const owner = get().owner || useCyberspace.getState().identity.pubkey
    const card: BlueprintCard = { ...c, rowKey: `${owner}/${c.record.id}`, owner, source: 'made', at: now() }
    set({ owner, cards: [card, ...get().cards.filter((x) => x.rowKey !== card.rowKey)], fresh: new Set([...get().fresh, card.rowKey]) })
    get().remember([card.record])
    void persist((d) => writeCards(d, [card]))
    return card
  },

  addFound: (record, leftBy) => {
    const lookup = recordLookup(record)
    if (!lookup || !readRecord(record)) return null
    const owner = get().owner || useCyberspace.getState().identity.pubkey
    const rowKey = `${owner}/${record.id}`
    if (get().cards.some((c) => c.rowKey === rowKey)) return null
    const card: BlueprintCard = { rowKey, owner, lookup, record, source: 'found', at: now(), ...(leftBy && leftBy !== record.pubkey ? { leftBy } : {}) }
    set({ owner, cards: [card, ...get().cards], fresh: new Set([...get().fresh, rowKey]) })
    get().remember([record])
    void persist((d) => writeCards(d, [card]))
    return card
  },

  recordsFor: async (lookup) => {
    const out = new Map<string, NostrEvent>()
    for (const c of get().cards) if (c.lookup === lookup && !c.archived) out.set(c.record.id, c.record)
    for (const r of seenMemory.values()) if (recordLookup(r) === lookup) out.set(r.id, r)
    const d = await database()
    if (d) for (const r of await readRecords(d, lookup).catch(() => [] as RecordRow[])) out.set(r.record.id, r.record)
    return [...out.values()]
  },

  remember: (records) => {
    const rows: RecordRow[] = []
    for (const record of records) {
      const lookup = recordLookup(record)
      if (!lookup) continue
      seenMemory.set(record.id, record)
      rows.push({ id: record.id, lookup, record, seen: now() })
    }
    void persist((d) => writeRecords(d, rows))
  },

  addToys: (toys) => {
    set({ toys: [...get().toys, ...toys] })
    void persist((d) => writeToys(d, toys))
  },

  dropToy: (rowKey) => {
    set({ toys: get().toys.filter((t) => t.rowKey !== rowKey) })
    void persist((d) => deleteToys(d, [rowKey]))
  },

  putAwayToys: (rowKeys) => set({ putAway: new Set([...get().putAway, ...rowKeys]) }),

  markSeen: (rowKeys) => {
    if (!rowKeys) { set({ fresh: new Set() }); return }
    const fresh = new Set(get().fresh)
    for (const k of rowKeys) fresh.delete(k)
    set({ fresh })
  },

  noteBuilt: (lookup) => {
    const changed: BlueprintCard[] = []
    const cards = get().cards.map((c) => {
      if (c.lookup !== lookup) return c
      const n = { ...c, built: (c.built ?? 0) + 1 }
      changed.push(n)
      return n
    })
    if (changed.length) { set({ cards }); void persist((d) => writeCards(d, changed)) }
  },

  archive: (rowKey, archived) => {
    const changed: BlueprintCard[] = []
    const cards = get().cards.map((c) => {
      if (c.rowKey !== rowKey) return c
      const n = { ...c }
      if (archived) n.archived = now()
      else delete n.archived
      changed.push(n)
      return n
    })
    set({ cards })
    void persist((d) => writeCards(d, changed))
  },
}))
