/**
 * walkLimits.test.tsx - WALK's sync limit as a setting (arkinox, 2026-11-18:
 * "maybe sync loss warning should be a setting ... maybe below the red chain
 * sync warning box it can say 'turn off this warning in settings'"), the
 * fluid pause's switch since 2026-11-22 ("Pause fluid walk when your chain
 * falls behind", renamed Optimize chain when Settings was grouped that day).
 *
 * - on by default; the slowdown and the LOSING SYNC warning are parked
 *   (store/walkLimits.ts SYNC_SLOWDOWN_ON): nothing slows, nothing warns,
 *   and the warning and its line are not on the page;
 * - switched back on (the test seam), the slowdown from 15 and the warning
 *   work as before, with no stop at 20;
 * - off: no slowdown, no warning, and the CHAIN chip still counts;
 * - the choice is kept in the existing settings store (store/useLayers.ts)
 *   across a reload;
 * - the line under the warning opens the menu at that switch, unfolding
 *   Settings, and moves nothing on the page when it appears.
 *
 * The fluid pause itself, and the walk with the limit off, are walkFluid.test.ts.
 */
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { SYNCWARN_TAP_FROM, SyncWarning, useSyncWarnAside } from '../SyncWarning'
import { WALK_LIMITS_HINT, WALK_LIMITS_TITLE } from '../ViewPanel'
import { WALK_LIMITS_ROW, openSettingAt } from '../settingsLink'
import { aheadBar, aheadLabel, tickClass } from '../ChainAhead'
import { DEFAULT_LAYERS, LAYERS_KEY, loadLayers, useLayers } from '../../store/useLayers'
import { usePanelLayout } from '../../store/usePanelLayout'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { SYNC_SLOWDOWN_ON, walkSpeedFactor, walkWarnOpacity } from '../../store/walkLimits'
import { FLUID_EASE_FROM, FLUID_HOLD_AT, FLUID_PAUSE_AT, syncSpeedFactor, syncWarnOpacity } from '../../lib/fluidWalk'

/** The parked slowdown and warning (store/walkLimits.ts SYNC_SLOWDOWN_ON) switched on or back to the flag. */
const slowdown = (on: boolean | null): void => {
  const g = globalThis as { __ONOSENDAI_SYNC_SLOWDOWN__?: boolean }
  if (on === null) delete g.__ONOSENDAI_SYNC_SLOWDOWN__
  else g.__ONOSENDAI_SYNC_SLOWDOWN__ = on
}

/** The page as the warning's line looks it up: the one switch it opens at, scrolled to and focused, drawn after `missing` more looks (the menu still opening). */
const row = { scrolled: 0, focused: 0, missing: 0 }
const pageBefore = (globalThis as { document?: unknown }).document
;(globalThis as { document?: unknown }).document = {
  getElementById: (id: string) => {
    if (id !== WALK_LIMITS_ROW) return null
    if (row.missing > 0) { row.missing--; return null }
    return { scrollIntoView: () => { row.scrolled++ }, focus: () => { row.focused++ } }
  },
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

const panel = (all: Host[]): Host => all.find((h) => String(h.props.className ?? '').split(' ').includes('syncwarn'))!

afterAll(() => { (globalThis as { document?: unknown }).document = pageBefore })

beforeEach(() => {
  localStorage.removeItem(LAYERS_KEY)
  useLayers.setState({ ...loadLayers() })
  menu.opened.length = 0
  row.scrolled = 0
  row.focused = 0
  row.missing = 0
  useSyncWarnAside.setState({ aside: false })
})

afterEach(() => {
  useCyberspace.setState({ walking: false })
  useWalk.setState({ behind: 0, open: null })
})

describe('the setting', () => {
  it('is on by default; the slowdown and the warning are parked, so nothing slows or warns', () => {
    expect(DEFAULT_LAYERS.walkLimits).toBe(true)
    expect(useLayers.getState().walkLimits).toBe(true)
    expect(SYNC_SLOWDOWN_ON).toBe(false)
    for (const n of [0, FLUID_EASE_FROM, 15, 17, 19, FLUID_HOLD_AT, 30]) {
      expect(walkSpeedFactor(n)).toBe(1)
      expect(walkWarnOpacity(n)).toBe(0)
    }
  })

  it('switched back on, the speed and the warning go by the slowdown, with no stop at 20', () => {
    slowdown(true)
    try {
      for (const n of [0, FLUID_EASE_FROM, 15, 17, 19, FLUID_HOLD_AT, 30]) {
        expect(walkSpeedFactor(n)).toBe(syncSpeedFactor(n))
        expect(walkWarnOpacity(n)).toBe(syncWarnOpacity(n))
      }
      expect(walkSpeedFactor(FLUID_HOLD_AT)).toBeGreaterThan(0)
    } finally { slowdown(null) }
  })

  it('off: full speed and no warning however far ahead, the slowdown switched back on or not', () => {
    useLayers.getState().setLayer('walkLimits', false)
    for (const on of [false, true]) {
      slowdown(on)
      for (const n of [0, 15, 19, FLUID_HOLD_AT, 40, 200]) {
        expect(walkSpeedFactor(n)).toBe(1)
        expect(walkWarnOpacity(n)).toBe(0)
      }
    }
    slowdown(null)
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

  it('is named for what it does now, says it plainly, with no em dash; the menu explanation has the risk in full', () => {
    expect(WALK_LIMITS_TITLE).toBe('Optimize chain')
    expect(WALK_LIMITS_HINT).toBe('Pauses fluid walk when your chain falls behind. Step walking makes fewer new chain events, so your chain catches up.')
    const panelSource = readFileSync(new URL('../ViewPanel.tsx', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(panelSource).toContain('If your chain falls far behind and something interrupts it, like closing the tab or losing connection, moves that have not reached your chain can be lost.')
    expect(panelSource).not.toContain('Chain sync limit keeps')
    for (const words of [WALK_LIMITS_TITLE, WALK_LIMITS_HINT, panelSource]) expect(words).not.toMatch(/\u2014/)
  })

  it('off, the CHAIN chip still counts how far ahead, with no amber stretch, brackets or red', () => {
    expect(aheadLabel(22)).toBe(' 22 moves ahead of your chain. Fluid WALK pauses at 21.')
    expect(aheadLabel(22, false)).toBe(' 22 moves ahead of your chain. The fluid pause is off.')
    expect(aheadLabel(0, false)).toBe('')
    expect(aheadBar(20)).toMatchObject({ n: 20, slow: true, limit: false, close: 1, zone: true })
    expect(aheadBar(FLUID_PAUSE_AT)).toMatchObject({ n: 20, slow: true, limit: true, close: 1, zone: true })
    for (const n of [5, 15, 20, 40]) {
      const bar = aheadBar(n, false)
      expect(bar, String(n)).toMatchObject({ n: Math.min(n, 20), on: true, slow: false, limit: false, close: 0, zone: false })
      const ticks = Array.from({ length: 20 }, (_, k) => tickClass(k + 1, bar, { rose: false, goneTop: 0 }))
      expect(ticks.filter((c) => c.split(' ').includes('is-lit'))).toHaveLength(Math.min(n, 20))
      expect(ticks.some((c) => c.split(' ').includes('is-z'))).toBe(false)
    }
  })
})

describe('the LOSING SYNC warning, parked', () => {
  it('is not on the page at all, nor its line, however far ahead', async () => {
    useCyberspace.setState({ walking: true })
    for (const n of [15, FLUID_HOLD_AT, 40]) {
      useWalk.setState({ open: null, behind: n })
      const m = await mount(<SyncWarning />)
      expect(m.all().filter((h) => String(h.props.className ?? '').includes('syncwarn'))).toHaveLength(0)
      expect(m.buttons('Turn off this warning in settings')).toHaveLength(0)
      await m.unmount()
    }
  })
})

describe('the LOSING SYNC warning, switched back on', () => {
  beforeEach(() => slowdown(true))
  afterEach(() => slowdown(null))

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
    expect(line.props.disabled).toBe(false)
    // The line is outside the box's live region, so a screen reader hears the count, not the line.
    expect(panel(m.all()).props.role).toBeUndefined()
    useLayers.getState().setLayer('walkLimits', false)
    await settled()
    expect(panel(m.all()).props.style).toEqual({ opacity: 0 })
    expect(m.buttons('Turn off this warning in settings')[0].props.disabled).toBe(true)
    await m.unmount()
  })

  it('the line takes a tap only once the box is half shown', async () => {
    for (const [n, tappable] of [[15, false], [16, false], [17, true], [20, true]] as const) {
      ahead(n)
      const m = await mount(<SyncWarning />)
      const opacity = (panel(m.all()).props.style as { opacity: number }).opacity
      expect(opacity >= SYNCWARN_TAP_FROM, String(n)).toBe(tappable)
      expect(m.buttons('Turn off this warning in settings')[0].props.disabled, String(n)).toBe(!tappable)
      await m.unmount()
    }
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
    expect(css).toContain('.syncwarn.is-tappable .syncwarn__off { pointer-events: auto; }')
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
    // The warning steps aside so it does not cover the switch, until the walk catches up.
    expect(panel(m.all()).props.style).toEqual({ opacity: 0 })
    ahead(0)
    await settled()
    expect(useSyncWarnAside.getState().aside).toBe(false)
    ahead(FLUID_HOLD_AT)
    await settled()
    expect(panel(m.all()).props.style).toEqual({ opacity: 1 })
    await m.unmount()
  })

  it('waits for the menu to draw the switch, then goes to it', async () => {
    row.missing = 5
    openSettingAt(WALK_LIMITS_ROW)
    await new Promise((r) => setTimeout(r, 600))
    expect(row.missing).toBe(0)
    expect(row.focused).toBe(1)
  })

  it('an unfolded Settings stays unfolded', async () => {
    usePanelLayout.setState({ collapsed: {} })
    openSettingAt(WALK_LIMITS_ROW)
    await settled()
    expect(usePanelLayout.getState().collapsed.view).toBeFalsy()
    expect(row.focused).toBe(1)
  })
})
