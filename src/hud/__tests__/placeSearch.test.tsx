/**
 * placeSearch.test.tsx: PLACE OBJECT's search and height (arkinox,
 * 2026-11-16: "this modal needs to expand to full screen height (as needed)
 * and we need to add a search bar below the scrollable area. search should
 * filter results. folder trees open to reveal matching folder names, and
 * folders open to reveal matching shards").
 *
 * - MINE, mounted with the real search box: a match opens every folder
 *   above it, a folder whose name matches shows what is in it, everything
 *   else is hidden, the match is marked, and "No matches" says so.
 * - Folds tapped while searching stay with the search; clearing it puts
 *   every folder back as it was folded before, and the stored tree is never
 *   written.
 * - FEED filters its list by name.
 * - The modal is the full-height kind, with the search under the list, and
 *   above a phone keyboard it is placed on the visual viewport.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_TREE, applyOps, type FolderOp } from '../../lib/shardFolders'

;(globalThis as { window?: unknown }).window ??= globalThis
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: Object.assign(
    (sel: (s: { identity: { pubkey: string } }) => unknown) => sel({ identity: { pubkey: 'ee'.repeat(32) } }),
    { getState: () => ({ identity: { pubkey: 'ee'.repeat(32) } }), subscribe: () => () => undefined },
  ),
}))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => null }))
vi.mock('../ShardThumb', () => ({ ShardThumb: () => <span className="shardthumb" /> }))
// The modal goes through a portal to document.body; there is no document here, so a server render draws it in place.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (children: unknown) => children }))

const { ShardFolders } = await import('../ShardFolders')
const { SearchField } = await import('../ui/SearchField')
const { FeedList } = await import('../FeedList')
const { useShardFolders } = await import('../../store/useShardFolders')
const { useFeed } = await import('../../store/useFeed')
const { StashModals } = await import('../StashModals')
const { useStash } = await import('../stash')
const { useWorkshop } = await import('../../store/useWorkshop')
const { visualBox } = await import('../../hooks/useVisualViewport')
const { escapeTop, useEscape } = await import('../../hooks/useEscape')
const { mount, textOf } = await import('../../test/elementRoot')
type Host = import('../../test/elementRoot').Host

interface Item { id: string; name: string }
const ITEMS: Item[] = [
  { id: 'red', name: 'basilica-prop-gonfalon-red' },
  { id: 'blue', name: 'basilica-prop-gonfalon-blue' },
  { id: 'door', name: 'basilica-plug-wall-door' },
  { id: 'arch', name: 'basilica-plug-wall-arch' },
  { id: 'oak', name: 'oak tree' },
]
const refOf = (i: Item): string => i.id
const nameOf = (i: Item): string => i.name
const mk = (id: string, name: string, parent: string | null = null): FolderOp => ({ op: 'create', id, name, parent, at: 1 })

/** His screenshot's tree, every folder folded, as stored before the search. */
function store(): void {
  const tree = applyOps(EMPTY_TREE, [
    mk('plugs', 'basilica plugs'),
    mk('props', 'props', 'plugs'),
    mk('banners', 'banners', 'props'),
    mk('walls', 'walls', 'plugs'),
    { op: 'assign', refs: ['red', 'blue'], folder: 'banners' },
    { op: 'assign', refs: ['door', 'arch'], folder: 'walls' },
  ])
  useShardFolders.setState({ tree: { ...tree, collapsed: { plugs: true, props: true, banners: true, walls: true } }, storage: 'indexeddb' })
}

/** MINE as PLACE OBJECT draws it: the list, then the search box under it. */
function Mine(): JSX.Element {
  const [query, setQuery] = useState('')
  return (
    <>
      <ul className="objpick__list">
        <ShardFolders items={ITEMS} refOf={refOf} nameOf={nameOf} query={query} row={(i, f) => <li key={i.id} data-row={i.id}><span className="objpick__name">{f.mark(i.name)}</span>{f.tool}</li>} />
      </ul>
      <SearchField value={query} onChange={setQuery} placeholder="Search shards and folders" label="Search your shards and folders" />
    </>
  )
}

const rows = (all: Host[]): string[] => all.filter((h) => typeof h.props['data-row'] === 'string').map((h) => h.props['data-row'] as string)
const folderOpen = (all: Host[], name: string): boolean | undefined => all.find((h) => h.type === 'button' && h.props.className === 'sfold__toggle' && textOf(h).includes(name))?.props['aria-expanded'] as boolean | undefined
const folderShown = (all: Host[], name: string): boolean => folderOpen(all, name) !== undefined

async function type(m: Awaited<ReturnType<typeof mount>>, text: string): Promise<void> {
  const input = m.all().find((h) => h.type === 'input' && h.props['aria-label'] === 'Search your shards and folders')
  if (!input) throw new Error('no search box')
  ;(input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: text } })
  await new Promise((r) => setTimeout(r, 5))
}

afterEach(() => { useShardFolders.setState({ tree: EMPTY_TREE }) })

describe('searching MINE', () => {
  it('opens every folder above a matching shard and hides what does not match', async () => {
    store()
    const m = await mount(<Mine />)
    expect(rows(m.all())).toEqual(['oak'])
    await type(m, 'DOOR')
    expect(rows(m.all())).toEqual(['door'])
    expect(folderOpen(m.all(), 'basilica plugs')).toBe(true)
    expect(folderOpen(m.all(), 'walls')).toBe(true)
    // props has nothing that matches anywhere inside it.
    expect(folderShown(m.all(), 'props')).toBe(false)
    // The matched part is marked.
    const hit = m.all().find((h) => h.type === 'mark')
    expect(hit && textOf(hit)).toBe('door')
    await m.unmount()
  })

  it('shows what is in a folder whose name matches', async () => {
    store()
    const m = await mount(<Mine />)
    await type(m, 'banner')
    expect(rows(m.all())).toEqual(['red', 'blue'])
    for (const f of ['basilica plugs', 'props', 'banners']) expect(folderOpen(m.all(), f)).toBe(true)
    expect(folderShown(m.all(), 'walls')).toBe(false)
    await m.unmount()
  })

  it('says No matches when nothing matches', async () => {
    store()
    const m = await mount(<Mine />)
    await type(m, 'zzz')
    expect(rows(m.all())).toEqual([])
    expect(m.says('No matches')).toBe(true)
    await m.unmount()
  })

  it('puts every folder back as it was when the search is cleared, folds tapped during it included', async () => {
    store()
    const before = useShardFolders.getState().tree
    const m = await mount(<Mine />)
    await type(m, 'basilica')
    expect(rows(m.all())).toEqual(['red', 'blue', 'door', 'arch'])
    // A fold tapped while searching folds it for the search only.
    await m.press('walls')
    expect(folderOpen(m.all(), 'walls')).toBe(false)
    expect(rows(m.all())).toEqual(['red', 'blue'])
    expect(useShardFolders.getState().tree).toBe(before)
    // Cleared by the box's ✕.
    const clear = m.all().find((h) => h.type === 'button' && h.props['aria-label'] === 'Clear the search')
    ;(clear!.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(rows(m.all())).toEqual(['oak'])
    expect(folderOpen(m.all(), 'basilica plugs')).toBe(false)
    expect(useShardFolders.getState().tree).toBe(before)
    expect(m.all().some((h) => h.type === 'mark')).toBe(false)
    await m.unmount()
  })

  it('clears the search on Escape before it closes the modal', async () => {
    store()
    const closed = vi.fn()
    function InModal(): JSX.Element { useEscape('modal', true, closed); return <Mine /> }
    const m = await mount(<InModal />)
    await type(m, 'door')
    escapeTop()
    await new Promise((r) => setTimeout(r, 5))
    expect(closed).not.toHaveBeenCalled()
    expect(rows(m.all())).toEqual(['oak'])
    escapeTop()
    expect(closed).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('folds and unfolds the stored tree as before with no search', async () => {
    store()
    const m = await mount(<Mine />)
    await m.press('basilica plugs')
    expect(useShardFolders.getState().tree.collapsed.plugs).toBeUndefined()
    await m.unmount()
  })
})

describe('searching FEED', () => {
  const pk = 'ab'.repeat(32)
  // A server render reads the store's initial state: the feed is written there too.
  const feed = (objects: unknown[]): void => {
    useFeed.setState({ objects: objects as never, listings: [], loading: false, exhausted: true })
    Object.assign(useFeed.getInitialState(), useFeed.getState())
  }
  const obj = (d: string, name: string) => ({ id: d.padEnd(64, '0'), pubkey: pk, createdAt: 1, d, address: `33331:${pk}:${d}`, shard: { id: d, name, vertices: [], faces: [] }, event: {} })

  it('shows only the objects whose name holds the search, marked', () => {
    feed([obj('a', 'Red Banner'), obj('b', 'stone wall'), obj('c', 'banner pole')])
    const html = renderToStaticMarkup(<FeedList onPick={() => undefined} query="BANNER" />)
    expect(html).toContain('Red <mark class="searchfield__hit">Banner</mark>')
    expect(html).toContain('<mark class="searchfield__hit">banner</mark> pole')
    expect(html).not.toContain('stone wall')
  })

  it('says No matches when nothing in the feed matches', () => {
    feed([obj('b', 'stone wall')])
    const html = renderToStaticMarkup(<FeedList onPick={() => undefined} query="banner" />)
    expect(html).toContain('No matches')
    expect(html).not.toContain('stone wall')
  })

  it('shows the whole feed with no search', () => {
    feed([obj('a', 'Red Banner'), obj('b', 'stone wall')])
    const html = renderToStaticMarkup(<FeedList onPick={() => undefined} />)
    expect(html).toContain('Red Banner')
    expect(html).toContain('stone wall')
    expect(html).not.toContain('<mark')
  })
})

describe('the modal', () => {
  const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
  const css = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

  it('is PLACE OBJECT, drawn full height with the search under the list', () => {
    useWorkshop.setState({ shards: ITEMS.map((i) => ({ ...i, vertices: [[0, 0, 0]], faces: [] })) as never })
    Object.assign(useWorkshop.getInitialState(), useWorkshop.getState())
    useStash.setState({ models: true, pickTab: 'mine' } as never)
    Object.assign(useStash.getInitialState(), useStash.getState())
    const hadDocument = 'document' in globalThis
    if (!hadDocument) (globalThis as { document?: unknown }).document = { body: {} }
    let html: string
    try { html = renderToStaticMarkup(<StashModals />) } finally { if (!hadDocument) delete (globalThis as { document?: unknown }).document }
    expect(html).toContain('Place an object')
    expect(html).toMatch(/class="modal modal--fill"/)
    expect(html).toMatch(/class="modal__card login stash-modal stash-modal--fill"/)
    // Title row, then the body: the tabs, the list, and the search last.
    expect(html.indexOf('class="objpick__body"')).toBeGreaterThan(html.indexOf('class="login__head"'))
    expect(html.indexOf('class="searchfield objpick__search"')).toBeGreaterThan(html.indexOf('class="objpick__list"'))
    // The card is a column capped at the overlay, inside the safe area, and only the list scrolls.
    expect(css).toMatch(/\.modal__card\.stash-modal--fill \{ display: flex; flex-direction: column; max-height: 100%; overflow: hidden; \}/)
    expect(css).toMatch(/\.stash-modal--fill \.objpick__body > \.objpick__list \{[^}]*min-height: 0; max-height: none; overflow-y: auto;/)
    expect(css).toMatch(/\.modal\.modal--fill \{[^}]*safe-area-inset-bottom/)
  })

  it('sits above a phone keyboard: the overlay goes on the visual viewport only while it is shorter', () => {
    // iPhone 375x812 with the keyboard up, the page scrolled 40px under it.
    expect(visualBox(812, { height: 476, offsetTop: 40, scale: 1 })).toEqual({ top: 40, height: 476 })
    // No keyboard: the overlay's own CSS stands.
    expect(visualBox(812, { height: 812, offsetTop: 0, scale: 1 })).toBeNull()
    // A pinch zoom is not a keyboard.
    expect(visualBox(812, { height: 400, offsetTop: 100, scale: 2 })).toBeNull()
    expect(visualBox(812, null)).toBeNull()
  })

  it('has its search under the list', () => {
    const s = src('PlaceObjectPicker.tsx')
    expect(s.indexOf('<SearchField')).toBeGreaterThan(s.indexOf("source === 'feed' && ("))
  })

  it('has no em dash in what was added', () => {
    const files = ['PlaceObjectPicker.tsx', 'ui/SearchField.tsx', 'ShardFolders.tsx', 'FeedList.tsx', 'LookPicker.tsx', 'ChestCompose.tsx', '../workshop/sheets/MenuSheet.tsx', '../workshop/ObjectPicker.tsx', '../hooks/useVisualViewport.ts', '../lib/shardSearch.ts']
    for (const p of files) expect(src(p)).not.toContain('\u2014')
  })
})
