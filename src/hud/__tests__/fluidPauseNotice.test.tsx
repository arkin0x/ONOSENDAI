/**
 * fluidPauseNotice.test.tsx: the word beside the CHAIN chip while fluid WALK
 * is paused for the chain (hud/FluidPauseNotice.tsx; arkinox, 2026-11-22):
 *
 * - "Fluid paused while your chain catches up" for as long as the pause
 *   lasts, set off by the walk's own count reaching 21;
 * - "Fluid back on" once it comes back by itself, briefly, then it leaves
 *   the page; a switch by hand says nothing;
 * - never out of WALK, or on a chain not yours to walk;
 * - the chip is untouched by it, and the stylesheet keeps it out of the
 *   layout: absolutely placed beside the chip, no pointer events, a fade by
 *   opacity alone; no em dash in its words.
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
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {}, setProofHandler: () => {} }))
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('../../hooks/useSocial', () => ({ useActionComments: () => ({ comments: [], loading: false, refresh: () => {} }) }))

import { ChainExplorer } from '../ChainExplorer'
import { FLUID_NOTICE_FADE_MS, FLUID_PAUSED_TEXT, FLUID_RESUMED_TEXT, fluidNotice } from '../FluidPauseNotice'
import { FLUID_RESUME_NOTICE_MS, useFluidWalk } from '../../store/fluidSwitch'
import { useChainUi } from '../../store/useChainUi'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { useLayers } from '../../store/useLayers'
// The walk's fluid frame, which asks for the pause whenever the count changes, as the app's scene loads it.
import '../../store/walkFluid'

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const spawn = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), type: 'spawn', position: { x: 1n, y: 2n, z: 3n }, plane: 0, created_at: 1 }
const realChain = useCyberspace.getState().focusChain
const chainOf = (n: number): void => {
  const chain = Array.from({ length: n }, (_, i) => ({ ...spawn, id: i.toString(16).padStart(64, '0') }))
  useCyberspace.setState({ focusChain: () => chain as unknown as ReturnType<typeof realChain>, events: [] })
}
const walkAt = (behind: number, walking = true): void => {
  useCyberspace.setState({ walking })
  useWalk.setState({ behind, open: null, queue: [], running: null })
}
const note = (all: Host[]): Host | undefined => all.find((h) => String(h.props.className ?? '').split(' ').includes('fluidnote'))
const textOf = (h: Host | string): string => (typeof h === 'string' ? h : h.type === '#text' ? String(h.props.text) : h.children.map(textOf).join(''))
const chipOf = (all: Host[]): Host => all.find((h) => h.type === 'button' && String(h.props.className).includes('explorer__toggle'))!

beforeEach(() => {
  useFluidWalk.setState({ on: true, paused: false, resumedAt: 0 })
  useLayers.setState({ walkLimits: true })
})

afterEach(() => {
  useWalk.setState({ behind: 0, open: null, queue: [], running: null })
  useCyberspace.setState({ walking: false, focusChain: realChain, events: [], spectate: null, exploreIndex: null, forkNotice: null })
  useChainUi.setState({ explorerOpen: false })
  useFluidWalk.setState({ on: false, paused: false, resumedAt: 0 })
})

describe('what it says', () => {
  it('paused, while walking your own chain; back on, for FLUID_RESUME_NOTICE_MS; else nothing', () => {
    expect(fluidNotice({ paused: true, resumedAt: 0 }, true, true, 0)).toBe('paused')
    expect(fluidNotice({ paused: false, resumedAt: 1000 }, true, true, 1000 + FLUID_RESUME_NOTICE_MS - 1)).toBe('resumed')
    expect(fluidNotice({ paused: false, resumedAt: 1000 }, true, true, 1000 + FLUID_RESUME_NOTICE_MS)).toBe(null)
    expect(fluidNotice({ paused: false, resumedAt: 0 }, true, true, 5)).toBe(null)
    expect(fluidNotice({ paused: true, resumedAt: 0 }, false, true, 0)).toBe(null)
    expect(fluidNotice({ paused: true, resumedAt: 0 }, true, false, 0)).toBe(null)
  })

  it('in plain words with no em dash', () => {
    expect(FLUID_PAUSED_TEXT).toBe('Fluid paused while your chain catches up')
    expect(FLUID_RESUMED_TEXT).toBe('Fluid back on')
    for (const w of [FLUID_PAUSED_TEXT, FLUID_RESUMED_TEXT]) expect(w).not.toMatch(/\u2014/)
  })
})

describe('beside the CHAIN chip', () => {
  it('comes up when the walk reaches 21 ahead, stays until 15, then says it is back on and leaves', async () => {
    chainOf(3)
    walkAt(5)
    const m = await mount(<ChainExplorer />)
    expect(note(m.all())).toBeUndefined()
    const chipBefore = chipOf(m.all()).props.className
    walkAt(21); await settled()
    expect(useFluidWalk.getState().paused).toBe(true)
    const n = note(m.all())!
    expect(textOf(n)).toBe(FLUID_PAUSED_TEXT)
    expect(String(n.props.className).split(' ')).toEqual(expect.arrayContaining(['fluidnote', 'is-paused', 'is-on']))
    expect(n.props.role).toBe('status')
    expect(n.props['aria-live']).toBe('polite')
    // The chip beside it is the chip the count alone makes.
    expect(String(chipOf(m.all()).props.className)).toContain(String(chipBefore))
    walkAt(16); await settled()
    expect(textOf(note(m.all())!)).toBe(FLUID_PAUSED_TEXT)
    walkAt(15); await settled()
    expect(useFluidWalk.getState().paused).toBe(false)
    expect(textOf(note(m.all())!)).toBe(FLUID_RESUMED_TEXT)
    expect(String(note(m.all())!.props.className)).toContain('is-resumed is-on')
    // Briefly: then it fades (still on the page, no longer on), then it leaves.
    await new Promise((r) => setTimeout(r, FLUID_RESUME_NOTICE_MS + 80))
    await settled()
    const fading = note(m.all())
    if (fading) {
      expect(String(fading.props.className)).not.toContain('is-on')
      expect(textOf(fading)).toBe(FLUID_RESUMED_TEXT)
    }
    await new Promise((r) => setTimeout(r, FLUID_NOTICE_FADE_MS + 80))
    await settled()
    expect(note(m.all())).toBeUndefined()
    await m.unmount()
  }, 10000)

  it('a switch by hand while paused ends it without "back on"', async () => {
    chainOf(3)
    walkAt(22)
    const m = await mount(<ChainExplorer />)
    expect(textOf(note(m.all())!)).toBe(FLUID_PAUSED_TEXT)
    useFluidWalk.getState().set(false)
    await settled()
    await new Promise((r) => setTimeout(r, FLUID_NOTICE_FADE_MS + 80))
    await settled()
    expect(note(m.all())).toBeUndefined()
    walkAt(3); await settled()
    expect(note(m.all())).toBeUndefined()
    await m.unmount()
  })

  it('says nothing out of WALK, or on a chain you are spectating', async () => {
    chainOf(3)
    useFluidWalk.setState({ paused: true })
    walkAt(22, false)
    const m = await mount(<ChainExplorer />)
    expect(note(m.all())).toBeUndefined()
    await m.unmount()
    // Someone else's chain on the chip (its explorer closed: the chip is the subject).
    useCyberspace.setState({ spectate: { pubkey: 'f'.repeat(64) } as never })
    useChainUi.setState({ explorerOpen: false })
    const theirs = await mount(<ChainExplorer />)
    walkAt(22); await settled()
    expect(useFluidWalk.getState().paused).toBe(true)
    expect(note(theirs.all())).toBeUndefined()
    await theirs.unmount()
  })

  it('with the setting off, nothing pauses and nothing is said', async () => {
    useLayers.setState({ walkLimits: false })
    chainOf(3)
    walkAt(30)
    const m = await mount(<ChainExplorer />)
    expect(useFluidWalk.getState().paused).toBe(false)
    expect(note(m.all())).toBeUndefined()
    await m.unmount()
  })
})

describe('the stylesheet', () => {
  const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
  const rule = (sel: string): string => { const at = css.indexOf(`${sel} {`); return css.slice(at, css.indexOf('}', at)) }

  it('places it beside the chip, out of the layout, taking no touch; the chip row is the chip\'s own size', () => {
    expect(rule('.explorer__chiprow')).toContain('position: relative')
    const n = rule('.fluidnote')
    expect(n).toContain('position: absolute')
    expect(n).toContain('left: calc(100% + 8px)')
    expect(n).toContain('pointer-events: none')
    expect(n).toContain('opacity: 0')
    expect(n).toContain('color: #fff')
    // It wraps on a phone before the screen's edge.
    expect(n).toContain('max-width: calc(100vw - 100% - var(--instruments-left) - 8px - var(--compass-reserve))')
  })

  it('fades by opacity alone, and not at all under reduced motion', () => {
    expect(rule('.fluidnote')).toContain('transition: opacity 320ms ease')
    expect(css).toMatch(/@keyframes fluidnote-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fluidnote \{ transition: none; \}\s*\.fluidnote\.is-on \{ animation: none; \}/)
  })
})
