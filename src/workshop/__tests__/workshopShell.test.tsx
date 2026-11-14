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
const { frameOffset, useBenchView } = await import('../benchAxes')
const { newShard } = await import('sno-core/shards')

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

/** A small shard with a face, so every row has something to act on. */
function cube() {
  const s = newShard('Cube')
  return {
    ...s,
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p.map((n) => n * 4096) as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
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
const DOCK = ['LOOK', 'STAMP', 'SELECT', 'ADD', 'FACE', 'COLOR']

beforeEach(() => {
  // The toast's timer and the view menu's tap-elsewhere are the window's and
  // the document's; this renderer has neither, so stand-ins do, once the
  // modules that read the real ones at load are loaded.
  vi.stubGlobal('window', globalThis)
  if (typeof document === 'undefined') vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
  const s = cube()
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

  it('keep MOTION in its place, greyed out until the motion editor lands', async () => {
    const m = await mount(<Workshop />)
    const motion = m.buttons('MOTION')[0]
    expect(motion.props.disabled).toBe(true)
    expect(String(motion.props.title)).toContain('coming soon')
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

  it('put the move pad and the color column away while one is up', async () => {
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0, 1])
    const m = await mount(<Workshop />)
    expect(byClass(m.all(), 'benchpad').length).toBe(1)
    expect(byClass(m.all(), 'ws__acts').length).toBe(1)
    await m.press('SHARD')
    expect(byClass(m.all(), 'benchpad').length).toBe(0)
    expect(byClass(m.all(), 'ws__acts').length).toBe(0)
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
  it('holds STAMP\'s options and, with something held, the held rows', async () => {
    useWorkshop.getState().setTool('stamp')
    const m = await mount(<Workshop />)
    const strip = (): Host => byClass(m.all(), 'ws__strip')[0]
    expect(buttonsIn(strip()).map(textOf)).toEqual(expect.arrayContaining(['BLOCK', 'OBJECT']))
    expect(buttonsIn(strip()).some((b) => b.props['aria-label'] === 'Larger')).toBe(true)
    useWorkshop.getState().setTool('select')
    useWorkshop.getState().setSelection([0, 1, 2])
    await new Promise((r) => setTimeout(r, 5))
    const labels = buttonsIn(strip()).map(label)
    for (const l of ['Invert: taps and boxes take points out', 'Deselect everything', 'Turn left', 'Turn right', 'Cut the selection', 'Copy the selection', 'Select everything', 'Fill the selection', 'Subdivide the selection']) expect(labels).toContain(l)
    // STAMP's options are STAMP's alone.
    expect(labels).not.toContain('BLOCK')
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
    useWorkshop.setState({ stampObject: null })
    const m = await mount(<Workshop />)
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
    await m.unmount()
  })
})

describe('the bench framing (benchAxes frameOffset)', () => {
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
