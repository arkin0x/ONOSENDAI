/**
 * walkLimits.test.tsx - WALK's sync limit as a setting (arkinox, 2026-11-18:
 * "maybe sync loss warning should be a setting ... maybe below the red chain
 * sync warning box it can say 'turn off this warning in settings'").
 *
 * - on by default, exactly as before: the slowdown from 15, the stop at 20,
 *   the LOSING SYNC warning;
 * - off: no slowdown, no stop, no warning, and the CHAIN chip still counts;
 * - the choice is kept in the existing settings store (store/useLayers.ts)
 *   across a reload;
 * - the line under the warning opens the menu at that switch, unfolding
 *   Settings, and moves nothing on the page when it appears.
 *
 * The walk itself at 20 ahead with the limit off is walkFluid.test.ts.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settled, type Host } from '../../test/elementRoot'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
const menu = vi.hoisted(() => ({ opened: [] as boolean[] }))
vi.mock('../../hooks/useMenuOpen', async (orig) => ({ ...(await orig() as object), setMenuOpen: (open: boolean) => { menu.opened.push(open) } }))

import { SyncWarning } from '../SyncWarning'
import { WALK_LIMITS_HINT } from '../ViewPanel'
import { WALK_LIMITS_ROW, openSettingAt } from '../settingsLink'
import { aheadLabel } from '../ChainAhead'
import { DEFAULT_LAYERS, LAYERS_KEY, loadLayers, useLayers } from '../../store/useLayers'
import { usePanelLayout } from '../../store/usePanelLayout'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { walkSpeedFactor, walkWarnOpacity } from '../../store/walkLimits'
import { FLUID_EASE_FROM, FLUID_HOLD_AT, syncSpeedFactor, syncWarnOpacity } from '../../lib/fluidWalk'

/** The page as the warning's line looks it up: the one switch it opens at, scrolled to and focused. */
const row = { scrolled: 0, focused: 0 }
;(globalThis as { document?: unknown }).document = {
  getElementById: (id: string) => id === WALK_LIMITS_ROW ? { scrollIntoView: () => { row.scrolled++ }, focus: () => { row.focused++ } } : null,
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

const panel = (all: Host[]): Host => all.find((h) => String(h.props.className ?? '').split(' ').includes('syncwarn'))!

beforeEach(() => {
  localStorage.removeItem(LAYERS_KEY)
  useLayers.setState({ ...loadLayers() })
  menu.opened.length = 0
  row.scrolled = 0
  row.focused = 0
})

afterEach(() => {
  useCyberspace.setState({ walking: false })
  useWalk.setState({ behind: 0, open: null })
})

describe('the setting', () => {
  it('is on by default, as WALK always was: the speed and the warning go by the slowdown', () => {
    expect(DEFAULT_LAYERS.walkLimits).toBe(true)
    expect(useLayers.getState().walkLimits).toBe(true)
    for (const n of [0, FLUID_EASE_FROM, 15, 17, 19, FLUID_HOLD_AT, 30]) {
      expect(walkSpeedFactor(n)).toBe(syncSpeedFactor(n))
      expect(walkWarnOpacity(n)).toBe(syncWarnOpacity(n))
    }
    expect(walkSpeedFactor(FLUID_HOLD_AT)).toBe(0)
  })

  it('off: full speed and no warning however far ahead', () => {
    useLayers.getState().setLayer('walkLimits', false)
    for (const n of [0, 15, 19, FLUID_HOLD_AT, 40, 200]) {
      expect(walkSpeedFactor(n)).toBe(1)
      expect(walkWarnOpacity(n)).toBe(0)
    }
  })

  it('is kept across a reload, in the settings store that already holds the other switches', () => {
    useLayers.getState().setLayer('walkLimits', false)
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY)!) as Record<string, unknown>
    expect(saved.walkLimits).toBe(false)
    // The other switches are saved alongside, untouched.
    expect(saved.glow).toBe(true)
    expect(loadLayers().walkLimits).toBe(false)
    useLayers.getState().setLayer('walkLimits', true)
    expect(loadLayers().walkLimits).toBe(true)
    // An old save without it reads on.
    localStorage.setItem(LAYERS_KEY, JSON.stringify({ dots: false }))
    expect(loadLayers()).toMatchObject({ dots: false, walkLimits: true })
  })

  it('says what it does and the risk, with no em dash', () => {
    expect(WALK_LIMITS_HINT).toContain('slows at 15')
    expect(WALK_LIMITS_HINT).toContain('stops at 20')
    expect(WALK_LIMITS_HINT).toContain('If your chain falls far behind and something interrupts it, like closing the tab or losing connection, moves that have not reached your chain can be lost.')
    expect(WALK_LIMITS_HINT).not.toMatch(/—/)
  })

  it('off, the CHAIN chip still counts how far ahead, and names no stop', () => {
    expect(aheadLabel(22)).toBe(' 22 moves ahead of your chain. The walk stops at 20.')
    expect(aheadLabel(22, false)).toBe(' 22 moves ahead of your chain. The sync limit is off.')
    expect(aheadLabel(0, false)).toBe('')
  })
})

describe('the LOSING SYNC warning', () => {
  /** Walking, `n` events ahead (the open segment is one of them). */
  const ahead = (n: number): void => {
    useCyberspace.setState({ walking: true })
    useWalk.setState({ open: null, behind: n })
  }

  it('shows at 20 ahead with the limit on, with its line under it; never with it off', async () => {
    ahead(FLUID_HOLD_AT)
    const m = await mount(<SyncWarning />)
    expect(panel(m.all()).props.style).toEqual({ opacity: 1 })
    const [line] = m.buttons('Turn off this warning in settings')
    expect(line).toBeDefined()
    expect(line.props.tabIndex).toBe(0)
    useLayers.getState().setLayer('walkLimits', false)
    await settled()
    expect(panel(m.all()).props.style).toEqual({ opacity: 0 })
    expect(m.buttons('Turn off this warning in settings')[0].props.tabIndex).toBe(-1)
    await m.unmount()
  })

  it('the line is always drawn, so nothing moves when the warning comes up, and the stylesheet keeps it out of the layout', async () => {
    ahead(0)
    const m = await mount(<SyncWarning />)
    expect(panel(m.all()).props.style).toEqual({ opacity: 0 })
    expect(m.buttons('Turn off this warning in settings')).toHaveLength(1)
    await m.unmount()
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.syncwarn__off {'), css.indexOf('}', css.indexOf('.syncwarn__off {')))
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('pointer-events: none')
    expect(css).toContain('.syncwarn.is-on .syncwarn__off { pointer-events: auto; }')
  })

  it('the line opens the menu at the sync limit switch, unfolding Settings', async () => {
    usePanelLayout.setState({ collapsed: { view: true } })
    ahead(FLUID_HOLD_AT)
    const m = await mount(<SyncWarning />)
    await m.press('Turn off this warning in settings')
    await settled()
    expect(menu.opened).toEqual([true])
    expect(usePanelLayout.getState().collapsed.view).toBeFalsy()
    expect(row.scrolled).toBe(1)
    expect(row.focused).toBe(1)
    // Nothing is switched for you.
    expect(useLayers.getState().walkLimits).toBe(true)
    await m.unmount()
  })

  it('an unfolded Settings stays unfolded', async () => {
    usePanelLayout.setState({ collapsed: {} })
    openSettingAt(WALK_LIMITS_ROW)
    await settled()
    expect(usePanelLayout.getState().collapsed.view).toBeFalsy()
    expect(row.focused).toBe(1)
  })
})
