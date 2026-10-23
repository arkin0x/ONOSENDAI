/**
 * shardFoldersStorage.test.ts: the folder tree kept in IndexedDB, per
 * identity, through the store. A page load is a fresh copy of the store
 * module over the same database; a second tab is a second copy open at the
 * same time. A change made before the load has answered is kept; another
 * identity's folders are not shown; two tabs' changes both land.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTree, folderOf, pathOf } from '../../lib/shardFolders'

const ME = 'ee'.repeat(32)
const OTHER = 'dd'.repeat(32)
let identity = ME
const watchers = new Set<(s: { identity: { pubkey: string } }, prev: { identity: { pubkey: string } }) => void>()

vi.mock('../useCyberspace', () => ({
  useCyberspace: {
    getState: () => ({ identity: { pubkey: identity, npub: '' } }),
    subscribe: (fn: (s: { identity: { pubkey: string } }, prev: { identity: { pubkey: string } }) => void) => { watchers.add(fn); return () => watchers.delete(fn) },
  },
}))

type Mod = typeof import('../useShardFolders')

/** A page load (or another tab): the module fresh, then the store's load. */
async function boot(owner = identity): Promise<Mod> {
  vi.resetModules()
  const mod = await import('../useShardFolders')
  await mod.useShardFolders.getState().load(owner)
  return mod
}

function switchTo(pubkey: string): void {
  const prev = { identity: { pubkey: identity } }
  identity = pubkey
  for (const w of watchers) w({ identity: { pubkey } }, prev)
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  identity = ME
  watchers.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shard folders in IndexedDB', () => {
  it('keeps folders, filings and folds across a reload', async () => {
    const a = await boot()
    const forest = a.createFolderPath(['maze-kit', 'forest'])!
    a.assignToFolder(['oak', 'pine'], forest)
    const kit = a.useShardFolders.getState().tree.folders[forest].parent!
    a.useShardFolders.getState().setCollapsed(kit, true)
    await a.useShardFolders.getState().flush()

    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(b.useShardFolders.getState().storage).toBe('indexeddb')
    expect(pathOf(t, forest)).toEqual(['maze-kit', 'forest'])
    expect(folderOf(t, 'oak')).toBe(forest)
    expect(t.collapsed[kit]).toBe(true)
  })

  it('returns the existing folder when the path is already there', async () => {
    const a = await boot()
    const one = a.createFolderPath(['maze-kit', 'water'])
    const two = a.createFolderPath(['maze-kit', 'water'])
    expect(two).toBe(one)
    expect(Object.keys(a.useShardFolders.getState().tree.folders)).toHaveLength(2)
    expect(a.createFolderPath([])).toBeNull()
    expect(a.createFolderPath(['  '])).toBeNull()
  })

  it('shows a change at once, and keeps one made before the load answered', async () => {
    const a = await boot()
    a.createFolderPath(['stored'])
    await a.useShardFolders.getState().flush()

    vi.resetModules()
    const b: Mod = await import('../useShardFolders')
    // No load yet: the first change loads this identity's tree itself.
    const early = b.createFolderPath(['early'])!
    expect(b.useShardFolders.getState().tree.folders[early]?.name).toBe('early')
    await b.useShardFolders.getState().flush()
    const names = Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name).sort()
    expect(names).toEqual(['early', 'stored'])

    const c = await boot()
    expect(Object.values(c.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['early', 'stored'])
  })

  it('deleting a folder through the store loses no shard', async () => {
    const a = await boot()
    const trees = a.createFolderPath(['kit', 'forest', 'trees'])!
    const t0 = a.useShardFolders.getState().tree
    const forest = t0.folders[trees].parent!
    const kit = t0.folders[forest].parent!
    a.assignToFolder('oak', trees)
    a.assignToFolder('moss', forest)
    a.assignToFolder('gate', kit)
    a.useShardFolders.getState().deleteFolder(forest)
    a.useShardFolders.getState().deleteFolder(kit)
    await a.useShardFolders.getState().flush()

    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(folderOf(t, 'oak')).toBe(trees)
    expect(t.folders[trees].parent).toBeNull()
    const built = buildTree(t, ['oak', 'moss', 'gate'], (s) => s)
    expect(built.items.sort()).toEqual(['gate', 'moss'])
    expect(built.folders[0].items).toEqual(['oak'])
  })

  it('refuses a move into a descendant through the store', async () => {
    const a = await boot()
    const trees = a.createFolderPath(['kit', 'forest', 'trees'])!
    const kit = pathOf(a.useShardFolders.getState().tree, trees) && Object.values(a.useShardFolders.getState().tree.folders).find((f) => f.name === 'kit')!.id
    expect(a.useShardFolders.getState().moveFolder(kit, trees)).toBe(false)
    expect(a.useShardFolders.getState().moveFolder(kit, kit)).toBe(false)
    expect(a.useShardFolders.getState().moveFolder(trees, null)).toBe(true)
    expect(a.useShardFolders.getState().moveFolder(trees, 'gone')).toBe(false)
  })

  it('keeps each identity\'s folders apart, and a switch shows the new one\'s only', async () => {
    const a = await boot()
    a.createFolderPath(['mine'])
    await a.useShardFolders.getState().flush()
    switchTo(OTHER)
    expect(a.useShardFolders.getState().owner).toBe(OTHER)
    expect(Object.keys(a.useShardFolders.getState().tree.folders)).toHaveLength(0)
    a.createFolderPath(['theirs'])
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['theirs'])
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['mine'])
  })

  it('writes a change queued before a switch to the identity it was made for', async () => {
    const a = await boot()
    a.createFolderPath(['before-switch'])
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    expect(Object.keys(a.useShardFolders.getState().tree.folders)).toHaveLength(0)
    identity = ME
    const b = await boot(ME)
    expect(Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['before-switch'])
  })

  it('lands both tabs\' changes, neither overwriting the other', async () => {
    const tabA = await boot()
    const tabB = await boot()
    // Both loaded the same (empty) tree; each now changes it.
    tabA.createFolderPath(['from-a'])
    tabB.createFolderPath(['from-b'])
    await tabA.useShardFolders.getState().flush()
    await tabB.useShardFolders.getState().flush()
    const c = await boot()
    expect(Object.values(c.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['from-a', 'from-b'])
  })

  it('lasts the session in memory where IndexedDB cannot open', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    const a = await boot()
    expect(a.useShardFolders.getState().storage).toBe('memory')
    const id = a.createFolderPath(['kit'])!
    a.assignToFolder('oak', id)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
  })
})
