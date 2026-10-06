/**
 * chainFetch.test.ts - how a chain is asked for, against relay stand-ins.
 *
 * Each stand-in answers like a strfry relay with a small limit: newest first,
 * at most `cap` events per question. What would go wrong silently: a chain
 * asked for by action name (a game's moves and unknown actions never
 * arrive); a long chain cut at a relay's limit and never paged, or paged
 * from the wrong place when two relays hold different stretches; one second
 * holding more events than a page; a chain longer than the paging budget
 * resolving to its spawn alone; and a look before every commit paging back
 * through a chain this device already holds.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { buildChain, chainHead, spawnTemplate, type NostrEvent } from '../events'
import type { RelayAnswer } from '../relayOutcome'
import { decideSelfCheck } from '../chainHold'
import { actionEvent, hopEvent } from './chainFixtures'

interface StandIn { url: string; events: NostrEvent[]; cap: number }
let relays: StandIn[] = []
const asked: Filter[] = []

/** One relay: kind, author, ids, #A, #e and until, newest first, capped. */
function answer(r: StandIn, f: Filter): NostrEvent[] {
  return r.events
    .filter((e) => !f.kinds || f.kinds.includes(e.kind))
    .filter((e) => !f.authors || f.authors.includes(e.pubkey))
    .filter((e) => !f.ids || f.ids.includes(e.id))
    .filter((e) => !f['#A'] || e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1])))
    .filter((e) => !f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1])))
    .filter((e) => f.until === undefined || e.created_at <= f.until)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
    .slice(0, r.cap)
}

vi.mock('../relay', () => ({
  query: async (f: Filter) => {
    asked.push(f)
    const seen = new Map<string, NostrEvent>()
    for (const r of relays) for (const e of answer(r, f)) seen.set(e.id, e)
    return [...seen.values()]
  },
  queryEach: async (f: Filter): Promise<RelayAnswer[]> => {
    asked.push(f)
    return relays.map((r) => ({ url: r.url, outcome: 'answered', events: answer(r, f) }))
  },
  subscribe: () => () => {},
}))

const { ChainGapError, askChainEvents, fetchChainEvents, MAX_CHAIN_PAGES } = await import('../chains')

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 100), sk) as NostrEvent

/** spawn, then `n` actions alternating hop and an unknown action; `second(i)` is each one's created_at. */
function chainOf(n: number, second: (i: number) => number = (i) => 100 + i): NostrEvent[] {
  const out: NostrEvent[] = [spawn]
  for (let i = 1; i <= n; i++) {
    const prev = out[out.length - 1]
    out.push(i % 2
      ? hopEvent({ pubkey: pk, createdAt: second(i), genesisId: spawn.id, previousId: prev.id, c: pk, to: { x: BigInt(i), y: 0n, z: 0n } })
      : actionEvent({ pubkey: pk, createdAt: second(i), genesisId: spawn.id, previousId: prev.id, name: 'wave' }))
  }
  return out
}

const one = (events: NostrEvent[], cap = 3): StandIn[] => [{ url: 'wss://relay.test/', events, cap }]
const ids = (events: NostrEvent[]): string[] => events.map((e) => e.id)

beforeEach(() => {
  relays = []
  asked.length = 0
})

describe('fetching a chain by its genesis', () => {
  it('asks for the spawns, then the chain by genesis, and gets the actions no name filter would', async () => {
    const chain = chainOf(2)
    // A v1 drift of the same identity: names no v2 spawn, so never asked for.
    const drift: NostrEvent = { ...spawn, id: 'd'.repeat(64), created_at: 999, tags: [['A', 'drift'], ['e', 'f'.repeat(64), '', 'genesis']] }
    relays = one([...chain, drift])
    const got = await fetchChainEvents(pk)
    expect(asked[0]).toMatchObject({ '#A': ['spawn'] })
    expect(asked[1]).toMatchObject({ '#e': [spawn.id] })
    expect(ids(got).sort()).toEqual(ids(chain).sort())
    expect(chainHead(buildChain(got))?.id).toBe(chain[2].id)
  })

  it('pages back past the relay limit until the chain is whole', async () => {
    const chain = chainOf(8)
    relays = one(chain)
    expect(ids(buildChain(await fetchChainEvents(pk)).map((a) => ({ id: a.id }) as NostrEvent))).toEqual(ids(chain))
    expect(asked.some((f) => f.until !== undefined)).toBe(true)
  })

  it('probe: a second relay holding only the start does not stop the paging early', async () => {
    const chain = chainOf(12)
    // The capped relay holds everything; the other holds the start only.
    relays = [{ url: 'wss://a/', events: chain, cap: 3 }, { url: 'wss://b/', events: chain.slice(0, 3), cap: 50 }]
    const built = buildChain(await fetchChainEvents(pk))
    expect(built).toHaveLength(13)
    expect(chainHead(built)?.id).toBe(chain[12].id)
  })

  it('probe: more events in one second than a page, filled by asking for the missing events', async () => {
    // Events 3 to 9 all share one second; the relay returns three at a time.
    const chain = chainOf(10, (i) => (i < 3 ? 100 + i : i <= 9 ? 500 : 501))
    relays = one(chain)
    const built = buildChain(await fetchChainEvents(pk))
    expect(ids(built.map((a) => ({ id: a.id }) as NostrEvent))).toEqual(ids(chain))
    expect(asked.some((f) => f.ids !== undefined)).toBe(true)
  })

  it('probe: a chain needing more than twenty pages comes back whole, not as its spawn', async () => {
    const chain = chainOf(70)
    relays = one(chain)
    const built = buildChain(await fetchChainEvents(pk))
    expect(built).toHaveLength(71)
    expect(chainHead(built)?.id).toBe(chain[70].id)
  })

  it('a hole no question can fill is reported, never resolved to the stretch before it', async () => {
    const chain = chainOf(6)
    // The relay lost the first hop.
    relays = one(chain.filter((e) => e.id !== chain[1].id))
    await expect(fetchChainEvents(pk)).rejects.toBeInstanceOf(ChainGapError)
    const answers = await askChainEvents(pk)
    expect(answers[0]).toMatchObject({ outcome: 'unreachable', reason: 'the relays returned only part of this chain' })
    // The self-check cannot say what the chain is: the first move holds.
    expect(decideSelfCheck(answers, 'wss://relay.test/', true)).toEqual({ status: 'unknown', cause: { kind: 'unreachable', reason: 'the relays returned only part of this chain' } })
  })

  it('a chain longer than the paging budget is reported as partial too', async () => {
    const chain = chainOf(3 * (MAX_CHAIN_PAGES + 4))
    relays = one(chain)
    await expect(fetchChainEvents(pk)).rejects.toBeInstanceOf(ChainGapError)
  })

  it('with the genesis known, asks for the spawns and the chain at once', async () => {
    relays = one(chainOf(2))
    await fetchChainEvents(pk, spawn.id)
    expect(asked).toHaveLength(2)
    expect(asked.map((f) => (f['#e'] ? 'chain' : 'spawns')).sort()).toEqual(['chain', 'spawns'])
  })

  it('a look with the chain in hand asks only for what is newer: no paging back through a long chain', async () => {
    const chain = chainOf(40)
    relays = one([...chain, ...chainOf(0)])
    const newer = hopEvent({ pubkey: pk, createdAt: 900, genesisId: spawn.id, previousId: chain[40].id, c: pk, to: { x: 99n, y: 0n, z: 0n } })
    relays[0].events.push(newer)
    const got = await fetchChainEvents(pk, spawn.id, chain)
    expect(asked).toHaveLength(2)
    expect(ids(got)).toContain(newer.id)
  })

  it('with a genesis known but a newer spawn on the relay, asks for the newer chain too', async () => {
    const respawn = finalizeEvent(spawnTemplate(pk, 500), sk) as NostrEvent
    relays = one([...chainOf(2), respawn])
    const got = await fetchChainEvents(pk, spawn.id)
    expect(asked.some((f) => f['#e']?.[0] === respawn.id)).toBe(true)
    expect(buildChain(got)[0].id).toBe(respawn.id)
  })

  it('the per-relay version keeps the answer and the whole chain', async () => {
    const chain = chainOf(6)
    relays = one(chain)
    const answers = await askChainEvents(pk)
    expect(answers).toHaveLength(1)
    expect(answers[0].outcome).toBe('answered')
    expect(ids(buildChain(answers[0].events).map((a) => ({ id: a.id }) as NostrEvent))).toEqual(ids(chain))
  })

  it('nothing at all: one question, no chain asked for', async () => {
    relays = one([])
    const answers = await askChainEvents(pk)
    expect(asked).toHaveLength(1)
    expect(answers[0]).toMatchObject({ outcome: 'answered', events: [] })
  })
})
