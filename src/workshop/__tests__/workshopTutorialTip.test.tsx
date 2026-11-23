/**
 * workshopTutorialTip.test.tsx - the tour's word inside the workshop
 * (new-user feedback, 2026-11-21: "Once, I followed a tip to open the
 * workshop and landed there with no other tip. I had no idea what to do and
 * just left").
 *
 * The tutorial's workshop step, walked: OPEN WORKSHOP opens it on the pieces
 * found with MENU up, and the workshop now says what to do first (tap a
 * piece), then, with a piece on the bench, what to try next; BACK TO THE TOUR
 * closes the workshop and the tour goes on to "Where next?". Outside the
 * tutorial the card is never drawn. The copy is plain: no em dash.
 *
 * The relay module is replaced: nothing here reaches a relay.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Host } from '../../test/elementRoot'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  return {
    ...real,
    publish: vi.fn(async () => ({ ok: true, accepted: [] })),
    publishMany: vi.fn(async () => ({ ok: true, accepted: [] })),
    query: vi.fn(async () => []),
  }
})
vi.mock('../../hooks/useMenuOpen', async (orig) => {
  const real = await orig<typeof import('../../hooks/useMenuOpen')>()
  return { ...real, setMenuOpen: vi.fn() }
})
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

const { mount, settled } = await import('../../test/elementRoot')
const { Workshop } = await import('../Workshop')
const { useWorkshop } = await import('../../store/useWorkshop')
const { useBeginner } = await import('../beginner')
const { ADVANCE_MS, runTutorialEffect, useTutorial } = await import('../../store/useTutorial')
const { TUTORIAL_SCRIPT, WORKSHOP } = await import('../../tutorial/script')
const { TIP_TEXT, WORKSHOP_STEP_ID, tipFor } = await import('../shell/TutorialTip')
const { newShard } = await import('sno-core/shards')
await import('../../tutorial/director')

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

function textOf(h: Host | string): string {
  if (typeof h === 'string') return h
  if (h.type === '#text') return String(h.props.text)
  if (h.type === 'kbd') return ''
  return h.children.map(textOf).join('')
}
const cls = (h: Host): string => String(h.props.className ?? '')
const byClass = (all: Host[], c: string): Host[] => all.filter((h) => cls(h).split(/\s+/).includes(c))
const tip = (all: Host[]): Host | null => byClass(all, 'ws__tuttip')[0] ?? null
const id = (): string | undefined => useTutorial.getState().script.steps[useTutorial.getState().index]?.id
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A piece the player found, as the tutorial copies it in (tutorial/director.ts copyTutorialShards). */
function trampoline() {
  const s = newShard('Trampoline')
  return {
    ...s,
    id: 'tutorial-trampoline',
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  if (typeof document === 'undefined') vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null })
  const s = trampoline()
  useWorkshop.setState({ open: false, shards: [s], currentId: s.id, tool: 'view', selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, past: [], future: [], openPanel: null, notice: null })
  useBeginner.setState({ tools: 'all', step: null, glow: null, done: true, uses: { view: 3, stamp: 3, select: 3, paint: 3, add: 3, face: 3 } })
  useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
})
afterEach(() => {
  useTutorial.getState().pause()
  useWorkshop.setState({ open: false })
  vi.unstubAllGlobals()
})

describe('the workshop step, walked', () => {
  it('opens the workshop with a tip for what to do first, then what next, and BACK TO THE TOUR goes on to "Where next?"', async () => {
    useTutorial.getState().start({ at: WORKSHOP_STEP_ID })
    expect(id()).toBe('workshop')
    // OPEN WORKSHOP in the coach, as the player taps it; the coach steps aside while the workshop is open.
    runTutorialEffect(WORKSHOP.action!.effect)
    useWorkshop.setState({ open: true, openPanel: 'menu' })
    const m = await mount(<Workshop />)
    await tick()
    expect(useWorkshop.getState().open).toBe(true)

    // MENU up: the pieces found are there; tap one.
    let card = tip(m.all())
    expect(card, 'a tip in the workshop on the tutorial step').not.toBeNull()
    expect(textOf(card!)).toContain(TIP_TEXT.menu)
    expect(textOf(card!)).toContain('BACK TO THE TOUR')
    expect(byClass(m.all(), 'ws__sheet').length).toBe(1)

    // A piece picked closes MENU: the tip moves on to what to try with it, in the same place.
    const close = m.all().find((h) => h.type === 'button' && /^Close MENU/i.test(String(h.props['aria-label'] ?? '')))
    expect(close, 'MENU has its close').toBeDefined()
    ;(close!.props.onClick as () => void)()
    await settled()
    await tick()
    card = tip(m.all())
    expect(card).not.toBeNull()
    expect(textOf(card!)).toContain(TIP_TEXT.bench)

    // The way back: BACK TO THE TOUR closes the workshop, and the tour goes on.
    expect(textOf(byClass(m.all(), 'ws__tuttip-back')[0])).toContain('BACK TO THE TOUR')
    await m.press('BACK TO THE TOUR')
    await tick()
    expect(useWorkshop.getState().open).toBe(false)
    expect(useTutorial.getState().done).toBe(true)
    await new Promise((r) => setTimeout(r, ADVANCE_MS + 50))
    expect(id()).toBe('choice')
    await m.unmount()
  })
})

describe('the tip, as written', () => {
  it('is drawn only on the tour workshop step, never outside the tour or while the eye is set', async () => {
    expect(tipFor(false, 'workshop', 'menu')).toBeNull()
    expect(tipFor(true, undefined, null)).toBeNull()
    expect(tipFor(true, 'workshop', 'menu')).toBe('menu')
    expect(tipFor(true, 'workshop', null)).toBe('bench')
    expect(tipFor(true, 'workshop', 'shard')).toBe('bench')
    expect(tipFor(true, 'workshop', null, true)).toBeNull()
    // BUILD's step says the workshop will not interrupt it: no card there.
    expect(tipFor(true, 'build-place', 'menu')).toBeNull()

    useTutorial.setState({ active: false })
    useWorkshop.setState({ open: true })
    const m = await mount(<Workshop />)
    await tick()
    expect(tip(m.all())).toBeNull()
    await m.unmount()
  })

  it('is plain and fits: no em dash, no jargon, four lines at most at 375px, white text in a kept four-line slot, clear of the rail', () => {
    for (const line of Object.values(TIP_TEXT)) {
      expect(line).not.toContain('—')
      expect(line).not.toMatch(/commit|shard|vertex|extent|sno/i)
      // About 25 characters a line in the narrowest card (a short phone, the rail folded to two columns): the owner's bench line (2026-11-23) takes four.
      expect(line.length).toBeLessThanOrEqual(100)
    }
    const rule = (sel: string): string => { const i = CSS.indexOf(sel); return CSS.slice(i, CSS.indexOf('}', i)) }
    expect(rule('.ws__tuttip-text {')).toContain('color: #fff')
    expect(rule('.ws__tuttip-text {')).toContain('min-height: calc(4 * 1.45em)')
    // One place in every state: under the top bar, clear of the rail, one column or folded to two.
    expect(rule('.ws__tuttip {')).toContain('top: calc(var(--ws-top-end) + 10px)')
    expect(rule('.ws__tuttip {')).toContain('left: calc(var(--ws-gutter) + 44px + 8px)')
    const short = CSS.slice(CSS.indexOf('@media (max-height: 700px) {\n  .ws__tuttip'))
    expect(short).toContain('.ws__tuttip { left: calc(var(--ws-gutter) + 94px + 8px); }')
    // The workshop's notices stand below it, never under it.
    expect(CSS).toContain('.workshop:has(.ws__tuttip) .ws__toast {')
    expect(CSS).toContain('.workshop:has(.ws__tuttip) .ws__storage {')
  })

  it("names ADD only where ADD is on the dock: the tour's workshop step shows all six tools to a beginner, without keeping the choice", async () => {
    expect(TIP_TEXT.bench).toBe("Drag to turn it. Tap STAMP to add pre-made shapes, or ADD to hand-craft your object's points.")
    const { dockShowsFour } = await import('../shell/Dock')
    expect(dockShowsFour('four', 'view', false)).toBe(true)
    expect(dockShowsFour('four', 'view', true)).toBe(false)
    expect(dockShowsFour('all', 'view', false)).toBe(false)
  })
})
