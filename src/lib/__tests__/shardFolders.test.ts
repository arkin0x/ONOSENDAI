/**
 * shardFolders.test.ts - bulk import's way to folders, before and after the
 * workshop has them.
 *
 * What these prove: with no folder functions on the store the adapter is
 * absent and placing does nothing; once `createFolderPath` and
 * `assignToFolder` are there it lights up, makes each path once, and leaves
 * a shard at the zip's top where it is; `folderPathOf` comes along when
 * present.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { folderApi, placeInFolders } from '../shardFolders'

describe('folderApi', () => {
  it('is absent while the workshop has no folders, and placing does nothing', () => {
    expect(folderApi({})).toBeNull()
    expect(folderApi()).toBeNull()
    expect(placeInFolders(null, [{ shardId: 'a', folder: ['kit'] }])).toBe(false)
  })

  it('lights up with createFolderPath and assignToFolder, making each path once', () => {
    const createFolderPath = vi.fn((path: string[]) => `id:${path.join('/')}`)
    const assignToFolder = vi.fn()
    const api = folderApi({ createFolderPath, assignToFolder })
    expect(api).not.toBeNull()
    expect(api!.folderPathOf).toBeUndefined()
    expect(placeInFolders(api, [
      { shardId: 'a', folder: ['maze-kit', 'forest'] },
      { shardId: 'b', folder: ['maze-kit', 'forest'] },
      { shardId: 'c', folder: ['maze-kit', 'shared'] },
      { shardId: 'd', folder: [] },
    ])).toBe(true)
    expect(createFolderPath.mock.calls).toEqual([[['maze-kit', 'forest']], [['maze-kit', 'shared']]])
    expect(assignToFolder.mock.calls).toEqual([['a', 'id:maze-kit/forest'], ['b', 'id:maze-kit/forest'], ['c', 'id:maze-kit/shared']])
  })

  it('carries folderPathOf when the store has it', () => {
    const folderPathOf = (): string[] => ['x']
    expect(folderApi({ createFolderPath: () => '', assignToFolder: () => {}, folderPathOf })!.folderPathOf).toBe(folderPathOf)
  })
})
