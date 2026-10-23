/**
 * importFolders.ts - where bulk import files a shard: the folder its file
 * was in, in the workshop's own folders, once there are any.
 *
 * Local nested folders are their own change (#449, feat/shard-folders): a
 * store of their own, store/useShardFolders.ts, with createFolderPath(path)
 * and assignToFolder(modelId, folderId) for code that files shards. Until it
 * is merged there is nothing to import, so it is looked for, not imported:
 * import.meta.glob finds the module when the file exists and nothing when it
 * does not, and bulk import lights up on the merge with no change here. If
 * those names change before it lands, this file is the one place to follow.
 */

/** What bulk import needs of the folders. */
export interface FolderApi {
  /** The folder at this path, made if it is missing, outermost first; its id, or null for an empty path. */
  createFolderPath: (path: readonly string[]) => string | null
  /** File the shard (its workshop model id) in that folder. */
  assignToFolder: (shardId: string, folderId: string | null) => void
  /** The shard's folder path, outermost first; [] at the top. */
  folderPathOf?: (shardId: string) => string[]
  /** Resolves once the filing has reached storage. */
  flush?: () => Promise<void>
}

/** The shapes of #449's modules that are read here, all optional, since they may be absent or change. */
interface FoldersStoreModule {
  createFolderPath?: unknown
  assignToFolder?: unknown
  useShardFolders?: { getState?: () => { tree?: unknown; flush?: unknown } }
}
interface FoldersLibModule {
  folderOf?: unknown
  pathOf?: unknown
}

/** The two modules, when the files exist. */
export interface FolderModules {
  store?: FoldersStoreModule
  lib?: FoldersLibModule
}

const stores = import.meta.glob<FoldersStoreModule>('../store/useShardFolders.ts', { eager: true })
const libs = import.meta.glob<FoldersLibModule>('../lib/shardFolders.ts', { eager: true })

function found(): FolderModules {
  return { store: Object.values(stores)[0], lib: Object.values(libs)[0] }
}

/** The workshop's folders, or null while it has none. */
export function folderApi(mods: FolderModules = found()): FolderApi | null {
  const { store, lib } = mods
  const create = store?.createFolderPath
  const assign = store?.assignToFolder
  if (typeof create !== 'function' || typeof assign !== 'function') return null
  const api: FolderApi = {
    createFolderPath: (path) => (create as (p: readonly string[]) => string | null)(path),
    assignToFolder: (shardId, folderId) => (assign as (r: string, f: string | null) => void)(shardId, folderId),
  }
  const getState = store?.useShardFolders?.getState
  if (typeof getState === 'function' && typeof getState().flush === 'function') api.flush = () => (getState().flush as () => Promise<void>)()
  const folderOf = lib?.folderOf
  const pathOf = lib?.pathOf
  if (typeof getState === 'function' && typeof folderOf === 'function' && typeof pathOf === 'function') {
    api.folderPathOf = (shardId) => {
      const tree = getState().tree
      if (!tree) return []
      const path = (pathOf as (t: unknown, id: string | null) => unknown)(tree, (folderOf as (t: unknown, r: string) => string | null)(tree, shardId))
      return Array.isArray(path) ? path.filter((s): s is string => typeof s === 'string') : []
    }
  }
  return api
}

/**
 * Put each shard in its folder, making each path once (`made` carries the
 * paths already made across calls, by path). A shard with no folder (a file
 * at the zip's top) is left where it is. Nothing happens without folders.
 * Whether folders were there to put them in.
 */
export function placeInFolders(api: FolderApi | null, placements: ReadonlyArray<{ shardId: string; folder: readonly string[] }>, made: Map<string, string | null> = new Map()): boolean {
  if (!api) return false
  for (const { shardId, folder } of placements) {
    if (folder.length === 0) continue
    const key = folder.join('/')
    let id = made.get(key)
    if (id === undefined) { id = api.createFolderPath([...folder]); made.set(key, id) }
    if (id) api.assignToFolder(shardId, id)
  }
  return true
}
