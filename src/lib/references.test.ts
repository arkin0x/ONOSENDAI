/** references.test.ts - a reference's relay hint is honored only when it is already one of the user's relays. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const asked: string[][] = []
vi.mock('./relay', () => ({
  queryAny: vi.fn(async (relays: string[]) => { asked.push(relays); return [] }),
  relaySet: () => ['wss://mine.test', 'wss://also-mine.test'],
}))

import { resolveReference } from './references'

beforeEach(() => { asked.length = 0 })

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
