/**
 * workshopShell.test.tsx - the workshop's five fixed places (workshop
 * redesign, phase 1; arkinox, 2026-11-14: "the new workbench looks amazing.
 * ship it"): the top bar, the rail, the view ball, the strip and the dock are
 * on screen in every state, each in its own order, and none of them is ever
 * taken away; the areas, the palette and the object picker open as sheets,
 * one at a time, in the bottom group above the dock; Esc closes the sheet
 * before anything else; the tutorial's MENU still opens as the workshop does.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { textOf, type Host } from '../../test/elementRoot'

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
// Radix's switch reaches for the DOM (HTMLFormElement), which this renderer has
// none of: a plain switch button stands in, as in bounceRow.test.tsx.
vi.mock('../../hud/ui/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button type="button" role="switch" id={id} aria-checked={checked} onClick={() => onCheckedChange(!checked)}>switch</button>
  ),
  Field: ({ label, children }: { label: string; children: unknown }) => <div className="ui-field"><span>{label}</span>{children as never}</div>,
}))


const { mount } = await import('../../test/elementRoot')
const { Workshop } = await import('../Workshop')
const { useWorkshop } = await import('../../store/useWorkshop')
const { escapeTop } = await import('../../hooks/useEscape')
const { frameOffset, frameZoom, useBenchView } = await import('../benchAxes')
const { newShard, ticksOf } = await import('sno-core/shards')

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

/** A small shard with a face, so every row has something to act on. */
function cube() {
  const s = newShard('Cube')
  return {
    ...s,
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
  }
}

const cls = (h: Host): string => String(h.props.className ?? '')
const byClass = (all: Host[], c: string): Host[] => all.filter((h) => cls(h).split(/\s+/).includes(c))
const label = (h: Host): string => String(h.props['aria-label'] ?? textOf(h)).trim()
const buttonsIn = (h: Host): Host[] => { const out: Host[] = []; const walk = (n: Host | string): void => { if (typeof n === 'string') return; if (n.type === 'button') out.push(n); n.children.forEach(walk) }; walk(h); return out }

/** What each fixed place holds right now, in order. */
function places(all: Host[]) {
  const one = (c: string): Host | null => byClass(all, c)[0] ?? null
  const top = one('ws__topbar')
  const rail = one('ws__rail')
  const dock = one('ws__dock')
  return {
    top: top ? buttonsIn(top).map((b) => textOf(b) || label(b)) : null,
    rail: rail ? buttonsIn(rail).map(label) : null,
    ball: one('ws__viewball') !== null,
    strip: one('ws__strip') !== null,
    dock: dock ? buttonsIn(dock).map((b) => textOf(b) || (cls(b).includes('ws__colorchip') ? 'COLOR' : label(b))) : null,
  }
}

const TOP = ['Close the workshop', 'MENU', 'SHARD', 'GRID', 'AVATAR', 'MOTION', 'DEPLOY']
const RAIL = ['Undo', 'Redo', 'Raise the grid floor', 'Lower the grid floor']
const DOCK = ['LOOK', 'STAMP', 'SELECT', 'PAINT', 'ADD', 'FACE', 'COLOR']

beforeEach(() => {
  // The toast's timer and the view menu's tap-elsewhere are the window's and
  // the document's; this renderer has neither, so stand-ins do, once the
  // modules that read the real ones at load are loaded.
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  if (typeof document === 'undefined') vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null })
  const s = cube()
  useWorkshop.setState({ selectKind: 'points', paintMode: 'face', paintEdge: false, boxSelect: false, invert: false })
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'view', selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, past: [], future: [], openPanel: null, notice: null })
  localStorage.setItem('onosendai:workshop-intro', '1')
})
afterEach(() => {
  useWorkshop.setState({ open: false })
  vi.unstubAllGlobals()
})

describe('the five fixed places', () => {
  it('are all on screen, each in its order, in every tool and with something held', async () => {
    const m = await mount(<Workshop />)
    const states: Array<[string, () => void]> = [
      ['LOOK', () => useWorkshop.getState().setTool('view')],
      ['STAMP', () => useWorkshop.getState().setTool('stamp')],
      ['ADD', () => useWorkshop.getState().setTool('add')],
      ['SELECT', () => useWorkshop.getState().setTool('select')],
      ['SELECT holding points', () => { useWorkshop.getState().setTool('select'); useWorkshop.getState().setSelection([0, 1, 2]) }],
      ['SELECT holding one point, clipboard full', () => { useWorkshop.getState().copySelection(); useWorkshop.getState().setSelection([0]) }],
      ['FACE', () => useWorkshop.getState().setTool('face')],
      ['FACE picking', () => useWorkshop.setState({ facePick: [0, 1] })],
      ['FACE holding a face', () => { useWorkshop.getState().clearFacePick(); useWorkshop.getState().selectFace(0) }],
    ]
    for (const [name, set] of states) {
      set()
      await new Promise((r) => setTimeout(r, 5))
      const p = places(m.all())
      expect(p.top, name).toEqual(TOP)
      expect(p.rail, name).toEqual(RAIL)
      expect(p.ball, name).toBe(true)
      expect(p.strip, name).toBe(true)
      expect(p.dock, name).toEqual(DOCK)
    }
    await m.unmount()
  })

  it('stay with every sheet open, the palette and the object picker too', async () => {
    const m = await mount(<Workshop />)
    for (const area of ['MENU', 'SHARD', 'GRID', 'AVATAR']) {
      await m.press(area)
      const p = places(m.all())
      expect(p.top, area).toEqual(TOP)
      expect(p.rail, area).toEqual(RAIL)
      expect(p.ball, area).toBe(true)
      expect(p.dock, area).toEqual(DOCK)
      await m.press(area)
    }
    const chip = byClass(m.all(), 'ws__colorchip')[0]
    ;(chip.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(m.all().some((h) => h.props['aria-label'] === 'Palette')).toBe(true)
    expect(places(m.all()).dock).toEqual(DOCK)
    expect(places(m.all()).rail).toEqual(RAIL)
    await m.unmount()
  })

  it('light the tool in hand on the dock and the open area in the top bar', async () => {
    useWorkshop.getState().setTool('select')
    const m = await mount(<Workshop />)
    const lit = (c: string): string[] => byClass(m.all(), c).filter((h) => h.props['aria-pressed'] === true).map(textOf)
    expect(lit('ws__dockbtn')).toEqual(['SELECT'])
    await m.press('SHARD')
    expect(lit('ws__topbtn')).toEqual(['SHARD'])
    await m.unmount()
  })

  it('open MOTION like its siblings: its sheet holds the motion editor, PREVIEW and all', async () => {
    const m = await mount(<Workshop />)
    const motion = m.buttons('MOTION')[0]
    expect(motion.props.disabled).toBeFalsy()
    await m.press('MOTION')
    expect(byClass(m.all(), 'ws__sheet').map((h) => String(h.props['aria-label']))).toEqual(['Motion'])
    expect(m.all().some((h) => h.props['aria-label'] === 'Add a motion')).toBe(true)
    await m.press('SPIN')
    expect(m.says('PREVIEW')).toBe(true)
    expect(m.all().some((h) => h.props['aria-label'] === 'Scrub one cycle')).toBe(true)
    await m.press('MOTION')
    expect(byClass(m.all(), 'ws__sheet')).toEqual([])
    await m.unmount()
  })

  it('never wrap the top bar or hide the rail or the dock in CSS', () => {
    const rule = (sel: string): string => {
      const at = CSS.indexOf(`\n${sel} {`)
      expect(at, sel).toBeGreaterThan(-1)
      return CSS.slice(at, CSS.indexOf('}', at))
    }
    expect(rule('.ws__topbar')).toContain('flex-wrap: nowrap')
    for (const sel of ['.ws__topbar', '.ws__rail', '.ws__view', '.ws__bottom']) expect(rule(sel)).toMatch(/position: absolute/)
    // No rule anywhere hides a fixed place.
    expect(CSS).not.toMatch(/\.ws__(topbar|rail|viewball|strip|dock)\s*\{[^}]*display:\s*none/)
  })
})

describe('the sheets', () => {
  const regions = (all: Host[]): string[] => byClass(all, 'ws__sheet').map((h) => String(h.props['aria-label']))

  it('open one at a time: an area replaces another, the palette replaces an area, a second tap closes', async () => {
    const m = await mount(<Workshop />)
    await m.press('MENU')
    expect(regions(m.all())).toEqual(['Menu'])
    await m.press('SHARD')
    expect(regions(m.all())).toEqual(['Shard'])
    const chip = byClass(m.all(), 'ws__colorchip')[0]
    ;(chip.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(regions(m.all())).toEqual(['Palette'])
    ;(byClass(m.all(), 'ws__colorchip')[0].props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(regions(m.all())).toEqual([])
    await m.press('GRID')
    await m.press('GRID')
    expect(regions(m.all())).toEqual([])
    await m.unmount()
  })

  it('stand in the bottom group, before the strip and the dock, which they never cover', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    const bottom = byClass(m.all(), 'ws__bottom')[0]
    const kids = bottom.children.filter((c): c is Host => typeof c !== 'string').map((c) => cls(c).split(' ')[0])
    expect(kids).toEqual(['ws__sheet', 'ws__strip', 'ws__dock'])
    // An area stands on the dock, over the strip; a tall one (palette, picker) on the strip; none above the rail.
    const sheet = CSS.slice(CSS.indexOf('\n.ws__sheet {'), CSS.indexOf('}', CSS.indexOf('\n.ws__sheet {')))
    expect(sheet).toContain('bottom: var(--ws-dock)')
    expect(sheet).toContain('var(--ws-rail-end)')
    const tall = CSS.slice(CSS.indexOf('\n.ws__sheet.ws__sheet--tall {'), CSS.indexOf('}', CSS.indexOf('\n.ws__sheet.ws__sheet--tall {')))
    expect(tall).toContain('bottom: 100%')
    expect(tall).toContain('var(--ws-rail-end)')
    await m.unmount()
  })

  it('leave nothing floating over the bench but the move handles: no pad, no color column (phase 2)', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0, 1])
    const m = await mount(<Workshop />)
    for (const gone of ['benchpad', 'ws__acts', 'ws__held', 'ws__at']) expect(byClass(m.all(), gone).length, gone).toBe(0)
    expect(byClass(m.all(), 'ws__handles').length).toBe(1)
    expect(byClass(m.all(), 'ws__handle').map((h) => textOf(h))).toEqual(['+X', '+Y', '+Z'])
    await m.unmount()
  })

  it('close first on Esc, then the selection lets go, then the workshop closes', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0])
    const m = await mount(<Workshop />)
    await m.press('MENU')
    escapeTop()
    await new Promise((r) => setTimeout(r, 5))
    expect(regions(m.all())).toEqual([])
    expect(useWorkshop.getState().selection).toEqual([0])
    escapeTop()
    await new Promise((r) => setTimeout(r, 5))
    expect(useWorkshop.getState().selection).toEqual([])
    expect(useWorkshop.getState().open).toBe(true)
    escapeTop()
    expect(useWorkshop.getState().open).toBe(false)
    await m.unmount()
  })

  it('open MENU as the workshop opens when asked, as the tutorial asks', async () => {
    useWorkshop.setState({ openPanel: 'menu' })
    const m = await mount(<Workshop />)
    expect(regions(m.all())).toEqual(['Menu'])
    expect(useWorkshop.getState().openPanel).toBeNull()
    expect(m.says('+ NEW SHARD')).toBe(true)
    await m.unmount()
  })

  it('say which area and which shard in the header, with an X that closes', async () => {
    const m = await mount(<Workshop />)
    await m.press('GRID')
    const head = byClass(m.all(), 'ws__sheet-head')[0]
    expect(textOf(head)).toContain('GRID')
    expect(textOf(head)).toContain('Cube')
    const x = byClass(m.all(), 'ws__sheet-x')[0]
    expect(x.props['aria-label']).toBe('Close GRID')
    ;(x.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(regions(m.all())).toEqual([])
    await m.unmount()
  })
})

describe('the strip', () => {
  const strip = (m: Awaited<ReturnType<typeof mount>>): Host => byClass(m.all(), 'ws__strip')[0]
  const slots = (m: Awaited<ReturnType<typeof mount>>): string[] => buttonsIn(strip(m)).filter((b) => cls(b).includes('ws__heldbtn')).map((b) => textOf(b).replace(/\d+/g, '').trim())
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

  it('STAMP: a shape chip that opens picture tiles (OBJECT among them), SIZE, TURN, MORE', async () => {
    useWorkshop.getState().setTool('stamp')
    useWorkshop.getState().setStampKind('block')
    const m = await mount(<Workshop />)
    const words = buttonsIn(strip(m)).map(textOf)
    expect(words[0]).toBe('STAMP')
    expect(words).toEqual(expect.arrayContaining(['BLOCK', 'TURN', 'MORE']))
    expect(buttonsIn(strip(m)).some((b) => b.props['aria-label'] === 'Larger')).toBe(true)
    expect(byClass(m.all(), 'ws__tiles').length).toBe(0)
    await m.press('BLOCK')
    const tiles = byClass(m.all(), 'ws__tile').map(textOf)
    expect(tiles).toEqual(['BLOCK', 'WEDGE', 'PYRAMID', 'COLUMN', 'RING', 'STAR', 'ARROW', 'OBJECT'])
    const pyramid = byClass(m.all(), 'ws__tile').find((h) => textOf(h) === 'PYRAMID')!
    ;(pyramid.props.onClick as () => void)()
    await tick()
    expect(useWorkshop.getState().stampKind).toBe('pyramid')
    expect(byClass(m.all(), 'ws__tiles').length).toBe(0)
    await m.unmount()
  })

  it('SELECT: POINTS, FACES or OBJECTS, ADD or REMOVE, BOX, ALL, MORE; BOX is what makes a drag draw a box', async () => {
    useWorkshop.getState().setTool('select')
    const m = await mount(<Workshop />)
    expect(buttonsIn(strip(m)).map(textOf)).toEqual(['SELECT', 'POINTS', 'ADD', 'REMOVE', 'BOX', 'ALL', 'MORE'])
    await m.press('REMOVE')
    expect(useWorkshop.getState().invert).toBe(true)
    await m.press('BOX')
    expect(useWorkshop.getState().boxSelect).toBe(true)
    await m.press('ALL')
    expect(useWorkshop.getState().selection).toEqual([0, 1, 2, 3])
    // One finger orbits in every tool but SELECT with BOX on, where the drag is the box's.
    const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
    expect(bench).toContain("enableRotate={!(tool === 'select' && boxSelect)}")
    expect(bench).toContain("const on = useWorkshop((s) => s.tool === 'select' && s.boxSelect)")
    await m.unmount()
  })

  it('FACE: the corners, then FILL, BACK, CANCEL, AUTO, in that order, greyed until they apply', async () => {
    useWorkshop.getState().setTool('face')
    const m = await mount(<Workshop />)
    const keys = (): Host[] => buttonsIn(strip(m)).slice(1, 5)
    expect(keys().map(textOf)).toEqual(['FILL', 'BACK', 'CANCEL', 'AUTO'])
    expect(keys().map((b) => b.props.disabled)).toEqual([true, true, true, false])
    useWorkshop.setState({ facePick: [0, 1] })
    await tick()
    expect(textOf(byClass(m.all(), 'ws__corners')[0])).toContain('2/3')
    expect(keys().map((b) => b.props.disabled)).toEqual([true, false, false, false])
    await m.press('BACK')
    expect(useWorkshop.getState().facePick).toEqual([0])
    // Picking corners is not holding: FACE's strip stays.
    expect(slots(m)).toEqual([])
    await m.unmount()
  })

  it('becomes the held bar, with the same slots in the same order, whatever is held in whatever tool', async () => {
    const SLOTS = ['PT', 'LEFT', 'RIGHT', 'COPY', 'PASTE', 'COLOR', 'DELETE', 'MORE']
    const m = await mount(<Workshop />)
    const cases: Array<[string, () => void]> = [
      ['LOOK, one point', () => { useWorkshop.getState().setTool('view'); useWorkshop.getState().setSelection([0]) }],
      ['SELECT, three points', () => { useWorkshop.getState().setTool('select'); useWorkshop.getState().setSelection([0, 1, 2]) }],
      ['STAMP, two points', () => { useWorkshop.getState().setTool('stamp'); useWorkshop.getState().setSelection([0, 1]) }],
      ['SELECT FACES, a face', () => { useWorkshop.getState().setTool('select'); useWorkshop.getState().setSelectKind('faces'); useWorkshop.getState().selectFace(0) }],
    ]
    for (const [name, set] of cases) {
      set()
      await tick()
      const got = slots(m)
      expect(got.slice(1), name).toEqual(SLOTS.slice(1))
      // DELETE second from the right, always.
      expect(got[got.length - 2], name).toBe('DELETE')
    }
    // PASTE greyed with nothing copied, never gone.
    const paste = (): Host => buttonsIn(strip(m)).find((b) => textOf(b) === 'PASTE')!
    expect(paste().props.disabled).toBe(true)
    useWorkshop.getState().setTool('select'); useWorkshop.getState().setSelection([0, 1])
    await m.press('COPY')
    expect(paste().props.disabled).toBe(false)
    // The count lets go.
    const count = buttonsIn(strip(m)).find((b) => cls(b).includes('ws__heldbtn--count'))!
    expect(String(count.props['aria-label'])).toContain('2 points held')
    ;(count.props.onClick as () => void)()
    await tick()
    expect(useWorkshop.getState().selection).toEqual([])
    expect(slots(m)).toEqual([])
    await m.unmount()
  })

  it('counts a face held (SELECT FACES) as a face, not its corners', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelectKind('faces')
    useWorkshop.getState().selectFace(0)
    const m = await mount(<Workshop />)
    const count = buttonsIn(strip(m)).find((b) => cls(b).includes('ws__heldbtn--count'))!
    expect(textOf(count).replace(/\s+/g, ' ')).toBe('1 FACE')
    // AUTO and FLIP, and REMOVE for face taps, are in MORE while the face is held.
    await m.press('MORE')
    for (const w of ['FLIP FACE', 'FLIP SURFACE', 'AUTO', 'REMOVE', 'BOX']) expect(m.buttons(w).length, w).toBeGreaterThan(0)
    await m.unmount()
  })

  it('keeps a typed move one UNDO with a full history, and refuses a place off the grid whole', async () => {
    const s0 = useWorkshop.getState().current()!
    useWorkshop.setState({ past: Array.from({ length: 64 }, () => s0) })
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([1])
    const m = await mount(<Workshop />)
    await m.press('MORE')
    const inputs = (): Host[] => m.all().filter((h) => h.type === 'input' && String(h.props['aria-label']).endsWith(', in units'))
    ;(inputs()[0].props.onChange as (e: unknown) => void)({ target: { value: '2' } })
    ;(inputs()[2].props.onChange as (e: unknown) => void)({ target: { value: '1' } })
    await tick()
    const submit = (): void => { const form = m.all().find((h) => h.type === 'form')!; (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => {} }) }
    submit()
    await tick()
    expect(ticksOf(useWorkshop.getState().current()!.vertices[1])).toEqual([240, 0, 120])
    expect(useWorkshop.getState().past.length).toBe(64)
    useWorkshop.getState().undo()
    expect(ticksOf(useWorkshop.getState().current()!.vertices[1])).toEqual([120, 0, 0])
    // Off the grid: nothing moves, not even the axes that would fit.
    useWorkshop.getState().redo()
    useWorkshop.getState().setSelection([1])
    await tick()
    ;(inputs()[0].props.onChange as (e: unknown) => void)({ target: { value: '1' } })
    ;(inputs()[1].props.onChange as (e: unknown) => void)({ target: { value: '9999' } })
    await tick()
    submit()
    await tick()
    expect(ticksOf(useWorkshop.getState().current()!.vertices[1])).toEqual([240, 0, 120])
    await m.unmount()
  })

  it('asks BLEND or EDGE before COLOR puts the color on a face', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelectKind('faces')
    useWorkshop.getState().selectFace(0)
    const m = await mount(<Workshop />)
    await m.press('COLOR')
    const menu = m.all().find((h) => h.props['aria-label'] === 'How to color the selected faces')!
    expect(buttonsIn(menu).map(textOf)).toEqual(['BLEND', 'EDGE'])
    await m.unmount()
  })

  it('opens MORE: what is held, the exact place, the move pad, and the whole shard', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([1])
    const m = await mount(<Workshop />)
    await m.press('MORE')
    const sheet = m.all().find((h) => h.props['aria-label'] === 'More')!
    expect(sheet).toBeDefined()
    const words = buttonsIn(sheet).map(textOf)
    for (const w of ['JOINED', 'CUT', 'DUPLICATE', 'FILL', 'SUBDIVIDE', 'PIECE', 'TAKE COLOR', 'SET', 'ALL', 'COLOR ALL', 'BOX', 'REMOVE']) expect(words, w).toContain(w)
    expect(buttonsIn(sheet).filter((b) => String(b.props['aria-label'] ?? '').startsWith('Move ')).length).toBe(6)
    // Typed exact numbers move the point there in one step, one UNDO back.
    const inputs = m.all().filter((h) => h.type === 'input' && String(h.props['aria-label']).endsWith(', in units'))
    expect(inputs.map((i) => i.props.value)).toEqual(['1', '0', '0'])
    const before = useWorkshop.getState().past.length
    ;(inputs[0].props.onChange as (e: unknown) => void)({ target: { value: '3' } })
    ;(inputs[1].props.onChange as (e: unknown) => void)({ target: { value: '1 1/2' } })
    await tick()
    const form = m.all().find((h) => h.type === 'form' && h.props['aria-label'] === "The point's place")!
    ;(form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => {} })
    await tick()
    const v = useWorkshop.getState().current()!.vertices[1]
    expect(ticksOf(v)).toEqual([3 * 120, 1.5 * 120, 0])
    expect(useWorkshop.getState().past.length).toBe(before + 1)
    await m.unmount()
  })

  it('carries a badge on MORE while points are stacked, with WELD inside', async () => {
    const s = cube()
    s.vertices.push({ ...s.vertices[0] })
    useWorkshop.setState({ shards: [s], currentId: s.id })
    const m = await mount(<Workshop />)
    expect(textOf(byClass(m.all(), 'ws__badge')[0])).toBe('1')
    await m.press('MORE')
    expect(m.buttons('WELD 1').length).toBe(1)
    await m.unmount()
  })

  it('says what a tap does behind its ?, for the tool in hand, and lets go of it with the tool', async () => {
    useWorkshop.getState().setTool('add')
    const m = await mount(<Workshop />)
    const q = (): Host => byClass(m.all(), 'ws__strip-tool')[0]
    expect(q().props['aria-label']).toBe('What ADD does')
    ;(q().props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    expect(textOf(byClass(m.all(), 'ws__hint')[0])).toContain('place a vertex')
    useWorkshop.getState().setTool('stamp')
    await new Promise((r) => setTimeout(r, 5))
    expect(byClass(m.all(), 'ws__hint').length).toBe(0)
    await m.unmount()
  })

  it('opens the object picker as a sheet from OBJECT', async () => {
    useWorkshop.getState().setTool('stamp')
    useWorkshop.setState({ stampObject: null, stampMode: 'shape' })
    const m = await mount(<Workshop />)
    await m.press(/^BLOCK|^WEDGE|^PYRAMID|^COLUMN|^RING|^STAR|^ARROW/)
    await m.press('OBJECT')
    expect(m.all().some((h) => h.props['aria-label'] === 'Choose an object to stamp')).toBe(true)
    expect(places(m.all()).dock).toEqual(DOCK)
    await m.unmount()
  })
})

describe('the view ball', () => {
  it('opens its menu on a tap: the views, the grid keys, the snap and the ghost', async () => {
    const m = await mount(<Workshop />)
    expect(byClass(m.all(), 'ws__viewmenu').length).toBe(0)
    const ball = byClass(m.all(), 'ws__viewball')[0]
    expect(ball.props['aria-expanded']).toBe(false)
    // The ball is the orbit sphere's drag and tap: a press and a lift with no travel is a tap.
    const down = ball.props.onPointerDown as (e: unknown) => void
    const listeners = new Map<string, (e: unknown) => void>()
    const target = Object.assign(ball, { setPointerCapture: () => {}, ownerDocument: { addEventListener: (t: string, fn: (e: unknown) => void) => { listeners.set(t, fn) }, removeEventListener: () => {} }, getBoundingClientRect: () => ({ width: 60 }) })
    down({ pointerType: 'touch', button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault: () => {}, currentTarget: target })
    listeners.get('pointerup')?.({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 10 })
    await new Promise((r) => setTimeout(r, 5))
    const menu = byClass(m.all(), 'ws__viewmenu')[0]
    expect(menu).toBeDefined()
    const words = buttonsIn(menu).map(label)
    for (const w of ['HOME', 'FIT', 'TOP', 'FRONT', 'SIDE', 'Tip the grid up', 'Tip the grid down', 'Roll the grid left', 'Roll the grid right', 'RESET', 'Coarser snap', 'Finer snap']) expect(words).toContain(w)
    // TOP asks the bench for the view straight down.
    const top = buttonsIn(menu).find((b) => textOf(b) === 'TOP')!
    ;(top.props.onClick as () => void)()
    expect(useBenchView.getState().request?.kind).toBe('top')
    // A view picked puts the menu away, so the view is seen.
    await new Promise((r) => setTimeout(r, 5))
    expect(byClass(m.all(), 'ws__viewmenu').length).toBe(0)
    await m.unmount()
  })
})

describe('the bench framing (benchAxes frameOffset, frameZoom)', () => {
  it('keeps the scale the bench always had at rest, and shrinks it by the share a sheet takes', () => {
    // At rest: the field the canvas shows is the field it always showed.
    const rest = { top: 62, bottom: 116, rest: 116 }
    const o = frameOffset(375, 812, rest)!
    const z = frameZoom(812, o.fullHeight, rest)
    // Shown field = fov over fullHeight, times height / fullHeight, over zoom: the same as fov over height.
    expect((812 / o.fullHeight) / z).toBeCloseTo(1, 12)
    // A sheet up: what fitted in the resting band fits in what is left.
    const up = { top: 62, bottom: 450, rest: 116 }
    const s = frameOffset(375, 812, up)!
    const zs = frameZoom(812, s.fullHeight, up)
    expect((812 / s.fullHeight) / zs).toBeCloseTo((812 - 62 - 116) / (812 - 62 - 450), 12)
    // No offset, no zoom.
    expect(frameZoom(812, 812, { top: 0, bottom: 0, rest: 0 })).toBe(1)
  })

  it('centres the shard in the band the bars and a sheet leave', () => {
    // Nothing covered, or covered evenly: no offset.
    expect(frameOffset(375, 812, { top: 0, bottom: 0 })).toBeNull()
    expect(frameOffset(375, 812, { top: 60, bottom: 60 })).toBeNull()
    // A sheet at the bottom: a taller virtual view, shown from `shift` down,
    // whose middle lands in the middle of what is left.
    const o = frameOffset(375, 812, { top: 62, bottom: 420 })!
    const shift = 420 - 62
    expect(o).toEqual({ fullWidth: 375, fullHeight: 812 + shift, x: 0, y: shift, width: 375, height: 812 })
    expect(o.fullHeight / 2 - o.y).toBe((62 + (812 - 420)) / 2)
    // More covered at the top: the view shows the virtual view's top.
    const t = frameOffset(375, 812, { top: 300, bottom: 100 })!
    expect(t.y).toBe(0)
    expect(t.fullHeight / 2).toBe((300 + (812 - 100)) / 2)
  })
  it('never frames into nothing', () => {
    expect(frameOffset(0, 812, { top: 0, bottom: 400 })).toBeNull()
    expect(frameOffset(375, 812, { top: 0, bottom: 900 })).toBeNull()
  })
})

describe('the move handles and exact numbers (phase 2)', () => {
  it('fold a whole drag into one UNDO from the shard alone, so a full history folds too', () => {
    const src = readFileSync(join(__dirname, '..', 'shell', 'MoveHandles.tsx'), 'utf8')
    expect(src).toContain('if (d.before && now.currentId === d.shardId && now.current() !== d.before) useWorkshop.setState({ past: dragHistory(d.past, d.before, now.past) })')
    expect(src).not.toMatch(/past\.length - d\.past\.length/)
  })
  it('never take a multi-finger press for a tap on the bench', () => {
    const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
    const taps = bench.match(/if \(e\.delta > tapSlop\(\)( \|\| multiPress\(\))?\) return/g) ?? []
    expect(taps.length).toBeGreaterThanOrEqual(4)
    for (const t of taps) expect(t).toContain('multiPress()')
    expect(bench).toContain('if (down.size >= 1) noteMultiTouch(true)')
  })

  it('turn a drag along an axis into whole grid steps, and an axis seen end on into none', async () => {
    const { handleSteps } = await import('../benchAxes')
    // One unit covers 40px to the right: 40px is one unit, 120 ticks, two steps of 60.
    expect(handleSteps(40, 0, [40, 0], 120, 60)).toBe(2)
    expect(handleSteps(-40, 0, [40, 0], 120, 60)).toBe(-2)
    // Across the axis moves nothing.
    expect(handleSteps(0, 50, [40, 0], 120, 60)).toBe(0)
    // Y up on screen is negative pixels.
    expect(handleSteps(0, -80, [0, -40], 120, 120)).toBe(2)
    expect(handleSteps(30, 30, [0.2, 0.1], 120, 60)).toBe(0)
  })
  it('stand a fixed reach out along each axis as it looks on screen, and hide one seen end on', async () => {
    const { handleAt, HANDLE_REACH_PX } = await import('../shell/MoveHandles')
    const f = { center: [100, 200] as [number, number], perUnit: [[30, 40], [0, -10], [1, 1]] as [[number, number], [number, number], [number, number]] }
    expect(handleAt(f, 0)).toEqual([100 + 0.6 * HANDLE_REACH_PX, 200 + 0.8 * HANDLE_REACH_PX])
    expect(handleAt(f, 1)).toEqual([100, 200 - HANDLE_REACH_PX])
    expect(handleAt(f, 2)).toBeNull()
  })
  it('read places typed as the readout writes them', async () => {
    const { parseUnits } = await import('../sheets/MoreSheet')
    expect(parseUnits('3')).toBe(360)
    expect(parseUnits('-2')).toBe(-240)
    expect(parseUnits('1/2')).toBe(60)
    expect(parseUnits('1 1/2')).toBe(180)
    expect(parseUnits('-3/4')).toBe(-90)
    expect(parseUnits('0.25')).toBe(30)
    expect(parseUnits('abc')).toBeNull()
    expect(parseUnits('1/0')).toBeNull()
  })
})

describe('PAINT, and FACE only making faces (phase 3)', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
  const RED: [number, number, number] = [1, 0, 0]
  const colors = (): string[] => useWorkshop.getState().current()!.vertices.map((v) => v.c.join(','))

  it('is the dock\'s fourth tool, key 6, with POINT, FACE, PIECE, ALL and BLEND or EDGE in the strip', async () => {
    const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
    expect(bench).toContain("if (e.code === 'Digit6') w.setTool('paint')")
    useWorkshop.getState().setTool('paint')
    const m = await mount(<Workshop />)
    const strip = byClass(m.all(), 'ws__strip')[0]
    expect(buttonsIn(strip).map(textOf)).toEqual(['PAINT', 'POINT', 'FACE', 'PIECE', 'ALL', 'BLEND', 'EDGE', 'MORE'])
    const blend = (): Host => buttonsIn(byClass(m.all(), 'ws__strip')[0]).find((b) => textOf(b) === 'BLEND')!
    expect(blend().props.disabled).toBe(false)
    await m.press('POINT')
    expect(useWorkshop.getState().paintMode).toBe('point')
    // BLEND and EDGE are a face's: greyed for the others, never gone.
    expect(blend().props.disabled).toBe(true)
    await m.unmount()
  })

  it('lets go of what is held on the way in, so its strip is its own', () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0, 1])
    useWorkshop.getState().setTool('paint')
    expect(useWorkshop.getState().selection).toEqual([])
  })

  it('paints what a tap met, one UNDO each, and leaves what is held alone', () => {
    const w = useWorkshop.getState
    useWorkshop.setState({ color: RED, selection: [3] })
    const before = colors()
    // POINT: that point only; a face's middle paints nothing.
    w().setPaintMode('point')
    w().paintTap({ face: 0 })
    expect(colors()).toEqual(before)
    w().paintTap({ vertex: 0 })
    expect(colors()[0]).toBe('1,0,0')
    expect(colors()[1]).toBe(before[1])
    expect(w().selection).toEqual([3])
    w().undo()
    expect(colors()).toEqual(before)
    // FACE, BLEND: its corners. EDGE: a hard seam, the corners as they were.
    w().setPaintMode('face')
    w().paintTap({ face: 0 })
    expect(colors().slice(0, 3)).toEqual(['1,0,0', '1,0,0', '1,0,0'])
    expect(colors()[3]).toBe(before[3])
    w().undo()
    w().setPaintEdge(true)
    w().paintTap({ face: 1 })
    expect(colors()).toEqual(before)
    expect(w().current()!.facecolors?.[1]).toEqual(RED)
    w().undo()
    // PIECE and ALL: everything joined, everything.
    w().setPaintMode('piece')
    w().paintTap({ vertex: 0 })
    expect(new Set(colors())).toEqual(new Set(['1,0,0']))
    w().undo()
    w().setPaintMode('all')
    // UNDO lets go; hold something again to see a paint leave it held.
    w().setSelection([3])
    const past = w().past.length
    w().paintTap({ face: 1 })
    expect(new Set(colors())).toEqual(new Set(['1,0,0']))
    expect(w().past.length).toBe(past + 1)
    expect(w().selection).toEqual([3])
  })

  it('takes a color with the dropper from a point or a face, holding nothing new', () => {
    const w = useWorkshop.getState
    const s = w().current()!
    useWorkshop.setState({ shards: [{ ...s, vertices: s.vertices.map((v, i) => (i === 2 ? { ...v, c: [0, 0, 1] as [number, number, number] } : v)) }], color: RED, selection: [] })
    w().takeColorAt({ vertex: 2 })
    expect(w().color).toEqual([0, 0, 1])
    expect(w().selection).toEqual([])
  })

  it('FACE taps pick corners only; faces are held from SELECT FACES; LOOK taps nothing', () => {
    const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
    expect(bench).toContain("onFaceClick={tool === 'paint' || (tool === 'select' && selectKind === 'faces') ? onFace : undefined}")
    expect(bench).toContain("if (tool === 'face') w.pickForFace(first)")
    expect(bench).toContain("if (tool === 'view') return")
    expect(bench).toContain("if (w.tool === 'select' && w.selectKind === 'objects') w.togglePart(part)")
    // A box takes what the switch says.
    expect(bench).toContain("kind = w.selectKind")
    expect(bench).toMatch(/if \(kind === 'faces'\) \{[\s\S]*facesIn/)
  })

  it('switches SELECT between POINTS, FACES and OBJECTS from tiles, letting go on a change', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0, 1])
    useWorkshop.getState().selectVertex(null)
    const m = await mount(<Workshop />)
    await m.press('POINTS')
    expect(byClass(m.all(), 'ws__tile').map(textOf)).toEqual(['POINTS', 'FACES', 'OBJECTS'])
    useWorkshop.getState().setSelection([0, 1])
    await tick()
    const faces = byClass(m.all(), 'ws__tile').find((h) => textOf(h) === 'FACES')
    expect(faces).toBeUndefined() // the held bar took the strip, and the tiles with it
    useWorkshop.getState().selectVertex(null)
    await tick()
    await m.press('POINTS')
    ;(byClass(m.all(), 'ws__tile').find((h) => textOf(h) === 'FACES')!.props.onClick as () => void)()
    await tick()
    expect(useWorkshop.getState().selectKind).toBe('faces')
    // ALL in FACES holds every face, with its corners.
    await m.press('ALL')
    expect(useWorkshop.getState().selectedFaces).toEqual([0, 1])
    useWorkshop.getState().setSelectKind('objects')
    expect(useWorkshop.getState().selectedFaces).toEqual([])
    expect(useWorkshop.getState().selection).toEqual([])
    await m.unmount()
  })
})
