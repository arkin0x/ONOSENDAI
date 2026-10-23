/**
 * shardFoldersList.test.tsx: the folder tree as a shard list draws it. Each
 * row is still the caller's own <li>, handed MOVE TO FOLDER; folders come
 * before the shards at the top; a shard filed in a folder that is gone is
 * drawn at the top; a folded folder hides its rows but still counts them.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_TREE, applyOps } from '../../lib/shardFolders'

vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: Object.assign(
    (sel: (s: { identity: { pubkey: string } }) => unknown) => sel({ identity: { pubkey: 'ee'.repeat(32) } }),
    { getState: () => ({ identity: { pubkey: 'ee'.repeat(32) } }), subscribe: () => () => undefined },
  ),
}))

const { ShardFolders } = await import('../ShardFolders')
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
    expect(render()).not.toContain('—')
  })
})
