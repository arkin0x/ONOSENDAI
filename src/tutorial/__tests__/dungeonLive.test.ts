/**
 * dungeonLive.test.ts - once the tutorial dungeon's key is the owner's (a
 * live game, lib/games/flag.ts), the final card offers DUNGEON on the
 * production host with no switch set, and the game is one ONOSENDAI plays
 * there. The game module is the live one here (a real-looking key); nothing
 * is entered, so nothing publishes.
 */
import { describe, expect, it, vi } from 'vitest'

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
  // The production host, in a production build, before any module reads it.
  ;(globalThis as { location?: unknown }).location = { hostname: 'onosendai.tech', search: '' }
})

const OWNER = vi.hoisted(() => 'cd'.repeat(32))
vi.mock('../../lib/games/tutorialGame', async (orig) => {
  const real = await orig<typeof import('../../lib/games/tutorialGame')>()
  return { ...real, TUTORIAL_PUBKEY: OWNER, TUTORIAL_GAME: real.tutorialGameFor(OWNER) }
})

import { choiceOffered, useTutorial } from '../../store/useTutorial'
import { CHOICE } from '../script'
import { registerDungeonChoice } from '../dungeon'
import { gamesEnabled } from '../../lib/games/flag'
import { gameFor } from '../../lib/games/registry'
import { tutorialDungeonEnabled } from '../../store/useGame'

describe('the DUNGEON choice once the game is live', () => {
  it('is offered on production with no switch set, and the game is played there', () => {
    vi.stubEnv('DEV', false)
    try {
      // No device switch: the DUNGEON comes from the game being live, not from ?games=1.
      expect(gamesEnabled()).toBe(false)
      expect(tutorialDungeonEnabled()).toBe(true)
      useTutorial.setState({ script: { steps: [CHOICE] } })
      expect(registerDungeonChoice()).toBe(true)
      expect(choiceOffered(CHOICE.choices!.find((c) => c.id === 'dungeon')!)).toBe(true)
      expect(gameFor(OWNER)?.pubkey).toBe(OWNER)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
