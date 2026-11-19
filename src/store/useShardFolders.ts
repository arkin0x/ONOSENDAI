/**
 * useShardFolders.ts: the folders your shard lists are sorted into, the
 * device's, kept on this device only.
 *
 * The workshop is a local repository of SNO on the device, the same for
 * every identity, and so are its folders and when each shard was last
 * deployed (which only sorts the lists): a switch of identity never changes
 * them (owner ruling, 2026-11-19, after every folder vanished on a NEW
 * RANDOM KEY). Builds before kept one tree per identity; the first read
 * merges them into the device's (lib/shardFoldersDb.ts, mergeTrees).
 *
 * Every shard list (the workshop MENU, PLACE OBJECT's MINE, STAMP's objects)
 * draws through hud/ShardFolders.tsx over this store, so they all show the
 * same folders. The tree is pure data with pure ops (lib/shardFolders.ts),
 * one row in IndexedDB (lib/shardFoldersDb.ts). Nothing is published.
 *
 * A change shows at once: the op is applied to the tree in memory and queued
 * for the database, where it is applied to the stored tree in one
 * transaction (commitOps). What the database answers is the tree with every
 * op still queued applied on top (replay), so a slow write never makes an
 * earlier change flicker back. Another tab's commit is announced on a
 * BroadcastChannel, and this tab reads the stored tree again. Where
 * IndexedDB cannot be opened, folders last the session.
 *
 * A deploy is kept here too (markUsed): when each shard was last deployed,
 * which the lists sort by as they sort by an edit.
 *
 * For code that files shards (the zip import): createFolderPath(['maze-kit',
 * 'forest']) makes or finds that path and returns the last folder's id, and
 * assignToFolder(ref, id) files a shard by its workshop model id. Both act at
 * once; flush() resolves when they have reached the database.
 */

import { create } from 'zustand'
import { describeError } from '../lib/secrets/db'
import { EMPTY_TREE, applyOp, canonical, childrenOf, cleanName, folderOf, newFolderId, type Folder, type FolderOp, type FolderTree } from '../lib/shardFolders'
import { commitOps, openShardFoldersDb, readTree } from '../lib/shardFoldersDb'
import { fileCopiesWith, readLastUsedFrom } from './useWorkshop'

export type FolderStorage = 'loading' | 'indexeddb' | 'memory'

interface ShardFoldersState {
  tree: FolderTree
  storage: FolderStorage
  /** Read the device's tree (again), and start following other tabs' changes. */
  load: () => Promise<void>
  /** A new folder; returns its id, or null for an empty name. */
  createFolder: (name: string, parent?: string | null) => string | null
  /** Make or find each folder of a path from the top; returns the last one's id, or null for an empty path. */
  createFolderPath: (path: readonly string[]) => string | null
  renameFolder: (id: string, name: string) => void
  /** Into another folder, or to the top with null; false when refused (itself, under itself, or gone). */
  moveFolder: (id: string, parent: string | null) => boolean
  /** The folder goes; its shards and folders move up to its parent. No shard is touched. */
  deleteFolder: (id: string) => void
  /**
   * The folder and every folder under it go, with the filings of the shards
   * in them. For the workshop's DELETE CONTENTS, which deletes those shards
   * itself first (useWorkshop removeMany) and calls this only once that is
   * saved (hud/ShardFolders deleteFolderNow); this deletes no shard.
   */
  purgeFolder: (id: string) => void
  /** File shards (by ref) in a folder, or at the top with null. */
  assignToFolder: (ref: string | readonly string[], folder: string | null) => void
  setCollapsed: (id: string, collapsed: boolean) => void
  /** A deploy of these shards (by ref) went through: every list puts them first in their folder (lib/shardFolders.ts newestFirst). */
  markUsed: (ref: string | readonly string[], at?: number) => void
  /** Resolves once every change so far has reached the database, or failed and been said. */
  flush: () => Promise<void>
}

interface Queued { op: FolderOp }

/** Ops applied in memory and not yet committed, oldest first. */
const queued: Queued[] = []

function drop(entry: Queued): void {
  const at = queued.indexOf(entry)
  if (at >= 0) queued.splice(at, 1)
}

/** The tree the database holds with what is still queued on top. */
function replay(tree: FolderTree): FolderTree {
  let t = tree
  for (const q of queued) t = applyOp(t, q.op)
  return t
}

let db: Promise<IDBDatabase | null> | null = null

function database(): Promise<IDBDatabase | null> {
  if (!db) {
    db = openShardFoldersDb().then((d) => {
      // A newer build upgrading the database in another tab: step aside, and
      // open again on the next change.
      d.onversionchange = () => { d.close(); db = null }
      // A connection the browser closed (a tab long in the background): open again next time.
      d.onclose = () => { db = null }
      return d
    }).catch((err: unknown) => {
      console.warn(`[folders] IndexedDB unavailable, folders last this session only: ${describeError(err)}`)
      return null
    })
  }
  return db
}

/** Reads and writes, one after another, so a read never lands between a write and its answer. */
let chain: Promise<void> = Promise.resolve()
function then(step: () => Promise<void>): Promise<void> {
  chain = chain.then(step).catch((err: unknown) => { console.warn(`[folders] ${describeError(err)}`) })
  return chain
}

const CHANNEL = 'sno:shard-folders'
let channel: BroadcastChannel | null = null
function announce(): void {
  try { channel?.postMessage({ changed: true }) } catch { /* closed */ }
}

let watching = false

export const useShardFolders = create<ShardFoldersState>((set, get) => {
  /** Read the stored tree and show it. */
  const reread = (): Promise<void> => then(async () => {
    const d = await database()
    if (!d) {
      set({ storage: 'memory' })
      return
    }
    let stored: FolderTree
    try { stored = await readTree(d) } catch (err) {
      console.warn(`[folders] could not read folders: ${describeError(err)}`)
      set({ storage: 'memory' })
      return
    }
    set({ tree: replay(stored), storage: 'indexeddb' })
  })

  /** Apply an op now and queue it for the database; returns the tree it made. */
  const commit = (op: FolderOp): FolderTree => {
    const entry: Queued = { op }
    const tree = applyOp(get().tree, op)
    // Refused or already so in the tree as loaded: nothing to write. While it
    // loads, the stored tree may differ, so the op goes to it regardless; and
    // a path, a filing or a fold always goes, since another tab may have
    // changed what this one still shows: a path this tab sees whole may have
    // been deleted there, and goes to the stored tree to be made again under
    // the same ids (review of PR 449).
    const always = op.op === 'path' || op.op === 'assign' || op.op === 'collapse'
    if (tree === get().tree && get().storage !== 'loading' && !(always && get().storage === 'indexeddb')) return tree
    queued.push(entry)
    if (tree !== get().tree) set({ tree })
    void then(async () => {
      const d = await database()
      let failed = false
      try {
        if (!d) return
        const stored = await commitOps(d, [op])
        drop(entry)
        if (get().storage !== 'memory') set({ tree: replay(stored) })
        announce()
      } catch (err) {
        console.warn(`[folders] could not save a folder change: ${describeError(err)}`)
        // Show what is stored rather than a change that was not kept, and
        // open the database again for the next one.
        d?.close()
        db = null
        failed = true
      } finally {
        // Committed, failed, or memory only: either way it is not waiting any more.
        drop(entry)
      }
      if (failed) void reread()
    })
    return tree
  }

  return {
    tree: EMPTY_TREE,
    storage: 'loading',

    load: async () => {
      if (!watching) {
        watching = true
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            channel = new BroadcastChannel(CHANNEL)
            // Any tab's change, of any build: read the stored tree again.
            channel.onmessage = () => { if (get().storage === 'indexeddb') void reread() }
          } catch { channel = null }
        }
      }
      await reread()
    },

    createFolder: (name, parent = null) => {
      if (!cleanName(name)) return null
      const id = newFolderId()
      const tree = commit({ op: 'create', id, name, parent, at: Date.now() })
      return tree.folders[id] ? id : null
    },

    createFolderPath: (path) => {
      const names = path.map(cleanName).filter((n) => n !== '')
      if (names.length === 0) return null
      // The folders already there go by their own ids, so finding a path
      // writes no alias; only a segment this tab has not seen gets a new id
      // (review of PR 449: 200 calls left 398 aliases).
      const ids: string[] = []
      let parent: string | null = null
      let known = true
      for (const name of names) {
        const have: Folder | undefined = known ? childrenOf(get().tree, parent).find((f) => f.name === name) : undefined
        if (have) { ids.push(have.id); parent = have.id } else { ids.push(newFolderId()); known = false }
      }
      const tree = commit({ op: 'path', ids, names, at: Date.now() })
      return canonical(tree, ids[ids.length - 1])
    },

    renameFolder: (id, name) => { commit({ op: 'rename', id, name }) },

    moveFolder: (id, parent) => {
      const tree = commit({ op: 'move', id, parent })
      const to = parent === null ? null : canonical(tree, parent)
      return !!tree.folders[id] && (parent === null || to !== null) && tree.folders[id].parent === to
    },

    deleteFolder: (id) => { commit({ op: 'delete', id }) },

    purgeFolder: (id) => { commit({ op: 'purge', id }) },

    assignToFolder: (ref, folder) => {
      const refs = typeof ref === 'string' ? [ref] : [...ref]
      if (refs.length) commit({ op: 'assign', refs, folder })
    },

    setCollapsed: (id, collapsed) => { commit({ op: 'collapse', id, collapsed }) },

    markUsed: (ref, at = Date.now()) => {
      const refs = (typeof ref === 'string' ? [ref] : [...ref]).filter((r) => r !== '')
      if (refs.length) commit({ op: 'use', refs, at })
    },

    flush: () => then(async () => undefined),
  }
})

// The workshop opens the top of its list, deploys counted (useWorkshop newestId).
readLastUsedFrom(() => useShardFolders.getState().tree.used)

// A duplicate lands in its source's folder (useWorkshop duplicate); a source
// at the top files nothing. While the tree is still being read, every shard
// looks to be at the top, so the copy is filed once it has been read.
fileCopiesWith((copy, source) => {
  const file = (): void => {
    const at = folderOf(useShardFolders.getState().tree, source)
    if (at !== null) useShardFolders.getState().assignToFolder(copy, at)
  }
  if (useShardFolders.getState().storage === 'loading') void useShardFolders.getState().load().then(file)
  else file()
})

/** Make or find a folder path from the top, for code outside React: returns the last folder's id. */
export function createFolderPath(path: readonly string[]): string | null {
  return useShardFolders.getState().createFolderPath(path)
}

/** File a shard (its workshop model id) in a folder, or at the top with null. */
export function assignToFolder(ref: string | readonly string[], folder: string | null): void {
  useShardFolders.getState().assignToFolder(ref, folder)
}
