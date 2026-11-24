/**
 * crewChip.test.ts - the Crew chip answered by its keys (terrain/TerrainCrew.tsx):
 * a walker whose mouse is captured never has to free it. Enter adds; Enter
 * typed into a field, pressed on a button, or with a modal or the bag open is
 * left alone; a held Enter adds once. Esc goes through the shared Escape
 * stack as a chip, so a modal above it closes first and TERRAIN is not left.
 * And the chip names whom it asks: the nearest player within 8 gibsons, not
 * you, not in your Crew, not asked this visit.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

import { CREW_NEAR, crewChipKeys, nearbyToAsk, resetCrewOffers } from '../TerrainCrew'
import { useTerrain } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { usePresence } from '../../store/usePresence'
import { useShare } from '../../store/terrainShare'
import { escapeTop, registerEscape, topEscape } from '../../hooks/useEscape'

/** A stand-in for the window: the listeners it holds, and a key press delivered to them. */
function fakeWindow(): { on: EventTarget; press: (key: string, o?: { repeat?: boolean; inField?: boolean }) => { prevented: boolean }; count: () => number } {
  const held = new Set<(e: Event) => void>()
  const on = {
    addEventListener: (_t: string, l: (e: Event) => void) => { held.add(l) },
    removeEventListener: (_t: string, l: (e: Event) => void) => { held.delete(l) },
  } as unknown as EventTarget
  const press = (key: string, o: { repeat?: boolean; inField?: boolean } = {}) => {
    const out = { prevented: false }
    const ev = {
      key, repeat: !!o.repeat, metaKey: false, ctrlKey: false, altKey: false,
      target: o.inField ? { closest: () => ({}) } : { closest: () => null },
      preventDefault: () => { out.prevented = true }, stopImmediatePropagation: () => undefined,
    } as unknown as Event
    for (const l of held) l(ev)
    return out
  }
  return { on, press, count: () => held.size }
}

beforeEach(() => {
  useTerrain.setState({ sheet: false })
  resetCrewOffers()
})

describe('the Crew chip\'s keys', () => {
  it('Enter adds, once for a held key; left to a field, a modal or the open bag', () => {
    const w = fakeWindow()
    let adds = 0
    const off = crewChipKeys(w.on, () => { adds++ })
    expect(w.press('Enter').prevented).toBe(true)
    expect(adds).toBe(1)
    w.press('Enter', { repeat: true })
    w.press('Enter', { inField: true })
    expect(adds).toBe(1)
    useTerrain.setState({ sheet: true })
    w.press('Enter')
    expect(adds).toBe(1)
    useTerrain.setState({ sheet: false })
    const closeModal = registerEscape('modal', () => undefined)
    w.press('Enter')
    expect(adds).toBe(1)
    closeModal()
    w.press('a')
    expect(adds).toBe(1)
    off()
    expect(w.count()).toBe(0)
  })

  it('Esc closes the chip as the most recent chip, after a modal above it', () => {
    let chip = 0, modal = 0
    const offChip = registerEscape('chip', () => { chip++ })
    const offModal = registerEscape('modal', () => { modal++ })
    expect(topEscape()?.layer).toBe('modal')
    escapeTop()
    expect([modal, chip]).toEqual([1, 0])
    offModal()
    escapeTop()
    expect(chip).toBe(1)
    offChip()
  })
})

describe('whom the chip asks', () => {
  it('the nearest player within 8 gibsons, not in your Crew, not asked this visit', () => {
    const me = useCyberspace.getState().identity.pubkey
    const at = { x: 1_000_000n, y: 1_000_000n, z: 1_000_000n }
    useCyberspace.setState({ position: { ...at }, cursor: { ...at }, walking: false, plane: 0 })
    const near = 'a'.repeat(64), far = 'b'.repeat(64), crew = 'c'.repeat(64)
    const now = Math.floor(Date.now() / 1000)
    const person = (pk: string, d: bigint) => ({ pubkey: pk, position: { x: at.x + d, y: at.y, z: at.z }, plane: 0 as const, lastActive: now, type: 'hop' as const, checkedAt: now, actionId: 'f'.repeat(64) })
    usePresence.setState({ people: { [near]: person(near, 3n), [far]: person(far, BigInt(CREW_NEAR + 1)), [crew]: person(crew, 1n), [me]: person(me, 0n) } } as never)
    useShare.setState({ crew: [crew] })
    expect(nearbyToAsk()).toBe(near)
  })
})
