/**
 * discovered.test.ts - which games an identity has found, for the GAMES panel
 * (lib/games/discovered.ts): none at first; a game noted on this device for
 * that identity (entered here, or offered by the tutorial's card), kept per
 * identity and past a page that would not keep it; a game whose entry is on
 * the chain; a game whose world bag opened here. Never a game that is off
 * here, so never the DEV dungeon on the production host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  return m
})

import type { ActionEvent } from '../../events'
import { FOUND_GAMES_PREFIX, discoveredGames, enterFromRefusal, enteredOnChain, noteFoundGame, notedGames, useFoundGames, worldsOpened } from '../discovered'
import { TUTORIAL_GAME } from '../tutorialGame'

const ME = 'a1'.repeat(32)
const OTHER = 'b2'.repeat(32)
const DUNGEON = TUTORIAL_GAME.pubkey
const inside = { ...TUTORIAL_GAME.region.base, x: TUTORIAL_GAME.region.base.x + 3n }

/** An action as far as the list reads it. */
const enter = (pubkey: string): ActionEvent => ({ role: 'enter', game: { pubkey, relayHint: '' } }) as unknown as ActionEvent
const hop = (): ActionEvent => ({ role: 'base' }) as unknown as ActionEvent

const found = (noted: string[] = [], chain: ActionEvent[] = [], finds: Parameters<typeof worldsOpened>[0] = []) =>
  discoveredGames({ noted, chain, finds }).map((g) => g.pubkey)

beforeEach(() => {
  mem.clear()
  // The DEV dungeon every test plays (src/test/noNetwork.ts) is on by this device's switch.
  mem.set('onosendai:games', '1')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('the games found', () => {
  it('none at first: nothing noted, no entry on the chain, no world opened', () => {
    expect(found()).toEqual([])
    expect(found([], [hop()])).toEqual([])
  })

  it('the tutorial dungeon once noted (entered here, or offered by the card)', () => {
    expect(found([DUNGEON])).toEqual([DUNGEON])
  })

  it('a game whose entry is on the chain, its bracket open or closed', () => {
    expect(enteredOnChain([hop(), enter(DUNGEON), hop()])).toEqual([DUNGEON])
    expect(found([], [hop(), enter(DUNGEON)])).toEqual([DUNGEON])
  })

  it('a game whose world bag opened here: signed by its key, inside its region, in its plane', () => {
    const plane = TUTORIAL_GAME.region.plane
    expect(found([], [], [{ author: DUNGEON, at: inside, plane }])).toEqual([DUNGEON])
    // Another author in the region, the game key elsewhere, or the other plane: not its world.
    expect(found([], [], [{ author: OTHER, at: inside, plane }])).toEqual([])
    expect(found([], [], [{ author: DUNGEON, at: { x: 0n, y: 0n, z: 0n }, plane }])).toEqual([])
    expect(found([], [], [{ author: DUNGEON, at: inside, plane: plane === 1 ? 0 : 1 }])).toEqual([])
  })

  it('never a game ONOSENDAI does not implement', () => {
    expect(found([OTHER], [enter(OTHER)])).toEqual([])
  })

  it('never a game that is off here: the DEV dungeon with the switch off, or on the production host whatever the switch', () => {
    mem.delete('onosendai:games')
    expect(found([DUNGEON], [enter(DUNGEON)])).toEqual([])
    mem.set('onosendai:games', '1')
    vi.stubGlobal('location', { hostname: 'onosendai.tech', search: '' })
    vi.stubEnv('DEV', false)
    expect(found([DUNGEON], [enter(DUNGEON)])).toEqual([])
  })
})

describe('the notes, per identity on this device', () => {
  it('kept for the identity that found it, and no other', () => {
    expect(notedGames(ME)).toEqual([])
    const v = useFoundGames.getState().version
    noteFoundGame(ME, DUNGEON)
    expect(notedGames(ME)).toEqual([DUNGEON])
    expect(notedGames(OTHER)).toEqual([])
    expect(JSON.parse(mem.get(FOUND_GAMES_PREFIX + ME)!)).toEqual([DUNGEON])
    expect(useFoundGames.getState().version).toBe(v + 1)
    // Noted again: nothing written, nothing drawn again.
    noteFoundGame(ME, DUNGEON)
    expect(useFoundGames.getState().version).toBe(v + 1)
  })

  it('ignores junk: no identity, a key that is not 64 hex, a stored list that is not one', () => {
    noteFoundGame('', DUNGEON)
    noteFoundGame(ME, 'not a key')
    expect(notedGames(ME)).toEqual([])
    mem.set(FOUND_GAMES_PREFIX + OTHER, '{"x":1}')
    expect(notedGames(OTHER)).toEqual([])
    mem.set(FOUND_GAMES_PREFIX + OTHER, `[7, "zz", "${DUNGEON}"]`)
    expect(notedGames(OTHER)).toEqual([DUNGEON])
  })

  it('a device that will not keep it (private mode) keeps it for the page', () => {
    const real = globalThis.localStorage
    vi.stubGlobal('localStorage', { ...real, setItem: () => { throw new Error('quota') }, getItem: () => { throw new Error('denied') } })
    noteFoundGame(OTHER, DUNGEON)
    expect(notedGames(OTHER)).toEqual([DUNGEON])
  })
})

describe('the seam for a game entered only from a certain place', () => {
  it('says nothing today: every game is entered from anywhere (owner, 2026-11-13)', () => {
    expect(enterFromRefusal(TUTORIAL_GAME)).toBeNull()
  })
})
