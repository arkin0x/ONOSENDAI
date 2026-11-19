/**
 * personalLists.ts: a small list that is one identity's own (lib/personalDb.ts),
 * as a store sees it: shown for whoever is signed in, empty for a new or
 * different identity from the moment of the switch, and that identity's own
 * again when it logs back in (owner ruling, 2026-11-19).
 *
 * A store makes one with personalList({ name, legacy, clean, empty, merge,
 * show }) and calls save(list) on every change; `show` is called with the
 * list to draw whenever whose list it is changes, when it has been read, and
 * when another tab changed it. Whose list it is comes from setOwner, called
 * for every list by startPersonalLists (store/personalStart.ts), which
 * follows the identity; nothing here imports the identity store, so any
 * store, useCyberspace included, can hold a list without an import cycle.
 *
 * No change is lost (review of #827):
 * - A change made before an identity's list has been read is held for that
 *   identity (`early`), and merged into what is read (`merge`) and written
 *   before anything is shown, again and again while more arrive. A switch
 *   meanwhile still writes it to the identity it was made for.
 * - A read or write that fails leaves the change held, and the next change
 *   reads again, so nothing is written over a list that was never read.
 * - A list read back while a newer change is on screen is not shown over it:
 *   that change is written after the read, and is what stands.
 * Two tabs changing the same identity's list at once: the later whole list
 * wins, as with the localStorage list before.
 *
 * Where IndexedDB cannot be opened, each identity's list is kept in
 * localStorage under its own key (lib/personalDb.ts fallbackKey), and moved
 * into IndexedDB the next time it opens.
 */

import { adopt, adoptFallback, adoptedHere, clearFallback, isOwner, markAdoptedHere, openPersonalDb, readFallback, writeFallback, writeList } from '../lib/personalDb'

export interface PersonalListSpec<T> {
  /** The list's name in the database (lib/personalDb.ts). */
  name: string
  /** The device-wide list builds before kept (localStorage), adopted once by the identity signed in when it is first read; undefined when there is none. */
  legacy: () => unknown
  /** What was read back, as this app can use it. */
  clean: (raw: unknown) => T
  empty: T
  /** A newer whole list made before the stored one was read (`early`), laid over it, losing nothing of either that the newer one did not remove. */
  merge: (stored: T, early: T) => T
  /** Draw this list, which is `owner`'s. */
  show: (value: T, owner: string) => void
}

export interface PersonalList<T> {
  readonly name: string
  /** Whose list is shown. */
  owner: () => string
  /** Show `owner`'s list (empty at once, then as read), and keep changes for it from now on. */
  setOwner: (owner: string) => Promise<void>
  /** Keep a change to the list shown, for the identity it belongs to. */
  save: (value: T) => void
  /** Read the list shown again (another tab changed it). */
  reread: () => Promise<void>
  /** Resolves once every change so far has been written, or failed. */
  flush: () => Promise<void>
}

const lists = new Set<PersonalList<unknown>>()

/** Every list made so far, for startPersonalLists. */
export function personalListsMade(): ReadonlySet<PersonalList<unknown>> {
  return lists
}

/**
 * IndexedDB, opened once; null when it cannot be opened in this visit, and
 * the lists then go to localStorage (fallback) for the rest of it, so one
 * visit never splits a list between the two.
 */
let db: Promise<IDBDatabase | null> | null = null
let fellBack = false
function database(): Promise<IDBDatabase | null> {
  if (fellBack) return Promise.resolve(null)
  if (!db) {
    db = openPersonalDb().then((d) => {
      // A newer build upgrading in another tab, or a connection the browser closed: open again next time.
      d.onversionchange = () => { d.close(); db = null }
      d.onclose = () => { db = null }
      return d
    }).catch((err: unknown) => {
      console.warn(`[personal] IndexedDB unavailable, your places and lists are kept in localStorage this visit: ${err instanceof Error ? err.message : String(err)}`)
      fellBack = true
      return null
    })
  }
  return db
}

const CHANNEL = 'onosendai:personal'
let channel: BroadcastChannel | null = null
function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e: MessageEvent<{ owner?: unknown; name?: unknown }>) => {
      for (const l of lists) if (l.name === e.data?.name && l.owner() === e.data?.owner) void l.reread()
    }
  } catch { channel = null }
}

/** Stop hearing other tabs: for tests, where each page load is a module copy that would otherwise hear the next one. */
export function stopHearingOtherTabs(): void {
  try { channel?.close() } catch { /* closed */ }
  channel = null
  lists.clear()
}

export function personalList<T>(spec: PersonalListSpec<T>): PersonalList<T> {
  let owner = ''
  /** Whether `owner`'s list has been read and is what the store shows. */
  let loaded = false
  /** Bumped by every change and every switch: a read that started before one does not draw over it. */
  let gen = 0
  /** Reads for `owner` queued or running. */
  let reading = 0
  /**
   * Per identity, the newest list changed before its stored list was read,
   * or after a write failed. `whole`: made from the stored list as shown
   * (after a failed write), so it replaces it as it is; otherwise it was
   * made before the stored list was ever shown, and is merged with it.
   */
  const early = new Map<string, { value: T; whole: boolean }>()
  /** Per identity, changes counted: a failed write is held only while it is that identity's newest. */
  const seq = new Map<string, number>()
  /** Whether `owner`'s stored list has been shown since the switch to it. */
  let shownStored = false
  let queue: Promise<void> = Promise.resolve()
  const then = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(step).catch((err: unknown) => { console.warn(`[personal] ${spec.name}: ${err instanceof Error ? err.message : String(err)}`) })
    return queue
  }

  /** `who`'s stored list, adopting the device-wide one the first time; a list kept in localStorage while IndexedDB was away is merged in. */
  const readStored = async (who: string): Promise<T> => {
    let legacy: unknown
    try { legacy = spec.legacy() } catch { legacy = undefined }
    const d = await database()
    if (!d) {
      const raw = adoptFallback(who, spec.name, legacy)
      return raw === undefined ? spec.empty : spec.clean(raw)
    }
    // Adopted already in a visit without IndexedDB: not again, for anyone.
    const raw = await adopt(d, who, spec.name, adoptedHere(spec.name) ? undefined : legacy)
    markAdoptedHere(spec.name, who)
    let value = raw === undefined ? spec.empty : spec.clean(raw)
    let away: unknown
    try { away = readFallback(who, spec.name) } catch { away = undefined }
    if (away !== undefined) {
      value = spec.merge(value, spec.clean(away))
      await writeList(d, who, spec.name, value)
      clearFallback(who, spec.name)
    }
    return value
  }

  /** Write `who`'s whole list where this visit keeps lists. Throws when it was not kept. */
  const persist = async (who: string, value: T): Promise<void> => {
    const d = await database()
    if (d) await writeList(d, who, spec.name, value)
    else writeFallback(who, spec.name, value)
    try { channel?.postMessage({ owner: who, name: spec.name }) } catch { /* closed */ }
  }

  /**
   * Read `who`'s list, fold every held change into it and write that, and
   * resolve with the list as it now stands; null when a read or write failed
   * (the held change stays held).
   */
  const settle = async (who: string): Promise<T | null> => {
    let value: T
    try { value = await readStored(who) } catch (err) {
      console.warn(`[personal] ${spec.name}: could not read your list: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
    // Each round merges the newest held list with the list as read, never
    // with the last round's result: a held list is made from what the store
    // showed (the held list before it), so a place removed in it stays removed.
    const read = value
    for (;;) {
      const held = early.get(who)
      if (held === undefined) return value
      const merged = held.whole ? held.value : spec.merge(read, held.value)
      try { await persist(who, merged) } catch (err) {
        console.warn(`[personal] ${spec.name}: could not keep a change: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
      value = merged
      // A change made while this was written is the next round.
      if (early.get(who) === held) early.delete(who)
    }
  }

  const read = (who: string): Promise<void> => {
    const counted = who === owner
    if (counted) reading++
    const started = gen
    return then(async () => {
      try {
        if (!isOwner(who)) {
          if (owner === who && gen === started) { loaded = true; shownStored = true; spec.show(early.get(who)?.value ?? spec.empty, who) }
          return
        }
        const value = await settle(who)
        if (owner !== who || value === null) return
        // A change on screen since this read began is newer, and is written after it.
        if (loaded && gen !== started) return
        loaded = true
        shownStored = true
        spec.show(value, who)
      } finally {
        if (counted) reading = Math.max(0, reading - 1)
      }
    })
  }

  const list: PersonalList<T> = {
    name: spec.name,
    owner: () => owner,
    setOwner: (who) => {
      ensureChannel()
      if (who === owner) return read(who)
      const was = owner
      // What the old identity changed before its list was read is written for it, not dropped.
      if (was && early.has(was) && isOwner(was)) void then(async () => { await settle(was) })
      owner = who
      loaded = false
      shownStored = false
      reading = 0
      gen++
      // A new identity shows nothing of the old one's, from this moment.
      spec.show(early.get(who)?.value ?? spec.empty, who)
      return read(who)
    },
    save: (value) => {
      const who = owner
      if (!who) { console.warn(`[personal] ${spec.name}: a change before any identity was known was not kept`); return }
      gen++
      const n = (seq.get(who) ?? 0) + 1
      seq.set(who, n)
      if (!loaded || !isOwner(who)) {
        early.set(who, { value, whole: shownStored })
        // Nothing read yet, or the read failed: read (again), which writes it.
        if (reading === 0) void read(who)
        return
      }
      void then(async () => {
        try { await persist(who, value) } catch (err) {
          console.warn(`[personal] ${spec.name}: could not keep a change: ${err instanceof Error ? err.message : String(err)}`)
          // Held, and merged on the next read: the next change reads again
          // first. Only while it is the newest: a later change is a whole
          // list made after it, and holding this one would bring back what
          // that one removed.
          if (seq.get(who) === n) {
            early.set(who, { value, whole: true })
            if (owner === who) loaded = false
          }
        }
      })
    },
    reread: () => (loaded ? read(owner) : queue),
    flush: () => then(async () => undefined),
  }
  lists.add(list as PersonalList<unknown>)
  return list
}
