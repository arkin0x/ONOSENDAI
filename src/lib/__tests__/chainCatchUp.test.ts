/**
 * chainCatchUp.test.ts - a device that held 2,167 actions of a chain catches
 * up to the 2,625 another device published, against a relay that answers
 * as relay.onosendai.tech does: newest first, at most 500 events per REQ in
 * total, whatever the REQ's filters (owner's tablet, 2026-11-21).
 *
 * What would go wrong silently: one page of 500 taken as the whole answer,
 * so the head lands partway (the tablet stopped 115 moves in); the head
 * check before a signature reading a partial answer as the head, and
 * signing onto it, which forks the chain; the spawns of a combined REQ
 * pushed out by the moves and the chain asked for no further.
 *
 * | Question | Gap | Asked as |
 * |---|---|---|
 * | the catch-up (fetchChainEvents, from the newest event held) | 458, 600, 1,200 | one REQ, then a page per hole |
 * | the load's self-check (askChainEvents) | 458, 600 | spawns, chain, pages |
 * | the head check (confirmChainEvents) | 458, 600 | spawns and chain in one REQ, then the spawns, then pages |
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import { buildChain, chainHead, type NostrEvent } from '../events'
import type { RelayAnswer } from '../relayOutcome'
import { decideSelfCheck } from '../chainHold'
import { actionEvent, hopEvent } from './chainFixtures'

const CAP = 500
const relay = vi.hoisted(() => ({ events: [] as NostrEvent[], reqs: 0 }))

function matches(f: Filter, e: NostrEvent): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f['#A'] && !e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1]))) return false
  if (f['#e'] && !e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]))) return false
  if (f.since !== undefined && e.created_at < f.since) return false
  if (f.until !== undefined && e.created_at > f.until) return false
  return true
}

/** One REQ: the union of its filters, newest first, capped as a whole (nostrdb). */
function answer(filter: Filter | Filter[]): NostrEvent[] {
  relay.reqs++
  const fs = Array.isArray(filter) ? filter : [filter]
  return relay.events
    .filter((e) => fs.some((f) => matches(f, e)))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
    .slice(0, Math.min(CAP, ...fs.map((f) => f.limit ?? Infinity)))
}

vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  const { normalizeURL } = await import('nostr-tools/utils')
  const url = normalizeURL(actual.CYBERSPACE_RELAY)
  return {
    ...actual,
    signedIn: () => true,
    relaySet: () => [actual.CYBERSPACE_RELAY],
    dropRelays: () => {},
    authPending: () => false,
    query: async (f: Filter) => answer(f),
    queryEach: async (f: Filter): Promise<RelayAnswer[]> => [{ url, outcome: 'answered', events: answer(f) }],
    queryEachSettled: async (_relays: string[], f: Filter | Filter[], _w: number, _p: string, _wf: string[], opts: { onSent?: () => void } = {}): Promise<RelayAnswer[]> => {
      opts.onSent?.()
      return [{ url, outcome: 'answered', events: answer(f) }]
    },
    subscribe: () => () => {},
  }
})

const { askChainEvents, confirmChainEvents, fetchChainEvents } = await import('../chains')
const { DEFAULT_RELAY } = await import('../../store/useRelays')

const pk = 'ab'.repeat(32)
const spawn = actionEvent({ pubkey: pk, createdAt: 1000, genesisId: '', previousId: '', name: 'spawn' })
spawn.tags = [['A', 'spawn'], ['C', '0'.repeat(64)]]

/**
 * The spawn and `n` hops after it. Up to `split` they were made on this
 * device, an hour apart from what came after, which another device signed
 * a few to a second, as WALK does.
 */
function chainOf(n: number, split: number): NostrEvent[] {
  const out: NostrEvent[] = [spawn]
  for (let i = 1; i <= n; i++) {
    const prev = out[out.length - 1]
    const at = i <= split ? 1000 + i * 10 : 1000 + split * 10 + 3600 + Math.floor((i - split) / 3)
    out.push(hopEvent({ pubkey: pk, createdAt: at, genesisId: spawn.id, previousId: prev.id, c: '0'.repeat(64), to: { x: BigInt(i), y: 0n, z: 0n } }))
  }
  return out
}

const headOf = (events: NostrEvent[]): string | undefined => chainHead(buildChain(events, pk))?.id

beforeEach(() => { relay.reqs = 0 })

describe('catching up past the relay cap of 500 per REQ', () => {
  for (const gap of [458, 600, 1200]) {
    it(`the catch-up from the newest event held reaches the head ${gap} moves on`, async () => {
      const all = chainOf(2167 + gap, 2167)
      relay.events = all
      const have = all.slice(0, 2168)
      const since = have[have.length - 1].created_at
      const got = await fetchChainEvents(pk, spawn.id, have, since)
      expect(headOf([...have, ...got])).toBe(all[all.length - 1].id)
      // Pages, not the whole chain again: the REQs grow with the gap, never with the chain.
      expect(relay.reqs).toBeLessThanOrEqual(3 + Math.ceil(gap / CAP) * 2)
    })
  }

  for (const gap of [458, 600]) {
    it(`the load's self-check finds the head ${gap} moves on`, async () => {
      const all = chainOf(2167 + gap, 2167)
      relay.events = all
      const have = all.slice(0, 2168)
      const answers = await askChainEvents(pk, spawn.id, have)
      const verdict = decideSelfCheck(answers, DEFAULT_RELAY, true)
      expect(verdict.status).toBe('found')
      if (verdict.status !== 'found') return
      expect(headOf([...have, ...verdict.events])).toBe(all[all.length - 1].id)
    })

    it(`the head check before a signature finds the head ${gap} moves on, never a page short of it`, async () => {
      const all = chainOf(2167 + gap, 2167)
      relay.events = all
      const have = all.slice(0, 2168)
      const anchor = have[have.length - 1]
      const got = await confirmChainEvents(pk, spawn.id, have, { since: anchor.created_at, anchorId: anchor.id })
      expect(got).not.toBeNull()
      expect(headOf([...have, ...got!])).toBe(all[all.length - 1].id)
    })
  }

  it('a load with nothing saved yet (the chain still being read from IndexedDB) pages the whole 2,625 actions', async () => {
    const all = chainOf(2625, 2167)
    relay.events = all
    const answers = await askChainEvents(pk, undefined, [])
    const verdict = decideSelfCheck(answers, DEFAULT_RELAY, true)
    expect(verdict.status).toBe('found')
    if (verdict.status === 'found') expect(headOf(verdict.events)).toBe(all[all.length - 1].id)
  })

  it('a relay that holds only a prefix of the chain (the phone still publishing) answers that prefix, whole, and the head is its last event', async () => {
    // The phone publishes oldest first (publisher.ts), so what the relay holds
    // at any moment is a chain: the head check reads it as the head the relays
    // have, and the watch brings the rest (selfSync.ts watchOwnChain).
    const all = chainOf(2625, 2167)
    relay.events = all.slice(0, 2167 + 116)
    const have = all.slice(0, 2168)
    const got = await fetchChainEvents(pk, spawn.id, have, have[have.length - 1].created_at)
    expect(headOf([...have, ...got])).toBe(all[2167 + 115].id)
  })
})
