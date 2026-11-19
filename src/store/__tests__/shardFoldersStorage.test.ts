/**
 * shardFoldersStorage.test.ts: the folder tree kept in IndexedDB, the
 * device's, through the store. A page load is a fresh copy of the store
 * module over the same database; a second tab is a second copy open at the
 * same time. A change made before the load has answered is kept; a switch of
 * identity changes nothing (owner ruling, 2026-11-19); two tabs' changes
 * both land; the trees older builds kept per identity are merged once and
 * left in place.
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
async function boot(): Promise<Mod> {
  vi.resetModules()
  const mod = await import('../useShardFolders')
  await mod.useShardFolders.getState().load()
  return mod
}

/** Rows as a build before 2026-11-19 kept them: one tree per identity, under its pubkey. */
async function seedOldRows(rows: Record<string, unknown>): Promise<void> {
  const { openShardFoldersDb, TREES_STORE } = await import('../../lib/shardFoldersDb')
  const db = await openShardFoldersDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TREES_STORE, 'readwrite')
    for (const [owner, tree] of Object.entries(rows)) tx.objectStore(TREES_STORE).put({ owner, tree })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
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

  it('keeps when each shard was last deployed across a reload, for every identity (it only sorts)', async () => {
    const a = await boot()
    a.useShardFolders.getState().markUsed(['oak', ''], 42)
    expect(a.useShardFolders.getState().tree.used).toEqual({ oak: 42 })
    await a.useShardFolders.getState().flush()
    const b = await boot()
    expect(b.useShardFolders.getState().tree.used).toEqual({ oak: 42 })
    identity = OTHER
    const c = await boot()
    expect(c.useShardFolders.getState().tree.used).toEqual({ oak: 42 })
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

  it('finds an existing path without writing anything new', async () => {
    const a = await boot()
    const id = a.createFolderPath(['maze-kit', 'forest'])
    for (let i = 0; i < 200; i += 1) expect(a.createFolderPath(['maze-kit', 'forest'])).toBe(id)
    await a.useShardFolders.getState().flush()
    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(Object.keys(t.folders)).toHaveLength(2)
    expect(Object.keys(t.alias)).toHaveLength(0)
  })

  it('an id handed out before the load answered still names the folder it found', async () => {
    const a = await boot()
    a.createFolderPath(['kit'])
    await a.useShardFolders.getState().flush()
    vi.resetModules()
    const b: Mod = await import('../useShardFolders')
    const early = b.createFolderPath(['kit'])!
    await b.useShardFolders.getState().flush()
    b.useShardFolders.getState().renameFolder(early, 'maze-kit')
    b.useShardFolders.getState().setCollapsed(early, true)
    b.assignToFolder('oak', early)
    await b.useShardFolders.getState().flush()
    const t = (await boot()).useShardFolders.getState().tree
    const [only] = Object.values(t.folders)
    expect(Object.keys(t.folders)).toHaveLength(1)
    expect(only.name).toBe('maze-kit')
    expect(t.collapsed[only.id]).toBe(true)
    expect(folderOf(t, 'oak')).toBe(only.id)
  })

  it('files a shard where the user put it even when this tab had not seen another tab\'s filing', async () => {
    const tabA = await boot()
    const tabB = await boot()
    const id = tabA.createFolderPath(['kit'])!
    tabA.assignToFolder('oak', id)
    await tabA.useShardFolders.getState().flush()
    // Tab B still shows oak at the top, and takes it to the top.
    tabB.assignToFolder('oak', null)
    await tabB.useShardFolders.getState().flush()
    expect(folderOf((await boot()).useShardFolders.getState().tree, 'oak')).toBeNull()
  })

  it('makes a path again when another tab deleted it while this tab still showed it', async () => {
    const tabA = await boot()
    tabA.createFolderPath(['kit', 'forest'])
    await tabA.useShardFolders.getState().flush()
    const tabB = await boot()
    const kit = Object.values(tabA.useShardFolders.getState().tree.folders).find((f) => f.name === 'kit')!.id
    tabA.useShardFolders.getState().deleteFolder(kit)
    const forest = Object.values(tabA.useShardFolders.getState().tree.folders).find((f) => f.name === 'forest')!.id
    tabA.useShardFolders.getState().deleteFolder(forest)
    await tabA.useShardFolders.getState().flush()
    // Tab B has not reread: it still shows kit/forest, and files oak there.
    const id = tabB.createFolderPath(['kit', 'forest'])!
    tabB.assignToFolder('oak', id)
    await tabB.useShardFolders.getState().flush()
    const t = (await boot()).useShardFolders.getState().tree
    expect(pathOf(t, folderOf(t, 'oak'))).toEqual(['kit', 'forest'])
    expect(Object.keys(t.alias)).toHaveLength(0)
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

  it('a switch of identity keeps every folder and filing on screen (the NEW RANDOM KEY bug)', async () => {
    const a = await boot()
    const mine = a.createFolderPath(['mine'])!
    a.assignToFolder('oak', mine)
    await a.useShardFolders.getState().flush()
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(mine)
    a.createFolderPath(['theirs'])
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['mine', 'theirs'])
    // And after a reload, as anyone.
    identity = OTHER
    const b = await boot()
    expect(folderOf(b.useShardFolders.getState().tree, 'oak')).toBe(mine)
  })

  it('writes a change queued before a switch, and shows it after', async () => {
    const a = await boot()
    a.createFolderPath(['before-switch'])
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['before-switch'])
    const b = await boot()
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

  it('lasts the session in memory where IndexedDB cannot open, through a switch', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    const a = await boot()
    expect(a.useShardFolders.getState().storage).toBe('memory')
    const id = a.createFolderPath(['kit'])!
    a.assignToFolder('oak', id)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
  })
})

describe('the trees older builds kept per identity', () => {
  const THIRD = 'cc'.repeat(32)
  // ME filed three shards, OTHER two (one of them also filed by ME, elsewhere), THIRD none.
  const mine = {
    folders: {
      fk: { id: 'fk', name: 'kit', parent: null, at: 1 },
      ff: { id: 'ff', name: 'forest', parent: 'fk', at: 2 },
    },
    assign: { oak: 'ff', pine: 'ff', rock: 'fk' },
    collapsed: { fk: true },
    alias: {},
    used: { oak: 10 },
  }
  const theirs = {
    folders: {
      g1: { id: 'g1', name: 'kit', parent: null, at: 5 },
      g2: { id: 'g2', name: 'desert', parent: 'g1', at: 6 },
      g3: { id: 'g3', name: 'props', parent: null, at: 7 },
    },
    assign: { rock: 'g3', cactus: 'g2' },
    collapsed: { g3: true },
    alias: {},
    used: { oak: 30, cactus: 5 },
  }
  const third = { folders: { h1: { id: 'h1', name: 'empty', parent: null, at: 9 } }, assign: {}, collapsed: {}, alias: {} }

  it('merges them into one tree on the first load, losing no folder and no filing', async () => {
    await seedOldRows({ [OTHER]: theirs, [ME]: mine, [THIRD]: third })
    identity = THIRD
    const a = await boot()
    const t = a.useShardFolders.getState().tree
    const paths = Object.keys(t.folders).map((id) => pathOf(t, id).join('/')).sort()
    // kit joined by path; desert added under it; props and empty added at the top.
    expect(paths).toEqual(['empty', 'kit', 'kit/desert', 'kit/forest', 'props'])
    expect(pathOf(t, folderOf(t, 'oak'))).toEqual(['kit', 'forest'])
    expect(pathOf(t, folderOf(t, 'cactus'))).toEqual(['kit', 'desert'])
    // Filed by both: ME filed more shards, so ME's filing stands.
    expect(pathOf(t, folderOf(t, 'rock'))).toEqual(['kit'])
    expect(t.collapsed.fk).toBe(true)
    expect(t.collapsed.g3).toBe(true)
    expect(t.used).toEqual({ oak: 30, cactus: 5 })
  })

  it('leaves the old rows exactly as they were, and merges only once', async () => {
    await seedOldRows({ [ME]: mine, [OTHER]: theirs })
    const a = await boot()
    a.createFolderPath(['later'])
    await a.useShardFolders.getState().flush()
    const { openShardFoldersDb, readIdentityTree } = await import('../../lib/shardFoldersDb')
    const db = await openShardFoldersDb()
    expect(Object.keys((await readIdentityTree(db, ME)).folders).sort()).toEqual(['ff', 'fk'])
    expect(Object.keys((await readIdentityTree(db, OTHER)).folders).sort()).toEqual(['g1', 'g2', 'g3'])
    db.close()
    // An old row changed after the merge (a tab of an older build) is not merged again over the device's tree.
    await seedOldRows({ [OTHER]: { folders: { z: { id: 'z', name: 'late', parent: null, at: 1 } }, assign: {}, collapsed: {}, alias: {} } })
    const b = await boot()
    const names = Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name).sort()
    expect(names).toEqual(['desert', 'forest', 'kit', 'later', 'props'])
  })

  it('a change made before the first load answered lands on the merged tree, not over it', async () => {
    await seedOldRows({ [ME]: mine })
    vi.resetModules()
    const a = await import('../useShardFolders')
    const p = a.useShardFolders.getState().load()
    a.createFolderPath(['early'])
    await p
    await a.useShardFolders.getState().flush()
    const b = await boot()
    expect(Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['early', 'forest', 'kit'])
  })

  it('two tabs loading at once merge once', async () => {
    await seedOldRows({ [ME]: mine, [OTHER]: theirs })
    vi.resetModules()
    const tab1 = await import('../useShardFolders')
    vi.resetModules()
    const tab2 = await import('../useShardFolders')
    await Promise.all([tab1.useShardFolders.getState().load(), tab2.useShardFolders.getState().load()])
    const n1 = Object.keys(tab1.useShardFolders.getState().tree.folders).sort()
    const n2 = Object.keys(tab2.useShardFolders.getState().tree.folders).sort()
    expect(n1).toEqual(n2)
    expect(n1).toEqual(['ff', 'fk', 'g2', 'g3'])
  })
})
