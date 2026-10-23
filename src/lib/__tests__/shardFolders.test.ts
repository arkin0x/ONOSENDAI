/**
 * shardFolders.test.ts: the folder tree as pure data. Folders nest; a move
 * into itself or under itself is refused; deleting a folder never loses a
 * shard (they move up to its parent, or the top); a shard filed in a folder
 * that is gone is shown at the top; a damaged tree is drawn, not lost; and
 * createFolderPath finds what is there before it makes anything.
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_TREE, applyOp, applyOps, buildTree, canonical, flatFolders, folderOf, newestFirst, normalizeTree, pathOf, type FolderNode, type FolderOp, type FolderTree } from '../shardFolders'

const mk = (id: string, name: string, parent: string | null = null): FolderOp => ({ op: 'create', id, name, parent, at: 1 })
const file = (refs: string[], folder: string | null): FolderOp => ({ op: 'assign', refs, folder })

/** maze-kit > forest > trees, and maze-kit > water, with shards in each. */
function kit(): FolderTree {
  return applyOps(EMPTY_TREE, [
    mk('kit', 'maze-kit'),
    mk('forest', 'forest', 'kit'),
    mk('trees', 'trees', 'forest'),
    mk('water', 'water', 'kit'),
    file(['oak', 'pine'], 'trees'),
    file(['moss'], 'forest'),
    file(['pond'], 'water'),
    file(['gate'], 'kit'),
  ])
}

const SHARDS = ['oak', 'pine', 'moss', 'pond', 'gate', 'loose']

/** Every ref anywhere in a built list. */
function allRefs(built: { folders: FolderNode<string>[]; items: string[] }): string[] {
  const out = [...built.items]
  const walk = (n: FolderNode<string>): void => { out.push(...n.items); n.folders.forEach(walk) }
  built.folders.forEach(walk)
  return out.sort()
}

describe('nesting', () => {
  it('nests folders to any depth and draws each shard in its own', () => {
    const t = kit()
    expect(pathOf(t, 'trees')).toEqual(['maze-kit', 'forest', 'trees'])
    const built = buildTree(t, SHARDS, (s) => s)
    expect(built.items).toEqual(['loose'])
    const [k] = built.folders
    expect(k.folder.id).toBe('kit')
    expect(k.items).toEqual(['gate'])
    expect(k.folders.map((f) => f.folder.name)).toEqual(['forest', 'water'])
    expect(k.folders[0].folders[0].items).toEqual(['oak', 'pine'])
    expect(k.count).toBe(5)
    expect(allRefs(built)).toEqual([...SHARDS].sort())
  })

  it('keeps the order items came in, inside a folder', () => {
    const built = buildTree(kit(), ['pine', 'oak'], (s) => s)
    expect(built.folders[0].folders[0].folders[0].items).toEqual(['pine', 'oak'])
  })

  it('sorts folders by name, numbers as numbers', () => {
    const t = applyOps(EMPTY_TREE, [mk('a', 'kit 10'), mk('b', 'kit 2'), mk('c', 'Alpha')])
    expect(flatFolders(t).map((f) => f.folder.name)).toEqual(['Alpha', 'kit 2', 'kit 10'])
  })

  it('refuses an empty name and trims the rest', () => {
    expect(applyOp(EMPTY_TREE, mk('x', '   '))).toBe(EMPTY_TREE)
    const t = applyOp(EMPTY_TREE, mk('x', '  forest   kit '))
    expect(t.folders.x.name).toBe('forest kit')
    expect(applyOp(t, { op: 'rename', id: 'x', name: '' }).folders.x.name).toBe('forest kit')
    expect(applyOp(t, { op: 'rename', id: 'x', name: 'woods' }).folders.x.name).toBe('woods')
  })
})

describe('moving a folder', () => {
  it('moves into another folder and to the top', () => {
    let t = applyOp(kit(), { op: 'move', id: 'water', parent: 'forest' })
    expect(pathOf(t, 'water')).toEqual(['maze-kit', 'forest', 'water'])
    t = applyOp(t, { op: 'move', id: 'water', parent: null })
    expect(pathOf(t, 'water')).toEqual(['water'])
  })

  it('refuses a move into itself', () => {
    const t = kit()
    expect(applyOp(t, { op: 'move', id: 'forest', parent: 'forest' })).toBe(t)
  })

  it('refuses a move under its own descendant, at any depth', () => {
    const t = kit()
    expect(applyOp(t, { op: 'move', id: 'kit', parent: 'forest' })).toBe(t)
    expect(applyOp(t, { op: 'move', id: 'kit', parent: 'trees' })).toBe(t)
    expect(applyOp(t, { op: 'move', id: 'forest', parent: 'trees' })).toBe(t)
  })

  it('refuses a move into a folder that is not there, rather than to the top', () => {
    const t = kit()
    expect(applyOp(t, { op: 'move', id: 'trees', parent: 'nowhere' })).toBe(t)
  })

  it('leaves no loop when two moves cross (two tabs, one after the other)', () => {
    // Tab A moves water under forest; tab B, not yet seeing it, moves forest under water.
    const t = applyOps(kit(), [{ op: 'move', id: 'water', parent: 'forest' }, { op: 'move', id: 'forest', parent: 'water' }])
    expect(pathOf(t, 'water')).toEqual(['maze-kit', 'forest', 'water'])
    expect(allRefs(buildTree(t, SHARDS, (s) => s))).toEqual([...SHARDS].sort())
  })
})

describe('deleting a folder', () => {
  it('moves its shards and folders up to its parent and touches no shard', () => {
    const t = applyOp(kit(), { op: 'delete', id: 'forest' })
    expect(t.folders.forest).toBeUndefined()
    expect(t.folders.trees.parent).toBe('kit')
    expect(folderOf(t, 'moss')).toBe('kit')
    expect(folderOf(t, 'oak')).toBe('trees')
    expect(allRefs(buildTree(t, SHARDS, (s) => s))).toEqual([...SHARDS].sort())
  })

  it('moves a top folder\'s contents to the top', () => {
    const t = applyOp(kit(), { op: 'delete', id: 'kit' })
    expect(folderOf(t, 'gate')).toBeNull()
    expect('gate' in t.assign).toBe(false)
    expect(t.folders.forest.parent).toBeNull()
    expect(t.folders.water.parent).toBeNull()
    const built = buildTree(t, SHARDS, (s) => s)
    expect(built.items.sort()).toEqual(['gate', 'loose'])
    expect(allRefs(built)).toEqual([...SHARDS].sort())
  })

  it('never loses a shard, whatever is deleted in whatever order', () => {
    const order = ['trees', 'kit', 'water', 'forest']
    let t = kit()
    for (const id of order) {
      t = applyOp(t, { op: 'delete', id })
      expect(allRefs(buildTree(t, SHARDS, (s) => s))).toEqual([...SHARDS].sort())
    }
    expect(Object.keys(t.folders)).toEqual([])
    expect(buildTree(t, SHARDS, (s) => s).items.sort()).toEqual([...SHARDS].sort())
  })

  it('forgets the folded state of a deleted folder', () => {
    let t = applyOp(kit(), { op: 'collapse', id: 'forest', collapsed: true })
    expect(t.collapsed.forest).toBe(true)
    t = applyOp(t, { op: 'delete', id: 'forest' })
    expect(t.collapsed.forest).toBeUndefined()
  })
})

describe('orphans and damage', () => {
  it('shows a shard filed in a folder that is gone at the top', () => {
    const t: FolderTree = { ...kit(), assign: { ...kit().assign, ghost: 'deleted-elsewhere' } }
    expect(folderOf(t, 'ghost')).toBeNull()
    expect(buildTree(t, ['ghost', 'oak'], (s) => s).items).toEqual(['ghost'])
  })

  it('refuses to file in a folder that is gone, as a move does', () => {
    const t = kit()
    expect(applyOp(t, file(['oak'], 'gone'))).toBe(t)
    expect(folderOf(t, 'oak')).toBe('trees')
  })

  it('draws a folder whose parent is missing at the top', () => {
    const t: FolderTree = { ...EMPTY_TREE, folders: { a: { id: 'a', name: 'a', parent: 'missing', at: 0 } }, assign: { s: 'a' } }
    const built = buildTree(t, ['s'], (x) => x)
    expect(built.folders.map((f) => f.folder.id)).toEqual(['a'])
    expect(built.folders[0].items).toEqual(['s'])
  })

  it('draws a loop of parents rather than losing it', () => {
    const t: FolderTree = {
      ...EMPTY_TREE,
      folders: { a: { id: 'a', name: 'a', parent: 'b', at: 0 }, b: { id: 'b', name: 'b', parent: 'a', at: 0 }, c: { id: 'c', name: 'c', parent: 'a', at: 0 } },
      assign: { x: 'a', y: 'b', z: 'c' },
    }
    const built = buildTree(t, ['x', 'y', 'z'], (s) => s)
    expect(allRefs(built)).toEqual(['x', 'y', 'z'])
    expect(flatFolders(t).map((f) => f.folder.id).sort()).toEqual(['a', 'b', 'c'])
    // And a looped folder can be deleted without losing what is in it.
    expect(allRefs(buildTree(applyOp(t, { op: 'delete', id: 'a' }), ['x', 'y', 'z'], (s) => s))).toEqual(['x', 'y', 'z'])
  })

  it('keeps what it can read of a damaged stored tree', () => {
    const t = normalizeTree({ folders: { a: { id: 'a', name: 'kit', parent: null }, b: { id: 'not-b', name: 'x' }, c: 7 }, assign: { s: 'a', t: 5 }, collapsed: { a: true, b: 'yes' } })
    expect(Object.keys(t.folders)).toEqual(['a'])
    expect(t.assign).toEqual({ s: 'a' })
    expect(t.collapsed).toEqual({ a: true })
    expect(normalizeTree(null)).toEqual(EMPTY_TREE)
    expect(normalizeTree('junk')).toEqual(EMPTY_TREE)
  })
})

describe('createFolderPath (the path op)', () => {
  it('makes a whole path, and finds it the second time', () => {
    const t1 = applyOp(EMPTY_TREE, { op: 'path', ids: ['1', '2'], names: ['maze-kit', 'forest'], at: 1 })
    expect(pathOf(t1, '2')).toEqual(['maze-kit', 'forest'])
    const t2 = applyOp(t1, { op: 'path', ids: ['3', '4', '5'], names: ['maze-kit', 'forest', 'trees'], at: 2 })
    expect(Object.keys(t2.folders).sort()).toEqual(['1', '2', '5'])
    expect(canonical(t2, '4')).toBe('2')
    expect(pathOf(t2, '5')).toEqual(['maze-kit', 'forest', 'trees'])
  })

  it('files under the folder that was already there when its new id was an alias', () => {
    // Two tabs import the same zip: the second's ids find the first's folders.
    let t = applyOp(EMPTY_TREE, { op: 'path', ids: ['a1', 'a2'], names: ['maze-kit', 'water'], at: 1 })
    t = applyOps(t, [{ op: 'path', ids: ['b1', 'b2'], names: ['maze-kit', 'water'], at: 2 }, file(['pond'], 'b2')])
    expect(folderOf(t, 'pond')).toBe('a2')
    expect(Object.keys(t.folders).sort()).toEqual(['a1', 'a2'])
  })

  it('lets every op on a folder use an id that became an alias', () => {
    let t = applyOp(EMPTY_TREE, { op: 'path', ids: ['a1'], names: ['kit'], at: 1 })
    t = applyOp(t, { op: 'path', ids: ['b1'], names: ['kit'], at: 2 })
    expect(t.folders.b1).toBeUndefined()
    t = applyOps(t, [{ op: 'rename', id: 'b1', name: 'maze-kit' }, { op: 'collapse', id: 'b1', collapsed: true }])
    expect(t.folders.a1.name).toBe('maze-kit')
    expect(t.collapsed.a1).toBe(true)
    t = applyOps(t, [mk('top', 'top'), { op: 'move', id: 'b1', parent: 'top' }])
    expect(t.folders.a1.parent).toBe('top')
    t = applyOp(t, { op: 'delete', id: 'b1' })
    expect(t.folders.a1).toBeUndefined()
  })

  it('skips empty segments and changes nothing for an empty path', () => {
    const t = applyOp(EMPTY_TREE, { op: 'path', ids: ['1', '2', '3'], names: ['kit', ' ', 'forest'], at: 1 })
    expect(pathOf(t, '3')).toEqual(['kit', 'forest'])
    expect(applyOp(EMPTY_TREE, { op: 'path', ids: [], names: [], at: 1 })).toBe(EMPTY_TREE)
  })

  it('does not merge a same-named folder at another level', () => {
    const t = applyOps(EMPTY_TREE, [mk('k', 'kit'), mk('f', 'forest', 'k'), { op: 'path', ids: ['n'], names: ['forest'], at: 1 }])
    expect(t.folders.n.parent).toBeNull()
  })
})

describe('assign and collapse', () => {
  it('files several shards at once and takes them back to the top', () => {
    let t = applyOp(kit(), file(['loose', 'oak'], 'water'))
    expect(folderOf(t, 'loose')).toBe('water')
    expect(folderOf(t, 'oak')).toBe('water')
    t = applyOp(t, file(['loose'], null))
    expect('loose' in t.assign).toBe(false)
  })

  it('returns the same tree for a change that changes nothing', () => {
    const t = kit()
    expect(applyOp(t, file(['oak'], 'trees'))).toBe(t)
    expect(applyOp(t, { op: 'collapse', id: 'kit', collapsed: false })).toBe(t)
    expect(applyOp(t, { op: 'collapse', id: 'nope', collapsed: true })).toBe(t)
  })
})

describe('scale', () => {
  it('draws a few hundred folders and a deep chain quickly', () => {
    const ops: FolderOp[] = []
    for (let i = 0; i < 400; i += 1) ops.push(mk(`w${i}`, `wide ${i}`, i % 20 === 0 ? null : `w${i - (i % 20)}`))
    for (let i = 0; i < 200; i += 1) ops.push(mk(`d${i}`, `deep ${i}`, i === 0 ? null : `d${i - 1}`))
    const t = applyOps(EMPTY_TREE, ops)
    const started = performance.now()
    const built = buildTree(t, ['x'], (s) => s)
    flatFolders(t)
    expect(performance.now() - started).toBeLessThan(500)
    expect(built.folders).toHaveLength(21)
  })
})

describe('a deploy counted as an edit (the use op, newestFirst)', () => {
  it('keeps the later time, so the same op twice changes nothing', () => {
    const t = applyOp(EMPTY_TREE, { op: 'use', refs: ['oak', ''], at: 50 })
    expect(t.used).toEqual({ oak: 50 })
    expect(applyOp(t, { op: 'use', refs: ['oak'], at: 50 })).toBe(t)
    expect(applyOp(t, { op: 'use', refs: ['oak'], at: 10 })).toBe(t)
    expect(applyOp(t, { op: 'use', refs: ['oak'], at: 90 }).used).toEqual({ oak: 90 })
  })

  it('survives a folder deleted, and a stored tree read back', () => {
    const t = applyOps(EMPTY_TREE, [{ op: 'create', id: 'kit', name: 'kit', parent: null, at: 1 }, { op: 'use', refs: ['oak'], at: 7 }, { op: 'delete', id: 'kit' }])
    expect(t.used).toEqual({ oak: 7 })
    expect(normalizeTree({ used: { oak: 7, bad: 'x', inf: Infinity } }).used).toEqual({ oak: 7 })
  })

  it('sorts by the later of the edit and the deploy, ties in the order given', () => {
    const items = [{ id: 'a', at: 30 }, { id: 'b', at: 20 }, { id: 'c', at: 10 }, { id: 'd', at: 10 }]
    const order = (used?: Record<string, number>): string[] => newestFirst(items, (i) => i.id, (i) => i.at, used).map((i) => i.id)
    expect(order(undefined)).toEqual(['a', 'b', 'c', 'd'])
    expect(order({ d: 40 })).toEqual(['d', 'a', 'b', 'c'])
    // A deploy older than the last edit changes nothing.
    expect(order({ a: 5, c: 25 })).toEqual(['a', 'c', 'b', 'd'])
  })
})
