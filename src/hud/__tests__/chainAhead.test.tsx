/**
 * chainAhead.test.tsx: the CHAIN chip's ahead bar (hud/ChainAhead.tsx;
 * arkinox, 2026-11-17): what it shows at each count, that it goes by the
 * fluid pause's own number and thresholds (arkinox, 2026-11-22: amber from
 * 15, where a paused fluid WALK comes back on, red from 21, where it pauses), that the chip is untouched with
 * nothing ahead and the bar lingers about a second after catching up, and
 * that the stylesheet keeps it out of the layout and still under reduced
 * motion. The real boxes are measured in a browser by
 * scripts/chain-ahead-probe.mjs.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
// Nothing here may reach a relay.
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

// The chip counts the comments on the action under its mark, off a relay: not here.
vi.mock('../../hooks/useSocial', () => ({ useActionComments: () => ({ comments: [], loading: false, refresh: () => {} }) }))

import { ChainExplorer } from '../ChainExplorer'
import { AHEAD_LINGER_MS, AHEAD_TICKS, AHEAD_TRACK_START, aheadBar, aheadLabel, aheadStep, tickClass, type AheadTrack } from '../ChainAhead'
import { FLUID_EASE_FROM, FLUID_HOLD_AT, FLUID_PAUSE_AT, FLUID_RESUME_AT, syncSpeedFactor, syncWarnOpacity } from '../../lib/fluidWalk'
import { useChainUi } from '../../store/useChainUi'
import { useCyberspace } from '../../store/useCyberspace'
import { SYNC_WARN_AT, useWalk, type WalkSegment } from '../../store/useWalk'
import { eventsAhead } from '../../store/walkAhead'
import { useFluidWalk } from '../../store/fluidSwitch'

// Fluid WALK chosen, as the app has it by default: the bar shows the fluid pause's marks (with it off, the bar only counts).
useFluidWalk.setState({ on: true })

// The chip's own effects use the window's timers and watch the page's visibility.
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const COUNTS = [0, 1, 5, 14, 15, 17, 20, 21]
const still = { rose: false, goneTop: 0 }
const classes = (n: number, track: Pick<AheadTrack, 'rose' | 'goneTop'> = still): string[] => Array.from({ length: AHEAD_TICKS }, (_, k) => tickClass(k + 1, aheadBar(n), track))
const has = (cls: string, name: string): boolean => cls.split(' ').includes(name)
const count = (all: string[], name: string): number => all.filter((c) => has(c, name)).length

describe('the bar at each count', () => {
  it('has one tick per event, to one short of the fluid pause', () => {
    expect(AHEAD_TICKS).toBe(FLUID_PAUSE_AT - 1)
    expect(AHEAD_TICKS).toBe(FLUID_HOLD_AT)
    expect(AHEAD_TICKS).toBe(20)
  })

  it('lights that many ticks from the left, the newest the head', () => {
    for (const n of COUNTS) {
      const all = classes(n)
      expect([n, count(all, 'is-lit')]).toEqual([n, Math.min(n, 20)])
      expect([n, all.findIndex((c) => has(c, 'is-lit') === false)]).toEqual([n, n >= 20 ? -1 : n])
      expect([n, all.findIndex((c) => has(c, 'is-head')) + 1]).toEqual([n, Math.min(n, 20)])
      expect(count(all, 'is-head')).toBe(n === 0 ? 0 : 1)
    }
  })

  it('keeps the last six slots as the slowing stretch, set apart at its first', () => {
    for (const n of COUNTS) {
      const all = classes(n)
      expect(all.map((c) => has(c, 'is-z'))).toEqual(Array.from({ length: 20 }, (_, k) => k + 1 >= 15))
      expect(all.findIndex((c) => has(c, 'is-z1')) + 1).toBe(15)
      // Hollow amber outlines are the slowing slots not yet reached.
      expect([n, all.filter((c) => has(c, 'is-z') && !has(c, 'is-lit')).length]).toEqual([n, Math.max(0, Math.min(6, 20 - n))])
    }
  })

  it('is off at 0, plain to 14, amber from 15, red at the fluid pause, 21', () => {
    const state = (n: number): string => { const b = aheadBar(n); return `${b.on ? 'on' : 'off'}${b.slow ? ' slow' : ''}${b.limit ? ' limit' : ''}` }
    expect(COUNTS.map(state)).toEqual(['off', 'on', 'on', 'on', 'on slow', 'on slow', 'on slow', 'on slow limit'])
  })

  it('closes the brackets in from 15 to 20', () => {
    expect(COUNTS.map((n) => aheadBar(n).close)).toEqual([0, 0, 0, 0, 0, 0.4, 1, 1])
    expect(aheadBar(19).close).toBeCloseTo(0.8, 6)
  })

  it('stays full, never past its ticks, however far past 20 the count goes', () => {
    for (const n of [21, 26, 400]) {
      expect(aheadBar(n)).toEqual({ ...aheadBar(20), limit: true })
      expect(count(classes(n), 'is-lit')).toBe(20)
      expect(classes(n).findIndex((c) => has(c, 'is-head')) + 1).toBe(20)
    }
    // And nothing odd for a count that is not a count.
    for (const n of [-3, NaN, Infinity, 0.9]) expect(aheadBar(n).n).toBe(0)
    expect(aheadBar(17.9).n).toBe(17)
  })
})

describe('the same number and thresholds as the fluid pause (and the parked slowdown and warning)', () => {
  it('turns amber where a paused fluid WALK comes back on, red where it pauses; amber is where the parked slowdown and warning start', () => {
    expect(SYNC_WARN_AT).toBe(FLUID_EASE_FROM + 1)
    expect(SYNC_WARN_AT).toBe(FLUID_RESUME_AT)
    for (let n = 0; n <= 30; n++) {
      const b = aheadBar(n)
      expect([n, b.slow]).toEqual([n, n >= FLUID_RESUME_AT])
      expect([n, b.slow]).toEqual([n, syncSpeedFactor(n) < 1])
      expect([n, b.slow]).toEqual([n, syncWarnOpacity(n) > 0])
      expect([n, b.limit]).toEqual([n, n >= FLUID_PAUSE_AT])
    }
  })
})

describe('what a change plays', () => {
  const at = (n: number, total: number, more: Partial<AheadTrack> = {}): AheadTrack => ({ ...AHEAD_TRACK_START, n, total, ...more })

  it('a new move lights its tick', () => {
    const t = aheadStep(at(4, 100), 5, 100)
    expect(t).toMatchObject({ n: 5, rose: true, goneTop: 0, landed: 0 })
    expect(classes(5, t).findIndex((c) => has(c, 'is-ign')) + 1).toBe(5)
    expect(count(classes(5, t), 'is-ign')).toBe(1)
  })

  it('a move landing folds the end tick away and glints the total', () => {
    const t = aheadStep(at(17, 100), 16, 101)
    expect(t).toMatchObject({ n: 16, rose: false, goneTop: 17, landed: 1 })
    const all = classes(16, t)
    expect(all.findIndex((c) => has(c, 'is-going')) + 1).toBe(17)
    expect(count(all, 'is-going')).toBe(1)
    expect(count(all, 'is-ign')).toBe(0)
  })

  it('moves landing one after another each fold, and none is cut short by the next', () => {
    const a = aheadStep(at(6, 100), 5, 101)
    const b = aheadStep(a, 4, 102)
    expect(b).toMatchObject({ n: 4, goneTop: 6, landed: 2 })
    expect(classes(4, b).map((c) => has(c, 'is-going'))).toEqual(Array.from({ length: 20 }, (_, k) => k + 1 === 5 || k + 1 === 6))
    // The next move clears them.
    expect(aheadStep(b, 5, 102)).toMatchObject({ rose: true, goneTop: 0 })
  })

  it('a move landing as another is made glints the total and folds nothing: the count did not come down', () => {
    const a = aheadStep(at(6, 100), 6, 101)
    expect(a).toMatchObject({ n: 6, landed: 1, goneTop: 0 })
    // And a count that then falls with no landing of its own (STOP) fades.
    expect(aheadStep(a, 5, 101)).toMatchObject({ n: 5, goneTop: 0, landed: 1 })
  })

  it('starts each time ahead with no glint owed: the first move after catching up is not a landing', () => {
    const caught = aheadStep(at(1, 100), 0, 101)
    expect(caught).toMatchObject({ n: 0, goneTop: 1, landed: 1 })
    expect(aheadStep(caught, 1, 101)).toMatchObject({ n: 1, rose: true, goneTop: 0, landed: 0 })
    // Still ahead, the count of landings carries on, so each one glints anew.
    expect(aheadStep(at(3, 100, { landed: 4 }), 4, 100).landed).toBe(4)
  })

  it('a count that falls without a landing fades: a step undone, a wall, STOP', () => {
    expect(aheadStep(at(6, 100), 5, 100)).toMatchObject({ n: 5, rose: false, goneTop: 0, landed: 0 })
    expect(aheadStep(at(9, 100), 0, 100)).toMatchObject({ n: 0, rose: false, goneTop: 0, landed: 0 })
    // Several at once fade together, landing or not.
    expect(aheadStep(at(9, 100), 6, 103)).toMatchObject({ n: 6, goneTop: 0, landed: 1 })
  })

  it('the total does not glint with nothing ahead, and nothing changes for no change', () => {
    expect(aheadStep(at(0, 100), 0, 101).landed).toBe(0)
    const t = at(3, 100, { rose: true })
    expect(aheadStep(t, 3, 100)).toBe(t)
  })
})

describe('the label', () => {
  it('gains the count, and says where fluid WALK pauses', () => {
    expect(aheadLabel(0)).toBe('')
    expect(aheadLabel(1)).toBe(' 1 move ahead of your chain. Fluid WALK pauses at 21.')
    expect(aheadLabel(17)).toBe(' 17 moves ahead of your chain. Fluid WALK pauses at 21.')
    // The real count, past 20 too.
    expect(aheadLabel(23)).toBe(' 23 moves ahead of your chain. Fluid WALK pauses at 21.')
  })
})

// ---- The chip itself, on the real stores ----

const spawn = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), type: 'spawn', position: { x: 1n, y: 2n, z: 3n }, plane: 0, created_at: 1 }
const realChain = useCyberspace.getState().focusChain
const chainOf = (n: number): void => {
  const chain = Array.from({ length: n }, (_, i) => ({ ...spawn, id: i.toString(16).padStart(64, '0') }))
  // A new (empty) events array is what tells the chip its chain changed.
  useCyberspace.setState({ focusChain: () => chain as unknown as ReturnType<typeof realChain>, events: [] })
}
/**
 * A move landing, as the walk's own listener does it (store/useWalk.ts
 * pump): the count comes down inside the store change that grew the chain,
 * so the chip sees both at once. Listening from before any chip is mounted,
 * as the walk does.
 */
let landing: number | null = null
useCyberspace.subscribe(() => {
  if (landing === null) return
  const behind = landing
  landing = null
  useWalk.setState({ behind })
})
const land = (total: number, behind: number): void => { landing = behind; chainOf(total) }
const walkAt = (behind: number, walking = true): void => {
  useCyberspace.setState({ walking })
  useWalk.setState({ behind, open: null, queue: [], running: null })
}

afterEach(() => {
  useWalk.setState({ behind: 0, open: null, queue: [], running: null })
  useCyberspace.setState({ walking: false, focusChain: realChain, events: [], spectate: null, exploreIndex: null, forkNotice: null })
  useChainUi.setState({ explorerOpen: false })
})

const marked = (all: Host[]): boolean => all.some((h) => /ahead/.test(String(h.props.className ?? '')))
/** Wait for the marks to leave the page; how long it took, in ms. No upper bound on a slow machine but the test's own. */
async function gone(m: { all: () => Host[] }): Promise<number> {
  const from = Date.now()
  while (marked(m.all())) {
    if (Date.now() - from > 8000) throw new Error('the bar never left the page')
    await new Promise((r) => setTimeout(r, 20))
  }
  return Date.now() - from
}

const chipOf = (all: Host[]): Host => all.find((h) => h.type === 'button' && String(h.props.className).includes('explorer__toggle'))!
const kids = (h: Host, cls: string): Host[] => h.children.filter((c): c is Host => typeof c !== 'string' && String(c.props.className ?? '').split(' ').includes(cls))
const litOf = (chip: Host): number => (kids(chip, 'aheadbar')[0]?.children ?? []).filter((t) => typeof t !== 'string' && has(String(t.props.className ?? ''), 'is-lit')).length

/** A host tree as the markup a page would hold: tags, classes, ARIA and inline style, and the words. */
function markup(h: Host | string): string {
  if (typeof h === 'string') return h
  if (h.type === '#text') return String(h.props.text)
  const attrs = Object.entries(h.props)
    .filter(([k, v]) => (k === 'className' || k === 'style' || k.startsWith('aria-')) && v !== undefined)
    .map(([k, v]) => ` ${k === 'className' ? 'class' : k}="${typeof v === 'object' ? JSON.stringify(v) : String(v)}"`)
  return `<${h.type}${attrs.join('')}>${h.children.map(markup).join('')}</${h.type}>`
}

/** Today's chip, to the character: what the page holds with nothing ahead (in the chip's row, which the fluid pause's word sits beside). */
const PLAIN = '<div class="explorer"><div class="explorer__chiprow"><button class="chip explorer__toggle" aria-label="Show chain explorer" aria-pressed="false">CHAIN 3/3</button></div></div>'

describe('the CHAIN chip in WALK', () => {
  it('with nothing ahead is exactly the chip it always was', async () => {
    chainOf(3)
    walkAt(0)
    const m = await mount(<ChainExplorer />)
    const chip = chipOf(m.all())
    expect(chip.props.className).toBe('chip explorer__toggle')
    expect(chip.props['aria-label']).toBe('Show chain explorer')
    expect(marked(m.all())).toBe(false)
    expect(markup(m.all()[0])).toBe(PLAIN)
    // And again once it has shown and gone.
    walkAt(4); await settled()
    expect(markup(m.all()[0])).not.toBe(PLAIN)
    walkAt(0)
    await gone(m)
    expect(markup(m.all()[0])).toBe(PLAIN)
    await m.unmount()
  })

  it('shows the count at 1, 5, 14, 15, 17, 20 and 21, and the words never change', async () => {
    chainOf(3)
    walkAt(0)
    const m = await mount(<ChainExplorer />)
    for (const n of COUNTS.slice(1)) {
      walkAt(n)
      await settled()
      const chip = chipOf(m.all())
      const cls = String(chip.props.className).split(' ')
      expect([n, litOf(chip)]).toEqual([n, Math.min(n, 20)])
      expect(kids(chip, 'aheadbar')[0].children.length).toBe(20)
      expect([n, cls.includes('has-ahead'), cls.includes('is-ahead')]).toEqual([n, true, true])
      expect([n, cls.includes('is-slow')]).toEqual([n, n >= 15])
      expect([n, cls.includes('is-limit')]).toEqual([n, n >= 21])
      expect(chip.props['aria-label']).toBe(`Show chain explorer. ${n} move${n === 1 ? '' : 's'} ahead of your chain. Fluid WALK pauses at 21.`)
      expect(m.says('CHAIN 3/3')).toBe(true)
      // The marks are decoration: a reader gets the label.
      expect(kids(chip, 'aheadbar')[0].props['aria-hidden']).toBe('true')
      expect(kids(chip, 'aheadbrk')[0].props['aria-hidden']).toBe('true')
    }
    await m.unmount()
  })

  it('moves the brackets in from 15 to 20', async () => {
    chainOf(3)
    walkAt(15)
    const m = await mount(<ChainExplorer />)
    const gap = (): string => String((kids(chipOf(m.all()), 'aheadbrk')[0].props.style as Record<string, string>)['--ahead-gap'])
    expect(gap()).toBe('4.00px')
    walkAt(17); await settled()
    expect(gap()).toBe('3.00px')
    walkAt(20); await settled()
    expect(gap()).toBe('1.50px')
    walkAt(24); await settled()
    expect(gap()).toBe('1.50px')
    expect(litOf(chipOf(m.all()))).toBe(20)
    await m.unmount()
  })

  it('reads the number the fluid pause reads: the queue, the open segment, a count past 20', async () => {
    chainOf(3)
    walkAt(6)
    const m = await mount(<ChainExplorer />)
    expect(eventsAhead()).toBe(6)
    expect(litOf(chipOf(m.all()))).toBe(eventsAhead())
    // The segment still being walked is one more, for the fluid pause and the bar alike.
    useWalk.setState({ open: {} as WalkSegment })
    await settled()
    expect(eventsAhead()).toBe(7)
    expect(litOf(chipOf(m.all()))).toBe(7)
    expect(String(chipOf(m.all()).props['aria-label'])).toContain(' 7 moves ahead')
    useWalk.setState({ behind: 19 })
    await settled()
    expect(eventsAhead()).toBe(20)
    expect(String(chipOf(m.all()).props.className)).not.toContain('is-limit')
    // At the pause: full, red, and the label has the real count.
    useWalk.setState({ behind: 20 })
    await settled()
    expect(eventsAhead()).toBe(21)
    expect(String(chipOf(m.all()).props.className)).toContain('is-limit')
    expect(litOf(chipOf(m.all()))).toBe(20)
    expect(String(chipOf(m.all()).props['aria-label'])).toContain(' 21 moves ahead')
    await m.unmount()
  })

  it('glints the total when a move lands, with a new glint each time', async () => {
    chainOf(3)
    walkAt(2)
    const m = await mount(<ChainExplorer />)
    const words = (): Host => kids(chipOf(m.all()), 'aheadtxt')[0]
    const glint = (): Host | undefined => kids(chipOf(m.all()), 'aheadglint')[0]
    expect(String(words().props.className)).toBe('aheadtxt')
    expect(glint()).toBeUndefined()
    land(4, 1); await settled()
    // A white copy of the words, laid over them: the page's text is still the words once.
    expect(String(glint()!.props.className)).toBe('aheadglint is-glint')
    expect(glint()!.props['data-words']).toBe('CHAIN 4/4')
    expect(glint()!.props['aria-hidden']).toBe('true')
    expect(glint()!.children).toEqual([])
    expect(m.says('CHAIN 4/4')).toBe(true)
    const first = glint()
    const bar = kids(chipOf(m.all()), 'aheadbar')[0].children as Host[]
    expect(has(String(bar[1].props.className), 'is-going')).toBe(true)
    land(5, 0); await settled()
    expect(glint()).not.toBe(first)
    expect(glint()!.props['data-words']).toBe('CHAIN 5/5')
    await m.unmount()
  })

  it('does not glint for a move made: not on the first step, and not on the first step after catching up', async () => {
    chainOf(3)
    walkAt(0)
    const m = await mount(<ChainExplorer />)
    const glints = (): boolean => kids(chipOf(m.all()), 'aheadglint').length > 0
    walkAt(1); await settled()
    expect(glints()).toBe(false)
    // It lands, and the walk has caught up: the total glinted for that.
    land(4, 0); await settled()
    expect(glints()).toBe(true)
    // A step while the bar is still fading out, and one after it has gone: neither is a landing.
    walkAt(1); await settled()
    expect(glints()).toBe(false)
    land(5, 0)
    await gone(m)
    walkAt(1); await settled()
    expect(glints()).toBe(false)
    await m.unmount()
  })

  it('lingers about a second after catching up, then leaves the chip as it was', async () => {
    expect(AHEAD_LINGER_MS).toBeGreaterThanOrEqual(1300)
    expect(AHEAD_LINGER_MS).toBeLessThanOrEqual(1600)
    chainOf(3)
    walkAt(3)
    const m = await mount(<ChainExplorer />)
    walkAt(0); await settled()
    // Caught up: the bar is still on the page, empty, on its way out.
    const chip = chipOf(m.all())
    expect(String(chip.props.className)).toBe('chip explorer__toggle has-ahead')
    expect(kids(chip, 'aheadbar').length).toBe(1)
    expect(litOf(chip)).toBe(0)
    expect(chip.props['aria-label']).toBe('Show chain explorer')
    // It leaves no sooner than its time (a slow machine only makes it later).
    expect(await gone(m)).toBeGreaterThanOrEqual(AHEAD_LINGER_MS - 200)
    expect(chipOf(m.all()).props.className).toBe('chip explorer__toggle')
    await m.unmount()
  })

  it('a step inside the wait starts the wait again: no blink while proofs keep pace', async () => {
    chainOf(3)
    walkAt(2)
    const m = await mount(<ChainExplorer />)
    walkAt(0); await settled()
    // Most of the way through the wait, one more step is made and proved.
    await new Promise((r) => setTimeout(r, 700))
    walkAt(1); await settled()
    expect(litOf(chipOf(m.all()))).toBe(1)
    walkAt(0); await settled()
    // The full wait runs from this catch-up, not what was left of the first.
    expect(await gone(m)).toBeGreaterThanOrEqual(AHEAD_LINGER_MS - 200)
    await m.unmount()
  })

  it('shows nothing out of WALK, in history, or on a chain you are spectating', async () => {
    chainOf(3)
    walkAt(12, false)
    const m = await mount(<ChainExplorer />)
    const none = (): boolean => !marked(m.all())
    expect(none()).toBe(true)
    walkAt(12); await settled()
    expect(none()).toBe(false)
    // Stepping into history takes the marks off at once, with no fade: it is another view of the chain.
    useCyberspace.setState({ exploreIndex: 1 }); await settled()
    expect(none()).toBe(true)
    expect(String(chipOf(m.all()).props['aria-label'])).not.toContain('ahead')
    useCyberspace.setState({ exploreIndex: null })
    walkAt(12); await settled()
    expect(none()).toBe(false)
    await m.unmount()
    // Spectating: someone else's chain is on the chip (and its explorer opens; closed here, the chip is the subject).
    useCyberspace.setState({ spectate: { pubkey: 'f'.repeat(64) } as never })
    useChainUi.setState({ explorerOpen: false })
    const theirs = await mount(<ChainExplorer />)
    walkAt(12); await settled()
    expect(marked(theirs.all())).toBe(false)
    expect(String(chipOf(theirs.all()).props['aria-label'])).not.toContain('ahead')
    await theirs.unmount()
  })

  it('with Fluid WALK switched off by hand, nothing pauses: the bar only counts, never red, and the label says so', async () => {
    chainOf(3)
    useFluidWalk.setState({ on: false })
    try {
      walkAt(22)
      const m = await mount(<ChainExplorer />)
      const cls = String(chipOf(m.all()).props.className).split(' ')
      expect(litOf(chipOf(m.all()))).toBe(20)
      expect(cls.includes('is-slow') || cls.includes('is-limit')).toBe(false)
      expect(String(chipOf(m.all()).props['aria-label'])).toContain('22 moves ahead of your chain. The fluid pause is off.')
      await m.unmount()
    } finally { useFluidWalk.setState({ on: true }) }
  })

  it('stays on the chip when a fold from another device changes its face', async () => {
    chainOf(3)
    walkAt(5)
    useCyberspace.setState({ forkNotice: { adopted: 0, dropped: 2, replaced: false, at: 1 } })
    const m = await mount(<ChainExplorer />)
    const chip = chipOf(m.all())
    expect(String(chip.props.className)).toBe('chip explorer__toggle explorer__toggle--dropped has-ahead is-ahead')
    expect(m.says('2 ACTIONS DROPPED')).toBe(true)
    expect(litOf(chip)).toBe(5)
    expect(chip.props['aria-label']).toBe('2 actions from this device were dropped. Tap to read why. 5 moves ahead of your chain. Fluid WALK pauses at 21.')
    await m.unmount()
  })
})

// ---- The stylesheet's side of it ----

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
/** The declarations of the one rule with exactly this selector. */
function rule(selector: string, within = css): Record<string, string> {
  const at = within.split('\n').findIndex((l) => l.trim() === `${selector} {` || l.trim().startsWith(`${selector} { `))
  expect([selector, at >= 0]).toEqual([selector, true])
  const rest = within.split('\n').slice(at).join('\n')
  const body = rest.slice(rest.indexOf('{') + 1, rest.indexOf('}')).replace(/\/\*[\s\S]*?\*\//g, '')
  // Split on the semicolons that end a declaration, not ones inside a value.
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]))
}
const section = css.slice(css.indexOf('/* ---------- Chain chip: how far ahead ----------'), css.indexOf('/* What is left when the pad is dismissed'))

describe('the bar in the stylesheet', () => {
  it('has its own section, between the chips and the pad hint', () => {
    expect(section.length).toBeGreaterThan(1000)
  })

  it('is out of the layout: the bar and the brackets are absolutely placed and take no touch', () => {
    for (const sel of ['.aheadbar', '.aheadbrk']) {
      const r = rule(sel, section)
      expect([sel, r.position]).toEqual([sel, 'absolute'])
      expect([sel, r['pointer-events']]).toEqual([sel, 'none'])
    }
    // Inside the chip's 9px bottom padding, between its 12px sides.
    expect(rule('.chip').padding).toBe('9px 12px')
    expect(rule('.aheadbar', section)).toMatchObject({ left: '12px', right: '12px', bottom: '3px', height: '3px' })
  })

  it('changes nothing about the chip that could move anything', () => {
    const sizing = /(^|[\s;{])(padding|margin|width|height|min-width|min-height|max-width|max-height|font|font-size|line-height|letter-spacing|border|border-width|display|flex|gap|top|left|right|bottom|inset|box-sizing|white-space)\s*:/
    const blocks = [...section.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
    // Rules on the chip's button itself (not on the marks inside it).
    const onChip = blocks.filter((b) => b.sel.split(',').some((s) => /\.explorer__toggle[.\w-]*$/.test(s.trim())))
    expect(onChip.map((b) => b.sel)).toEqual(['.explorer__toggle.has-ahead', '.explorer__toggle.is-limit'])
    for (const b of onChip) expect([b.sel, sizing.test(b.body)]).toEqual([b.sel, false])
    expect(Object.keys(rule('.explorer__toggle.has-ahead', section)).sort()).toEqual(['position'])
    // The red border's fade is a layer over the chip's own border, the same box: out of the layout too.
    expect(rule('.explorer__toggle.has-ahead::after', section)).toMatchObject({ position: 'absolute', inset: '-1px', border: '1px solid var(--limit)', 'border-radius': 'inherit', 'pointer-events': 'none' })
    expect(Object.keys(rule('.explorer__toggle.is-limit', section)).sort()).toEqual(['border-color', 'transition'])
    // Not an ease: the chip's own border steps aside in one step, once the red layer has faded in over it.
    expect(rule('.explorer__toggle.is-limit', section)).toEqual({ 'border-color': 'transparent', transition: 'border-color 0s 300ms' })
    // The words' span is inline and only lifted above the glow.
    expect(Object.keys(rule('.aheadtxt', section)).sort()).toEqual(['position', 'z-index'])
  })

  it('waits most of a second before fading out, inside the time the bar stays on the page', () => {
    const out = rule('.aheadbar', section).transition
    expect(out).toBe('opacity 400ms ease 900ms')
    expect(900 + 400).toBeLessThanOrEqual(AHEAD_LINGER_MS)
    expect(rule('.explorer__toggle.is-ahead .aheadbar', section)).toMatchObject({ opacity: '1' })
    expect(rule('.aheadbar', section).opacity).toBe('0')
  })

  it('uses the LOSING SYNC warning\'s own red at the limit', () => {
    const red = /--limit:\s*(#[0-9a-f]{6})/.exec(css)![1]
    const warning = css.slice(css.indexOf('.syncwarn__panel {'))
    expect(new RegExp(`color: ${red};`).test(warning.slice(0, warning.indexOf('}')))).toBe(true)
    expect(rule('.explorer__toggle.has-ahead::after', section).border).toBe('1px solid var(--limit)')
    expect(rule('.explorer__toggle.is-limit::after', section).opacity).toBe('1')
    expect(rule('.explorer__toggle.is-limit .aheadbar i.is-lit', section).background).toContain('var(--limit)')
    expect(rule('.explorer__toggle.is-limit .aheadbrk', section)['--ahead-line']).toBe('var(--limit)')
  })

  it('says the limit with more than colour: a slow breathe and the brackets, never a flash', () => {
    expect(rule('.explorer__toggle.is-limit .aheadbar', section).animation).toContain('ahead-breathe 1.6s ease-in-out infinite')
    expect(rule('.explorer__toggle.is-slow .aheadbrk', section).opacity).toBe('1')
    // Hollow, not filled: the slowing slots before they are reached.
    expect(rule('.aheadbar i.is-z', section).background).toBe('transparent')
  })

  it('under reduced motion runs none of its animations and keeps its colours', () => {
    const bare = section.replace(/\/\*[\s\S]*?\*\//g, '')
    const media = bare.slice(bare.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    // Every rule in the section that sets an animation, by its selector.
    const animated = [...bare.slice(0, bare.lastIndexOf('@media')).matchAll(/([^{}]+)\{[^{}]*\banimation:[^{}]*\}/g)].map((m) => m[1].trim())
    expect(animated.sort()).toEqual(['.aheadbar', '.aheadbar i.is-going', '.aheadbar i.is-going::after', '.aheadbar i.is-ign', '.aheadbar i.is-ign::after', '.aheadglint.is-glint', '.aheadbrk i', '.explorer__toggle.is-limit .aheadbar'].sort())
    // The reduced-motion rule that turns animation off names each of them, selector for selector.
    const off = [...media.matchAll(/([^{}]+)\{\s*animation: none;\s*\}/g)].flatMap((m) => m[1].split(',').map((sel) => sel.trim()))
    expect(off.sort()).toEqual([...animated].sort())
    // Nothing there hides a state.
    expect(media).not.toMatch(/display|visibility|opacity: 0/)
  })
})
