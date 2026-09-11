import { describe, expect, it } from 'vitest'
import { dayOf, headPrOf, resolveVersion, versionOf, UNVERSIONED } from './version'

// The real merges of 2026-09-10 and 2026-09-11 as GitHub reports them, in
// UTC: four late on the 10th Chicago time (03:24Z to 04:28Z on the 11th),
// two on the 11th (16:46Z).
const MERGED = [
  { number: 129, mergedAt: '2026-09-11T02:24:04Z' },
  { number: 131, mergedAt: '2026-09-11T04:26:33Z' },
  { number: 130, mergedAt: '2026-09-11T04:27:40Z' },
  { number: 135, mergedAt: '2026-09-11T04:28:51Z' },
  { number: 133, mergedAt: '2026-09-11T16:46:24Z' },
  { number: 134, mergedAt: '2026-09-11T16:46:59Z' },
]

const parts = (v: string): number[] => v.split('.').map(Number)
const before = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

describe('the build version', () => {
  it('reads the PR number off a squash-merge subject', () => {
    expect(headPrOf('LOOT lands holding the cubes around the destination (#134)')).toBe(134)
    expect(headPrOf('LOOT lands holding the cubes (#134)\n\nbody mentioning (#7)')).toBe(134)
    expect(headPrOf('Merge v2 into feat/experience')).toBeNull()
    expect(headPrOf(undefined)).toBeNull()
  })

  it('counts the day in Chicago, where a merge at 04:28Z is still the night before', () => {
    expect(dayOf('2026-09-11T04:28:51Z')).toBe('20260910')
    expect(dayOf('2026-09-11T16:46:59Z')).toBe('20260911')
  })

  it('is 2.20260911.2.134 for the second merge of the 11th, #134', () => {
    expect(versionOf(MERGED, 134)).toBe('2.20260911.2.134')
  })

  it('gives an older commit its own number again: #135 was the fourth of the 10th, #131 the second', () => {
    expect(versionOf(MERGED, 135)).toBe('2.20260910.4.135')
    expect(versionOf(MERGED, 131)).toBe('2.20260910.2.131')
  })

  it('versions a build that is not a merge as the newest merge', () => {
    expect(versionOf(MERGED, null)).toBe('2.20260911.2.134')
    expect(versionOf(MERGED, 999)).toBe('2.20260911.2.134')
  })

  it('only goes up across the merges, day boundary included', () => {
    const order = [129, 131, 130, 135, 133, 134].map((n) => versionOf(MERGED, n))
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1]} < ${order[i]}`).toBe(true)
  })

  it('says so rather than inventing a number when there is nothing to count', () => {
    expect(versionOf([], 134)).toBe(UNVERSIONED)
  })

  it('resolves from the environment first, then GitHub, and never throws', async () => {
    expect(await resolveVersion({ VITE_ONOSENDAI_VERSION: '2.1.1.1' }, null)).toBe('2.1.1.1')
    const ok = (async () => ({ ok: true, status: 200, json: async () => MERGED.map((p) => ({ number: p.number, merged_at: p.mergedAt })) })) as unknown as typeof fetch
    expect(await resolveVersion({}, 'x (#133)', ok)).toBe('2.20260911.1.133')
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await resolveVersion({}, 'x (#133)', down)).toBe(UNVERSIONED)
  })
})
