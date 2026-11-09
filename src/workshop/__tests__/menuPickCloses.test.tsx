/**
 * menuPickCloses.test.tsx: tapping a shard in the workshop's MENU opens it and
 * closes MENU (arkinox, 2026-11-09: "in workshop, tapping a shard in MENU
 * should close the menu"); the row's other tools leave it open; while SELECT
 * is on, a tap on a row picks it or lets it go instead, and the picks are kept
 * (review of PR 631: opening would close MENU and drop them, and on a phone
 * SELECT then MOVE is the only way to file many shards); and MENU, opened
 * again, is where it was scrolled to (lib/scrollMemory.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachScrollMemory, forgetScrollMemory, scrollKey } from '../../lib/scrollMemory'
import { mount, textOf, type Host } from '../../test/elementRoot'

// Thumbnails draw through a shared WebGL stage; nothing here to draw on, and nothing to see.
vi.mock('../../hud/ShardThumb', () => ({ ShardThumb: () => null }))

const { ShardList } = await import('../Workshop')
const { useWorkshop } = await import('../../store/useWorkshop')
const { useShardFolders } = await import('../../store/useShardFolders')
const { useCyberspace } = await import('../../store/useCyberspace')
const { EMPTY_TREE } = await import('../../lib/shardFolders')

const workshop = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')
const list = workshop.slice(workshop.indexOf('export const ShardList = memo('), workshop.indexOf('export function Workshop('))

const shard = (id: string, name: string, at: number) => ({ id, name, vertices: [], faces: [], mode: 'solid', unit: 0, extent: 8, updatedAt: at })
const SHARDS = [shard('oak', 'oak tree', 3), shard('pond', 'still pond', 2), shard('gate', 'stone gate', 1)]

/** The MENU panel's scrolling element, as a stand-in: scrollTop clamps as a browser's does. */
function panel(scrollHeight = 6000, clientHeight = 500) {
  let top = 0
  const on = new Map<string, Set<() => void>>()
  const box = {
    scrollHeight,
    clientHeight,
    get scrollTop() { return top },
    set scrollTop(v: number) { top = Math.max(0, Math.min(v, scrollHeight - clientHeight)) },
    addEventListener: (t: string, fn: () => void) => { if (!on.has(t)) on.set(t, new Set()); on.get(t)!.add(fn) },
    removeEventListener: (t: string, fn: () => void) => { on.get(t)?.delete(fn) },
    scrollTo: (v: number) => { box.scrollTop = v; for (const fn of on.get('scroll') ?? []) fn() },
  }
  return box
}

async function menuList() {
  const select = vi.fn()
  const onOpen = vi.fn()
  useWorkshop.setState({ shards: SHARDS as never, currentId: 'oak', select })
  useShardFolders.setState({ owner: useCyberspace.getState().identity.pubkey, tree: EMPTY_TREE, storage: 'indexeddb' })
  const m = await mount(<ShardList currentId="oak" onOpen={onOpen} />)
  const pick = (name: string): Host => m.all().find((h) => h.type === 'button' && h.props.className === 'workshop__pick' && textOf(h).includes(name))!
  const box = (name: string): Host => m.all().find((h) => h.type === 'input' && h.props['aria-label'] === `Select ${name}`)!
  const tap = async (h: Host): Promise<void> => { (h.props.onClick as () => void)(); await new Promise((r) => setTimeout(r, 5)) }
  const tick = async (name: string): Promise<void> => { (box(name).props.onChange as (e: unknown) => void)({ target: { checked: true } }); await new Promise((r) => setTimeout(r, 5)) }
  return { m, select, onOpen, pick, box, tap, tick }
}

afterEach(() => forgetScrollMemory())

describe('tapping a shard in MENU', () => {
  it('opens the shard and closes MENU', async () => {
    const { m, select, onOpen, pick, tap } = await menuList()
    await tap(pick('still pond'))
    expect(select).toHaveBeenCalledWith('pond')
    expect(onOpen).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('leaves MENU open for the row\'s other tools: duplicate, copy, move and delete', () => {
    // onOpen is called once in the list, by the pick, and by nothing else in the row.
    expect(list.split('onOpen()').length - 1).toBe(1)
    for (const tool of ['w().duplicate(s.id)', 'copy(s.id)', 'w().remove(s.id)', '{f.tool}']) expect(list).toContain(tool)
    expect(workshop).toContain('<ShardList currentId={shard.id} onOpen={closeMenu} />')
    expect(workshop).toContain('const closeMenu = useCallback(() => setPanel(null), [])')
  })

  it('while SELECT is on, picks the row or lets it go instead, MENU stays open and the picks are kept', async () => {
    const { m, select, onOpen, pick, box, tap, tick } = await menuList()
    await m.press(/^SELECT$/)
    await tick('oak tree')
    await tick('still pond')
    expect(m.buttons('MOVE (2)')).toHaveLength(1)
    // A tap on another row's name: it is picked, not opened.
    await tap(pick('stone gate'))
    expect(select).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(box('stone gate').props.checked).toBe(true)
    expect(box('oak tree').props.checked).toBe(true)
    expect(box('still pond').props.checked).toBe(true)
    expect(pick('stone gate').props['aria-pressed']).toBe(true)
    expect(m.buttons('MOVE (3)')).toHaveLength(1)
    // Again: let go, the others kept.
    await tap(pick('stone gate'))
    expect(box('stone gate').props.checked).toBe(false)
    expect(m.buttons('MOVE (2)')).toHaveLength(1)
    expect(onOpen).not.toHaveBeenCalled()
    // DONE, and a tap opens again.
    await m.press('DONE')
    expect(pick('still pond').props['aria-pressed']).toBeUndefined()
    await tap(pick('still pond'))
    expect(select).toHaveBeenCalledWith('pond')
    expect(onOpen).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('opens again where it was scrolled to', () => {
    const key = scrollKey('workshop-menu', 'cc'.repeat(32))
    const open = panel()
    const watching = attachScrollMemory(open, key)
    open.scrollTo(2750)
    // The tap: the shard opens and MENU unmounts, letting its element go.
    watching.detach()
    const reopened = panel()
    attachScrollMemory(reopened, key)
    expect(reopened.scrollTop).toBe(2750)
  })
})
