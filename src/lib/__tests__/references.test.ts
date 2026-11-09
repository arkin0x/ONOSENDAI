/** references.test.ts - a reference's relay hint is honored only when it is already one of the user's relays. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const asked: string[][] = []
const filters: Array<Record<string, unknown>> = []
const held: Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][] }> = []
vi.mock('../relay', () => ({
  queryAny: vi.fn(async (relays: string[], filter: { kinds?: number[]; authors?: string[]; '#d'?: string[]; ids?: string[] }) => {
    asked.push(relays)
    filters.push(filter)
    return held.filter((e) => (!filter.ids || filter.ids.includes(e.id)) && (!filter.kinds || filter.kinds.includes(e.kind)) && (!filter.authors || filter.authors.includes(e.pubkey)) && (!filter['#d'] || filter['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  }),
  relaySet: () => ['wss://mine.test', 'wss://also-mine.test'],
}))

import { REFERENCE_BATCH, REFERENCES_KEPT_BYTES, forgetReferences, referencesKept, resolveReference } from '../references'

beforeEach(() => { asked.length = 0; filters.length = 0; held.length = 0; forgetReferences() })

describe('resolveReference', () => {
  it('ignores a hint that is not one of the user relays', async () => {
    await resolveReference(['e', '1'.repeat(64), 'wss://tracker.example', ''])
    expect(asked).toEqual([['wss://mine.test', 'wss://also-mine.test']])
  })
  it('asks a hint first when it is one of the user relays', async () => {
    await resolveReference(['e', '2'.repeat(64), 'wss://also-mine.test', ''])
    expect(asked).toEqual([['wss://also-mine.test', 'wss://mine.test']])
  })
  it('remembers an answer, including a miss, for a minute', async () => {
    const ref = ['e', '3'.repeat(64), '', '']
    await resolveReference(ref)
    await resolveReference(ref)
    expect(asked).toHaveLength(1)
  })
})

describe('batched fetching (spec §7.6 Reading, rule 2)', () => {
  const author = 'ab'.repeat(32)
  it('a bag’s sealed entries asked for together go out as one query per chunk of addresses, and each gets its own event', async () => {
    const ds = Array.from({ length: 2 * REFERENCE_BATCH }, (_, i) => `${i}`.padStart(32, '0'))
    for (const [i, d] of ds.entries()) held.push({ id: `${i}`.padStart(64, 'f'), kind: 33335, pubkey: author, created_at: 1000 + i, tags: [['d', d]] })
    const got = await Promise.all(ds.map((d) => resolveReference(['a', `33335:${author}:${d}`, '', 'c'.repeat(64)])))
    expect(filters).toHaveLength(2)
    expect(filters.every((f) => (f['#d'] as string[]).length === REFERENCE_BATCH && (f.kinds as number[])[0] === 33335 && (f.authors as string[])[0] === author)).toBe(true)
    expect(got.map((e) => e?.tags[0][1])).toEqual(ds)
  })
  it('an address answers with its newest event', async () => {
    const d = 'n'.repeat(32)
    held.push({ id: '1'.repeat(64), kind: 33335, pubkey: author, created_at: 5, tags: [['d', d]] }, { id: '2'.repeat(64), kind: 33335, pubkey: author, created_at: 9, tags: [['d', d]] })
    expect((await resolveReference(['a', `33335:${author}:${d}`, '', '']))?.id).toBe('2'.repeat(64))
  })
  it('a hint to a relay the user does not use is never asked, in a batch too', async () => {
    await Promise.all([0, 1, 2].map((i) => resolveReference(['a', `33335:${author}:${'h'.repeat(31)}${i}`, 'wss://beacon.example', ''])))
    expect(asked.flat()).not.toContain('wss://beacon.example')
  })
})

describe('the answers kept (review of #645, should-fix 4)', () => {
  const author = 'cd'.repeat(32)
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('an answer past its minute goes at the next ask, whoever asks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await resolveReference(['e', '4'.repeat(64), '', ''])
      await resolveReference(['e', '5'.repeat(64), '', ''])
      expect(referencesKept().count).toBe(2)
      vi.setSystemTime(Date.now() + 61_000)
      await resolveReference(['e', '6'.repeat(64), '', ''])
      // The two old answers went; only the new one is kept.
      expect(referencesKept().count).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the events kept take no more than the byte budget, oldest first out', async () => {
    forgetReferences(20_000)
    const ds = Array.from({ length: 10 }, (_, i) => `${i}`.padStart(32, 'b'))
    for (const [i, d] of ds.entries()) held.push({ id: `${i}`.padStart(64, 'e'), kind: 33335, pubkey: author, created_at: 1000 + i, tags: [['d', d], ['encrypted', 'aes-256-gcm', 'x'.repeat(5_000), 'cyberspace:region']] })
    for (const d of ds) { await resolveReference(['a', `33335:${author}:${d}`, '', '']); await tick() }
    const kept = referencesKept()
    expect(kept.bytes).toBeLessThanOrEqual(20_000)
    expect(kept.count).toBeLessThan(ds.length)
    // The newest is still kept: asked again, it is not fetched again.
    const before = filters.length
    await resolveReference(['a', `33335:${author}:${ds[ds.length - 1]}`, '', ''])
    expect(filters.length).toBe(before)
    expect(REFERENCES_KEPT_BYTES).toBeGreaterThan(0)
  })
})
