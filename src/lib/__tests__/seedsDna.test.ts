/**
 * seedsDna.test.ts: a seed's DNA (DECK-0008 §8.1, §8.2) is checked before it
 * is used (its id is its hash, its signature verifies, its text is valid
 * SEEDO, its caps tag well formed) and resolved once: memory, a bag's own,
 * IndexedDB, then one batched query to the relays (a mock here). A DNA nobody
 * had is asked for again only after a while.
 */

import { describe, expect, it, vi } from 'vitest'
import { checkDna, DnaResolver, MISSING_RETRY_MS } from '../seeds/dnaStore'
import type { NostrEvent } from '../events'
import { crystalDna, dnaOf } from './seedsFixture'

const crystal = crystalDna()
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('checking a DNA', () => {
  it('a written DNA at the free caps: its name, its caps and the base price', () => {
    expect(checkDna(copy(crystal), crystal.id)).toMatchObject({ state: 'ok', name: 'crystal', caps: { vertices: 2048, symbols: 2048, generations: 32 }, price: 16 })
    expect(checkDna(dnaOf(crystal.content, [['caps', '8000', '6000', '40']]), dnaOf(crystal.content, [['caps', '8000', '6000', '40']]).id)).toMatchObject({ state: 'ok', price: 21 })
  })

  it('refused: another id, a broken signature, invalid SEEDO, a malformed caps tag, the wrong kind', () => {
    expect(checkDna(copy(crystal), 'ab'.repeat(32)).state).toBe('invalid')
    expect(checkDna({ ...copy(crystal), sig: 'ab'.repeat(64) }, crystal.id).state).toBe('invalid')
    const bad = dnaOf('dna x\naxiom F(')
    expect(checkDna(bad, bad.id)).toMatchObject({ state: 'invalid', error: expect.any(String) })
    const caps = dnaOf(crystal.content, [['caps', '08000', '6000', '40']])
    expect(checkDna(caps, caps.id)).toMatchObject({ state: 'invalid', error: 'Its size limit is malformed.' })
    const shard = { ...copy(crystal), kind: 3330 }
    expect(checkDna(shard as NostrEvent, crystal.id).state).toBe('invalid')
  })

  it('an empty content is a mixed DNA', () => {
    const mixed = dnaOf('', [['e', 'aa'.repeat(32), '', 'mother']])
    expect(checkDna(mixed, mixed.id).state).toBe('mixed')
  })
})

describe('resolving a DNA', () => {
  it('two seeds of one DNA and one of another: one query, and the relay copy cached', async () => {
    const other = dnaOf(crystal.content.replace('dna     crystal', 'dna     quartz'))
    const fetch = vi.fn(async (ids: string[]) => [copy(crystal), copy(other)].filter((e) => ids.includes(e.id)))
    const save = vi.fn(async () => {})
    const r = new DnaResolver({ fetch, load: async () => undefined, save })
    const [a, b, c] = await Promise.all([r.resolve(crystal.id), r.resolve(crystal.id), r.resolve(other.id)])
    expect([a.state, b.state, c.state]).toEqual(['ok', 'ok', 'ok'])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0].sort()).toEqual([crystal.id, other.id].sort())
    expect(save).toHaveBeenCalledTimes(2)
    // Known now: no second query.
    await r.resolve(crystal.id)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('from IndexedDB before the relays', async () => {
    const fetch = vi.fn(async () => [])
    const r = new DnaResolver({ fetch, load: async (id) => (id === crystal.id ? copy(crystal) : undefined), save: async () => {} })
    expect((await r.resolve(crystal.id)).state).toBe('ok')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('missing: asked again only after a while', async () => {
    let now = 0
    const fetch = vi.fn(async () => [] as NostrEvent[])
    const r = new DnaResolver({ fetch, load: async () => undefined, save: async () => {} }, () => now)
    expect((await r.resolve(crystal.id)).state).toBe('missing')
    expect((await r.resolve(crystal.id)).state).toBe('missing')
    expect(fetch).toHaveBeenCalledTimes(1)
    now = MISSING_RETRY_MS + 1
    await r.resolve(crystal.id)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a relay that answers with another event under that id is not believed', async () => {
    const forged = { ...copy(crystal), content: 'dna forged\naxiom F' }
    const r = new DnaResolver({ fetch: async () => [forged], load: async () => undefined, save: async () => {} })
    expect((await r.resolve(crystal.id)).state).toBe('invalid')
  })
})
