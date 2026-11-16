/**
 * duplicateKeepsFolder.test.ts: the workshop MENU's DUPLICATE puts the copy
 * in the folder its source is in, at any depth, and a source at the top keeps
 * its copy at the top (arkinox, 2026-11-16: "when i duplicate a shard from the
 * lucide copy plus button in the workshop menu, it gets copied to the root
 * instead of the current folder"). The folder counts the list draws follow.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTree, folderOf, type FolderNode } from '../../lib/shardFolders'

const ME = 'ee'.repeat(32)

vi.mock('../useCyberspace', () => ({
  useCyberspace: Object.assign(
    (sel: (s: { identity: { pubkey: string } }) => unknown) => sel({ identity: { pubkey: ME } }),
    { getState: () => ({ identity: { pubkey: ME, npub: '' } }), subscribe: () => () => undefined },
  ),
}))

type Folders = typeof import('../useShardFolders')
type Workshop = typeof import('../useWorkshop')

/** A page load: both stores fresh over the same database, the folders read. */
async function boot(): Promise<{ folders: Folders; workshop: Workshop }> {
  vi.resetModules()
  const folders = await import('../useShardFolders')
  const workshop = await import('../useWorkshop')
  await folders.useShardFolders.getState().load(ME)
  workshop.useWorkshop.setState({ shards: [], currentId: null })
  return { folders, workshop }
}

/** The drawn node for a path of folder names from the top. */
function nodeAt<T>(top: FolderNode<T>[], path: string[]): FolderNode<T> {
  let list = top
  let node: FolderNode<T> | undefined
  for (const name of path) {
    node = list.find((n) => n.folder.name === name)
    if (!node) throw new Error(`no folder ${name}`)
    list = node.folders
  }
  return node!
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* not under test */ })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DUPLICATE keeps the folder', () => {
  it('a shard in a nested folder is copied into that same folder, and the counts follow', async () => {
    const { folders, workshop } = await boot()
    const ws = workshop.useWorkshop.getState
    const fs = folders.useShardFolders.getState
    const src = ws().create('oak')
    ws().create('loose')
    const forest = folders.createFolderPath(['maze-kit', 'forest'])!
    folders.assignToFolder(src, forest)

    const before = buildTree(fs().tree, ws().shards, (s) => s.id)
    expect(nodeAt(before.folders, ['maze-kit']).count).toBe(1)
    expect(nodeAt(before.folders, ['maze-kit', 'forest']).count).toBe(1)
    expect(before.items.map((s) => s.name)).toEqual(['loose'])

    const copy = ws().duplicate(src)
    expect(copy).not.toBe(src)
    expect(folderOf(fs().tree, copy)).toBe(forest)
    expect(folderOf(fs().tree, src)).toBe(forest)

    const after = buildTree(fs().tree, ws().shards, (s) => s.id)
    const inForest = nodeAt(after.folders, ['maze-kit', 'forest'])
    expect(inForest.items.map((s) => s.name).sort()).toEqual(['oak', 'oak copy'])
    expect(inForest.count).toBe(2)
    expect(nodeAt(after.folders, ['maze-kit']).count).toBe(2)
    // Nothing new at the top.
    expect(after.items.map((s) => s.name)).toEqual(['loose'])
  })

  it('the filing reaches storage: the copy is still in the folder after a reload', async () => {
    const a = await boot()
    const src = a.workshop.useWorkshop.getState().create('pine')
    const forest = a.folders.createFolderPath(['maze-kit', 'forest'])!
    a.folders.assignToFolder(src, forest)
    const copy = a.workshop.useWorkshop.getState().duplicate(src)
    await a.folders.useShardFolders.getState().flush()

    const b = await boot()
    expect(folderOf(b.folders.useShardFolders.getState().tree, copy)).toBe(forest)
  })

  it('a shard at the top is copied to the top, and no folder count changes', async () => {
    const { folders, workshop } = await boot()
    const ws = workshop.useWorkshop.getState
    const fs = folders.useShardFolders.getState
    const filed = ws().create('filed')
    const top = ws().create('rock')
    const kit = folders.createFolderPath(['maze-kit'])!
    folders.assignToFolder(filed, kit)

    const copy = ws().duplicate(top)
    expect(folderOf(fs().tree, copy)).toBeNull()
    expect(copy in fs().tree.assign).toBe(false)

    const after = buildTree(fs().tree, ws().shards, (s) => s.id)
    expect(after.items.map((s) => s.name).sort()).toEqual(['rock', 'rock copy'])
    expect(nodeAt(after.folders, ['maze-kit']).count).toBe(1)
  })

  it('the copy is already in its folder when it joins the list, so it is never drawn at the top first', async () => {
    const { folders, workshop } = await boot()
    const src = workshop.useWorkshop.getState().create('wall')
    const kit = folders.createFolderPath(['maze-kit'])!
    folders.assignToFolder(src, kit)
    const seen: Array<string | null> = []
    const stop = workshop.useWorkshop.subscribe((s, prev) => {
      if (s.shards.length > prev.shards.length) seen.push(folderOf(folders.useShardFolders.getState().tree, s.shards[s.shards.length - 1].id))
    })
    workshop.useWorkshop.getState().duplicate(src)
    stop()
    expect(seen).toEqual([kit])
  })

  it('a duplicate made while the folders are still being read is filed once they are', async () => {
    const a = await boot()
    const src = a.workshop.useWorkshop.getState().create('gate')
    const kit = a.folders.createFolderPath(['maze-kit'])!
    a.folders.assignToFolder(src, kit)
    await a.folders.useShardFolders.getState().flush()

    // A page load: the folder store fresh and not yet read back, the shards already there.
    vi.resetModules()
    const folders = await import('../useShardFolders')
    const workshop = await import('../useWorkshop')
    workshop.useWorkshop.setState({ shards: a.workshop.useWorkshop.getState().shards, currentId: null })
    expect(folders.useShardFolders.getState().storage).toBe('loading')
    const copy = workshop.useWorkshop.getState().duplicate(src)
    await folders.useShardFolders.getState().load(ME)
    await folders.useShardFolders.getState().flush()
    expect(folderOf(folders.useShardFolders.getState().tree, copy)).toBe(kit)
  })

  it('a copy of a copy stays in the folder too', async () => {
    const { folders, workshop } = await boot()
    const ws = workshop.useWorkshop.getState
    const deep = folders.createFolderPath(['a', 'b', 'c'])!
    const src = ws().create('cell')
    folders.assignToFolder(src, deep)
    const second = ws().duplicate(ws().duplicate(src))
    expect(folderOf(folders.useShardFolders.getState().tree, second)).toBe(deep)
    expect(nodeAt(buildTree(folders.useShardFolders.getState().tree, ws().shards, (s) => s.id).folders, ['a']).count).toBe(3)
  })
})
