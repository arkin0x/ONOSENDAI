/**
 * modesHud.test.tsx - MODES on screen (hud/ModesPanel.tsx, hud/TouchControls.tsx;
 * owner, 2026-11-24):
 *
 * - the pad with the default list is today's: WALK in RECALL's slot, HOP
 *   (MODES) in the commit slot, and in WALK the dim HOP going back;
 * - with WALK first and BUILD second, the commit slot holds WALK lit, and
 *   RECALL's slot BUILD, dim to go in and lit to go back; in BUILD the mode
 *   button is the dim way back to WALK;
 * - the panel lists every mode in the player's order with what its place
 *   makes it, keeps the top mode's switch on, moves a mode with the up and
 *   down buttons, switches one off and back on, and RESET TO DEFAULT puts
 *   today's list back; no em dash in its words, and every row one height.
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
const rows = (): El[] => panel().filter((e) => e.type === 'li')
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

  it('with WALK first and BUILD second: WALK lit in the commit slot, BUILD in RECALL\'s', () => {
    updateModes((s) => moveModeTo(moveModeTo(s, 'walk', 0), 'build', 1))
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
  it('lists every mode in order with what its place makes it', () => {
    expect(rows().map((r) => r.props['data-mode'])).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
    const roles = rows().map((r) => words(r.props.children))
    expect(roles[0]).toContain('Starts in')
    expect(roles[1]).toContain('Second button')
    expect(roles[2]).toContain('Mode button')
    // The modes with their own keys print them.
    expect(words(inRow('build', 'modes__key').props.children)).toBe('B')
    expect(words(inRow('scan', 'modes__key').props.children)).toBe('N')
    expect(words(inRow('walk', 'modes__key').props.children)).toBe('')
    expect(words(inRow('terrain', 'modes__key').props.children)).toBe('T')
    expect(panel().some((e) => words(e.props.children) === MODES_HINT)).toBe(true)
  })

  it('the top mode\'s switch is on and cannot be turned off; the others can', () => {
    expect(inRow('hop', 'modes__switch').props.disabled).toBe(true)
    expect(inRow('hop', 'modes__switch').props.checked).toBe(true)
    expect(inRow('walk', 'modes__switch').props.disabled).toBe(false)
    ;(inRow('walk', 'modes__switch').props.onCheckedChange as (on: boolean) => void)(false)
    expect(storedModes().off).toEqual(['walk'])
    expect(words(rowOf('walk').props.children)).toContain('Off')
    expect(has(rowOf('walk'), 'is-off')).toBe(true)
    // TERRAIN is the second button now.
    expect(words(rowOf('terrain').props.children)).toContain('Second button')
    ;(inRow('walk', 'modes__switch').props.onCheckedChange as (on: boolean) => void)(true)
    expect(storedModes()).toEqual(DEFAULT_MODES)
  })

  it('moves a mode with the up and down buttons, disabled at the ends', () => {
    expect(inRow('hop', 'modes__up').props.disabled).toBe(true)
    expect(inRow('scan', 'modes__down').props.disabled).toBe(true)
    ;(inRow('walk', 'modes__up').props.onClick as () => void)()
    expect(storedModes().order).toEqual(['walk', 'hop', 'terrain', 'view', 'build', 'scan'])
    expect(words(rowOf('walk').props.children)).toContain('Starts in')
    ;(inRow('build', 'modes__down').props.onClick as () => void)()
    expect(storedModes().order).toEqual(['walk', 'hop', 'terrain', 'view', 'scan', 'build'])
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
})
