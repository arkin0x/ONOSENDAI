/**
 * confirmChain.test.ts - confirming a head asks the canonical relay only for
 * what is new, and replaces a socket that went quiet (review of #236, items
 * 2 and 3).
 *
 * What would go wrong silently: every move downloading the whole chain
 * again, so a long chain on a slow link is never confirmed and every move is
 * refused; and a canonical socket gone silent, or one whose auth a signer
 * refused once, asked again on the second try, so every move is refused for
 * half a minute or more.
 */

import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ log: [] as string[], filters: [] as Array<Record<string, unknown>>, outcome: 'answered' as 'answered' | 'unreachable' }))
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  dropRelays: (relays: string[]) => { calls.log.push(`drop ${relays.join(',')}`) },
  queryEachAt: async (relays: string[], filter: Record<string, unknown>) => {
    calls.log.push(`ask ${relays.join(',')}`)
    calls.filters.push(filter)
    return relays.map((url) => (calls.outcome === 'answered' ? { url, outcome: 'answered', events: [] } : { url, outcome: 'unreachable', reason: 'no answer in time', events: [] }))
  },
}))

import { normalizeURL } from 'nostr-tools/utils'
import { confirmChainEvents } from '../chains'
import { CYBERSPACE_RELAY } from '../relay'
import { spawnTemplate, type NostrEvent } from '../events'

const PK = 'ab'.repeat(32)
const spawn: NostrEvent = { ...spawnTemplate(PK, 1_000), id: 'cd'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
const canonical = normalizeURL(CYBERSPACE_RELAY)
const reset = (): void => { calls.log = []; calls.filters = []; calls.outcome = 'answered' }

describe('confirming a head against the canonical relay', () => {
  it('asks the chain only from `since` on, inclusive, and the spawns whole', async () => {
    reset()
    expect(await confirmChainEvents(PK, spawn.id, [spawn], { since: 1_234 })).toEqual([])
    const chainAsk = calls.filters.find((f) => Array.isArray(f['#e']))
    const spawnsAsk = calls.filters.find((f) => Array.isArray(f['#A']))
    expect(chainAsk).toMatchObject({ '#e': [spawn.id], since: 1_234 })
    expect(spawnsAsk).not.toHaveProperty('since')
  })

  it('without `since`, asks the whole chain, as before', async () => {
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn])
    expect(calls.filters.find((f) => Array.isArray(f['#e']))).not.toHaveProperty('since')
  })

  it('with `reconnect`, drops the canonical socket before asking anything', async () => {
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn], { reconnect: true })
    expect(calls.log[0]).toBe(`drop ${canonical}`)
    expect(calls.log.slice(1).every((l) => l === `ask ${canonical}`)).toBe(true)
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn])
    expect(calls.log.some((l) => l.startsWith('drop'))).toBe(false)
  })

  it('is null when the canonical relay did not truly answer', async () => {
    reset()
    calls.outcome = 'unreachable'
    expect(await confirmChainEvents(PK, spawn.id, [spawn], { since: 1_234 })).toBeNull()
  })
})
