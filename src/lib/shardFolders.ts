/**
 * shardFolders.ts - where bulk import puts a shard's folder, through whatever
 * folders the workshop has.
 *
 * Local nested folders are their own change (feat/shard-folders, in progress
 * beside this one). Until the workshop store has them, a zip's folders are
 * shown in the review list and go nowhere; once the store grows
 * `createFolderPath(path)` and `assignToFolder(shardId, folderId)` they light
 * up here with no change to bulk import. `folderPathOf(shardId)`, if it is
 * there too, lets duplicate matching look inside a folder rather than across
 * every shard. If folders land under other names, this file is the one place
 * to change.
 */

import { useWorkshop } from '../store/useWorkshop'

export interface FolderApi {
  /** The folder at this path, made if it is missing, outermost first; its id. */
  createFolderPath: (path: string[]) => string
  /** Put the shard in that folder. */
  assignToFolder: (shardId: string, folderId: string) => void
  /** The shard's folder path, outermost first; null when it is in none. */
  folderPathOf?: (shardId: string) => string[] | null
}

type MaybeFolders = Partial<Record<keyof FolderApi, unknown>>

/** The workshop's folders, or null while it has none. */
export function folderApi(state: MaybeFolders = useWorkshop.getState() as unknown as MaybeFolders): FolderApi | null {
  const { createFolderPath, assignToFolder, folderPathOf } = state
  if (typeof createFolderPath !== 'function' || typeof assignToFolder !== 'function') return null
  return {
    createFolderPath: createFolderPath as FolderApi['createFolderPath'],
    assignToFolder: assignToFolder as FolderApi['assignToFolder'],
    ...(typeof folderPathOf === 'function' ? { folderPathOf: folderPathOf as NonNullable<FolderApi['folderPathOf']> } : {}),
  }
}

/**
 * Put each shard in its folder, making each path once (`made` carries the
 * paths already made across calls, by path). A shard with no folder
 * (a file at the zip's top) is left where it is. Nothing happens without
 * folders. Whether folders were there to put them in.
 */
export function placeInFolders(api: FolderApi | null, placements: ReadonlyArray<{ shardId: string; folder: readonly string[] }>, made: Map<string, string> = new Map()): boolean {
  if (!api) return false
  for (const { shardId, folder } of placements) {
    if (folder.length === 0) continue
    const key = folder.join('/')
    let id = made.get(key)
    if (id === undefined) { id = api.createFolderPath([...folder]); made.set(key, id) }
    api.assignToFolder(shardId, id)
  }
  return true
}
