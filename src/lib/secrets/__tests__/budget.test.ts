/**
 * budget.test.ts: what goes when region keys and places pass their budget.
 *
 * The order (arkinox, 2026-10-03): scanned places first, the one stood on
 * longest ago first, taking with them the cube keys no remaining place refers
 * to; then opened and crossed keys, oldest first; never a bought key.
 */

import { describe, expect, it } from 'vitest'
import { bytesOf, bytesOfAll, planEviction, trimByCount, type Kept } from '../budget'
import type { Place, PlaceKey } from '../places'
import type { HeldKey } from '../../../store/useSecrets'

const held = (id: string, source: HeldKey['source'], at: number): HeldKey => ({
  lookupId: id.repeat(32), keyHex: 'bb'.repeat(32), height: 8, base: { x: '0', y: '0', z: '0' }, plane: 0, source, at,
})
const pk = (id: string): PlaceKey => ({ lookupId: id, keyHex: 'cc'.repeat(32), height: 1, base: { x: '0', y: '0', z: '0' } })
const place = (id: string, at: number, keys: string[]): Place => ({
  id, position: { x: '0', y: '0', z: '0' }, plane: 0, keys, first: at, at,
})

/**
 * Two places sharing a cube key, two earned keys and one bought key, all
 * older to newer as listed. The bought key is the oldest of everything, so
 * an order by age alone would drop it first.
 */
function fixture(): Kept {
  return {
    keys: {
      [held('b0', 'cloud', 1).lookupId]: held('b0', 'cloud', 1),
      [held('s1', 'scan', 10).lookupId]: held('s1', 'scan', 10),
      [held('h2', 'hop', 20).lookupId]: held('h2', 'hop', 20),
    },
    places: {
      old: place('old', 100, ['k-old', 'k-shared']),
      new: place('new', 200, ['k-new', 'k-shared']),
    },
    placeKeys: { 'k-old': pk('k-old'), 'k-new': pk('k-new'), 'k-shared': pk('k-shared') },
  }
}

const total = (k: Kept): number =>
  bytesOfAll(Object.values(k.keys)) + bytesOfAll(Object.values(k.places)) + bytesOfAll(Object.values(k.placeKeys))

describe('the eviction order', () => {
  it('drops nothing while it fits', () => {
    const k = fixture()
    expect(planEviction(k, total(k), total(k))).toMatchObject({ places: [], placeKeys: [], keys: [], bytes: 0 })
  })

  it('takes the oldest place first, and only the keys no other place still uses', () => {
    const k = fixture()
    const plan = planEviction(k, total(k), total(k) - 1)
    expect(plan.places).toEqual(['old'])
    // k-shared is still the newer place's; only k-old was the old place's alone.
    expect(plan.placeKeys).toEqual(['k-old'])
    expect(plan.keys).toEqual([])
    expect(plan.bytes).toBe(bytesOf(k.places.old) + bytesOf(k.placeKeys['k-old']))
  })

  it('takes every place before any held key, and a shared key goes with the last place using it', () => {
    const k = fixture()
    const placesBytes = bytesOfAll(Object.values(k.places)) + bytesOfAll(Object.values(k.placeKeys))
    const plan = planEviction(k, total(k), total(k) - placesBytes)
    expect(plan.places).toEqual(['old', 'new'])
    expect(plan.placeKeys.sort()).toEqual(['k-new', 'k-old', 'k-shared'])
    expect(plan.keys).toEqual([])
  })

  it('then opened and crossed keys, oldest first', () => {
    const k = fixture()
    const placesBytes = bytesOfAll(Object.values(k.places)) + bytesOfAll(Object.values(k.placeKeys))
    const plan = planEviction(k, total(k), total(k) - placesBytes - 1)
    expect(plan.keys).toEqual([held('s1', 'scan', 10).lookupId])
  })

  it('never a bought key, even when everything else is gone and it is still over', () => {
    const k = fixture()
    const plan = planEviction(k, total(k), 0)
    expect(plan.keys).toEqual([held('s1', 'scan', 10).lookupId, held('h2', 'hop', 20).lookupId])
    expect(plan.keys).not.toContain(held('b0', 'cloud', 1).lookupId)
    // What is left over budget is exactly the bought key.
    expect(total(k) - plan.bytes).toBe(bytesOf(k.keys[held('b0', 'cloud', 1).lookupId]))
  })

  it('a place key no place refers to goes before any place', () => {
    const k = fixture()
    k.placeKeys.stray = pk('stray')
    const plan = planEviction(k, total(k), total(k) - 1)
    expect(plan.placeKeys).toEqual(['stray'])
    expect(plan.places).toEqual([])
  })
})

describe('the localStorage fallback count', () => {
  it('drops opened and crossed keys before a bought one, however old the bought one is', () => {
    const k = fixture().keys
    const out = trimByCount(k, 2)
    expect(Object.keys(out).sort()).toEqual([held('b0', 'cloud', 1).lookupId, held('h2', 'hop', 20).lookupId].sort())
  })

  it('leaves the list alone under the count', () => {
    const k = fixture().keys
    expect(trimByCount(k, 3)).toBe(k)
  })
})
