/**
 * groupsSheet.test.tsx - GROUPS in the workshop (owner, 2026-11-23): the
 * rail's GROUPS key and G open the sheet, which stands on the strip; NEW
 * GROUP and SHOW ALL stay first and grey out rather than going; a row holds
 * its group or lets it go, hides it on the bench, and opens its actions;
 * DELETE CONTENTS never acts without its confirmation, which says what goes;
 * Ctrl+G makes a group from what is held and opens the sheet.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Host } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// Nothing here draws: the bench, the compass and the thumbnails are WebGL.
vi.mock('../Bench', () => ({ Bench: () => null }))
vi.mock('../../scene/Compass3D', () => ({ Compass3D: () => null }))
vi.mock('../../hud/ShardThumb', () => ({ ShardThumb: () => null }))
vi.mock('../../hooks/useScrollMemory', () => ({ useScrollMemory: () => () => {} }))
vi.mock('../../hud/ui/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button type="button" role="switch" id={id} aria-checked={checked} onClick={() => onCheckedChange(!checked)}>switch</button>
  ),
  Field: ({ label, children }: { label: string; children: unknown }) => <div className="ui-field"><span>{label}</span>{children as never}</div>,
}))

const { mount, textOf } = await import('../../test/elementRoot')
const { Workshop } = await import('../Workshop')
const { useWorkshop } = await import('../../store/useWorkshop')
const { useFacingPreview } = await import('../../store/facingPreview')
const { escapeTop } = await import('../../hooks/useEscape')
const { newShard } = await import('sno-core/shards')
const { groupsOf } = await import('../../lib/shardGroups')
const { useBeginner } = await import('../beginner')
const { useTutorial } = await import('../../store/useTutorial')
const { countsLine, deleteContentsCopy, groupsSubLine, GROUPS_SEARCH_FROM } = await import('../sheets/GroupsSheet')

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

const cls = (h: Host): string => String(h.props.className ?? '')
const byClass = (all: Host[], c: string): Host[] => all.filter((h) => cls(h).split(/\s+/).includes(c))
const byLabel = (all: Host[], l: string): Host | undefined => all.find((h) => h.props['aria-label'] === l)
const tap = async (h: Host | undefined): Promise<void> => {
  expect(h).toBeDefined()
  expect(h?.props.disabled).toBeFalsy()
  ;(h?.props.onClick as () => void)()
  await new Promise((r) => setTimeout(r, 5))
}

/** Two squares side by side, each two faces: 8 points. */
function twoSquares() {
  const s = newShard('Kit')
  const sq = (x: number) => [[x, 0, 0], [x + 1, 0, 0], [x + 1, 1, 0], [x, 1, 0]]
  return {
    ...s,
    vertices: [...sq(0), ...sq(3)].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]] as Array<[number, number, number]>,
  }
}

/** The window's keydown listeners, called as a key press would. */
const listeners = new Set<(e: unknown) => void>()
const key = (code: string, mods: { ctrl?: boolean; target?: unknown } = {}): { prevented: boolean } => {
  const out = { prevented: false }
  const e = { code, key: code, target: mods.target ?? null, metaKey: false, ctrlKey: !!mods.ctrl, altKey: false, shiftKey: false, repeat: false, preventDefault: () => { out.prevented = true } }
  for (const f of [...listeners]) f(e)
  return out
}

/** A body for ConfirmModal's portal. */
const body = Object.defineProperties({ type: 'body', props: {}, children: [] as Array<Host | string> }, { nodeType: { value: 1 } }) as Host
const inBody = (): Host[] => { const out: Host[] = []; const walk = (n: Host | string): void => { if (typeof n === 'string') return; out.push(n); n.children.forEach(walk) }; body.children.forEach(walk); return out }

beforeEach(() => {
  listeners.clear()
  body.children.length = 0
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('addEventListener', (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.add(f) })
  vi.stubGlobal('removeEventListener', (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.delete(f) })
  vi.stubGlobal('document', { body, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null })
  const s = twoSquares()
  useWorkshop.setState({ selectKind: 'points', boxSelect: false, invert: false, hiddenGroups: [] })
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'select', selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, past: [], future: [], openPanel: null, notice: null, eyeEdit: false })
  useFacingPreview.setState({ on: false })
  localStorage.setItem('onosendai:workshop-intro', '1')
  useBeginner.setState({ tools: 'all', step: null, glow: null, done: true, uses: { view: 3, stamp: 3, select: 3, paint: 3, add: 3, face: 3 } })
  useTutorial.setState({ active: false })
})
afterEach(() => {
  useWorkshop.setState({ open: false })
  vi.unstubAllGlobals()
})

const sheets = (all: Host[]): string[] => byClass(all, 'ws__sheet').map((h) => String(h.props['aria-label']))
const rows = (all: Host[]): Host[] => byClass(all, 'ws__groups-row')
const groups = () => groupsOf(useWorkshop.getState().current())

describe('the GROUPS key on the rail', () => {
  it('opens GROUPS as a sheet on the strip, lit while open, and closes it again', async () => {
    const m = await mount(<Workshop />)
    const keyBtn = (): Host | undefined => byLabel(m.all(), 'Groups')
    expect(keyBtn()?.props['aria-pressed']).toBe(false)
    await tap(keyBtn())
    expect(sheets(m.all())).toEqual(['Groups'])
    expect(cls(byClass(m.all(), 'ws__sheet')[0])).toContain('ws__sheet--onstrip')
    expect(keyBtn()?.props['aria-pressed']).toBe(true)
    // The strip is still there under it: the sheet stands on it.
    expect(byClass(m.all(), 'ws__strip').length).toBe(1)
    await tap(keyBtn())
    expect(sheets(m.all())).toEqual([])
    await m.unmount()
  })

  it('is greyed in LOOK, and LOOK puts GROUPS away', async () => {
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    useWorkshop.getState().setTool('view')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual([])
    expect(byLabel(m.all(), 'Groups')?.props.disabled).toBe(true)
    await m.unmount()
  })

  it('counts the groups hidden on the bench in a badge', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3])
    useWorkshop.getState().createGroup('Left')
    const id = groups()[0].id
    useWorkshop.getState().setGroupHidden(id, true)
    const m = await mount(<Workshop />)
    const k = byLabel(m.all(), 'Groups') as Host
    expect(byClass([k, ...k.children.filter((c): c is Host => typeof c !== 'string')], 'ws__badge--hidden').map((h) => textOf(h))).toEqual(['1'])
    expect(String(k.props.title)).toBe('Groups (G): 1 hidden on the bench')
    await m.unmount()
  })
})

describe('the GROUPS sheet', () => {
  it('starts empty with one line, NEW GROUP and SHOW ALL greyed, in the same first place', async () => {
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    expect(m.says('No groups yet: a paste, an import or NEW GROUP makes one.')).toBe(true)
    expect(m.says('NO GROUPS')).toBe(true)
    const pair = byClass(m.all(), 'ws__groups-pair')[0]
    const body = byClass(m.all(), 'ws__sheet-body')[0]
    expect(body.children[0]).toBe(pair)
    expect(m.buttons('NEW GROUP')[0].props.disabled).toBe(true)
    expect(m.buttons('SHOW ALL')[0].props.disabled).toBe(true)
    await m.unmount()
  })

  it('makes a group from what is held, holds it, lets it go on a tap and holds it again', async () => {
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    useWorkshop.getState().setSelection([0, 1, 2, 3])
    await new Promise((r) => setTimeout(r, 5))
    await m.press('NEW GROUP')
    expect(groups().map((g) => g.name)).toEqual(['Group 1'])
    expect(m.says('1 GROUP')).toBe(true)
    // The pair has not moved: still the body's first child.
    expect(byClass(m.all(), 'ws__sheet-body')[0].children[0]).toBe(byClass(m.all(), 'ws__groups-pair')[0])
    const main = (): Host => byClass(m.all(), 'ws__groups-main')[0]
    expect(main().props['aria-pressed']).toBe(true)
    expect(String(main().props['aria-label'])).toBe('Group 1: 4 points. All held. Tap to let it go.')
    expect(cls(rows(m.all())[0])).toContain('is-all')
    await tap(main())
    expect(useWorkshop.getState().selection).toEqual([])
    expect(main().props['aria-pressed']).toBe(false)
    useWorkshop.getState().setSelection([0])
    await new Promise((r) => setTimeout(r, 5))
    expect(main().props['aria-pressed']).toBe('mixed')
    await tap(main())
    expect([...useWorkshop.getState().selection].sort()).toEqual([0, 1, 2, 3])
    await m.unmount()
  })

  it('lists the newest first, and opens one row\'s actions at a time', async () => {
    const w = useWorkshop.getState
    w().setSelection([0, 1, 2, 3]); w().createGroup('Left')
    w().setSelection([4, 5, 6, 7]); w().createGroup('Right')
    w().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    expect(byClass(m.all(), 'ws__groups-name').map((h) => textOf(h))).toEqual(['Right', 'Left'])
    await tap(byLabel(m.all(), 'More for Right'))
    expect(byClass(m.all(), 'ws__groups-acts').length).toBe(1)
    await tap(byLabel(m.all(), 'More for Left'))
    expect(byClass(m.all(), 'ws__groups-acts').length).toBe(1)
    expect(byLabel(m.all(), 'More for Left')?.props['aria-expanded']).toBe(true)
    // Nothing held: ADD and REMOVE are greyed, not gone.
    expect(m.buttons('ADD TO GROUP')[0].props.disabled).toBe(true)
    expect(m.buttons('REMOVE FROM GROUP')[0].props.disabled).toBe(true)
    // A point of Right held: it can go into Left, and nothing of Left can come out.
    w().setSelection([4])
    await new Promise((r) => setTimeout(r, 5))
    expect(m.buttons('ADD TO GROUP')[0].props.disabled).toBe(false)
    expect(m.buttons('REMOVE FROM GROUP')[0].props.disabled).toBe(true)
    await m.press('ADD TO GROUP')
    expect(groups().find((g) => g.name === 'Left')?.vertices).toEqual([0, 1, 2, 3, 4])
    await m.unmount()
  })

  it('hides a group on the bench only: the row says HIDDEN, the header counts it, SHOW ALL brings it back', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3]); useWorkshop.getState().createGroup('Left'); useWorkshop.getState().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    await tap(byLabel(m.all(), 'Hide Left'))
    expect(cls(rows(m.all())[0])).toContain('is-hidden')
    expect(byClass(m.all(), 'ws__groups-counts').map((h) => textOf(h))).toEqual(['HIDDEN · 4 points'])
    expect(m.says('1 GROUP · 1 HIDDEN')).toBe(true)
    expect(byLabel(m.all(), 'Show Left')?.props['aria-pressed']).toBe(true)
    await m.press('SHOW ALL')
    expect(useWorkshop.getState().hiddenGroups).toEqual([])
    expect(m.buttons('SHOW ALL')[0].props.disabled).toBe(true)
    await m.unmount()
  })

  it('DELETE CONTENTS asks first and says what goes; CANCEL keeps it all, the red yes deletes it', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3]); useWorkshop.getState().createGroup('Left'); useWorkshop.getState().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    await tap(byLabel(m.all(), 'More for Left'))
    await m.press('DELETE CONTENTS')
    // Nothing gone yet.
    expect(useWorkshop.getState().current()?.vertices.length).toBe(8)
    const words = inBody().map((h) => (h.type === '#text' ? String(h.props.text) : '')).join(' ')
    expect(words).toContain('Delete what is in "Left"?')
    expect(words).toContain('Its 4 points go, and the group with them.')
    expect(words).toContain('2 faces built on these points go too.')
    expect(words).toContain('UNDO puts it back.')
    const button = (t: string): Host | undefined => inBody().find((h) => h.type === 'button' && textOf(h).includes(t))
    await tap(button('CANCEL'))
    expect(useWorkshop.getState().current()?.vertices.length).toBe(8)
    expect(groups().length).toBe(1)
    await m.press('DELETE CONTENTS')
    await tap(inBody().filter((h) => h.type === 'button' && textOf(h).includes('DELETE CONTENTS')).pop())
    expect(useWorkshop.getState().current()?.vertices.length).toBe(4)
    expect(groups().length).toBe(0)
    await m.unmount()
  })

  it('UNGROUP takes the group and leaves what it held', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3]); useWorkshop.getState().createGroup('Left'); useWorkshop.getState().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    await tap(byLabel(m.all(), 'More for Left'))
    await m.press('UNGROUP')
    expect(groups().length).toBe(0)
    expect(useWorkshop.getState().current()?.vertices.length).toBe(8)
    expect(m.says('No groups yet')).toBe(true)
    await m.unmount()
  })

  it('RENAME types over the name in place; Esc keeps the old one', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3]); useWorkshop.getState().createGroup('Left'); useWorkshop.getState().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    await tap(byLabel(m.all(), 'More for Left'))
    await m.press('RENAME')
    const field = (): Host | undefined => byLabel(m.all(), 'Group name')
    expect(field()?.props.value).toBe('Left')
    ;(field()?.props.onChange as (e: unknown) => void)({ target: { value: 'West wall' } })
    await new Promise((r) => setTimeout(r, 5))
    escapeTop()
    await new Promise((r) => setTimeout(r, 5))
    expect(groups()[0].name).toBe('Left')
    expect(sheets(m.all())).toEqual(['Groups'])
    await m.press('RENAME')
    ;(field()?.props.onChange as (e: unknown) => void)({ target: { value: 'West wall' } })
    await new Promise((r) => setTimeout(r, 5))
    ;(field()?.props.onKeyDown as (e: unknown) => void)({ key: 'Enter' })
    await new Promise((r) => setTimeout(r, 5))
    expect(groups()[0].name).toBe('West wall')
    await m.unmount()
  })

  it('shows a search only from eight groups up', async () => {
    const w = useWorkshop.getState
    for (let i = 0; i < GROUPS_SEARCH_FROM - 1; i++) { w().setSelection([i]); w().createGroup() }
    w().setSelection([])
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    expect(byLabel(m.all(), 'Search your groups')).toBeUndefined()
    await m.unmount()
    w().setSelection([7]); w().createGroup(); w().setSelection([])
    const n = await mount(<Workshop />)
    await tap(byLabel(n.all(), 'Groups'))
    expect(byLabel(n.all(), 'Search your groups')).toBeDefined()
    await n.unmount()
  })

  it('MORE\'s NEW GROUP makes the group and swaps MORE for GROUPS', async () => {
    useWorkshop.getState().setSelection([0, 1, 2, 3])
    const m = await mount(<Workshop />)
    await m.press('MORE')
    expect(sheets(m.all())).toEqual(['More'])
    await tap(byLabel(m.all(), 'Make a group from the selection'))
    expect(sheets(m.all())).toEqual(['Groups'])
    expect(groups().map((g) => g.name)).toEqual(['Group 1'])
    await m.unmount()
  })
})

describe('the keys', () => {
  it('G opens and closes GROUPS in an editing tool, not in LOOK, not while typing', async () => {
    const m = await mount(<Workshop />)
    key('KeyG')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual(['Groups'])
    key('KeyG')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual([])
    key('KeyG', { target: { tagName: 'INPUT' } })
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual([])
    useWorkshop.getState().setTool('paint')
    key('KeyG')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual(['Groups'])
    useWorkshop.getState().setTool('view')
    await new Promise((r) => setTimeout(r, 5))
    key('KeyG')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual([])
    await m.unmount()
  })

  it('Ctrl+G makes a group of what is held and opens GROUPS; with nothing held it only says so', async () => {
    const m = await mount(<Workshop />)
    const none = key('KeyG', { ctrl: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(none.prevented).toBe(true)
    expect(groups()).toEqual([])
    expect(sheets(m.all())).toEqual([])
    expect(useWorkshop.getState().notice).toBe('Select something first: a new group holds what you hold.')
    useWorkshop.getState().setSelection([4, 5, 6, 7])
    key('KeyG', { ctrl: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(groups().map((g) => g.name)).toEqual(['Group 1'])
    expect(sheets(m.all())).toEqual(['Groups'])
    // While FACING turns the shape, neither key does anything.
    useFacingPreview.setState({ on: true })
    key('KeyG')
    await new Promise((r) => setTimeout(r, 5))
    expect(sheets(m.all())).toEqual(['Groups'])
    await m.unmount()
  })

  it('Ctrl+G with a keyboard opens the new group straight into its name', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    useWorkshop.getState().setSelection([0, 1, 2, 3])
    const m = await mount(<Workshop />)
    key('KeyG', { ctrl: true })
    await new Promise((r) => setTimeout(r, 10))
    expect(byLabel(m.all(), 'Group name')?.props.value).toBe('Group 1')
    await m.unmount()
  })

  it('prints G on the rail and ^G on NEW GROUP', async () => {
    const m = await mount(<Workshop />)
    await tap(byLabel(m.all(), 'Groups'))
    const kbd = m.all().filter((h) => h.type === 'kbd').map((h) => textOf(h))
    expect(kbd).toContain('G')
    expect(kbd).toContain('^G')
    await m.unmount()
  })
})

describe('the words', () => {
  it('counts only the kinds a group has', () => {
    expect(countsLine({ points: 412, faces: 380, objects: 2 })).toBe('412 points · 380 faces · 2 objects')
    expect(countsLine({ points: 1, faces: 0, objects: 0 })).toBe('1 point')
    expect(countsLine({ points: 0, faces: 0, objects: 3 })).toBe('3 objects')
    expect(groupsSubLine(0, 0)).toBe('NO GROUPS')
    expect(groupsSubLine(1, 0)).toBe('1 GROUP')
    expect(groupsSubLine(14, 2)).toBe('14 GROUPS · 2 HIDDEN')
  })

  it('says what DELETE CONTENTS takes, shared and on-the-points faces included', () => {
    expect(deleteContentsCopy('Rock', { points: 412, faces: 380, objects: 2, facesBesides: 0, others: [] })).toEqual({
      title: 'Delete what is in "Rock"?',
      lines: ['Its 412 points, 380 faces and 2 objects go, and the group with them.', 'UNDO puts it back.'],
    })
    expect(deleteContentsCopy('Rock', { points: 4, faces: 3, objects: 0, facesBesides: 3, others: ['Wall'] }).lines).toEqual([
      'Its 4 points go, and the group with them.',
      'Some of it is in other groups too: it goes from them as well.',
      '3 faces built on these points go too.',
      'UNDO puts it back.',
    ])
  })

  it('has no em dash anywhere in the sheet or its CSS', () => {
    const src = readFileSync(join(__dirname, '..', 'sheets', 'GroupsSheet.tsx'), 'utf8')
    expect(src).not.toContain('\u2014')
    const at = CSS.indexOf('/* ---------- GROUPS')
    expect(at).toBeGreaterThan(-1)
    expect(CSS.slice(at)).not.toContain('\u2014')
  })

  it('stands the sheet on the strip and lets the strip\'s questions paint over it', () => {
    const rule = CSS.slice(CSS.indexOf('\n.ws__sheet.ws__sheet--onstrip {'), CSS.indexOf('}', CSS.indexOf('\n.ws__sheet.ws__sheet--onstrip {')))
    expect(rule).toContain('bottom: 100%')
    expect(rule).toContain('var(--ws-strip)')
    expect(rule).toContain('var(--ws-rail-end)')
    expect(CSS).toContain('.ws__bottom:has(.ws__sheet--onstrip) .ws__strip { z-index: 3; }')
  })
})
