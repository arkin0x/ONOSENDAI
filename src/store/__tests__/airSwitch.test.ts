/**
 * airSwitch.test.ts - air placing on or off (store/airSwitch.ts; owner,
 * 2026-11-27: "Tapping the middle of the place distance button should toggle
 * it off so you can't see the place cube. Tap again to toggle it on."): on by
 * default, kept per identity under its own pubkey in IndexedDB (kvStore's
 * moved prefixes), another identity's choice its own, a switch deleting
 * nothing; and with it off, PLACE with nothing at the cross does nothing,
 * saying how to turn it back on once a page, never at every press.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AIR_OFF_HINT, AIR_PLACE_PREFIX, airPlacing, airPlacingFor, forgetAirSwitch, setAirPlacing, toggleAirPlacing } from '../airSwitch'
import { kvGet, movesToKv } from '../../lib/kvStore'
import { useCyberspace } from '../useCyberspace'
import { setTerrainSession, useTerrain, type TerrainSession } from '../useTerrain'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const asWho = (pubkey: string): void => useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey } })

let before: { pubkey: string; npub: string }
beforeEach(() => {
  before = useCyberspace.getState().identity
  localStorage.removeItem(AIR_PLACE_PREFIX + ALICE)
  localStorage.removeItem(AIR_PLACE_PREFIX + BOB)
  forgetAirSwitch()
  asWho(ALICE)
})
afterEach(() => {
  useCyberspace.setState({ identity: before })
  localStorage.removeItem(AIR_PLACE_PREFIX + ALICE)
  localStorage.removeItem(AIR_PLACE_PREFIX + BOB)
  forgetAirSwitch()
})

describe('air placing, kept per identity', () => {
  it('is on with no choice made, and its record is one IndexedDB keeps (kvStore moves the prefix)', () => {
    expect(airPlacing()).toBe(true)
    expect(movesToKv(AIR_PLACE_PREFIX + ALICE)).toBe(true)
  })

  it('a tap turns it off and the next back on, each kept under the identity\'s own pubkey', () => {
    expect(toggleAirPlacing()).toBe(false)
    expect(airPlacing()).toBe(false)
    expect(kvGet(AIR_PLACE_PREFIX + ALICE)).toBe('0')
    expect(toggleAirPlacing()).toBe(true)
    expect(airPlacing()).toBe(true)
    expect(kvGet(AIR_PLACE_PREFIX + ALICE)).toBe('1')
  })

  it('another identity has its own choice, and switching between them deletes neither', () => {
    setAirPlacing(false)
    asWho(BOB)
    expect(airPlacing()).toBe(true)
    asWho(ALICE)
    expect(airPlacing()).toBe(false)
    expect(kvGet(AIR_PLACE_PREFIX + ALICE)).toBe('0')
    expect(kvGet(AIR_PLACE_PREFIX + BOB)).toBeNull()
    // A reload reads the same.
    forgetAirSwitch()
    expect(airPlacingFor(ALICE)).toBe(false)
    expect(airPlacingFor(BOB)).toBe(true)
  })
})

describe('PLACE with air placing off', () => {
  const field = { world: { blockCs: () => 0 } } as unknown as TerrainSession
  let say: Mock<(message: string | null) => void>
  let real: (m: string | null) => void
  beforeEach(() => {
    real = useTerrain.getState().say
    say = vi.fn()
    const inv = useTerrain.getState().inventory
    useTerrain.setState({ say, inventory: { ...inv, hotbar: [8, ...inv.hotbar.slice(1)], counts: { ...inv.counts, 8: 5 }, slot: 0 } })
    setTerrainSession(field)
  })
  afterEach(() => { useTerrain.setState({ say: real }); setTerrainSession(null) })

  it('with nothing at the cross, places nothing and says how to turn it on the first time only', () => {
    setAirPlacing(false)
    expect(useTerrain.getState().place(null, null)).toBe(false)
    expect(say).toHaveBeenCalledTimes(1)
    expect(say).toHaveBeenCalledWith(AIR_OFF_HINT)
    expect(AIR_OFF_HINT).toBe('Air Placement: off. Tap the number under PLACE.')
    for (let i = 0; i < 5; i++) expect(useTerrain.getState().place(null, null)).toBe(false)
    expect(say).toHaveBeenCalledTimes(1)
  })

  it('on, PLACE with nothing at all to aim at stays as quiet as before', () => {
    expect(useTerrain.getState().place(null, null)).toBe(false)
    expect(say).not.toHaveBeenCalled()
  })

  it('off, with nothing in hand, no hint either (there would be no ghost to show)', () => {
    setAirPlacing(false)
    const inv = useTerrain.getState().inventory
    useTerrain.setState({ inventory: { ...inv, counts: {} } })
    expect(useTerrain.getState().place(null, null)).toBe(false)
    expect(say).not.toHaveBeenCalled()
  })
})

describe('H on a keyboard', () => {
  it('is not TERRAIN\'s (H is HOP\'s: review of #950): air placing stays as it was, and the key goes on', async () => {
    const { terrainKeys } = await import('../../terrain/TerrainView')
    const say = vi.fn()
    const real = useTerrain.getState().say
    useTerrain.setState({ say, sheet: false })
    const on = new EventTarget()
    const stop = terrainKeys(on)
    const press = (repeat = false): void => {
      const e = new Event('keydown', { cancelable: true })
      Object.assign(e, { code: 'KeyH', repeat, metaKey: false, ctrlKey: false, altKey: false })
      on.dispatchEvent(e)
    }
    const heard = vi.fn()
    on.addEventListener('keydown', (e) => heard(e.defaultPrevented))
    try {
      press(); press(true)
      expect(airPlacing()).toBe(true)
      expect(say).not.toHaveBeenCalled()
      // Neither taken nor stopped: the main keymap (hooks/useKeyboard.ts) hears it next.
      expect(heard).toHaveBeenCalledTimes(2)
      expect(heard).toHaveBeenLastCalledWith(false)
    } finally {
      stop()
      useTerrain.setState({ say: real })
    }
  })
})
