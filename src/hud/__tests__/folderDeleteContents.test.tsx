/**
 * folderDeleteContents.test.tsx: DELETE on a folder of the workshop's own
 * list (arkinox, 2026-10-25: "i need an option to actually delete a folder
 * and everything in it"; then "maybe a toggle"). One confirmation, one
 * switch, off when it opens: off keeps today's move-up, on deletes every
 * shard and folder inside at any depth and nothing outside, with the counts
 * shown matching what goes. Only the workshop's list is handed the option.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_TREE, applyOps, buildTree, folderOf, type FolderNode, type FolderOp } from '../../lib/shardFolders'

vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: Object.assign(
    (sel: (s: { identity: { pubkey: string } }) => unknown) => sel({ identity: { pubkey: 'ee'.repeat(32) } }),
    { getState: () => ({ identity: { pubkey: 'ee'.repeat(32) } }), subscribe: () => () => undefined },
  ),
}))
// The modal goes through a portal to document.body; there is no document here, so it renders in place.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (children: unknown) => children }))
if (typeof document === 'undefined') (globalThis as { document?: unknown }).document = { body: {} }

const { DeleteFolder, deleteFolderCopy, deleteFolderNow } = await import('../ShardFolders')
const { useShardFolders } = await import('../../store/useShardFolders')

const mk = (id: string, name: string, parent: string | null = null): FolderOp => ({ op: 'create', id, name, parent, at: 1 })
const file = (refs: string[], folder: string | null): FolderOp => ({ op: 'assign', refs, folder })

/** maze-kit > cistern > walls > corners, maze-kit > water; and other-kit, and shards at the top. */
const OPS: FolderOp[] = [
  mk('kit', 'maze-kit'), mk('cistern', 'cistern', 'kit'), mk('walls', 'walls', 'cistern'), mk('corners', 'corners', 'walls'), mk('water', 'water', 'kit'),
  mk('other', 'other-kit'),
  file(['gate'], 'kit'), file(['arch', 'drain'], 'cistern'), file(['wall'], 'walls'), file(['corner1', 'corner2'], 'corners'), file(['pond'], 'water'),
  file(['rock'], 'other'),
]
const SHARDS = ['gate', 'arch', 'drain', 'wall', 'corner1', 'corner2', 'pond', 'rock', 'loose']
const INSIDE = ['gate', 'arch', 'drain', 'wall', 'corner1', 'corner2', 'pond']
const id = (s: string): string => s

function setup(): FolderNode<string> {
  useShardFolders.setState({ owner: 'ee'.repeat(32), tree: applyOps(EMPTY_TREE, OPS), storage: 'indexeddb' })
  return node('kit')
}
function node(folder: string): FolderNode<string> {
  const find = (ns: FolderNode<string>[]): FolderNode<string> | undefined => {
    for (const n of ns) { if (n.folder.id === folder) return n; const u = find(n.folders); if (u) return u }
    return undefined
  }
  return find(buildTree(useShardFolders.getState().tree, SHARDS, id).folders)!
}

afterEach(() => { useShardFolders.setState({ tree: EMPTY_TREE }) })

describe('the confirmation', () => {
  it('opens with the switch off: preserve, today\'s button, not red', () => {
    const kit = setup()
    const html = renderToStaticMarkup(<DeleteFolder node={kit} up="the top" refOf={id} deleteContents={{ remove: () => undefined, published: () => 0 }} onDone={() => undefined} />)
    expect(html).toContain('Delete folder &quot;maze-kit&quot;?')
    expect(html).toContain('Preserve contents and expand to the top.')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('>DELETE FOLDER</button>')
    expect(html).not.toContain('modal__confirm--danger')
    expect(html).not.toContain('—')
  })

  it('off names the folder the contents expand into', () => {
    expect(deleteFolderCopy(false, '"maze-kit"', 3, 1, 0).label).toBe('Preserve contents and expand to "maze-kit".')
  })

  it('on shows exactly what goes, the button red, and the published note when any are', () => {
    const kit = setup()
    const c = deleteFolderCopy(true, 'the top', 7, 4, 2)
    expect(c.label).toBe('Delete contents: 7 shards and 4 folders')
    expect(c.confirmLabel).toBe('DELETE FOLDER AND CONTENTS')
    expect(c.danger).toBe(true)
    expect(c.notes).toContain('2 are published: they stay on relays; RETRACT them separately.')
    // The counts it would show for maze-kit are the shards and folders inside it.
    expect(INSIDE).toHaveLength(7)
    expect(kit.count).toBe(7)
    expect(deleteFolderCopy(true, 'the top', 1, 1, 1).label).toBe('Delete contents: 1 shard and 1 folder')
    expect(deleteFolderCopy(true, 'the top', 1, 1, 1).notes).toContain('1 is published: it stays on relays; RETRACT it separately.')
    expect(deleteFolderCopy(true, 'the top', 5, 0, 0).notes).toEqual(['This cannot be undone.'])
    for (const c2 of [c, deleteFolderCopy(false, 'the top', 0, 0, 0)]) expect(JSON.stringify(c2)).not.toContain('—')
  })
})

describe('the yes', () => {
  it('on: every shard and folder inside, at any depth, goes, and nothing outside', () => {
    const kit = setup()
    const remove = vi.fn()
    const published = vi.fn(() => 0)
    const sets = vi.fn()
    const off = useShardFolders.subscribe(sets)
    deleteFolderNow(kit, true, id, { remove, published })
    off()
    expect(remove).toHaveBeenCalledTimes(1)
    expect([...remove.mock.calls[0][0]].sort()).toEqual([...INSIDE].sort())
    const t = useShardFolders.getState().tree
    expect(Object.keys(t.folders)).toEqual(['other'])
    expect(t.assign).toEqual({ rock: 'other' })
    // One folder change, however deep the folder went.
    expect(sets).toHaveBeenCalledTimes(1)
  })

  it('on, for a folder inside: its parent and siblings stay', () => {
    setup()
    const remove = vi.fn()
    deleteFolderNow(node('cistern'), true, id, { remove, published: () => 0 })
    expect([...remove.mock.calls[0][0]].sort()).toEqual(['arch', 'corner1', 'corner2', 'drain', 'wall'])
    const t = useShardFolders.getState().tree
    expect(Object.keys(t.folders).sort()).toEqual(['kit', 'other', 'water'])
    expect(folderOf(t, 'gate')).toBe('kit')
    expect(folderOf(t, 'pond')).toBe('water')
  })

  it('off: no shard is deleted and what was inside moves up', () => {
    const kit = setup()
    const remove = vi.fn()
    deleteFolderNow(kit, false, id, { remove, published: () => 0 })
    expect(remove).not.toHaveBeenCalled()
    const t = useShardFolders.getState().tree
    expect(t.folders.kit).toBeUndefined()
    expect(t.folders.cistern.parent).toBeNull()
    expect(t.folders.water.parent).toBeNull()
    expect(folderOf(t, 'gate')).toBeNull()
    expect(folderOf(t, 'corner1')).toBe('corners')
  })
})

describe('where it is offered', () => {
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : sources(p)
    return /\.tsx$/.test(n) ? [p] : []
  })

  it('only the workshop\'s own list is handed DELETE CONTENTS; the pickers are not', () => {
    const src = join(__dirname, '..', '..')
    const handing = sources(src).filter((p) => /<ShardFolders\b[^>]*deleteContents=/.test(readFileSync(p, 'utf8')))
    expect(handing.map((p) => p.slice(src.length + 1))).toEqual([join('workshop', 'Workshop.tsx')])
  })
})
