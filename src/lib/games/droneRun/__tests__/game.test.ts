/**
 * game.test.ts - DRONE RUN as a game this client implements: its region by
 * the tutorial dungeon's recipe, its region tag, and THE SWITCH. Its DEV key
 * is a placeholder: never LIVE, never on at the production host, on only by
 * this device's switch elsewhere, and always leavable (registry canLeave), so
 * a chain inside its bracket is never stranded.
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

import { sha256 } from '@noble/hashes/sha2.js'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { bytesToHex, positionHex } from '../../../events'
import { deviceSwitchHonoured, gameEnabled, gameLive, gamesEnabled, turnGamesOnHere } from '../../flag'
import { canLeave, gameFor, implementedGames } from '../../registry'
import { regionTag } from '../../bracket'
import { tutorialGameFor, TUTORIAL_DEV_PUBKEY } from '../../tutorialGame'
import { DRONE_RUN_BASE, DRONE_RUN_BASE_SEED, DRONE_RUN_DEV_PUBKEY, DRONE_RUN_GAME, DRONE_RUN_HEIGHT, droneRunAt } from '../game'
import type { Position } from '../../../space'

/** The tutorial dungeon's recipe: sha256 of the words read as a coordinate, each axis aligned to 2^height. */
function baseOf(words: string, height: number): Position {
  const { x, y, z } = coordToXyz(hexToCoord(bytesToHex(sha256(new TextEncoder().encode(words)))))
  const h = BigInt(height)
  return { x: (x >> h) << h, y: (y >> h) << h, z: (z >> h) << h }
}

function onProduction(): void {
  vi.stubGlobal('location', { hostname: 'www.onosendai.tech', search: '' })
  vi.stubEnv('DEV', false)
}
function onPreview(): void {
  vi.stubGlobal('location', { hostname: 'onosendai-git-game-drone-run.vercel.app', search: '' })
  vi.stubEnv('DEV', false)
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('the region', () => {
  it('is the tutorial dungeon\'s recipe with its own words, at height 8 in ideaspace', () => {
    // The recipe, checked on the tutorial dungeon's own base first.
    expect(baseOf('ONOSENDAI tutorial dungeon', 6)).toEqual(tutorialGameFor(TUTORIAL_DEV_PUBKEY).region.base)
    expect(DRONE_RUN_BASE_SEED).toBe('ONOSENDAI drone run')
    expect(baseOf(DRONE_RUN_BASE_SEED, 8)).toEqual(DRONE_RUN_BASE)
    expect(DRONE_RUN_GAME.region).toEqual({ base: DRONE_RUN_BASE, height: 8, plane: 1 })
    expect(DRONE_RUN_HEIGHT).toBe(8)
    expect(droneRunAt(1, 2, 3)).toEqual({ x: DRONE_RUN_BASE.x + 1n, y: DRONE_RUN_BASE.y + 2n, z: DRONE_RUN_BASE.z + 3n })
  })

  it('writes the region tag every entry carries: the aligned base in ideaspace and the height', () => {
    expect(regionTag(DRONE_RUN_GAME)).toEqual(['region', positionHex(DRONE_RUN_BASE, 1), '8'])
  })

  it('is a placeholder game: DEV key, no relay hint, no pads, a fixture world, played as DRONE RUN', () => {
    expect(DRONE_RUN_GAME.pubkey).toBe(DRONE_RUN_DEV_PUBKEY)
    expect(DRONE_RUN_GAME.name).toBe('DRONE RUN')
    expect(DRONE_RUN_GAME.relayHint).toBe('')
    expect(DRONE_RUN_GAME.pads).toEqual([])
    expect(DRONE_RUN_GAME.world.kind).toBe('fixture')
    expect(DRONE_RUN_GAME.play).toEqual({ kind: 'drone-run', variant: 'drone-run-base' })
    // None of the dungeon's rules.
    expect(DRONE_RUN_GAME.gravity).toBeUndefined()
    expect(DRONE_RUN_GAME.keyBag).toBeUndefined()
    expect(DRONE_RUN_GAME.exit).toBeUndefined()
  })
})

describe('THE SWITCH', () => {
  it('the DEV key is a placeholder: never LIVE, whatever its world', () => {
    expect(gameLive(DRONE_RUN_GAME)).toBe(false)
    expect(gameLive({ ...DRONE_RUN_GAME, world: { kind: 'relays' } })).toBe(false)
  })

  it('off on the production host, even with the device switch set', () => {
    localStorage.setItem('onosendai:games', '1')
    onProduction()
    expect(deviceSwitchHonoured()).toBe(false)
    expect(turnGamesOnHere()).toBe(false)
    expect(gameEnabled(DRONE_RUN_GAME)).toBe(false)
    expect(gameFor(DRONE_RUN_DEV_PUBKEY)).toBeNull()
    expect(implementedGames().map((g) => g.pubkey)).not.toContain(DRONE_RUN_DEV_PUBKEY)
  })

  it('off a preview by default; on by the device switch alone', () => {
    onPreview()
    expect(gameEnabled(DRONE_RUN_GAME)).toBe(false)
    expect(turnGamesOnHere()).toBe(true)
    expect(gamesEnabled()).toBe(true)
    expect(gameFor(DRONE_RUN_DEV_PUBKEY)).toBe(DRONE_RUN_GAME)
    expect(implementedGames()).toContain(DRONE_RUN_GAME)
  })

  it('always leavable, the switch off and on the production host too', () => {
    onProduction()
    expect(canLeave(DRONE_RUN_DEV_PUBKEY)).toBe(true)
  })
})
