/**
 * useDroneRunLevels.ts - the DRONE RUN fields this device can play, for the
 * GAMES panel: the BUILT-IN FIELD and every level imported here
 * (lib/games/droneRun/levelDb.ts), which one is chosen (levelChoice.ts,
 * remembered per device), IMPORT LEVEL and REMOVE.
 *
 * IMPORT LEVEL: the zip read and checked (level/package.ts), kept in
 * IndexedDB once its write has committed, and chosen. REMOVE takes one level
 * off this device (the panel asks first); the built-in field is chosen again
 * when it was the one chosen. Device-only: nothing here is published, synced
 * or put in the hidden list.
 */

import { create } from 'zustand'
import { readLevelPackage } from '../lib/games/droneRun/level/package'
import { chooseLevel, chosenLevel } from '../lib/games/droneRun/levelChoice'
import { deleteLevel, listLevels, openLevelsDb, putLevel, type LevelSummary } from '../lib/games/droneRun/levelDb'

/** Said when IndexedDB cannot be opened (a private window, say): an imported level could not outlast the page. */
export const NO_STORAGE_MESSAGE = 'This device cannot keep a level. Try outside a private window.'

export interface DroneRunLevelsState {
  /** Levels imported here, oldest first. */
  levels: LevelSummary[]
  /** The chosen level's id, or null for the built-in field. */
  chosen: string | null
  /** The list read once from storage. */
  loaded: boolean
  /** An import or a removal under way. */
  busy: 'importing' | 'removing' | null
  /** Read the list (once; again with `force`). */
  load: (force?: boolean) => Promise<void>
  /** Import a level package's bytes. Resolves to its name, the level kept and chosen, or to what is wrong, in words. */
  importZip: (bytes: Uint8Array) => Promise<{ name: string } | { refused: string }>
  /** Choose a level by id, or null for the built-in field. */
  choose: (id: string | null) => void
  /** Take a level off this device. Resolves to whether it is gone. */
  remove: (id: string) => Promise<boolean>
}

async function withDb<T>(f: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openLevelsDb()
  try { return await f(db) } finally { db.close() }
}

export const useDroneRunLevels = create<DroneRunLevelsState>((set, get) => ({
  levels: [],
  chosen: chosenLevel(),
  loaded: false,
  busy: null,

  load: async (force = false) => {
    if (get().loaded && !force) return
    let levels: LevelSummary[] = []
    try { levels = await withDb(listLevels) } catch { /* no storage: the built-in field only */ }
    // A chosen level no longer kept here: back to the built-in field.
    let chosen = chosenLevel()
    if (chosen && !levels.some((l) => l.id === chosen)) { chooseLevel(null); chosen = null }
    set({ levels, chosen, loaded: true })
  },

  importZip: async (bytes) => {
    if (get().busy) return { refused: 'Wait for the last one to finish.' }
    set({ busy: 'importing' })
    try {
      let pkg
      try { pkg = readLevelPackage(bytes) } catch (err) { return { refused: err instanceof Error ? err.message : String(err) } }
      const row = { id: pkg.level.id, name: pkg.level.name, importedAt: Date.now(), bytes: pkg.bytes, faces: pkg.faces, level: pkg.level, payloads: pkg.payloads }
      let levels: LevelSummary[]
      try { levels = await withDb(async (db) => { await putLevel(db, row); return listLevels(db) }) } catch { return { refused: NO_STORAGE_MESSAGE } }
      chooseLevel(row.id)
      set({ levels, chosen: row.id, loaded: true })
      return { name: row.name }
    } finally { set({ busy: null }) }
  },

  choose: (id) => {
    const next = id && get().levels.some((l) => l.id === id) ? id : null
    chooseLevel(next)
    set({ chosen: next })
  },

  remove: async (id) => {
    if (get().busy) return false
    set({ busy: 'removing' })
    try {
      const levels = await withDb(async (db) => { await deleteLevel(db, id); return listLevels(db) })
      const chosen = get().chosen === id ? null : get().chosen
      if (chosen === null) chooseLevel(null)
      set({ levels, chosen })
      return true
    } catch { return false } finally { set({ busy: null }) }
  },
}))
