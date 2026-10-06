/**
 * chainFetch.test.ts - how a chain is asked for, against a relay stand-in.
 *
 * The relay here answers like a strfry relay with a small limit: newest
 * first, at most LIMIT events per question. What would go wrong silently: a
 * chain asked for by action name (a game's moves and unknown actions never
 * arrive), a long chain cut at the relay's limit and never paged, and a
 * second round trip on every commit when the genesis was already known.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { buildChain, chainHead, spawnTemplate, type NostrEvent } from '../events'
import type { RelayAnswer } from '../relayOutcome'
import { actionEvent, hopEvent } from './chainFixtures'

const store: NostrEvent[] = []
const asked: Filter[] = []
const LIMIT = 3

/** A relay: kind, author, #A, #e and until, newest first, capped at LIMIT. */
function answer(f: Filter): NostrEvent[] {
  asked.push(f)
  return store
    .filter((e) => !f.kinds || f.kinds.includes(e.kind))
    .filter((e) => !f.authors || f.authors.includes(e.pubkey))
    .filter((e) => !f['#A'] || e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1])))
    .filter((e) => !f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1])))
    .filter((e) => f.until === undefined || e.created_at <= f.until)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, LIMIT)
}

vi.mock('../relay', () => ({
  query: async (f: Filter) => answer(f),
  queryEach: async (f: Filter): Promise<RelayAnswer[]> => [{ url: 'wss://relay.test/', outcome: 'answered', events: answer(f) }],
  subscribe: () => () => {},
}))

const { askChainEvents, fetchChainEvents } = await import('../chains')

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 100), sk) as NostrEvent

/** spawn, then `n` actions alternating hop and an unknown action, one second apart. */
function chainOf(n: number): NostrEvent[] {
  const out: NostrEvent[] = [spawn]
  for (let i = 1; i <= n; i++) {
    const prev = out[out.length - 1]
    out.push(i % 2
      ? hopEvent({ pubkey: pk, createdAt: 100 + i, genesisId: spawn.id, previousId: prev.id, c: pk, to: { x: BigInt(i), y: 0n, z: 0n } })
      : actionEvent({ pubkey: pk, createdAt: 100 + i, genesisId: spawn.id, previousId: prev.id, name: 'wave' }))
  }
  return out
}

beforeEach(() => {
  store.length = 0
  asked.length = 0
})

describe('fetching a chain by its genesis', () => {
  it('asks for the spawns, then the chain by genesis, and gets the actions no name filter would', async () => {
    const chain = chainOf(2)
    // A v1 drift of the same identity: names no v2 spawn, so never asked for.
    const drift: NostrEvent = { ...spawn, id: 'd'.repeat(64), created_at: 999, tags: [['A', 'drift'], ['e', 'f'.repeat(64), '', 'genesis']] }
    store.push(...chain, drift)
    const got = await fetchChainEvents(pk)
    expect(asked[0]).toMatchObject({ '#A': ['spawn'] })
    expect(asked[1]).toMatchObject({ '#e': [spawn.id] })
    expect(got.map((e) => e.id).sort()).toEqual(chain.map((e) => e.id).sort())
    expect(chainHead(buildChain(got))?.id).toBe(chain[2].id)
  })

  it('pages back past the relay limit until the chain is whole', async () => {
    const chain = chainOf(8)
    store.push(...chain)
    const built = buildChain(await fetchChainEvents(pk))
    expect(built.map((a) => a.id)).toEqual(chain.map((e) => e.id))
    expect(asked.filter((f) => f.until !== undefined).length).toBeGreaterThan(0)
  })

  it('stops paging when the relay has nothing older, gap or not', async () => {
    const chain = chainOf(4)
    // The relay lost the first hop: there is a gap no page can fill.
    store.push(...chain.filter((e) => e.id !== chain[1].id))
    await fetchChainEvents(pk)
    expect(asked.length).toBeLessThan(6)
  })

  it('with the genesis known, asks for the spawns and the chain at once', async () => {
    store.push(...chainOf(2))
    await fetchChainEvents(pk, spawn.id)
    expect(asked).toHaveLength(2)
    expect(asked.map((f) => (f['#e'] ? 'chain' : 'spawns')).sort()).toEqual(['chain', 'spawns'])
  })

  it('with a genesis known but a newer spawn on the relay, asks for the newer chain too', async () => {
    store.push(...chainOf(2))
    const respawn = finalizeEvent(spawnTemplate(pk, 500), sk) as NostrEvent
    store.push(respawn)
    const got = await fetchChainEvents(pk, spawn.id)
    expect(asked.some((f) => f['#e']?.[0] === respawn.id)).toBe(true)
    expect(buildChain(got)[0].id).toBe(respawn.id)
  })

  it('the per-relay version keeps the answer and the whole chain', async () => {
    const chain = chainOf(6)
    store.push(...chain)
    const answers = await askChainEvents(pk)
    expect(answers).toHaveLength(1)
    expect(answers[0].outcome).toBe('answered')
    expect(buildChain(answers[0].events).map((a) => a.id)).toEqual(chain.map((e) => e.id))
  })

  it('nothing at all: one question, no chain asked for', async () => {
    const answers = await askChainEvents(pk)
    expect(asked).toHaveLength(1)
    expect(answers[0]).toMatchObject({ outcome: 'answered', events: [] })
  })
})
