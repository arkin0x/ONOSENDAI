/**
 * modeHotkeys.test.tsx - the mode keys and the menu key (owner, 2026-11-24:
 * "H = HOP, V = VIEW, Y = WALK", and "M toggles the menu open and closed"),
 * through the real keyboard path (hooks/useKeyboard.ts) on a stand-in window:
 *
 * - H, V and Y go straight into their mode, turned off in MODES or not, as
 *   B and N do (owner: off is "not part of the rotation"); the newcomer view
 *   and a tour run follow the default list; TV hears no keys; a field being
 *   typed in keeps its letters;
 * - they move the ring and the toggle no more than B and N: out of WALK by
 *   Y's way in, the dim way back is the mode it came from;
 * - the hyperspace line scrubber moved from H to L;
 * - Ctrl+V, Ctrl+Y and Shift with them are not ours;
 * - M opens and shuts the menu, lets go of a captured mouse as it opens and
 *   never captures it again, and is not ours in a field or the workshop.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

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
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
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

import { mount, settled, type Mounted } from '../../test/elementRoot'
import { useKeyboard } from '../useKeyboard'
import { useMenuIsOpen, useMenuOpen } from '../useMenuOpen'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import { useScan } from '../../store/useScan'
import { useWalk } from '../../store/useWalk'
import { useShards } from '../../store/useShards'
import { useTutorial } from '../../store/useTutorial'
import { useTv } from '../../store/useTv'
import { useWorkshop } from '../../store/useWorkshop'
import { useHyperspace } from '../../store/useHyperspace'
import { useNewcomer } from '../../newcomer/useNewcomer'
import { backOf, currentPadMode, cycleMode, modeKeyAllowed, switchMode, watchLastRing } from '../../store/padMode'
import { MODES, resetModes, setModeOn, updateModes, useModes } from '../../store/modeOrder'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

const S = () => useCyberspace.getState()

type Listener = (e: unknown) => void
const listeners = new Map<string, Set<Listener>>()
const target = { tagName: 'CANVAS', closest: () => null }
const field = { tagName: 'INPUT', closest: () => null }
/** A key pressed on `on`, as the browser sends it. */
function press(code: string, on: object = target, mods: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}): void {
  const e = { code, key: code.replace(/^Key/, '').toLowerCase(), target: on, repeat: false, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods, preventDefault: () => { e.defaultPrevented = true } }
  for (const f of listeners.get('keydown') ?? []) f(e)
}
const exitPointerLock = vi.fn()
let locked: object | null = null

function Keys(): null { useKeyboard(); return null }
function Menu(): null { useMenuOpen(false); return null }

let mounted: Mounted | null = null
let stopRing: () => void = () => {}

beforeEach(async () => {
  listeners.clear()
  const on = (t: string, f: Listener) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f) }
  const off = (t: string, f: Listener) => { listeners.get(t)?.delete(f) }
  vi.stubGlobal('window', { addEventListener: on, removeEventListener: off })
  exitPointerLock.mockClear()
  locked = null
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, get pointerLockElement() { return locked }, exitPointerLock: () => { exitPointerLock(); locked = null }, hidden: false })
  stopRing()
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', deployError: null })
  useWalk.getState().exit()
  useBuilder.getState().exit()
  useScan.getState().exit()
  S().clearFocus()
  useTutorial.setState({ active: false })
  useTv.setState({ on: false })
  useWorkshop.setState({ open: false })
  useNewcomer.setState({ record: { seen: [] } })
  await placeSpawn()
  S().cancel()
  resetModes()
  useModes.setState({ back: null, lastRing: null })
  stopRing = watchLastRing()
  localStorage.removeItem('onosendai:menu-open')
  useMenuIsOpen.setState({ open: false, toggleable: true })
  mounted = await mount(createElement(() => { Keys(); Menu(); return null }))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  vi.unstubAllGlobals()
})

describe('H, V, Y', () => {
  it('are the keys MODES shows for HOP, VIEW and WALK, beside B and N', () => {
    const keys = Object.fromEntries(MODES.map((m) => [m.id, m.key]))
    expect(keys).toMatchObject({ hop: 'H', view: 'V', walk: 'Y', build: 'B', scan: 'N' })
  })

  it('go straight into their mode, from any mode', () => {
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    press('KeyH')
    expect(currentPadMode()).toBe('hop')
    press('KeyY')
    expect(currentPadMode()).toBe('walk')
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    press('KeyB')
    expect(currentPadMode()).toBe('build')
    press('KeyH')
    expect(currentPadMode()).toBe('hop')
    // In it already: nothing.
    press('KeyH')
    expect(currentPadMode()).toBe('hop')
  })

  it('move the ring and the toggle no more than B and N: out of WALK, back to the mode Y came from', () => {
    switchMode('view')
    press('KeyY')
    expect(currentPadMode()).toBe('walk')
    expect(useWalk.getState().from).toBe('view')
    cycleMode()
    expect(currentPadMode()).toBe('view')
    // The toggle slot is BUILD, the ring on SCAN: V into VIEW, the dim button back to SCAN.
    updateModes(() => ({ order: ['build', 'hop', 'view', 'scan', 'walk'], off: [] }))
    switchMode('scan')
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    expect(useModes.getState().lastRing).toBe('view')
    expect(backOf('build')).toBe('view')
  })

  it('open a mode turned off in MODES too, as B and N do: off is only out of the turns', () => {
    updateModes((s) => setModeOn(setModeOn(setModeOn(s, 'view', false), 'walk', false), 'build', false))
    expect(modeKeyAllowed('view')).toBe(true)
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    press('KeyH')
    expect(currentPadMode()).toBe('hop')
    press('KeyY')
    expect(currentPadMode()).toBe('walk')
    press('KeyH')
    press('KeyB')
    expect(currentPadMode()).toBe('build')
    press('KeyH')
    expect(currentPadMode()).toBe('hop')
    // Still out of the turns: the mode button passes over them.
    cycleMode()
    expect(currentPadMode()).toBe('scan')
  })

  it('follow the default list in the newcomer view and a tour run, and nothing in TV', () => {
    updateModes((s) => setModeOn(s, 'view', false))
    useNewcomer.setState({ record: { stage: 'newcomer', seen: [] } })
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    press('KeyH')
    useNewcomer.setState({ record: { seen: [] } })
    useTutorial.setState({ active: true })
    press('KeyV')
    expect(currentPadMode()).toBe('view')
    press('KeyH')
    useTutorial.setState({ active: false })
    useTv.setState({ on: true })
    press('KeyV')
    expect(currentPadMode()).toBe('hop')
  })

  it('are a field\'s letters while typing, and Ctrl or Shift with them is not ours', () => {
    press('KeyV', field)
    press('KeyY', field)
    expect(currentPadMode()).toBe('hop')
    press('KeyV', target, { ctrlKey: true })
    press('KeyY', target, { metaKey: true })
    press('KeyV', target, { shiftKey: true })
    expect(currentPadMode()).toBe('hop')
  })

  it('go into VIEW or WALK only at rest, as the pad offers them: not with a hop lined up, a proof computing or a placement pending', () => {
    S().moveCursor({ axis: 'x', dir: 1 })
    press('KeyY')
    press('KeyV')
    expect(currentPadMode()).toBe('hop')
    S().cancel()
    useCyberspace.setState({ proof: { ...S().proof, status: 'computing' } })
    try {
      press('KeyY')
      press('KeyV')
      expect(currentPadMode()).toBe('hop')
    } finally { useCyberspace.setState({ proof: { ...S().proof, status: 'idle' } }) }
    useShards.setState({ pending: {} as never })
    try {
      press('KeyY')
      press('KeyV')
      expect(currentPadMode()).not.toBe('walk')
      expect(currentPadMode()).not.toBe('view')
    } finally { useShards.setState({ pending: null }); useBuilder.getState().exit() }
    press('KeyH')
    press('KeyY')
    expect(currentPadMode()).toBe('walk')
  })

  it('out of WALK with steps still to prove: the first press stops them, the second leaves, as X does', () => {
    press('KeyY')
    expect(currentPadMode()).toBe('walk')
    useWalk.setState({ behind: 2 })
    const stop = vi.spyOn(useWalk.getState(), 'stop').mockImplementation(() => { useWalk.setState({ behind: 0 }) })
    try {
      press('KeyH')
      expect(stop).toHaveBeenCalledTimes(1)
      expect(currentPadMode()).toBe('walk')
      press('KeyH')
      expect(currentPadMode()).toBe('hop')
    } finally { stop.mockRestore() }
  })

  it('a focused select or an editable element keeps its letters', () => {
    press('KeyV', { tagName: 'SELECT', closest: () => null })
    press('KeyV', { tagName: 'DIV', isContentEditable: true, closest: () => null })
    expect(currentPadMode()).toBe('hop')
  })

  it('in the workshop are the bench\'s, not ours', () => {
    useWorkshop.setState({ open: true })
    press('KeyV')
    expect(currentPadMode()).toBe('hop')
  })
})

describe('the hyperspace line scrubber', () => {
  it('opens and shuts with L now; H is HOP', () => {
    useHyperspace.setState({ scrubHeight: null })
    press('KeyH')
    expect(useHyperspace.getState().scrubHeight).toBeNull()
    press('KeyL')
    expect(useHyperspace.getState().scrubHeight).not.toBeNull()
    press('KeyL')
    expect(useHyperspace.getState().scrubHeight).toBeNull()
  })
})

describe('M', () => {
  it('opens and shuts the menu', async () => {
    expect(useMenuIsOpen.getState().open).toBe(false)
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(true)
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(false)
  })

  it('lets go of a captured mouse as the menu opens, and never captures it again as it shuts', async () => {
    locked = { tagName: 'CANVAS' }
    press('KeyM')
    await settled()
    expect(exitPointerLock).toHaveBeenCalledTimes(1)
    expect(locked).toBeNull()
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(false)
    expect(locked).toBeNull()
    expect(exitPointerLock).toHaveBeenCalledTimes(1)
  })

  it('does nothing where the hamburger cannot (spectating, the newcomer view before the menu is shown), or over a dialog', async () => {
    useMenuIsOpen.setState({ toggleable: false })
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(false)
    useMenuIsOpen.setState({ toggleable: true })
    const doc = document as unknown as { querySelector?: (s: string) => unknown }
    doc.querySelector = (sel: string) => (sel === '[aria-modal="true"]' ? {} : null)
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(false)
    delete doc.querySelector
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(true)
  })

  it('is a field\'s letter while typing, and not ours over the workshop', async () => {
    press('KeyM', field)
    useWorkshop.setState({ open: true })
    press('KeyM')
    await settled()
    expect(useMenuIsOpen.getState().open).toBe(false)
  })
})

/** The main keymap and WALK's hold no other meaning for H, V, Y or M. */
describe('no collisions', () => {
  it('H, V, Y and M are nobody else\'s in the main keymap', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../useKeyboard.ts'), 'utf8')
    for (const code of ['KeyH', 'KeyV', 'KeyY', 'KeyM'] as const) {
      // Only the one place that answers each: the mode keys come from padMode's map, M has its own line.
      expect(src.match(new RegExp(`'${code}'`, 'g'))?.length ?? 0, code).toBe(code === 'KeyM' ? 1 : 0)
    }
    const walkKeys = readFileSync(resolve(__dirname, '../../lib/walkKeys.ts'), 'utf8')
    for (const code of ['KeyH', 'KeyV', 'KeyY', 'KeyM']) expect(walkKeys.includes(code), code).toBe(false)
  })
})

