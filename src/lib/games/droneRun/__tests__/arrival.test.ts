/**
 * arrival.test.ts - ?game=drone-run on arrival (store/gameArrival.ts): off
 * the production host it switches to LOCAL before anything can be signed,
 * turns games on for the device, sets the first-arrival tutorial aside for
 * the load, takes itself off the address, and once the saved chain is in
 * offers DRONE RUN in GAMES (the menu open, GAMES unfolded and first) until a
 * game opens. On the production host it does nothing at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => [],
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { gameArrivalPending, offerArrivalGame, takeGameArrival, watchGameArrival } from '../../../../store/gameArrival'
import { useCyberspace } from '../../../../store/useCyberspace'
import { usePanelLayout } from '../../../../store/usePanelLayout'
import { useGame } from '../../../../store/useGame'
import { arrivalModeAsked, noteArrivalModeAsked } from '../../../../tutorial/gate'
import { gamesEnabled } from '../../flag'
import { DRONE_RUN_GAME } from '../game'

/** An address and a history that records what replaceState put in it. */
function address(search: string): { loc: Pick<Location, 'pathname' | 'search' | 'hash'>; history: Pick<History, 'replaceState' | 'state'>; now: () => string | null } {
  let now: string | null = null
  return { loc: { pathname: '/', search, hash: '' }, history: { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { now = String(url) } }, now: () => now }
}

function host(hostname: string): void {
  vi.stubGlobal('location', { hostname, search: '' })
  vi.stubEnv('DEV', false)
}

beforeEach(() => {
  localStorage.clear()
  noteArrivalModeAsked(false)
  useCyberspace.getState().setLive(true)
  useGame.setState({ session: null, busy: null, message: null })
  usePanelLayout.setState({ collapsed: { games: true }, front: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('?game=drone-run off the production host', () => {
  it('LOCAL at once, games on, the tutorial aside, and the flag off the address (others kept)', () => {
    host('onosendai-git-game-drone-run.vercel.app')
    const a = address('?game=drone-run&mode=view')
    expect(takeGameArrival(a.loc, a.history)).toBe('drone-run')
    expect(useCyberspace.getState().live).toBe(false)
    expect(localStorage.getItem('onosendai:live')).toBe('0')
    expect(gamesEnabled()).toBe(true)
    expect(arrivalModeAsked()).toBe(true)
    expect(a.now()).toBe('/?mode=view')
    expect(gameArrivalPending()).toBe('drone-run')
  })

  it('in a dev build on any host too', () => {
    vi.stubGlobal('location', { hostname: 'www.onosendai.tech', search: '' })
    vi.stubEnv('DEV', true)
    const a = address('?game=DRONE-RUN')
    expect(takeGameArrival(a.loc, a.history)).toBe('drone-run')
    expect(useCyberspace.getState().live).toBe(false)
  })

  it('offers DRONE RUN once the saved chain is in: GAMES unfolded and first, until a game opens', async () => {
    host('localhost')
    const a = address('?game=drone-run')
    takeGameArrival(a.loc, a.history)
    watchGameArrival()
    await vi.waitFor(() => expect(gameArrivalPending()).toBeNull())
    expect(usePanelLayout.getState().collapsed.games).toBeFalsy()
    expect(usePanelLayout.getState().front).toBe('games')
    // A game opens: GAMES goes back to its place.
    useGame.setState({ session: { game: DRONE_RUN_GAME } as never })
    expect(usePanelLayout.getState().front).toBeNull()
  })

  it('an unfolded GAMES stays unfolded', () => {
    usePanelLayout.setState({ collapsed: {} })
    offerArrivalGame()
    expect(usePanelLayout.getState().collapsed.games).toBeFalsy()
  })
})

describe('anywhere else', () => {
  it('does nothing on the production host: LIVE as it was, games off, the address untouched', () => {
    host('www.onosendai.tech')
    const a = address('?game=drone-run')
    expect(takeGameArrival(a.loc, a.history)).toBeNull()
    expect(useCyberspace.getState().live).toBe(true)
    expect(gamesEnabled()).toBe(false)
    expect(arrivalModeAsked()).toBe(false)
    expect(a.now()).toBeNull()
    expect(gameArrivalPending()).toBeNull()
  })

  it('ignores a game it does not know, and no flag at all', () => {
    host('localhost')
    for (const search of ['?game=tetris', '', '?games=1']) {
      const a = address(search)
      expect(takeGameArrival(a.loc, a.history)).toBeNull()
      expect(a.now()).toBeNull()
    }
    expect(useCyberspace.getState().live).toBe(true)
  })
})
