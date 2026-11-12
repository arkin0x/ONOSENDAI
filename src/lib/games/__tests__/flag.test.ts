/**
 * flag.test.ts - THE SWITCH (lib/games/flag.ts): a game that is not live is
 * on only by this device's switch and never on the production host, exactly
 * as before; a live game (a real key, its world on the relays) is on
 * everywhere, production included. The one line that makes the tutorial
 * dungeon live is TUTORIAL_PUBKEY, and while it is the DEV key nothing on
 * production changes.
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

import { gameEnabled, gameLive, gamesEnabled } from '../flag'
import { gameFor } from '../registry'
import { TUTORIAL_DEV_PUBKEY, TUTORIAL_FIXTURE_WORLD, TUTORIAL_PUBKEY, TUTORIAL_RELAY, tutorialGameFor } from '../tutorialGame'

const REAL = 'ab'.repeat(32)
const dev = tutorialGameFor(TUTORIAL_DEV_PUBKEY)
const real = tutorialGameFor(REAL)

/** The production host, in a production build. */
function onProduction(): void {
  vi.stubGlobal('location', { hostname: 'onosendai.tech', search: '' })
  vi.stubEnv('DEV', false)
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('a live game', () => {
  it('is a real key with its world on the relays: never the DEV key, never a fixture, never malformed', () => {
    expect(gameLive(real)).toBe(true)
    expect(gameLive(dev)).toBe(false)
    expect(gameLive({ ...real, world: TUTORIAL_FIXTURE_WORLD })).toBe(false)
    expect(gameLive({ ...dev, world: { kind: 'relays' } })).toBe(false)
    expect(gameLive({ ...real, pubkey: 'AB'.repeat(32) })).toBe(false)
    expect(gameLive({ ...real, pubkey: '' })).toBe(false)
  })

  it('the key alone decides the tutorial dungeon\'s world and relay hint', () => {
    expect(dev.world).toBe(TUTORIAL_FIXTURE_WORLD)
    expect(dev.relayHint).toBe('')
    expect(real.world).toEqual({ kind: 'relays' })
    expect(real.relayHint).toBe(TUTORIAL_RELAY)
    // The rest of the game is the same under any key.
    const { pubkey: _a, relayHint: _b, world: _c, ...rulesDev } = dev
    const { pubkey: _d, relayHint: _e, world: _f, ...rulesReal } = real
    expect(rulesReal).toEqual(rulesDev)
  })
})

describe('on the production host', () => {
  it('the DEV game stays off, even with the device switch set: exactly as before', () => {
    localStorage.setItem('onosendai:games', '1')
    onProduction()
    expect(gamesEnabled()).toBe(false)
    expect(gameEnabled(dev)).toBe(false)
    expect(gameFor(TUTORIAL_DEV_PUBKEY)).toBeNull()
  })

  it('a live game is on, with no switch set', () => {
    onProduction()
    expect(gameEnabled(real)).toBe(true)
  })

  it('the tutorial dungeon as shipped: off while its key is the DEV key, on once it is the owner\'s', () => {
    onProduction()
    const shipped = tutorialGameFor(TUTORIAL_PUBKEY)
    if (TUTORIAL_PUBKEY === TUTORIAL_DEV_PUBKEY) {
      expect(gameEnabled(shipped)).toBe(false)
      expect(shipped.world).toBe(TUTORIAL_FIXTURE_WORLD)
    } else {
      expect(gameEnabled(shipped)).toBe(true)
      expect(shipped.world).toEqual({ kind: 'relays' })
      expect(shipped.relayHint).toBe(TUTORIAL_RELAY)
    }
  })
})

describe('off the production host', () => {
  it('the DEV game is on by the device switch alone, as before', () => {
    vi.stubGlobal('location', { hostname: 'preview.vercel.app', search: '' })
    vi.stubEnv('DEV', false)
    expect(gameEnabled(dev)).toBe(false)
    localStorage.setItem('onosendai:games', '1')
    expect(gameEnabled(dev)).toBe(true)
    expect(gameFor(TUTORIAL_DEV_PUBKEY)).not.toBeNull()
  })
})
