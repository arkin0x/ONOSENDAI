/**
 * earthBoardPath.test.ts - the tour's way to Earth ends at a BOARD a new
 * player can press (new-user feedback, 2026-11-21: "I wanted to go to earth
 * and followed the tips. But I couldn't go anywhere. The board button was
 * never available, so I couldn't ride").
 *
 * BOARD needs a destination. The pick step before it can be skipped, or its
 * taps can miss every dot, and a tap on a stop then only viewed it: nothing
 * the player did on the BOARD step could ever light BOARD, and BOARD said
 * nothing about why. Walked here, with the real HYPERSPACE panel rendered at
 * each step, as a new player with a chain head off the line:
 *
 * - the tips followed (TRAVEL TO EARTH, NEXT, a tap on a stop): BOARD is lit
 *   on the BOARD step, with nothing holding it;
 * - the pick step skipped: the BOARD step asks for a stop first (its note,
 *   and BOARD's own reason line), a tap on a stop picks it there, and BOARD
 *   lights;
 * - the stops still loading: BOARD says how far along, in plain words;
 * - outside the tour, no destination: BOARD says it needs one and offers
 *   PICK ONE.
 *
 * The relay module is replaced: nothing here reaches a relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

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
// The panel as hyperspaceRideChoice.test.ts renders it: no HOSAKA price, no workers, a station and stops to name.
vi.mock('../../hud/useRideQuote', () => ({ useRideQuote: () => ({ status: 'hidden' }) }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o() as object), postProof: () => {}, cancelProof: () => {} }))
vi.mock('../../lib/hyperspace/station', async (o) => ({ ...(await o() as object), findStation: () => ({ stop: { height: 100, kind: 'port', coordApprox: (5n << 200n) + 1n }, distance: 3 }) }))
vi.mock('../../store/useHyperspace', async (o) => ({
  ...(await o() as object),
  getStopByHeight: (height: number) => ({ height, kind: 'landfall', merkleRoot: 'ab'.repeat(32), blockHash: 'cd'.repeat(32), coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n }),
  getBlockHash: () => 'cd'.repeat(32),
  firstUnhashedHeight: () => null,
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

import { useCyberspace } from '../../store/useCyberspace'
import { ADVANCE_MS, useTutorial } from '../../store/useTutorial'
import { useHyperspace } from '../../store/useHyperspace'
import { usePanelLayout } from '../../store/usePanelLayout'
import { BOARD_NEEDS_DESTINATION, BOARD_TAP_A_STOP, HyperspacePanel, boardLoadingLine, selectStopInScene, useRideRun, useStopTapPicks } from '../../hud/HyperspacePanel'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { writeProgress } from '../gate'
import { EARTH_BOARD, TUTORIAL_SCRIPT } from '../script'
import { BOARD_PICK_FIRST_GLOW, BOARD_PICK_FIRST_NOTE } from '../earthRoute'
import '../director'

const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id
const html = (): string => renderToString(createElement(HyperspacePanel))
/** BOARD's opening tag, or null when the panel draws no BOARD. */
function board(page: string): string | null {
  const m = [...page.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map((x) => x[0]).find((b) => b.includes('hyper__btn--board'))
  return m ? m.slice(0, m.indexOf('>') + 1) : null
}
const lit = (page: string): boolean => { const b = board(page); return b !== null && !/\sdisabled=""/.test(b) }
const READY = { status: 'ready' as const, loaded: 111, total: 111, error: null, source: 'relay' as const }

/** Into the route from the "Where next?" card, as TRAVEL TO EARTH does, then NEXT on Earth. */
function toPickStep(): void {
  useTutorial.getState().start({ at: 'choice' })
  useTutorial.getState().choose('hyperspace')
  expect(id()).toBe('earth')
  useTutorial.getState().next()
  expect(id()).toBe('earth-pick')
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
  // A new player: one spawn signed, off the line, nothing chosen, the stops loaded.
  useCyberspace.setState({ events: [], transit: null, exploreIndex: null, spectate: null, chainConflict: null } as never)
  await placeSpawn()
  writeProgress(useCyberspace.getState().identity.pubkey, null)
  useHyperspace.setState({ destination: null, viewedStop: null, scrubHeight: null, tipHeight: 110, sync: READY })
  useRideRun.setState({ progress: null, hosaka: false, path: null, error: null, boarding: false })
  usePanelLayout.setState({ front: null })
})
afterEach(() => {
  useTutorial.getState().pause()
  vi.useRealTimers()
})

describe('the tips to Earth end at a BOARD a new player can press', () => {
  it('followed as written: a tap on a stop, then BOARD is lit with nothing holding it', () => {
    toPickStep()
    // Before a stop is picked, BOARD is dark and says why: a tap on a stop picks one here.
    expect(lit(html())).toBe(false)
    expect(html()).toContain(BOARD_TAP_A_STOP)

    selectStopInScene(105)
    expect(useHyperspace.getState().destination).toBe(105)
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(id()).toBe('earth-board')
    expect(useTutorial.getState().stepNote).toBeNull()
    // HYPERSPACE first in the menu, as the step says ("Your trip is at the top").
    expect(usePanelLayout.getState().front).toBe('hyperspace')

    const page = html()
    expect(lit(page), 'BOARD lit on the BOARD step').toBe(true)
    expect(page).not.toContain('hyper__why')
  })

  it('the pick step skipped: the BOARD step asks for a stop, a tap picks it there, and BOARD lights', () => {
    toPickStep()
    useTutorial.getState().next() // SKIP
    expect(id()).toBe('earth-board')
    expect(EARTH_BOARD.effect).toBe('board-step')
    expect(useHyperspace.getState().destination).toBeNull()

    // Dark, and said twice in plain words: the coach's line and BOARD's own.
    expect(lit(html())).toBe(false)
    expect(useTutorial.getState().stepNote).toBe(BOARD_PICK_FIRST_NOTE)
    expect(html()).toContain(BOARD_TAP_A_STOP)
    expect(html()).toContain('SHOW EARTH')
    // PICK ONE too, for when taps miss: the overlay's SET DESTINATION.
    expect(html()).toContain('PICK ONE')
    // The glow is on that line, not on a dark BOARD.
    expect(useTutorial.getState().stepHighlight).toBe(BOARD_PICK_FIRST_GLOW)

    // A tap on a stop here picks it (it used to only view it, and BOARD stayed dark for good).
    selectStopInScene(240)
    expect(useHyperspace.getState().destination).toBe(240)
    expect(useTutorial.getState().stepNote).toBeNull()
    expect(useTutorial.getState().stepHighlight).toBeNull()
    expect(id()).toBe('earth-board')
    expect(lit(html())).toBe(true)
    // A second tap keeps the stop picked: only views it.
    selectStopInScene(300)
    expect(useHyperspace.getState().destination).toBe(240)
  })

  it('a tap on a stop picks only while the tour asks for one; outside it a tap views', () => {
    toPickStep()
    expect(useStopTapPicks.getState().on).toBe(1)
    useTutorial.getState().pause()
    expect(useStopTapPicks.getState().on).toBe(0)
    selectStopInScene(105)
    expect(useHyperspace.getState().destination).toBeNull()
  })

  it('the stops still loading: BOARD says how far along, never "syncing the line"', () => {
    toPickStep()
    selectStopInScene(105)
    vi.advanceTimersByTime(ADVANCE_MS)
    useHyperspace.setState({ sync: { status: 'syncing', loaded: 487_000, total: 975_000, error: null, source: 'blobs' } })
    const page = html()
    expect(lit(page)).toBe(false)
    expect(page).toContain('LOADING THE STOPS: 49%. BOARD OPENS WHEN THEY ARE ALL IN')
    expect(page).not.toMatch(/SYNCING<\/p>|FINISHES SYNCING/)
    useHyperspace.setState({ sync: READY })
    expect(lit(html())).toBe(true)
  })

  it('outside the tour, no destination: BOARD says it needs one and offers PICK ONE', () => {
    useTutorial.getState().pause()
    const page = html()
    expect(lit(page)).toBe(false)
    expect(page).toContain(BOARD_NEEDS_DESTINATION)
    expect(page).toContain('PICK ONE')
    expect(page).not.toContain(BOARD_TAP_A_STOP)
    expect(page).not.toContain('SHOW EARTH')
    // Said once: the Destination group no longer repeats how.
    expect(page).toContain('None set.</p>')
  })

  it('says it plainly: no em dash, no "line" or "sync" jargon in what BOARD says', () => {
    const said = [BOARD_TAP_A_STOP, BOARD_NEEDS_DESTINATION, BOARD_PICK_FIRST_NOTE, boardLoadingLine({ status: 'syncing', loaded: 1, total: 2 }), boardLoadingLine({ status: 'error', loaded: 0, total: 0 })]
    for (const line of said) {
      expect(line).not.toContain('—')
      expect(line).not.toMatch(/\bline\b|sync/i)
    }
    expect(boardLoadingLine({ status: 'loading-cache', loaded: 0, total: 0 })).toContain('0%')
    // Never 100% while BOARD is still dark.
    expect(boardLoadingLine({ status: 'syncing', loaded: 975_000, total: 975_000 })).toContain('99%')
  })
})
