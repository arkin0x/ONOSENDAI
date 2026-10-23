/**
 * useShardFolders.ts: the folders your shard lists are sorted into, this
 * identity's, kept on this device only.
 *
 * Every shard list (the workshop MENU, PLACE OBJECT's MINE, STAMP's objects)
 * draws through hud/ShardFolders.tsx over this store, so they all show the
 * same folders. The tree is pure data with pure ops (lib/shardFolders.ts),
 * one row per identity in IndexedDB (lib/shardFoldersDb.ts). Nothing is
 * published.
 *
 * A change shows at once: the op is applied to the tree in memory and queued
 * for the database, where it is applied to the stored tree in one
 * transaction (commitOps). What the database answers is the tree with every
 * op still queued applied on top (replay), so a slow write never makes an
 * earlier change flicker back. Another tab's commit is announced on a
 * BroadcastChannel, and this tab reads the stored tree again. Ops are tagged
 * with the identity they were made for, so a switch while one is queued
 * writes it to that identity's tree and never shows it on the new one. Where
 * IndexedDB cannot be opened, folders last the session.
 *
 * A deploy is kept here too (markUsed): when each shard was last deployed,
 * which the lists sort by as they sort by an edit.
 *
 * For code that files shards (the zip import): createFolderPath(['maze-kit',
 * 'forest']) makes or finds that path and returns the last folder's id, and
 * assignToFolder(ref, id) files a shard by its workshop model id. Both act at
 * once; flush() resolves when they have reached the database.
 *
 * The identity is watched from load() rather than at module load, for the
 * same import-cycle reason as useInventory.
 */

import { create } from 'zustand'
import { describeError } from '../lib/secrets/db'
import { EMPTY_TREE, applyOp, canonical, childrenOf, cleanName, newFolderId, type Folder, type FolderOp, type FolderTree } from '../lib/shardFolders'
import { commitOps, openShardFoldersDb, readTree } from '../lib/shardFoldersDb'
import { useCyberspace } from './useCyberspace'
import { readLastUsedFrom } from './useWorkshop'

export type FolderStorage = 'loading' | 'indexeddb' | 'memory'

interface ShardFoldersState {
  /** The identity whose tree this is. */
  owner: string
  tree: FolderTree
  storage: FolderStorage
  /** Read this identity's tree (the current one when no owner is given), and start following identity changes. */
  load: (owner?: string) => Promise<void>
  /** A new folder; returns its id, or null for an empty name. */
  createFolder: (name: string, parent?: string | null) => string | null
  /** Make or find each folder of a path from the top; returns the last one's id, or null for an empty path. */
  createFolderPath: (path: readonly string[]) => string | null
  renameFolder: (id: string, name: string) => void
  /** Into another folder, or to the top with null; false when refused (itself, under itself, or gone). */
  moveFolder: (id: string, parent: string | null) => boolean
  /** The folder goes; its shards and folders move up to its parent. No shard is touched. */
  deleteFolder: (id: string) => void
  /** File shards (by ref) in a folder, or at the top with null. */
  assignToFolder: (ref: string | readonly string[], folder: string | null) => void
  setCollapsed: (id: string, collapsed: boolean) => void
  /** A deploy of these shards (by ref) went through: every list puts them first in their folder (lib/shardFolders.ts newestFirst). */
  markUsed: (ref: string | readonly string[], at?: number) => void
  /** Resolves once every change so far has reached the database, or failed and been said. */
  flush: () => Promise<void>
}

interface Queued { owner: string; op: FolderOp }

/** Ops applied in memory and not yet committed, oldest first. */
const queued: Queued[] = []

function drop(entry: Queued): void {
  const at = queued.indexOf(entry)
  if (at >= 0) queued.splice(at, 1)
}

/** The tree the database holds for `owner` with what is still queued for it on top. */
function replay(tree: FolderTree, owner: string): FolderTree {
  let t = tree
  for (const q of queued) if (q.owner === owner) t = applyOp(t, q.op)
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
function announce(owner: string): void {
  try { channel?.postMessage({ owner }) } catch { /* closed */ }
}

let watching = false

/** Where IndexedDB cannot be opened: each identity's tree for the session. */
const sessionTrees = new Map<string, FolderTree>()

export const useShardFolders = create<ShardFoldersState>((set, get) => {
  /** Read the stored tree for `owner` and show it, if that is still whose tree is shown. */
  const reread = (owner: string): Promise<void> => then(async () => {
    const d = await database()
    if (get().owner !== owner) return
    if (!d) {
      const kept = sessionTrees.get(owner)
      set(kept ? { storage: 'memory', tree: replay(kept, owner) } : { storage: 'memory' })
      return
    }
    let stored: FolderTree
    try { stored = await readTree(d, owner) } catch (err) {
      console.warn(`[folders] could not read folders: ${describeError(err)}`)
      set({ storage: 'memory' })
      return
    }
    if (get().owner === owner) set({ tree: replay(stored, owner), storage: 'indexeddb' })
  })

  /** Whose tree a change is for: the identity as it stands, loading its tree first if it is not the one shown. */
  const ownerNow = (): string => {
    const who = useCyberspace.getState().identity.pubkey
    if (get().owner !== who) void get().load(who)
    return who
  }

  /** Apply an op now and queue it for the database; returns the tree it made. */
  const commit = (op: FolderOp): FolderTree => {
    const owner = ownerNow()
    const entry: Queued = { owner, op }
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
        const stored = await commitOps(d, owner, [op])
        drop(entry)
        if (get().owner === owner && get().storage !== 'memory') set({ tree: replay(stored, owner) })
        announce(owner)
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
      if (failed && get().owner === owner) void reread(owner)
    })
    return tree
  }

  return {
    owner: '',
    tree: EMPTY_TREE,
    storage: 'loading',

    load: async (owner) => {
      if (!watching) {
        watching = true
        useCyberspace.subscribe((s, prev) => { if (s.identity.pubkey !== prev.identity.pubkey) void get().load(s.identity.pubkey) })
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            channel = new BroadcastChannel(CHANNEL)
            channel.onmessage = (e: MessageEvent<{ owner?: unknown }>) => {
              const who = e.data?.owner
              if (typeof who === 'string' && who === get().owner && get().storage === 'indexeddb') void reread(who)
            }
          } catch { channel = null }
        }
      }
      const who = owner ?? useCyberspace.getState().identity.pubkey
      // A new identity shows nothing of the old one's, from this moment.
      if (who !== get().owner) {
        // Without IndexedDB the old identity's folders wait here for it to come back.
        if (get().storage === 'memory' && get().owner) sessionTrees.set(get().owner, get().tree)
        set({ owner: who, tree: replay(EMPTY_TREE, who), storage: 'loading' })
      }
      await reread(who)
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

/** Make or find a folder path from the top, for code outside React: returns the last folder's id. */
export function createFolderPath(path: readonly string[]): string | null {
  return useShardFolders.getState().createFolderPath(path)
}

/** File a shard (its workshop model id) in a folder, or at the top with null. */
export function assignToFolder(ref: string | readonly string[], folder: string | null): void {
  useShardFolders.getState().assignToFolder(ref, folder)
}
