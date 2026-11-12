/**
 * dungeon.test.ts - the final card's DUNGEON (Track C, step C4): offered only
 * with games on for this device, its tap enters the tutorial dungeon, the card
 * goes once the game is on screen, and a refusal stays on the card in short
 * plain words.
 *
 * Game mode's entry is replaced (enterTutorialDungeon) so nothing publishes:
 * the real tutorial store, the real game store and the real registration run.
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

const entry = vi.hoisted(() => ({ calls: 0, next: (): Promise<string | null> => Promise.resolve(null) }))
vi.mock('../../store/useGame', async (orig) => {
  const real = await orig<typeof import('../../store/useGame')>()
  return { ...real, enterTutorialDungeon: () => { entry.calls++; return entry.next() } }
})

import { GAMES_OFF_MESSAGE, WALK_BUSY_MESSAGE, useGame, type GameSession } from '../../store/useGame'
import { choiceOffered, useTutorial } from '../../store/useTutorial'
import { CHOICE } from '../script'
import { DUNGEON_FAILED_MESSAGE, registerDungeonChoice } from '../dungeon'
import { GAME_BUSY_MESSAGE } from '../../store/useCyberspace'
import { VERSION_BLOCKED_MESSAGE } from '../../lib/versionGate'

const GAMES_KEY = 'onosendai:games'
const dungeon = CHOICE.choices!.find((c) => c.id === 'dungeon')!
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const offered = (): string[] => CHOICE.choices!.filter(choiceOffered).map((c) => c.id)

beforeEach(() => {
  entry.calls = 0
  entry.next = () => Promise.resolve(null)
  useGame.setState({ session: null, busy: null, message: null })
  useTutorial.setState({ script: { steps: [CHOICE] } })
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  vi.restoreAllMocks()
})

// One sequence: a registration cannot be taken back, so games-off is checked before games-on.
describe('the DUNGEON choice', () => {
  it('is not offered with games off (the default), for the DEV game every test plays (src/test/noNetwork.ts)', () => {
    localStorage.removeItem(GAMES_KEY)
    // Loading the module with games off registered nothing, and asking again registers nothing.
    expect(registerDungeonChoice()).toBe(false)
    expect(choiceOffered(dungeon)).toBe(false)
    expect(offered()).toEqual(['hyperspace', 'agents', 'friend', 'build'])
  })

  it('is offered with games on, and its tap enters the dungeon and ends the tutorial once the game is on screen', async () => {
    localStorage.setItem(GAMES_KEY, '1')
    expect(registerDungeonChoice()).toBe(true)
    expect(offered()).toEqual(['hyperspace', 'dungeon', 'agents', 'friend', 'build'])
    // The game comes on screen before its world is read: the card goes then, not after.
    entry.next = () => {
      useGame.setState({ session: { entryId: 'e'.repeat(64) } as unknown as GameSession })
      return new Promise(() => {})
    }
    useTutorial.getState().start()
    useTutorial.getState().choose('dungeon')
    expect(useTutorial.getState().choosing).toBe('dungeon')
    await settle()
    expect(entry.calls).toBe(1)
    expect(useTutorial.getState().active).toBe(false)
  })

  it('keeps the card on a refusal, with game mode\'s own words, and lets the player try again', async () => {
    entry.next = () => Promise.resolve(WALK_BUSY_MESSAGE)
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().choose('dungeon')
    await settle()
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().choosing).toBe(null)
    expect(useTutorial.getState().choiceNote).toBe(WALK_BUSY_MESSAGE)
    entry.next = () => Promise.resolve(null)
    useTutorial.getState().choose('dungeon')
    await settle()
    expect(entry.calls).toBe(2)
    expect(useTutorial.getState().active).toBe(false)
  })

  it('shows the chain\'s own refusals as they are, and a signer\'s or relay\'s raw error, or a throw, in plain words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useTutorial.getState().start({ restart: true })
    for (const words of [GAME_BUSY_MESSAGE, VERSION_BLOCKED_MESSAGE]) {
      entry.next = () => Promise.resolve(words)
      useTutorial.getState().choose('dungeon')
      await settle()
      expect(useTutorial.getState().choiceNote).toBe(words)
    }
    expect(warn).not.toHaveBeenCalled()
    for (const raw of ['Something went wrong: relay wss://x closed with code 1006', 'Signing failed: bunker said no']) {
      entry.next = () => Promise.resolve(raw)
      useTutorial.getState().choose('dungeon')
      await settle()
      expect(useTutorial.getState().choiceNote).toBe(DUNGEON_FAILED_MESSAGE)
    }
    entry.next = () => Promise.reject(new Error('boom'))
    useTutorial.getState().choose('dungeon')
    await settle()
    expect(useTutorial.getState().choiceNote).toBe(DUNGEON_FAILED_MESSAGE)
    expect(useTutorial.getState().active).toBe(true)
    // The words in full went to the console.
    expect(warn).toHaveBeenCalled()
  })

  it('a refusal that comes while some other game is already on screen is still a refusal', async () => {
    useGame.setState({ session: { entryId: 'f'.repeat(64) } as unknown as GameSession })
    entry.next = () => { useGame.setState({ busy: null }); return Promise.resolve(GAMES_OFF_MESSAGE) }
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().choose('dungeon')
    await settle()
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().choiceNote).toBe(GAMES_OFF_MESSAGE)
  })
})
