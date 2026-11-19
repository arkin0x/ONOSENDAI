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
 * A change made before an identity's list has been read is kept: once the
 * read answers, the two are merged (`merge`) and written. A change is always
 * written for the identity it was made for, captured when it was made, so a
 * switch while a write waits never puts it in the new identity's list. Where
 * IndexedDB cannot be opened, each identity's list lasts the session.
 */

import { adopt, isOwner, openPersonalDb, writeList } from '../lib/personalDb'

export interface PersonalListSpec<T> {
  /** The list's name in the database (lib/personalDb.ts). */
  name: string
  /** The device-wide list builds before kept (localStorage), adopted once by the identity signed in when it is first read; undefined when there is none. */
  legacy: () => unknown
  /** What was read back, as this app can use it. */
  clean: (raw: unknown) => T
  empty: T
  /** A change made before the read answered, laid over what was read. */
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

let db: Promise<IDBDatabase | null> | null = null
function database(): Promise<IDBDatabase | null> {
  if (!db) {
    db = openPersonalDb().then((d) => {
      d.onversionchange = () => { d.close(); db = null }
      d.onclose = () => { db = null }
      return d
    }).catch((err: unknown) => {
      console.warn(`[personal] IndexedDB unavailable, your places and lists last this session only: ${err instanceof Error ? err.message : String(err)}`)
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

export function personalList<T>(spec: PersonalListSpec<T>): PersonalList<T> {
  let owner = ''
  /** The owner whose list has been read and is shown, or '' while it is being read. */
  let loaded = ''
  /** A change made for `owner` before its list was read. */
  let early: T | null = null
  /** Each identity's list, where IndexedDB cannot be opened. */
  const session = new Map<string, T>()
  let queue: Promise<void> = Promise.resolve()
  const then = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(step).catch((err: unknown) => { console.warn(`[personal] ${spec.name}: ${err instanceof Error ? err.message : String(err)}`) })
    return queue
  }

  const read = (who: string): Promise<void> => then(async () => {
    if (owner !== who) return
    const d = await database()
    if (owner !== who) return
    let value: T
    if (!d || !isOwner(who)) {
      value = session.get(who) ?? spec.empty
    } else {
      let legacy: unknown
      try { legacy = spec.legacy() } catch { legacy = undefined }
      const raw = await adopt(d, who, spec.name, legacy)
      value = raw === undefined ? spec.empty : spec.clean(raw)
    }
    if (owner !== who) return
    const pending = early
    early = null
    if (pending !== null) {
      value = spec.merge(value, pending)
      await write(who, value)
    }
    loaded = who
    spec.show(value, who)
  })

  const write = async (who: string, value: T): Promise<void> => {
    session.set(who, value)
    const d = await database()
    if (!d || !isOwner(who)) return
    await writeList(d, who, spec.name, value)
    try { channel?.postMessage({ owner: who, name: spec.name }) } catch { /* closed */ }
  }

  const list: PersonalList<T> = {
    name: spec.name,
    owner: () => owner,
    setOwner: (who) => {
      ensureChannel()
      if (who === owner) return read(who)
      owner = who
      loaded = ''
      early = null
      // A new identity shows nothing of the old one's, from this moment.
      spec.show(spec.empty, who)
      return read(who)
    },
    save: (value) => {
      const who = owner
      if (!who) return
      if (loaded !== who) { early = value; return }
      void then(() => write(who, value))
    },
    reread: () => (loaded === owner ? read(owner) : queue),
    flush: () => then(async () => undefined),
  }
  lists.add(list as PersonalList<unknown>)
  return list
}
