/**
 * shardSearch.test.ts: the search under a list of your shards, as pure data
 * (arkinox, 2026-11-16: "search should filter results. folder trees open to
 * reveal matching folder names, and folders open to reveal matching shards").
 *
 * The tree is the one in his screenshot: basilica plugs > props > banners,
 * with walls beside props, and one shard at the top.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_TREE, applyOps, buildTree, type FolderNode, type FolderOp } from '../shardFolders'
import { filterTree, matchRange, matches, searchKey } from '../shardSearch'

interface Item { id: string; name: string }
const ITEMS: Item[] = [
  { id: 'red', name: 'basilica-prop-gonfalon-red' },
  { id: 'blue', name: 'basilica-prop-gonfalon-blue' },
  { id: 'door', name: 'basilica-plug-wall-door' },
  { id: 'arch', name: 'basilica-plug-wall-arch' },
  { id: 'oak', name: 'Oak Tree' },
]
const mk = (id: string, name: string, parent: string | null = null): FolderOp => ({ op: 'create', id, name, parent, at: 1 })
const TREE = applyOps(EMPTY_TREE, [
  mk('plugs', 'basilica plugs'),
  mk('props', 'props', 'plugs'),
  mk('banners', 'banners', 'props'),
  mk('walls', 'walls', 'plugs'),
  { op: 'assign', refs: ['red', 'blue'], folder: 'banners' },
  { op: 'assign', refs: ['door', 'arch'], folder: 'walls' },
])
const built = buildTree(TREE, ITEMS, (i) => i.id)
const nameOf = (i: Item): string => i.name

/** Every folder id and item id the search shows, in drawing order. */
function shown(f: { folders: FolderNode<Item>[]; items: Item[] }): string[] {
  const out: string[] = []
  const walk = (n: FolderNode<Item>): void => { out.push(`[${n.folder.id}]`); n.folders.forEach(walk); n.items.forEach((i) => out.push(i.id)) }
  f.folders.forEach(walk)
  f.items.forEach((i) => out.push(i.id))
  return out
}

describe('matching', () => {
  it('is a case-insensitive substring of the name', () => {
    expect(matches('Oak Tree', searchKey('  oAK '))).toBe(true)
    expect(matches('Oak Tree', searchKey('pine'))).toBe(false)
  })
  it('finds where the match sits, for the highlight', () => {
    expect(matchRange('basilica-plug-wall-door', searchKey('WALL'))).toEqual([14, 18])
    expect(matchRange('oak', '')).toBeNull()
    expect(matchRange('oak', 'pine')).toBeNull()
  })
})

describe('filtering a folder tree', () => {
  it('opens every folder above a matching shard and hides the rest', () => {
    const f = filterTree(built, 'door', nameOf)
    expect(shown(f)).toEqual(['[plugs]', '[walls]', 'door'])
    expect([...f.open].sort()).toEqual(['plugs', 'walls'])
  })

  it('shows everything in a folder whose name matches, and opens the way to it', () => {
    const f = filterTree(built, 'banner', nameOf)
    // Neither gonfalon says "banner": they show because their folder does.
    expect(shown(f)).toEqual(['[plugs]', '[props]', '[banners]', 'red', 'blue'])
    expect([...f.open].sort()).toEqual(['banners', 'plugs', 'props'])
  })

  it('shows a folder inside a matching folder, folded when nothing in it matches', () => {
    const f = filterTree(built, 'basilica plugs', nameOf)
    expect(shown(f)).toEqual(['[plugs]', '[props]', '[banners]', 'red', 'blue', '[walls]', 'door', 'arch'])
    expect([...f.open]).toEqual(['plugs'])
  })

  it('opens a folder inside a matching folder when something in it matches too', () => {
    const f = filterTree(built, 'basilica', nameOf)
    expect([...f.open].sort()).toEqual(['banners', 'plugs', 'props', 'walls'])
  })

  it('filters the shards at the top', () => {
    expect(shown(filterTree(built, 'oak', nameOf))).toEqual(['oak'])
  })

  it('shows nothing when nothing matches', () => {
    const f = filterTree(built, 'zzz', nameOf)
    expect(f.folders).toEqual([])
    expect(f.items).toEqual([])
  })

  it('counts what it shows', () => {
    const f = filterTree(built, 'red', nameOf)
    expect(f.folders[0].count).toBe(1)
    expect(filterTree(built, 'banner', nameOf).folders[0].count).toBe(2)
  })

  it('keeps a folder being named in sight whatever its name', () => {
    const f = filterTree(built, 'zzz', nameOf, 'banners')
    expect(shown(f)).toEqual(['[plugs]', '[props]', '[banners]', 'red', 'blue'])
  })

  it('never changes the tree it was handed', () => {
    const before = JSON.stringify(built)
    filterTree(built, 'banner', nameOf)
    expect(JSON.stringify(built)).toBe(before)
  })
})
