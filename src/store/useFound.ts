/**
 * useFound.ts: the found bags of the identity you are, kept and brought back.
 *
 * Every bag a scan opens is written here (lib/foundCache.ts unbagRemembered
 * hands it over), one row per bag address per identity, in IndexedDB
 * (lib/foundDb.ts). On load, and again on every identity switch, the rows of
 * the identity now in use are opened again and handed to the shard store as
 * finds, before any relay is asked, so what you have found is on screen even
 * when no relay answers (arkinox, 2026-10-13). The scans still run and merge
 * as before; a newer version of a bag replaces its row.
 *
 * Nothing leaves because a relay is silent. A row goes only when its bag no
 * longer opens or verifies, when its author's deletion (kind 5) names it, or
 * when the budget is full, oldest seen first and never one that holds
 * something you hold in ITEMS or sits in a place you starred.
 *
 * Without IndexedDB (private mode, a browser that never answers) finds are
 * kept for the session only, as they always were.
 */

import { create } from 'zustand'
import type { NostrEvent } from '../lib/events'
import type { Hidden, RegionOrigin } from '../lib/hidden'
import { HIDDEN_KIND } from '../lib/hidden'
import { FOUND_BUDGET_BYTES, deletedRows, forgetOpened, foundRow, keepsOver, lookupOf, openRow, rowKeyOf, setFoundSink, toEvict } from '../lib/foundCache'
import { deleteFound, openFoundDb, readFound, writeFound, type FoundBag } from '../lib/foundDb'
import { placePosition } from '../lib/starred'
import { query } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import { useInventory } from './useInventory'
import { useShards } from './useShards'
import { useStarred } from './useStarred'

/** A bag seen again is not rewritten for this long: a scan runs every time you cross a cube. */
const RESEEN_SECONDS = 6 * 60 * 60
/** Deletions are asked about this many bag authors at a time. */
const DELETION_AUTHORS_PER_ASK = 50

interface FoundState {
  /** Whose rows are loaded. */
  owner: string
  storage: 'loading' | 'indexeddb' | 'memory'
  /** Load the rows of `owner` (default: the identity in use) and hand what still opens to the shard store. */
  load: (owner?: string) => Promise<void>
}

let db: Promise<IDBDatabase | null> | null = null
function database(): Promise<IDBDatabase | null> {
  if (!db) {
    db = openFoundDb().catch((err: unknown) => {
      console.warn(`[found] IndexedDB unavailable, finds last this session only: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
  }
  return db
}

/** The loaded owner's rows and what each opened to, for the budget's questions. */
const rows = new Map<string, FoundBag>()
const opened = new Map<string, Hidden[]>()

let writes: Promise<void> = Promise.resolve()
function serial(job: (d: IDBDatabase) => Promise<void>): Promise<void> {
  writes = writes.then(() => database()).then((d) => (d ? job(d) : undefined)).catch((err: unknown) => {
    console.warn(`[found] write failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  return writes
}

const now = (): number => Math.floor(Date.now() / 1000)

/** Kept whatever the budget says: a bag holding something in ITEMS, or one in a place you starred. */
function exempt(row: FoundBag): boolean {
  const held = useInventory.getState().items
  const heldIds = new Set(Object.values(held).map((h) => h.id))
  if (row.itemIds.some((id) => heldIds.has(id))) return true
  const items = opened.get(row.rowKey) ?? []
  for (const star of useStarred.getState().places) {
    const p = placePosition(star.input)
    if (!p) continue
    for (const h of items) {
      if (h.plane !== star.plane) continue
      const k = BigInt(h.height)
      if (p.x >> k === h.at.x >> k && p.y >> k === h.at.y >> k && p.z >> k === h.at.z >> k) return true
    }
  }
  return false
}

function enforceBudget(d: IDBDatabase, budget = FOUND_BUDGET_BYTES): Promise<void> {
  const evict = toEvict([...rows.values()], budget, exempt)
  for (const k of evict) { rows.delete(k); opened.delete(k) }
  return deleteFound(d, evict)
}

/**
 * Bags Cyberspace TV kept before this identity's rows were read: held back
 * until they are, since only then does `remember` know whether the bag is
 * already a played row, which TV must never make watched (review of #390,
 * round 2).
 */
let waiting: Array<{ owner: string; args: Parameters<typeof remember> }> = []

/** Write what TV held back, now the rows are read; another identity's is dropped. */
function rememberWaiting(owner: string): void {
  const held = waiting
  waiting = []
  for (const w of held) if (w.owner === owner) remember(...w.args)
}

/** A bag that opened: kept, unless the row already holds this or a newer version seen recently. */
function remember(outer: NostrEvent, keyHex: string, items: Hidden[], refs: Record<string, NostrEvent>, height: number | undefined, origin: RegionOrigin | undefined, watched: boolean): void {
  const owner = useCyberspace.getState().identity.pubkey
  const state = useFound.getState()
  if (watched && (state.owner !== owner || state.storage === 'loading')) {
    waiting.push({ owner, args: [outer, keyHex, items, refs, height, origin, watched] })
    return
  }
  const key = rowKeyOf(owner, outer)
  if (!key) return
  const loaded = useFound.getState().owner === owner
  const had = loaded ? rows.get(key) : undefined
  if (had && had.outer.id !== outer.id && keepsOver(had.outer, outer)) return
  // A bag kept by TV and now found in play is rewritten at once, as played.
  const nowPlayed = had?.watched === true && !watched
  if (!nowPlayed && had && had.outer.id === outer.id && now() - had.seenAt < RESEEN_SECONDS && Object.keys(refs).every((k) => had.refs[k]?.id === refs[k].id)) return
  // Watched only while nothing found it in play: TV never makes a played row watched.
  const stillWatched = watched && (!had || had.watched === true)
  const row = foundRow(owner, outer, keyHex, items, had && had.outer.id === outer.id ? { ...had.refs, ...refs } : refs, height ?? had?.height, origin, now(), stillWatched)
  if (!row) return
  if (!origin && had?.origin) row.origin = had.origin
  if (loaded) { rows.set(key, row); opened.set(key, items) }
  void serial(async (d) => {
    await writeFound(d, [row])
    if (loaded && useFound.getState().owner === owner) await enforceBudget(d)
  })
}

/**
 * Ask the relays whether the authors of these bags deleted any of them, and
 * drop what they did, from the rows and from the screen. A relay that does
 * not answer drops nothing.
 */
async function pruneDeletions(owner: string, list: FoundBag[]): Promise<void> {
  const authors = [...new Set(list.map((r) => r.outer.pubkey))]
  for (let i = 0; i < authors.length; i += DELETION_AUTHORS_PER_ASK) {
    const some = authors.slice(i, i + DELETION_AUTHORS_PER_ASK)
    const mine = list.filter((r) => some.includes(r.outer.pubkey))
    let deletions: NostrEvent[]
    try {
      deletions = await query({ kinds: [5], authors: some, '#a': mine.map((r) => `${HIDDEN_KIND}:${r.outer.pubkey}:${lookupOf(r.outer) ?? ''}`) })
      deletions = deletions.concat(await query({ kinds: [5], authors: some, '#e': mine.map((r) => r.outer.id) }))
    } catch {
      continue
    }
    const gone = deletedRows(mine, deletions)
    if (gone.length === 0 || useFound.getState().owner !== owner) continue
    dropRows(gone)
  }
}

/** Remove rows and the finds that came only from them. */
function dropRows(keys: string[]): void {
  const bagIds = new Set<string>()
  for (const k of keys) {
    const r = rows.get(k)
    if (r) bagIds.add(r.outer.id)
    rows.delete(k)
    opened.delete(k)
  }
  void serial((d) => deleteFound(d, keys))
  if (bagIds.size === 0) return
  const shards = useShards.getState()
  const discovered: Record<string, Hidden> = {}
  let changed = false
  for (const [id, h] of Object.entries(shards.discovered)) {
    if (bagIds.has(h.bagId)) { changed = true; continue }
    discovered[id] = h
  }
  if (changed) useShards.setState({ discovered })
}

let watching = false

export const useFound = create<FoundState>((set, get) => ({
  owner: '',
  storage: 'loading',

  load: async (ownerArg) => {
    if (!watching) {
      watching = true
      setFoundSink(remember)
      // Another identity: its finds, and none of the last one's.
      useCyberspace.subscribe((s, prev) => {
        if (s.identity.pubkey === prev.identity.pubkey) return
        useShards.setState({ discovered: {} })
        // And what scans opened under the last one, so nothing of it is handed back.
        forgetOpened()
        void get().load(s.identity.pubkey)
      })
    }
    const owner = ownerArg ?? useCyberspace.getState().identity.pubkey
    if (owner !== get().owner) { rows.clear(); opened.clear(); set({ owner, storage: 'loading' }) }
    const d = await database()
    if (get().owner !== owner) return
    if (!d) { set({ storage: 'memory' }); rememberWaiting(owner); return }
    let stored: FoundBag[]
    try { stored = await readFound(d, owner) } catch (err) {
      console.warn(`[found] could not read finds: ${err instanceof Error ? err.message : String(err)}`)
      set({ storage: 'memory' })
      rememberWaiting(owner)
      return
    }
    if (get().owner !== owner) return
    const found: Hidden[] = []
    const watchedFinds: Hidden[] = []
    const bad: string[] = []
    for (const row of stored) {
      const items = await openRow(row)
      if (get().owner !== owner) return
      if (!items) { bad.push(row.rowKey); continue }
      // A row a scan this session already replaced with a newer version stays replaced.
      const now = rows.get(row.rowKey)
      if (now && keepsOver(now.outer, row.outer)) continue
      rows.set(row.rowKey, row)
      opened.set(row.rowKey, items)
      if (row.watched) watchedFinds.push(...items)
      else found.push(...items)
    }
    if (bad.length > 0) void serial((db) => deleteFound(db, bad))
    set({ storage: 'indexeddb' })
    rememberWaiting(owner)
    // Through the same door as a scan's finds: deletions you made are
    // honored, and nothing opens but a chest this identity opened by hand
    // before, opened again as it was (store/useOpenedChests).
    if (found.length > 0) useShards.getState().addDiscovered(found)
    // Kept by TV: back as TV's finds are, no chest in them opening.
    if (watchedFinds.length > 0) useShards.getState().addDiscovered(watchedFinds, { watched: true })
    void pruneDeletions(owner, [...rows.values()])
  },
}))

/** For tests: forget the open database and the loaded rows. */
export function resetFoundForTests(): void {
  db = null
  rows.clear()
  opened.clear()
  waiting = []
  writes = Promise.resolve()
  useFound.setState({ owner: '', storage: 'loading' })
}

/** For tests: wait for every write queued so far. */
export function flushFound(): Promise<void> { return writes }

/** For tests: the loaded rows. */
export function loadedRows(): FoundBag[] { return [...rows.values()] }

/** For tests: run the budget at a given size. */
export async function enforceBudgetForTests(budget: number): Promise<void> {
  const d = await database()
  if (d) await enforceBudget(d, budget)
}
