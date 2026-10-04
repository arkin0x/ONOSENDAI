/**
 * budget.test.ts: which held keys go when places alone cannot bring storage
 * back under its budget, and the localStorage fallback's count.
 *
 * The order (arkinox, 2026-10-03): places first (db.test.ts and
 * secretsStorage.test.ts), then opened and crossed keys, oldest first, never
 * a bought key.
 */

import { describe, expect, it } from 'vitest'
import { bytesOf, earnedToEvict, trimByCount } from '../budget'
import type { HeldKey } from '../../../store/useSecrets'

const held = (id: string, source: HeldKey['source'], at: number): HeldKey => ({
  lookupId: id.repeat(32), keyHex: 'bb'.repeat(32), height: 8, base: { x: '0', y: '0', z: '0' }, plane: 0, source, at,
})

/** A bought key older than everything, so an order by age alone would take it first. */
const keys = {
  [held('b0', 'cloud', 1).lookupId]: held('b0', 'cloud', 1),
  [held('s1', 'scan', 10).lookupId]: held('s1', 'scan', 10),
  [held('h2', 'hop', 20).lookupId]: held('h2', 'hop', 20),
}

describe('the held keys eviction takes', () => {
  it('opened and crossed together, oldest first, only as many as the bytes need', () => {
    expect(earnedToEvict(keys, 1).map((k) => k.lookupId)).toEqual([held('s1', 'scan', 10).lookupId])
    const both = bytesOf(keys[held('s1', 'scan', 10).lookupId]) + 1
    expect(earnedToEvict(keys, both).map((k) => k.source)).toEqual(['scan', 'hop'])
  })

  it('never a bought key, however much is needed', () => {
    expect(earnedToEvict(keys, Number.MAX_SAFE_INTEGER).map((k) => k.source)).toEqual(['scan', 'hop'])
  })

  it('nothing when nothing is needed', () => {
    expect(earnedToEvict(keys, 0)).toEqual([])
  })
})

describe('the localStorage fallback count', () => {
  it('drops opened and crossed keys before a bought one, however old the bought one is', () => {
    expect(Object.keys(trimByCount(keys, 2)).sort()).toEqual([held('b0', 'cloud', 1).lookupId, held('h2', 'hop', 20).lookupId].sort())
  })

  it('keeps every bought key even past the count', () => {
    const bought = Object.fromEntries(['c1', 'c2', 'c3'].map((id, i) => [held(id, 'cloud', i).lookupId, held(id, 'cloud', i)]))
    expect(Object.keys(trimByCount({ ...bought, ...keys }, 2))).toHaveLength(4)
  })

  it('leaves the list alone under the count', () => {
    expect(trimByCount(keys, 3)).toBe(keys)
  })
})
