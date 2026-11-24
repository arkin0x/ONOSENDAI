/**
 * modesHud.test.tsx - MODES on screen (hud/ModesPanel.tsx, hud/TouchControls.tsx;
 * owner, 2026-11-24):
 *
 * - the pad with the default list is today's: WALK in RECALL's slot, HOP
 *   (MODES) in the commit slot, and in WALK the dim HOP going back;
 * - with WALK the default mode and BUILD the toggle, the commit slot holds
 *   WALK lit, and RECALL's slot BUILD, dim to go in and lit to go back; in
 *   BUILD the mode button is the dim way back to WALK;
 * - the panel lists the Toggle Mode first, a rule under it, then the ring
 *   with the Default Mode first (owner, 2026-11-24), keeps the default
 *   mode's switch on, moves a mode with the up and down buttons (trading
 *   with the toggle slot across the rule), drags a mode into the toggle
 *   slot, switches one off and back on, and RESET TO DEFAULT puts today's
 *   list back; no em dash in its words, and every row one height.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  ;(globalThis as { window?: unknown }).window ??= globalThis
})
vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))
// A server render reads a zustand store's initial state; here each hook reads the live state.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { TouchControls } from '../TouchControls'
import { ModesPanel, MODES_HINT, dropIndex } from '../ModesPanel'
import { MODES_PREFIX } from '../../store/modeOrder'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import { useScan } from '../../store/useScan'
import { useWalk } from '../../store/useWalk'
import { useShards } from '../../store/useShards'
import { currentPadMode, switchMode } from '../../store/padMode'
import { DEFAULT_MODES, moveModeTo, resetModes, storedModes, updateModes, useModes } from '../../store/modeOrder'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

const S = () => useCyberspace.getState()

type El = ReactElement<Record<string, unknown> & { className?: string; children?: ReactNode }>

/** Every element a component draws itself, its hooks run inside a render. */
function drawn(component: () => JSX.Element): El[] {
  let out: ReactNode = null
  renderToString(createElement(() => { out = component(); return null }))
  const all: El[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!isValidElement(n)) return
    all.push(n as El)
    walk((n as El).props.children)
  }
  walk(out)
  return all
}
const words = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(words).join('')
  if (isValidElement(n)) return words((n as El).props.children)
  return ''
}
const has = (el: El, cls: string): boolean => (el.props.className ?? '').split(' ').includes(cls)
const pad = (): El[] => drawn(TouchControls)
const slot = (cls: string): El => {
  const b = pad().find((x) => x.type === 'button' && has(x, cls))
  if (!b) throw new Error(`no ${cls}`)
  return b
}
const pressPad = (b: El): void => { (b.props.onPointerDown as (e: unknown) => void)({ preventDefault: () => {}, stopPropagation: () => {} }) }
const panel = (): El[] => drawn(ModesPanel)
const rows = (): El[] => panel().filter((e) => e.type === 'li' && e.props['data-mode'] !== undefined)
const rowOf = (id: string): El => rows().find((r) => r.props['data-mode'] === id)!
const inRow = (id: string, cls: string): El => {
  const found: El[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!isValidElement(n)) return
    found.push(n as El)
    walk((n as El).props.children)
  }
  walk(rowOf(id).props.children)
  const el = found.find((e) => has(e, cls))
  if (!el) throw new Error(`no ${cls} in ${id}`)
  return el
}

beforeEach(async () => {
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle' })
  useWalk.getState().exit()
  useBuilder.getState().exit()
  useScan.getState().exit()
  S().clearFocus()
  await placeSpawn()
  S().cancel()
  resetModes()
  useModes.setState({ back: null, lastRing: null })
})

describe('the pad', () => {
  it('with the default list is today\'s', () => {
    const walk = slot('touchops__walk')
    expect(words(walk.props.children)).toBe('WALK')
    expect(has(walk, 'is-dim')).toBe(true)
    const mode = slot('is-hop')
    expect(words(mode.props.children)).toBe('HOP(MODES)')
    expect(pad().some((x) => has(x, 'touchops__second'))).toBe(false)
    pressPad(walk)
    expect(currentPadMode()).toBe('walk')
    const back = slot('is-hop')
    expect(has(back, 'is-on')).toBe(false)
    expect(back.props.title).toBe('Leave WALK and go back to HOP')
    expect(has(slot('touchops__walk'), 'is-on')).toBe(true)
  })

  it('with WALK the default mode and BUILD the toggle: WALK lit in the commit slot, BUILD in RECALL\'s', () => {
    updateModes((s) => moveModeTo(moveModeTo(s, 'build', 0), 'walk', 1))
    switchMode('walk')
    const mode = slot('is-walk')
    expect(has(mode, 'is-on')).toBe(true)
    expect(words(mode.props.children)).toBe('WALK(MODES)')
    expect(mode.props.title).toMatch(/Press for HOP$/)
    const second = slot('touchops__second')
    expect(has(second, 'is-build')).toBe(true)
    expect(has(second, 'is-dim')).toBe(true)
    expect(words(second.props.children)).toBe('BUILD')
    pressPad(second)
    expect(currentPadMode()).toBe('build')
    // In BUILD, the second button lit and the mode button the dim way back to WALK.
    expect(has(slot('touchops__second'), 'is-on')).toBe(true)
    const back = slot('is-walk')
    expect(has(back, 'is-on')).toBe(false)
    expect(back.props.title).toBe('Leave BUILD and go back to WALK')
    pressPad(back)
    expect(currentPadMode()).toBe('walk')
    // The ring goes on to HOP.
    pressPad(slot('is-walk'))
    expect(currentPadMode()).toBe('hop')
    expect(words(slot('is-hop').props.children)).toBe('HOP')
  })
})

describe('the MODES panel', () => {
  it('the Toggle Mode first, a rule under it, then the Default Mode and the rest of the ring', () => {
    expect(rows().map((r) => r.props['data-mode'])).toEqual(['walk', 'hop', 'view', 'build', 'scan'])
    const items = panel().filter((e) => e.type === 'li')
    expect(items[1].props.className).toBe('modes__rule')
    expect(items[1].props['aria-hidden']).toBe(true)
    expect(items.filter((e) => has(e, 'modes__rule'))).toHaveLength(1)
    expect(panel().some((e) => e.type === 'hr')).toBe(true)
    const roles = rows().map((r) => words(r.props.children))
    expect(roles[0]).toContain('Toggle Mode')
    expect(roles[1]).toContain('Default Mode')
    expect(roles[2]).toContain('Mode button')
    // The owner's words only: no "starts in", no "second button".
    expect(roles.join(' ')).not.toMatch(/starts in|second button/i)
    // The modes with their own keys print them.
    expect(words(inRow('build', 'modes__key').props.children)).toBe('B')
    expect(words(inRow('scan', 'modes__key').props.children)).toBe('N')
    expect(words(inRow('walk', 'modes__key').props.children)).toBe('')
    expect(panel().some((e) => words(e.props.children) === MODES_HINT)).toBe(true)
  })

  it('the default mode\'s switch is on and cannot be turned off; the toggle\'s can, which leaves no second button', () => {
    expect(inRow('hop', 'modes__switch').props.disabled).toBe(true)
    expect(inRow('hop', 'modes__switch').props.checked).toBe(true)
    expect(inRow('walk', 'modes__switch').props.disabled).toBe(false)
    ;(inRow('walk', 'modes__switch').props.onCheckedChange as (on: boolean) => void)(false)
    expect(storedModes().off).toEqual(['walk'])
    expect(words(rowOf('walk').props.children)).toContain('Toggle Mode: off')
    expect(has(rowOf('walk'), 'is-off')).toBe(true)
    expect(pad().some((x) => has(x, 'touchops__walk') || has(x, 'touchops__second'))).toBe(false)
    ;(inRow('walk', 'modes__switch').props.onCheckedChange as (on: boolean) => void)(true)
    expect(storedModes()).toEqual(DEFAULT_MODES)
    ;(inRow('view', 'modes__switch').props.onCheckedChange as (on: boolean) => void)(false)
    expect(words(rowOf('view').props.children)).toContain('Off')
  })

  it('moves a mode with the up and down buttons, across the rule by trading with the toggle, disabled at the ends', () => {
    expect(inRow('walk', 'modes__up').props.disabled).toBe(true)
    expect(inRow('scan', 'modes__down').props.disabled).toBe(true)
    ;(inRow('hop', 'modes__up').props.onClick as () => void)()
    expect(storedModes().order).toEqual(['hop', 'walk', 'view', 'build', 'scan'])
    expect(words(rowOf('hop').props.children)).toContain('Toggle Mode')
    expect(words(rowOf('walk').props.children)).toContain('Default Mode')
    ;(inRow('build', 'modes__down').props.onClick as () => void)()
    expect(storedModes().order).toEqual(['hop', 'walk', 'view', 'scan', 'build'])
  })

  it('a drag into the toggle slot trades the two; each place is worked out from the list as the drag began', () => {
    // Rows 58px apart, the rule 15px under the first; the list at the top of the screen.
    const ids = ['walk', 'hop', 'view', 'build', 'scan']
    const tops = [0, 73, 131, 189, 247]
    const list = {
      getBoundingClientRect: () => ({ top: 0 }),
      setPointerCapture: () => {},
      querySelectorAll: () => ids.map((id, i) => ({ dataset: { mode: id }, getBoundingClientRect: () => ({ top: tops[i], height: 52 }) })),
    }
    // One render's handlers, its list ref pointed at that list.
    const all = drawn(ModesPanel)
    const ol = all.find((e) => e.type === 'ol')!
    const ref = ((ol as unknown as { ref?: { current: unknown } }).ref ?? ol.props.ref) as { current: unknown }
    ref.current = list
    const grip = all.find((e) => e.type === 'button' && has(e, 'modes__grip') && String(e.props['aria-label']).startsWith('Move SCAN'))!
    ;(grip.props.onPointerDown as (e: unknown) => void)({ button: 0, pointerId: 1, preventDefault: () => {} })
    const moveTo = (clientY: number): void => { (ol.props.onPointerMove as (e: unknown) => void)({ pointerId: 1, clientY }) }
    // Up over the toggle slot: SCAN and WALK trade.
    moveTo(10)
    expect(storedModes().order).toEqual(['scan', 'hop', 'view', 'build', 'walk'])
    // Down again over the ring: from the list as it began, SCAN slides in the ring, WALK back in its slot.
    moveTo(140)
    expect(storedModes().order).toEqual(['walk', 'hop', 'scan', 'view', 'build'])
    moveTo(10)
    ;(ol.props.onPointerUp as (e: unknown) => void)({ pointerId: 1 })
    expect(storedModes().order).toEqual(['scan', 'hop', 'view', 'build', 'walk'])
    expect(words(rowOf('scan').props.children)).toContain('Toggle Mode')
    expect(words(rowOf('walk').props.children)).toContain('Mode button')
  })

  it('RESET TO DEFAULT puts today\'s list back, and waits while it already is', () => {
    const reset = (): El => panel().find((e) => e.type === 'button' && has(e, 'modes__reset'))!
    expect(reset().props.disabled).toBe(true)
    updateModes((s) => moveModeTo(s, 'scan', 0))
    expect(reset().props.disabled).toBe(false)
    ;(reset().props.onClick as () => void)()
    expect(storedModes()).toEqual(DEFAULT_MODES)
  })

  it('a drag lands a row before the first other row whose middle is below the pointer', () => {
    const r = ['hop', 'walk', 'view', 'build', 'scan'].map((id, i) => ({ id, top: i * 58, height: 52 }))
    expect(dropIndex(r, 'scan', 0)).toBe(0)
    expect(dropIndex(r, 'scan', 30)).toBe(1)
    expect(dropIndex(r, 'hop', 210)).toBe(3)
    expect(dropIndex(r, 'hop', 999)).toBe(4)
  })

  it('no em dash in its words; every row one height; the grip takes no scroll', () => {
    const src = readFileSync(resolve(__dirname, '../ModesPanel.tsx'), 'utf8')
    expect(src.includes('—')).toBe(false)
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    expect(css).toMatch(/\.modes__row \{[^}]*height: var\(--modes-row-h\);/)
    expect(css).toMatch(/\.modes__grip \{[^}]*touch-action: none;/)
  })

  it('a list kept before the toggle slot shows the same pad: its old first the Default Mode, its old second the Toggle Mode', () => {
    const me = useCyberspace.getState().identity.pubkey
    localStorage.setItem(MODES_PREFIX + me, JSON.stringify({ v: 1, order: ['walk', 'build', 'hop', 'view', 'scan'], off: [] }))
    useModes.setState({ pubkey: null })
    expect(rows().map((r) => r.props['data-mode'])).toEqual(['build', 'walk', 'hop', 'view', 'scan'])
    expect(words(rowOf('build').props.children)).toContain('Toggle Mode')
    expect(words(rowOf('walk').props.children)).toContain('Default Mode')
  })
})
