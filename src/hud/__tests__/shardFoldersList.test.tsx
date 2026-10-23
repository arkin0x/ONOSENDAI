/**
 * shardFoldersList.test.tsx: the folder tree as a shard list draws it. Each
 * row is still the caller's own <li>, handed MOVE TO FOLDER; folders come
 * before the shards at the top; a shard filed in a folder that is gone is
 * drawn at the top; a folded folder hides its rows but still counts them.
 * Moving into a folded folder leaves it folded; a new folder opens its parent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_TREE, applyOps } from '../../lib/shardFolders'

vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: Object.assign(
    (sel: (s: { identity: { pubkey: string } }) => unknown) => sel({ identity: { pubkey: 'ee'.repeat(32) } }),
    { getState: () => ({ identity: { pubkey: 'ee'.repeat(32) } }), subscribe: () => () => undefined },
  ),
}))

const { ShardFolders, makeFolder, moveTo } = await import('../ShardFolders')
const { useShardFolders } = await import('../../store/useShardFolders')

interface Item { id: string; name: string }
const ITEMS: Item[] = [{ id: 'oak', name: 'oak tree' }, { id: 'pond', name: 'pond' }, { id: 'gate', name: 'stone gate' }, { id: 'ghost', name: 'ghost' }]
const refOf = (i: Item): string => i.id
const nameOf = (i: Item): string => i.name

function render(collapsed = false): string {
  let tree = applyOps(EMPTY_TREE, [
    { op: 'create', id: 'kit', name: 'maze-kit', parent: null, at: 1 },
    { op: 'create', id: 'water', name: 'water', parent: 'kit', at: 1 },
    { op: 'assign', refs: ['oak'], folder: 'kit' },
    { op: 'assign', refs: ['pond'], folder: 'water' },
  ])
  tree = { ...tree, assign: { ...tree.assign, ghost: 'deleted-folder' } }
  if (collapsed) tree = { ...tree, collapsed: { water: true } }
  useShardFolders.setState({ owner: 'ee'.repeat(32), tree, storage: 'indexeddb' })
  Object.assign(useShardFolders.getInitialState(), useShardFolders.getState())
  return renderToStaticMarkup(
    <ul>
      <ShardFolders items={ITEMS} refOf={refOf} nameOf={nameOf} row={(i, f) => <li key={i.id} data-row={i.id}>{i.name}{f.tool}</li>} />
    </ul>,
  )
}

afterEach(() => { useShardFolders.setState({ tree: EMPTY_TREE }); Object.assign(useShardFolders.getInitialState(), useShardFolders.getState()) })

describe('a shard list with folders', () => {
  it('draws every shard once, each with MOVE TO FOLDER', () => {
    const html = render()
    for (const i of ITEMS) expect(html.split(`data-row="${i.id}"`).length - 1).toBe(1)
    expect(html.split('title="Move to a folder"').length - 1).toBe(ITEMS.length)
  })

  it('draws folders before the shards at the top, and an orphan at the top', () => {
    const html = render()
    const kit = html.indexOf('maze-kit')
    expect(kit).toBeGreaterThan(-1)
    expect(html.indexOf('data-row="gate"')).toBeGreaterThan(kit)
    // ghost's folder is gone: it sits beside stone gate, outside every folder list.
    const kids = html.slice(html.indexOf('class="sfold__kids"'), html.lastIndexOf('</ul></li>'))
    expect(kids).not.toContain('data-row="ghost"')
    expect(kids).toContain('data-row="oak"')
  })

  it('hides a folded folder\'s rows and still counts them', () => {
    const html = render(true)
    expect(html).not.toContain('data-row="pond"')
    expect(html).toMatch(/water<\/span><span class="sfold__count">1</)
    expect(html).toMatch(/maze-kit<\/span><span class="sfold__count">2</)
  })

  it('has no em dash in its copy', () => {
    expect(render()).not.toContain('\u2014')
  })
})

describe('moving into a folded folder', () => {
  // arkinox, 2026-10-23: "when I move a shard into a folder, please make it so the folder does not pop open."
  const folded = (): void => {
    const tree = applyOps(EMPTY_TREE, [
      { op: 'create', id: 'kit', name: 'maze-kit', parent: null, at: 1 },
      { op: 'create', id: 'water', name: 'water', parent: 'kit', at: 1 },
      { op: 'create', id: 'stone', name: 'stone', parent: null, at: 1 },
      { op: 'collapse', id: 'kit', collapsed: true },
      { op: 'collapse', id: 'water', collapsed: true },
    ])
    useShardFolders.setState({ owner: 'ee'.repeat(32), tree, storage: 'memory' })
  }

  it('files shards there and leaves it and the folders above it folded', () => {
    folded()
    moveTo({ kind: 'shards', refs: ['oak', 'pond'], label: '2 shards' }, 'water')
    const t = useShardFolders.getState().tree
    expect([t.assign.oak, t.assign.pond]).toEqual(['water', 'water'])
    expect(t.collapsed).toEqual({ kit: true, water: true })
  })

  it('moves a folder there and leaves it folded', () => {
    folded()
    moveTo({ kind: 'folder', id: 'stone', label: 'stone' }, 'water')
    const t = useShardFolders.getState().tree
    expect(t.folders.stone.parent).toBe('water')
    expect(t.collapsed).toEqual({ kit: true, water: true })
  })

  it('the chooser moves through moveTo and opens nothing itself', () => {
    const text = readFileSync(join(__dirname, '..', 'ShardFolders.tsx'), 'utf8')
    const pick = text.slice(text.indexOf('onPick={(to) =>'), text.indexOf('onClose={() => setMoving(null)}'))
    expect(pick).toContain('moveTo(moving, to)')
    expect(pick).not.toMatch(/unfold|setCollapsed/)
  })

  it('still opens the way to a new folder, so it can be named', () => {
    folded()
    const id = makeFolder('water')
    const t = useShardFolders.getState().tree
    expect(id && t.folders[id].parent).toBe('water')
    expect(t.collapsed).toEqual({})
  })
})

/** Every .tsx under src, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

describe('every list of your shards', () => {
  // arkinox, 2026-10-23: "the folders need to be available anywhere a list of our shards is shown."
  it('draws through ShardFolders wherever a component reads the workshop\'s models', () => {
    // Any spelling: a selector by any name, with or without parentheses, a filter after it, or getState().
    const readers = sources(join(__dirname, '..', '..')).filter((p) => /useWorkshop[\s\S]{0,80}?\.shards\b/.test(readFileSync(p, 'utf8')) && /<[a-z]/i.test(readFileSync(p, 'utf8')))
      .filter((p) => !/[\\/](scene|workshop[\\/]Bench)\b/.test(p) && /\.(map|filter)\(/.test(readFileSync(p, 'utf8')))
    expect(readers.length).toBeGreaterThanOrEqual(3)
    for (const p of readers) expect([p, readFileSync(p, 'utf8').includes('<ShardFolders')]).toEqual([p, true])
  })

  it('has no native select of models left', () => {
    // A file that reads the models has no <option> at all; the chest's lock
    // select (held keys) lives in ChestCompose, so there it is counted.
    for (const p of sources(join(__dirname, '..', '..'))) {
      const text = readFileSync(p, 'utf8')
      if (!/useWorkshop[\s\S]{0,80}?\.shards\b/.test(text)) continue
      const options = (text.replace(/\/\*[\s\S]*?\*\//g, '').match(/<option\b/g) ?? []).length
      expect([p, options]).toEqual([p, p.endsWith('ChestCompose.tsx') ? 2 : 0])
    }
  })
})

