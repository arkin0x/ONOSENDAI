/**
 * shardFolders.ts: the folder tree your shard lists are sorted into, as pure
 * data. Local only: nothing here is ever published, and the tree belongs to
 * one identity (store/useShardFolders.ts keeps one per pubkey, in IndexedDB
 * through lib/shardFoldersDb.ts).
 *
 * A folder is a name and a parent; a shard is filed by its ref (a workshop
 * model's id, which is also the `d` of the object it publishes as) pointing at
 * a folder. Folders are only ever a view over the lists: deleting one never
 * touches a shard. Its shards and subfolders move up to its parent, or to the
 * top when it had none, and a shard whose folder is gone for any reason is
 * shown at the top (folderOf). A tree read back damaged (a parent that is
 * missing, a loop of parents) is drawn with the broken folders at the top
 * rather than lost (parentOf).
 *
 * Every change is an op applied by applyOp, a pure function of the tree.
 * The store applies an op to the tree in memory at once and to the stored
 * tree inside one IndexedDB transaction, so two tabs changing the same tree
 * are applied one after the other to whatever the other left, not one
 * overwriting the other. That is why each op is checked against the tree it
 * lands on (a move into a folder another tab has since moved under it is
 * refused there), and why createFolderPath carries the ids it would create:
 * when the folder already exists in the tree it lands on, its new id becomes
 * an alias for the existing one, so a shard filed under it right after still
 * lands in the folder that was there.
 */

/** One folder. `parent` null is the top of the list. */
export interface Folder {
  id: string
  name: string
  parent: string | null
  /** When it was made, ms. */
  at: number
}

export interface FolderTree {
  folders: Record<string, Folder>
  /** Shard ref to the folder it is in. A ref absent here is at the top. */
  assign: Record<string, string>
  /** Folders shown folded. */
  collapsed: Record<string, true>
  /** A createFolderPath id that found its folder already made, to that folder. */
  alias: Record<string, string>
}

export type FolderOp =
  | { op: 'create'; id: string; name: string; parent: string | null; at: number }
  | { op: 'path'; ids: string[]; names: string[]; at: number }
  | { op: 'rename'; id: string; name: string }
  | { op: 'move'; id: string; parent: string | null }
  | { op: 'delete'; id: string }
  | { op: 'assign'; refs: string[]; folder: string | null }
  | { op: 'collapse'; id: string; collapsed: boolean }

/** The longest folder name kept, as a shard's name is capped (useWorkshop rename). */
export const MAX_NAME = 64

export const EMPTY_TREE: FolderTree = Object.freeze({ folders: {}, assign: {}, collapsed: {}, alias: {} }) as FolderTree

/** A folder name as kept: trimmed, inner runs of space made one, capped. Empty means no name. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

/** A fresh folder id. */
export function newFolderId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return `f-${c.randomUUID()}`
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The folder an id names now: itself, or what its alias found; null when there is none. */
export function canonical(tree: FolderTree, id: string | null | undefined): string | null {
  let at = id ?? null
  for (let hops = 0; at !== null && hops < 8; hops += 1) {
    if (tree.folders[at]) return at
    at = tree.alias[at] ?? null
  }
  return null
}

/**
 * The parent a folder is drawn under: its own when that exists and the chain
 * above it reaches the top without coming back round, else the top. A stored
 * tree should never hold a loop (move refuses one), but a damaged one is
 * drawn rather than lost.
 */
export function parentOf(tree: FolderTree, id: string): string | null {
  const parent = tree.folders[id]?.parent ?? null
  if (parent === null || !tree.folders[parent]) return null
  // Only a loop back to this folder lifts it; a loop higher up lifts the
  // folders in that loop, and this one stays under its parent.
  const seen = new Set<string>()
  for (let at: string | null = parent; at !== null; at = tree.folders[at]?.parent ?? null) {
    if (at === id) return null
    if (seen.has(at) || !tree.folders[at]) return parent
    seen.add(at)
  }
  return parent
}

/** Whether `id` is `ancestor` or sits anywhere under it. */
export function isWithin(tree: FolderTree, id: string | null, ancestor: string): boolean {
  const seen = new Set<string>()
  for (let at = id; at !== null && !seen.has(at); at = parentOf(tree, at)) {
    if (at === ancestor) return true
    seen.add(at)
  }
  return false
}

/** The folder a shard is shown in: the one it was filed in when that still exists, else the top (null). */
export function folderOf(tree: FolderTree, ref: string): string | null {
  const id = tree.assign[ref]
  return id && tree.folders[id] ? id : null
}

/** A folder's names from the top down. */
export function pathOf(tree: FolderTree, id: string | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (let at = id; at !== null && tree.folders[at] && !seen.has(at); at = parentOf(tree, at)) {
    seen.add(at)
    out.unshift(tree.folders[at].name)
  }
  return out
}

/** The folders directly under `parent`, by name. */
export function childrenOf(tree: FolderTree, parent: string | null): Folder[] {
  return childIndex(tree).get(parent) ?? []
}

/**
 * Every folder's children, sorted, worked out once per tree: the lists ask
 * for children folder by folder, and scanning every folder each time grew
 * with the square of the folder count (review of PR 449).
 */
const indexes = new WeakMap<FolderTree, Map<string | null, Folder[]>>()
function childIndex(tree: FolderTree): Map<string | null, Folder[]> {
  let index = indexes.get(tree)
  if (index) return index
  index = new Map()
  for (const f of Object.values(tree.folders)) {
    const p = parentOf(tree, f.id)
    const list = index.get(p)
    if (list) list.push(f)
    else index.set(p, [f])
  }
  // Frozen: childrenOf hands these out, and they are shared by every caller of the same tree.
  for (const [p, list] of index) index.set(p, Object.freeze(list.sort(byName)) as Folder[])
  indexes.set(tree, index)
  return index
}

function byName(a: Folder, b: Folder): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)
}

/** Every folder in drawing order with its depth, for a chooser. `skip` leaves out a folder and everything under it. */
export function flatFolders(tree: FolderTree, skip?: string): Array<{ folder: Folder; depth: number }> {
  const out: Array<{ folder: Folder; depth: number }> = []
  const walk = (parent: string | null, depth: number): void => {
    for (const f of childrenOf(tree, parent)) {
      if (f.id === skip) continue
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** A folder in a drawn list: what is in it, folders first. */
export interface FolderNode<T> {
  folder: Folder
  folders: FolderNode<T>[]
  items: T[]
  /** Every item in it and under it. */
  count: number
}

/**
 * The list as drawn: the folders at the top with what is in each, and the
 * items in no folder (or in one that is gone). Items keep the order they
 * came in, inside each folder, so a list sorted newest first stays so.
 */
export function buildTree<T>(tree: FolderTree, items: readonly T[], refOf: (item: T) => string): { folders: FolderNode<T>[]; items: T[] } {
  const inFolder = new Map<string | null, T[]>()
  for (const item of items) {
    const at = folderOf(tree, refOf(item))
    const list = inFolder.get(at)
    if (list) list.push(item)
    else inFolder.set(at, [item])
  }
  const node = (folder: Folder): FolderNode<T> => {
    const folders = childrenOf(tree, folder.id).map(node)
    const own = inFolder.get(folder.id) ?? []
    return { folder, folders, items: own, count: own.length + folders.reduce((n, f) => n + f.count, 0) }
  }
  return { folders: childrenOf(tree, null).map(node), items: inFolder.get(null) ?? [] }
}

/**
 * The tree after one op, or the same tree when the op changes nothing or is
 * refused (an empty name, a folder that is not there, a move into itself or
 * under itself).
 */
export function applyOp(tree: FolderTree, op: FolderOp): FolderTree {
  // An id createFolderPath handed out may be an alias of the folder it found:
  // every op on a folder acts on that folder.
  if (op.op === 'rename' || op.op === 'move' || op.op === 'delete' || op.op === 'collapse') {
    const id = canonical(tree, op.id)
    if (id === null) return tree
    if (id !== op.id) return applyOp(tree, { ...op, id })
  }
  switch (op.op) {
    case 'create': {
      const name = cleanName(op.name)
      if (!name || tree.folders[op.id]) return tree
      return { ...tree, folders: { ...tree.folders, [op.id]: { id: op.id, name, parent: canonical(tree, op.parent), at: op.at } } }
    }
    case 'path': {
      let folders = tree.folders
      let alias = tree.alias
      let parent: string | null = null
      const n = Math.min(op.ids.length, op.names.length)
      for (let i = 0; i < n; i += 1) {
        const name = cleanName(op.names[i])
        if (!name) continue
        const id = op.ids[i]
        const view: FolderTree = { ...tree, folders, alias }
        const have: Folder | undefined = folders[id] ? folders[id] : childrenOf(view, parent).find((f) => f.name === name)
        if (have) {
          if (have.id !== id) alias = { ...alias, [id]: have.id }
          parent = have.id
        } else {
          folders = { ...folders, [id]: { id, name, parent, at: op.at } }
          parent = id
        }
      }
      return folders === tree.folders && alias === tree.alias ? tree : { ...tree, folders, alias }
    }
    case 'rename': {
      const f = tree.folders[op.id]
      const name = cleanName(op.name)
      if (!f || !name || name === f.name) return tree
      return { ...tree, folders: { ...tree.folders, [op.id]: { ...f, name } } }
    }
    case 'move': {
      const f = tree.folders[op.id]
      if (!f) return tree
      const parent = op.parent === null ? null : canonical(tree, op.parent)
      // A named parent that is not there is refused, not read as the top.
      if (op.parent !== null && parent === null) return tree
      if (parent !== null && isWithin(tree, parent, op.id)) return tree
      if (parent === f.parent) return tree
      return { ...tree, folders: { ...tree.folders, [op.id]: { ...f, parent } } }
    }
    case 'delete': {
      if (!tree.folders[op.id]) return tree
      const up = parentOf(tree, op.id)
      const folders: Record<string, Folder> = {}
      for (const f of Object.values(tree.folders)) {
        if (f.id === op.id) continue
        folders[f.id] = f.parent === op.id ? { ...f, parent: up } : f
      }
      const assign: Record<string, string> = {}
      for (const [ref, at] of Object.entries(tree.assign)) {
        if (at !== op.id) assign[ref] = at
        else if (up !== null) assign[ref] = up
      }
      const alias: Record<string, string> = {}
      for (const [from, to] of Object.entries(tree.alias)) {
        if (to !== op.id) alias[from] = to
        else if (up !== null) alias[from] = up
      }
      const { [op.id]: _gone, ...collapsed } = tree.collapsed
      return { folders, assign, collapsed, alias }
    }
    case 'assign': {
      const to = canonical(tree, op.folder)
      // A named folder that is not there is refused, not read as the top, as a move is.
      if (op.folder !== null && to === null) return tree
      let assign = tree.assign
      for (const ref of op.refs) {
        if (!ref) continue
        if (to === null) {
          if (ref in assign) { const { [ref]: _out, ...rest } = assign; assign = rest }
        } else if (assign[ref] !== to) {
          assign = { ...assign, [ref]: to }
        }
      }
      return assign === tree.assign ? tree : { ...tree, assign }
    }
    case 'collapse': {
      if (!tree.folders[op.id] || !!tree.collapsed[op.id] === op.collapsed) return tree
      if (op.collapsed) return { ...tree, collapsed: { ...tree.collapsed, [op.id]: true } }
      const { [op.id]: _open, ...collapsed } = tree.collapsed
      return { ...tree, collapsed }
    }
  }
}

/** The ops in order. */
export function applyOps(tree: FolderTree, ops: readonly FolderOp[]): FolderTree {
  return ops.reduce(applyOp, tree)
}

/**
 * A tree read back from storage, as this app can use it: anything that is
 * not a folder, a filing or a fold is dropped, never the whole tree.
 */
export function normalizeTree(raw: unknown): FolderTree {
  const r = raw as Partial<Record<keyof FolderTree, unknown>> | null
  if (!r || typeof r !== 'object') return EMPTY_TREE
  const folders: Record<string, Folder> = {}
  if (r.folders && typeof r.folders === 'object') {
    for (const [id, v] of Object.entries(r.folders as Record<string, unknown>)) {
      const f = v as Partial<Folder> | null
      if (!f || typeof f !== 'object' || f.id !== id || typeof f.name !== 'string') continue
      const name = cleanName(f.name)
      if (!name) continue
      // Whatever a later build keeps on a folder is kept as it was.
      folders[id] = { ...f, id, name, parent: typeof f.parent === 'string' ? f.parent : null, at: typeof f.at === 'number' ? f.at : 0 }
    }
  }
  const strings = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {}
    if (v && typeof v === 'object') for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === 'string') out[k] = s
    return out
  }
  const collapsed: Record<string, true> = {}
  if (r.collapsed && typeof r.collapsed === 'object') for (const [k, v] of Object.entries(r.collapsed as Record<string, unknown>)) if (v === true) collapsed[k] = true
  return { folders, assign: strings(r.assign), collapsed, alias: strings(r.alias) }
}
