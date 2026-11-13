/**
 * gamesPanel.test.ts - GAMES in the menu (owner, 2026-11-13: "a game panel
 * in the menu UI so that you can enter a game that you've discovered
 * whenever you want"). It lists the games this identity found; ENTER goes
 * in through the one way in (useGame enter: enter-virtual from where you
 * stand, from anywhere), greyed out in every state no game can be entered
 * in; BACK INTO THE GAME stands in for it while the chain is inside that
 * game. Never the DEV dungeon on the production host. lib/relay is the
 * offline relay: nothing here is sent anywhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

const mem = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  // The DEV dungeon every test plays (src/test/noNetwork.ts) is on by this device's switch, from the first import.
  m.set('onosendai:games', '1')
  return m
})

vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => [],
}))

// A server render reads a zustand store's server snapshot; here each store's hook reads the live state.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { GamesPanel, NO_GAMES_LINE, TOUR_MESSAGE } from '../GamesPanel'
import { GAME_AT_HEAD_MESSAGE, GAME_BUSY_MESSAGE, GAME_CHOOSE_FIRST_MESSAGE, GAME_HOLDS_MESSAGE, GAME_IN_TRANSIT_MESSAGE, GAME_NEEDS_CHAIN_MESSAGE, useCyberspace } from '../../store/useCyberspace'
import { COVERED_MESSAGE, GAME_ALREADY_MESSAGE, WALK_BUSY_MESSAGE, useGame } from '../../store/useGame'
import { useWalk } from '../../store/useWalk'
import { useWorkshop } from '../../store/useWorkshop'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { useDemo } from '../../store/useDemo'
import { useTv } from '../../store/useTv'
import { useTutorial } from '../../store/useTutorial'
import { FOUND_GAMES_PREFIX, noteFoundGame, notedGames } from '../../lib/games/discovered'
import { TUTORIAL_GAME } from '../../lib/games/tutorialGame'
import { CHOICE } from '../../tutorial/script'
import { registerDungeonChoice } from '../../tutorial/dungeon'

type ButtonEl = ReactElement<{ disabled?: boolean; title?: string; onClick: () => void; children: ReactNode }>

const S = () => useCyberspace.getState()
const me = (): string => S().identity.pubkey
const DUNGEON = TUTORIAL_GAME.pubkey

/** The panel as drawn, and its buttons by label. */
function panel(): { html: string; button: (label: string) => ButtonEl | null } {
  let tree: ReactNode = null
  const html = renderToString(createElement(() => { tree = GamesPanel(); return tree as ReactElement }))
  const find = (node: ReactNode, label: string): ButtonEl | null => {
    if (Array.isArray(node)) { for (const n of node) { const hit = find(n, label); if (hit) return hit } return null }
    if (!isValidElement(node)) return null
    const props = node.props as { children?: ReactNode }
    if (node.type === 'button' && props.children === label) return node as ButtonEl
    return find(props.children, label)
  }
  return { html, button: (label) => find(tree, label) }
}

let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published' | 'position' | 'plane' | 'headPlane' | 'positionHistory' | 'chain'> | null = null

beforeEach(async () => {
  for (const k of [...mem.keys()]) if (k.startsWith(FOUND_GAMES_PREFIX)) mem.delete(k)
  // The DEV dungeon every test plays (src/test/noNetwork.ts) is on by this device's switch.
  mem.set('onosendai:games', '1')
  if (!fresh) {
    await placeSpawn()
    fresh = {
      events: [...S().events], prevEventId: S().prevEventId, genesisId: S().genesisId,
      published: { ...S().published }, position: S().position, plane: S().plane, headPlane: S().headPlane,
      positionHistory: [...S().positionHistory], chain: S().chain,
    }
  }
  useGame.setState({ session: null, busy: null, message: null })
  useCyberspace.setState({
    ...fresh, events: [...fresh.events], published: { ...fresh.published }, positionHistory: [...fresh.positionHistory],
    cursor: fresh.position, pendingTarget: null, chainConflict: null, plan: null,
    exploreIndex: null, spectate: null, focus: null, transit: null, walking: false,
    proof: { ...S().proof, status: 'idle', message: null },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  useTv.setState({ on: false })
  useDemo.setState({ active: false })
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useTutorial.setState({ active: false })
})

describe('the GAMES panel', () => {
  it('with nothing found: its title and one short line', () => {
    const { html, button } = panel()
    expect(html).toMatch(/^<section class="panel panel--games">/)
    expect(html).toContain('<h2>Games</h2>')
    expect(html).toContain(`<li class="avatars__empty">${NO_GAMES_LINE}</li>`)
    expect(button('ENTER')).toBeNull()
  })

  it('with the dungeon found: its name and ENTER, ready', () => {
    noteFoundGame(me(), DUNGEON)
    const { html, button } = panel()
    expect(html).toContain(TUTORIAL_GAME.name)
    expect(html).not.toContain(NO_GAMES_LINE)
    expect(button('ENTER')?.props.disabled).toBe(false)
  })

  it('lists a game whose entry is on the chain, entered from any client, and keeps it past a respawn (a new chain)', async () => {
    await S().enterGame(TUTORIAL_GAME)
    await S().exitGame()
    expect(notedGames(me())).toEqual([DUNGEON])
    expect(panel().html).toContain(TUTORIAL_GAME.name)
    useCyberspace.setState({ events: [...fresh!.events], genesisId: fresh!.genesisId, prevEventId: fresh!.prevEventId })
    expect(panel().html).toContain(TUTORIAL_GAME.name)
  })

  it('lists a game whose world bag opened here', async () => {
    const { useShards } = await import('../../store/useShards')
    const at = { ...TUTORIAL_GAME.region.base, y: TUTORIAL_GAME.region.base.y + 5n }
    const before = useShards.getState().discovered
    useShards.setState({ discovered: { w: { eventId: 'w', bagId: 'b', lookupId: 'l', author: DUNGEON, at, plane: TUTORIAL_GAME.region.plane, height: 6 } as never } })
    try {
      expect(panel().html).toContain(TUTORIAL_GAME.name)
      expect(notedGames(me())).toEqual([DUNGEON])
    } finally {
      useShards.setState({ discovered: before })
    }
    // A reload starts with no finds: still found.
    expect(panel().html).toContain(TUTORIAL_GAME.name)
  })

  it('ENTER goes in through useGame enter with that game, from where you stand: the entry is signed and the game noted', async () => {
    noteFoundGame(me(), DUNGEON)
    const enter = vi.spyOn(useGame.getState(), 'enter')
    const count = S().events.length
    panel().button('ENTER')!.props.onClick()
    expect(enter).toHaveBeenCalledWith(TUTORIAL_GAME)
    await enter.mock.results[0].value
    expect(S().events.length).toBe(count + 1)
    expect(S().actions().at(-1)?.role).toBe('enter')
    expect(useGame.getState().session?.game.pubkey).toBe(DUNGEON)
    useGame.setState({ session: null })
    await S().exitGame()
  })

  it('a game entered through useGame is noted for the identity, so a respawn forgets nothing', async () => {
    expect(notedGames(me())).toEqual([])
    expect(await useGame.getState().enter(TUTORIAL_GAME)).toBeNull()
    expect(notedGames(me())).toEqual([DUNGEON])
    useGame.setState({ session: null })
    await S().exitGame()
  })

  it('ENTER is greyed out, saying why, in every state no game can be entered in', () => {
    noteFoundGame(me(), DUNGEON)
    const greyed = (): ButtonEl => panel().button('ENTER')!
    const cases: Array<[string, () => void, () => void]> = [
      [GAME_IN_TRANSIT_MESSAGE, () => useCyberspace.setState({ transit: { stage: 'boarded' } as never }), () => useCyberspace.setState({ transit: null })],
      [COVERED_MESSAGE, () => useTv.setState({ on: true }), () => useTv.setState({ on: false })],
      [TOUR_MESSAGE, () => useDemo.setState({ active: true }), () => useDemo.setState({ active: false })],
      [GAME_ALREADY_MESSAGE, () => useGame.setState({ busy: 'entering' }), () => useGame.setState({ busy: null })],
      [COVERED_MESSAGE, () => useWorkshop.setState({ open: true }), () => useWorkshop.setState({ open: false })],
      [WALK_BUSY_MESSAGE, () => useWalk.setState({ falling: true }), () => useWalk.setState({ falling: false })],
      [GAME_AT_HEAD_MESSAGE, () => useCyberspace.setState({ exploreIndex: 0 }), () => useCyberspace.setState({ exploreIndex: null })],
      [GAME_BUSY_MESSAGE, () => useCyberspace.setState({ proof: { ...S().proof, status: 'computing' } }), () => useCyberspace.setState({ proof: { ...S().proof, status: 'idle' } })],
      [GAME_CHOOSE_FIRST_MESSAGE, () => useCyberspace.setState({ chainConflict: {} as never }), () => useCyberspace.setState({ chainConflict: null })],
      [GAME_NEEDS_CHAIN_MESSAGE, () => useCyberspace.setState({ events: [], genesisId: '', prevEventId: '' }), () => useCyberspace.setState({ events: [...fresh!.events], genesisId: fresh!.genesisId, prevEventId: fresh!.prevEventId })],
    ]
    for (const [why, on, off] of cases) {
      on()
      try {
        const b = greyed()
        expect(b.props.disabled, why).toBe(true)
        expect(b.props.title).toBe(why)
      } finally { off() }
      expect(greyed().props.disabled).toBe(false)
    }
  })

  it('inside the game: BACK INTO THE GAME in place of ENTER, which goes back in without signing', async () => {
    noteFoundGame(me(), DUNGEON)
    await S().enterGame(TUTORIAL_GAME)
    const count = S().events.length
    const { button } = panel()
    expect(button('ENTER')).toBeNull()
    const back = button('BACK INTO THE GAME')!
    expect(back.props.disabled).toBe(false)
    back.props.onClick()
    expect(useGame.getState().session?.game.pubkey).toBe(DUNGEON)
    expect(S().events.length).toBe(count)
    // On screen already: nothing to go back into.
    expect(panel().button('BACK INTO THE GAME')!.props.disabled).toBe(true)
    useGame.setState({ session: null })
    await S().exitGame()
  })

  it('inside a game, another game found is greyed out: one game at a time', async () => {
    noteFoundGame(me(), DUNGEON)
    await S().enterGame({ ...TUTORIAL_GAME, pubkey: 'ef'.repeat(32) })
    try {
      // The chain is held by a game this client never played: the dungeon cannot be entered now.
      const b = panel().button('ENTER')!
      expect(b.props.disabled).toBe(true)
      expect(b.props.title).toBe(GAME_HOLDS_MESSAGE)
    } finally {
      await S().exitGame()
    }
  })

  it('never offers the DEV dungeon on the production host, found or not', () => {
    noteFoundGame(me(), DUNGEON)
    vi.stubGlobal('location', { hostname: 'onosendai.tech', search: '' })
    vi.stubEnv('DEV', false)
    const { html, button } = panel()
    expect(html).not.toContain(TUTORIAL_GAME.name)
    expect(html).toContain(NO_GAMES_LINE)
    expect(button('ENTER')).toBeNull()
  })

  it('the tutorial\'s "Where next?" card offering DUNGEON notes it for that identity', () => {
    expect(registerDungeonChoice()).toBe(true)
    const index = useTutorial.getState().script.steps.findIndex((s) => s.id === CHOICE.id)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(notedGames(me())).toEqual([])
    useTutorial.setState({ active: true, pubkey: me(), index })
    expect(notedGames(me())).toEqual([DUNGEON])
  })
})
