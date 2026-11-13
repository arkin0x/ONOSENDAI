/**
 * earthRoute.test.ts - the tutorial's Earth route, one thing per panel
 * (owner, 2026-11-13: "way more hand-holdy"):
 *
 * - TRAVEL TO EARTH goes to four steps in order, all on the hyperspace
 *   branch: Earth (NEXT), pick a stop (waits for a destination), BOARD
 *   (waits for the chain to be on the line), RIDE (waits for a ride to start);
 * - the whole Earth is framed as the route starts, on a phone held upright
 *   and on a desktop;
 * - HYPERSPACE is the first panel in the menu while BOARD and RIDE are
 *   taught, and the player's saved panel order is never touched;
 * - finishing returns to the "Where next?" card with Earth checked off;
 * - no "bitcoin" and no em dash in anything these steps say.
 *
 * The relay module is replaced: nothing here reaches a relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Where the chain stands on the line, when a test says (a hyperjump head at a stop); else the real reading.
const line = vi.hoisted(() => ({ state: undefined as undefined | { previousId: string; coordHex: string; fromHeight: number | null } }))
vi.mock('../../lib/hyperspace/ride', async (orig) => {
  const real = await orig<typeof import('../../lib/hyperspace/ride')>()
  return { ...real, lineStateOf: (a: Parameters<typeof real.lineStateOf>[0]) => (line.state !== undefined ? line.state : real.lineStateOf(a)) }
})

vi.mock('../../hooks/useMenuOpen', async (orig) => {
  const real = await orig<typeof import('../../hooks/useMenuOpen')>()
  return { ...real, setMenuOpen: vi.fn() }
})

import { useCyberspace } from '../../store/useCyberspace'
import { ADVANCE_MS, routeOf, runTutorialEffect, useTutorial } from '../../store/useTutorial'
import { useHyperspace } from '../../store/useHyperspace'
import { PANEL_LAYOUT_KEY, usePanelLayout } from '../../store/usePanelLayout'
import { useTutorialCam } from '../../store/useTutorialCam'
import { selectStopInScene, useRideRun } from '../../hud/HyperspacePanel'
import { earthFrameDistance } from '../../lib/hyperspace/interest'
import { earthRadiusCells } from '../../lib/earthSurface'
import { EARTH_SCALE_EXP } from '../../lib/hyperspace/interest'
import { FOV } from '../../scene/camera'
import { readProgress, writeProgress } from '../gate'
import { CHOICE, EARTH, EARTH_BOARD, EARTH_PICK, EARTH_RIDE, TUTORIAL_SCRIPT } from '../script'
import '../director'
import '../earthRoute'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id
const ROUTE = [EARTH, EARTH_PICK, EARTH_BOARD, EARTH_RIDE]

/** The player's own saved layout, as the menu keeps it. */
const SAVED = JSON.stringify({ order: { left: ['items', 'identity', 'agents', 'avatars', 'create', 'hidden', 'discovered', 'targets', 'links'], right: ['scale', 'position', 'viewat', 'proof', 'cloud', 'chain', 'view', 'legend', 'controls', 'derezz', 'relays', 'hyperspace', 'tutorial'] }, collapsed: { hyperspace: true } })

beforeEach(() => {
  vi.useFakeTimers()
  useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
  // No routes checked off from an earlier test (a resume reads them back).
  writeProgress(pubkey(), null)
  useHyperspace.setState({ destination: null, viewedStop: null })
  useRideRun.setState({ progress: null, hosaka: false, path: null, error: null })
  useCyberspace.setState({ transit: null, events: [] } as never)
  localStorage.setItem(PANEL_LAYOUT_KEY, SAVED)
  const saved = JSON.parse(SAVED) as { order: never; collapsed: never }
  usePanelLayout.setState({ order: saved.order, collapsed: saved.collapsed, front: null })
})
afterEach(() => {
  useTutorial.getState().pause()
  vi.useRealTimers()
})

/** Into the route from the "Where next?" card, as TRAVEL TO EARTH does. */
function chooseEarth(): void {
  useTutorial.getState().start({ at: 'choice' })
  useTutorial.getState().choose('hyperspace')
}

describe('the Earth route, as written', () => {
  it('TRAVEL TO EARTH starts the route, and the route is the four steps in order, all on the branch', () => {
    expect(CHOICE.choices?.find((c) => c.id === 'hyperspace')?.step).toBe('earth')
    expect(routeOf(TUTORIAL_SCRIPT.steps, 'earth')).toEqual(['earth', 'earth-pick', 'earth-board', 'earth-ride'])
    for (const step of ROUTE) expect(step.branch, step.id).toBe(true)
    expect(ROUTE.map((s) => s.title)).toEqual(['Earth', 'Pick a stop', 'Board', 'Ride'])
    // Earth is read and NEXTed; the rest each wait on one thing.
    expect(ROUTE.map((s) => s.wait)).toEqual([undefined, 'pick-stop', 'board', 'ride'])
    expect(EARTH.effect).toBe('view-earth')
    // The last has no `then`: its FINISH goes back to the choices.
    expect(EARTH_RIDE.then).toBeUndefined()
  })

  it('says no "bitcoin" and no em dash anywhere on the route, and Earth has no hint line', () => {
    for (const step of ROUTE) {
      const said = [step.title, step.caption, step.captionDone, step.hint, step.explain, step.go].filter(Boolean).join(' ')
      expect(said, step.id).not.toMatch(/bitcoin/i)
      expect(said, step.id).not.toContain('—')
    }
    expect(EARTH.hint).toBeUndefined()
    // The cost is still explained, on RIDE.
    expect(EARTH_RIDE.explain).toContain('Nothing is spent until you RIDE')
  })

  it('glows BOARD and RIDE in the HYPERSPACE panel, and the hamburger only while the menu is shut', () => {
    expect(EARTH_BOARD.scene?.highlight).toContain('.hamburger-menu[aria-expanded="false"]')
    expect(EARTH_BOARD.scene?.highlight).toContain('[data-panel-id="hyperspace"] .hyper__btn--board')
    expect(EARTH_RIDE.scene?.highlight).toContain('[data-panel-id="hyperspace"] .hyper__actions .hyper__btn--ride')
    expect(EARTH_RIDE.scene?.highlight).not.toContain('board')
    // The pick has nothing in the page to point at: the stops are in the scene.
    expect(EARTH_PICK.scene?.highlight).toBeUndefined()
  })
})

describe('the Earth route, walked', () => {
  it('goes Earth, pick, BOARD, RIDE, then back to the choices with Earth checked off', () => {
    chooseEarth()
    expect(id()).toBe('earth')
    expect(useCyberspace.getState().focus?.label).toBe('EARTH')
    // Earth waits on nothing: NEXT goes on, not FINISH.
    useTutorial.getState().next()
    expect(id()).toBe('earth-pick')
    expect(useTutorial.getState().done).toBe(false)

    // A tap on a stop views it; on this step that also makes it the destination.
    selectStopInScene(840000)
    expect(useHyperspace.getState().destination).toBe(840000)
    expect(useTutorial.getState().done).toBe(true)
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(id()).toBe('earth-board')
    expect(useTutorial.getState().done).toBe(false)
    expect(usePanelLayout.getState().front).toBe('hyperspace')

    // BOARD: the chain goes on the line.
    useCyberspace.setState({ transit: { stage: 'boarded', enterEventId: 'e'.repeat(64), enterCoordHex: '0'.repeat(64) } } as never)
    expect(useTutorial.getState().done).toBe(true)
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(id()).toBe('earth-ride')
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    expect(useTutorial.getState().done).toBe(false)

    // RIDE: done as the proof starts, not when the ride lands.
    useRideRun.setState({ progress: { done: 0, total: 12, etaMs: null, price: null } })
    expect(useTutorial.getState().done).toBe(true)
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual(['hyperspace'])
    expect(readProgress(pubkey())).toEqual({ step: 'choice', choices: ['hyperspace'] })
  })

  it('only FINISH on a done RIDE checks Earth off: SKIP on RIDE goes back to the choices without it, and NEXT before RIDE only goes on', () => {
    chooseEarth()
    useTutorial.getState().next()
    useTutorial.getState().next()
    useTutorial.getState().next()
    expect(id()).toBe('earth-ride')
    expect(useTutorial.getState().doneChoices).toEqual([])
    // SKIP: the ride was never started.
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual([])
    // Again, riding this time: FINISH, once the ride is under way.
    useTutorial.getState().choose('hyperspace')
    useTutorial.getState().next()
    useTutorial.getState().next()
    useTutorial.getState().next()
    useRideRun.setState({ progress: { done: 0, total: 3, etaMs: null, price: null } })
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual(['hyperspace'])
  })

  it('BACK walks the route back a step at a time, to the choices from Earth, checking nothing off', () => {
    chooseEarth()
    useTutorial.getState().next()
    useTutorial.getState().next()
    expect(id()).toBe('earth-board')
    useTutorial.getState().back()
    expect(id()).toBe('earth-pick')
    useTutorial.getState().back()
    expect(id()).toBe('earth')
    useTutorial.getState().back()
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual([])
  })

  it('a reload partway resumes at Earth, the route\'s first step, which frames the planet again', () => {
    chooseEarth()
    useTutorial.getState().next()
    useTutorial.getState().next()
    expect(id()).toBe('earth-board')
    expect(readProgress(pubkey())?.step).toBe('earth-board')
    useTutorial.getState().pause()
    useCyberspace.getState().clearFocus(true)
    useTutorial.getState().start({ at: readProgress(pubkey())!.step })
    expect(id()).toBe('earth')
    expect(useCyberspace.getState().focus?.label).toBe('EARTH')
    // A step that is no route's later step resumes where it was.
    useTutorial.getState().pause()
    useTutorial.getState().start({ at: 'choice' })
    expect(id()).toBe('choice')
  })

  it('keeps a destination already set: the pick counts at once and the tap changes nothing', () => {
    useHyperspace.setState({ destination: 900000 })
    chooseEarth()
    useTutorial.getState().next()
    expect(id()).toBe('earth-pick')
    expect(useTutorial.getState().done).toBe(true)
    selectStopInScene(840000)
    expect(useHyperspace.getState().destination).toBe(900000)
  })

  it('picks only by a tap in the scene: not off the pick step, not by a scrub or VIEW STATION, and the same stop tapped again counts', () => {
    chooseEarth()
    expect(id()).toBe('earth')
    selectStopInScene(840000)
    expect(useHyperspace.getState().destination).toBe(null)
    useTutorial.getState().next()
    expect(id()).toBe('earth-pick')
    // A scrub or VIEW STATION views a stop without a tap in the scene.
    useHyperspace.setState({ viewedStop: 830000 })
    expect(useHyperspace.getState().destination).toBe(null)
    expect(useTutorial.getState().done).toBe(false)
    // The stop tapped on Earth, tapped again here.
    selectStopInScene(840000)
    expect(useHyperspace.getState().destination).toBe(840000)
    expect(useTutorial.getState().done).toBe(true)
  })

  /** On to the RIDE step through the route, the waits passed by SKIP. */
  const toRide = (): void => {
    chooseEarth()
    for (let i = 0; i < 3; i++) useTutorial.getState().next()
    expect(id()).toBe('earth-ride')
  }

  it('a stop the chain already stood at is not a ride; a ride landing at another stop since is', () => {
    // Standing at a stop from an earlier ride: a hyperjump head.
    line.state = { previousId: 'a'.repeat(64), coordHex: '0'.repeat(64), fromHeight: 800000 }
    try {
      toRide()
      expect(useTutorial.getState().done).toBe(false)
      // Another event while standing at the same stop is not a ride.
      line.state = { previousId: 'c'.repeat(64), coordHex: '0'.repeat(64), fromHeight: 800000 }
      useCyberspace.setState({ events: [] } as never)
      expect(useTutorial.getState().done).toBe(false)
      // At another stop: a ride landed (one too quick to be seen starting).
      line.state = { previousId: 'b'.repeat(64), coordHex: '0'.repeat(64), fromHeight: 840000 }
      useCyberspace.setState({ events: [] } as never)
      expect(useTutorial.getState().done).toBe(true)
    } finally {
      line.state = undefined
    }
  })

  it('a HOSAKA ride counts once it is paid for and under way, not on the tap or while its invoice is open', () => {
    const cloud = useCyberspace.getState().cloud
    try {
      toRide()
      // The tap: planning, then the invoice.
      useRideRun.setState({ hosaka: true })
      expect(useTutorial.getState().done).toBe(false)
      useCyberspace.setState({ cloud: { ...cloud, status: 'awaiting_payment', job: { action: 'ride' } as never } })
      expect(useTutorial.getState().done).toBe(false)
      // Paid: HOSAKA is riding.
      useCyberspace.setState({ cloud: { ...cloud, status: 'paid', job: { action: 'ride' } as never } })
      expect(useTutorial.getState().done).toBe(true)
    } finally {
      useCyberspace.setState({ cloud })
    }
  })

  it('BOARD counts a chain already on the line at once', () => {
    line.state = { previousId: 'a'.repeat(64), coordHex: '0'.repeat(64), fromHeight: null }
    try {
      chooseEarth()
      useTutorial.getState().next()
      useTutorial.getState().next()
      expect(id()).toBe('earth-board')
      expect(useTutorial.getState().done).toBe(true)
    } finally {
      line.state = undefined
    }
  })
})

describe('HYPERSPACE first, for a while', () => {
  it('is first only while BOARD and RIDE are up, and the saved order is never written', () => {
    const order = usePanelLayout.getState().order
    chooseEarth()
    expect(usePanelLayout.getState().front).toBe(null)
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe(null)
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    // FINISH: back to the choices, and the panel back where the player keeps it.
    useRideRun.setState({ progress: { done: 0, total: 3, etaMs: null, price: null } })
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(usePanelLayout.getState().front).toBe(null)
    expect(usePanelLayout.getState().order).toBe(order)
    expect(localStorage.getItem(PANEL_LAYOUT_KEY)).toBe(SAVED)
  })

  it('goes away with the route however it ends: BACK, closing the tutorial, or a pause', () => {
    chooseEarth()
    useTutorial.getState().next()
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    useTutorial.getState().back()
    expect(usePanelLayout.getState().front).toBe(null)
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    useTutorial.getState().end('skipped')
    expect(usePanelLayout.getState().front).toBe(null)
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('hyperspace')
    useTutorial.getState().next()
    useTutorial.getState().next()
    expect(usePanelLayout.getState().front).toBe('hyperspace')
    useTutorial.getState().pause()
    expect(usePanelLayout.getState().front).toBe(null)
    expect(localStorage.getItem(PANEL_LAYOUT_KEY)).toBe(SAVED)
  })
})

describe('the whole Earth in view as the route starts', () => {
  /** Whether a sphere of radius r at distance d fits a frame of `aspect` under the scene's FOV. */
  const fits = (d: number, aspect: number): boolean => {
    const tall = Math.tan((FOV * Math.PI) / 360)
    const half = Math.min(Math.atan(tall), Math.atan(tall * aspect))
    return Math.asin(earthRadiusCells(EARTH_SCALE_EXP) / d) < half
  }

  it('fits the planet with room to spare on a 375x812 phone and a 1440x900 desktop, inside the orbit\'s reach', () => {
    for (const [w, h] of [[375, 812], [1440, 900]]) {
      const d = earthFrameDistance(FOV, w / h)
      expect(fits(d, w / h), `${w}x${h}`).toBe(true)
      // Not so far that the planet is a speck: under 1.5 times the tightest fit.
      expect(fits(d / 1.5, w / h), `${w}x${h}`).toBe(false)
      expect(d).toBeLessThanOrEqual(24 * 4)
    }
    // The old start (26 cells) did not fit a phone.
    expect(fits(26, 375 / 812)).toBe(false)
  })

  it('view-earth asks the camera out to that distance for this screen', () => {
    const g = globalThis as { window?: unknown }
    const had = g.window
    g.window = { innerWidth: 375, innerHeight: 812 }
    try {
      runTutorialEffect('view-earth')
      expect(useTutorialCam.getState().zoom).toBeCloseTo(earthFrameDistance(FOV, 375 / 812), 6)
      expect(useCyberspace.getState().focus?.label).toBe('EARTH')
    } finally {
      g.window = had
      useCyberspace.getState().clearFocus(true)
    }
  })
})
