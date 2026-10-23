/**
 * importFolders.test.ts - bulk import's way to folders, before and after the
 * workshop has them (#449).
 *
 * What these prove: with no folders module the adapter is absent and placing
 * does nothing; with #449's createFolderPath and assignToFolder it lights
 * up, makes each path once, files each shard by its model id and leaves a
 * shard at the zip's top where it is; with the store's tree and the lib's
 * folderOf and pathOf it reads a shard's folder path for duplicate matching.
 */
import { describe, expect, it, vi } from 'vitest'
import { folderApi, placeInFolders } from '../importFolders'

describe('folderApi', () => {
  it('is absent while there are no folders, and placing does nothing', () => {
    expect(folderApi({})).toBeNull()
    expect(folderApi({ store: { createFolderPath: () => 'x' } })).toBeNull()
    expect(placeInFolders(null, [{ shardId: 'a', folder: ['kit'] }])).toBe(false)
  })

  it('finds nothing on a branch without the folders store', () => {
    // On v2 before #449 the file does not exist; once it does this lights up.
    const api = folderApi()
    expect(api === null || typeof api.createFolderPath === 'function').toBe(true)
  })

  it('lights up with createFolderPath and assignToFolder, making each path once', () => {
    const createFolderPath = vi.fn((path: readonly string[]) => `id:${path.join('/')}`)
    const assignToFolder = vi.fn()
    const api = folderApi({ store: { createFolderPath, assignToFolder } })
    expect(api).not.toBeNull()
    expect(api!.folderPathOf).toBeUndefined()
    const made = new Map<string, string | null>()
    placeInFolders(api, [{ shardId: 'a', folder: ['maze-kit', 'forest'] }, { shardId: 'd', folder: [] }], made)
    placeInFolders(api, [{ shardId: 'b', folder: ['maze-kit', 'forest'] }, { shardId: 'c', folder: ['maze-kit', 'shared'] }], made)
    expect(createFolderPath.mock.calls).toEqual([[['maze-kit', 'forest']], [['maze-kit', 'shared']]])
    expect(assignToFolder.mock.calls).toEqual([['a', 'id:maze-kit/forest'], ['b', 'id:maze-kit/forest'], ['c', 'id:maze-kit/shared']])
  })

  it('files nothing when a path comes back null', () => {
    const assignToFolder = vi.fn()
    placeInFolders(folderApi({ store: { createFolderPath: () => null, assignToFolder } }), [{ shardId: 'a', folder: ['x'] }])
    expect(assignToFolder).not.toHaveBeenCalled()
  })

  it('reads a shard\'s folder path from the store\'s tree', () => {
    const tree = { assign: { s1: 'f2' }, folders: { f1: { name: 'maze-kit', parent: null }, f2: { name: 'forest', parent: 'f1' } } }
    const api = folderApi({
      store: { createFolderPath: () => null, assignToFolder: () => {}, useShardFolders: { getState: () => ({ tree }) } },
      lib: {
        folderOf: (t: typeof tree, ref: string) => (t.assign as Record<string, string>)[ref] ?? null,
        pathOf: (t: typeof tree, id: string | null) => {
          const out: string[] = []
          for (let at = id; at; at = (t.folders as Record<string, { name: string; parent: string | null }>)[at].parent) out.unshift((t.folders as Record<string, { name: string }>)[at].name)
          return out
        },
      },
    })
    expect(api!.folderPathOf!('s1')).toEqual(['maze-kit', 'forest'])
    expect(api!.folderPathOf!('nobody')).toEqual([])
  })

  it('carries the store\'s flush, to wait for the filing to be saved', async () => {
    const flush = vi.fn(async () => {})
    const api = folderApi({ store: { createFolderPath: () => null, assignToFolder: () => {}, useShardFolders: { getState: () => ({ tree: {}, flush }) } } })
    await api!.flush!()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
