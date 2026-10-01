/**
 * fork.test.ts - what the chain says when two devices act as one identity.
 *
 * One identity has one chain. Two devices signed in as it can both act from
 * the same head, and then every reader, this one included, resolves the fork
 * the same way: follow the oldest child, tie broken on the smaller event id.
 * One branch wins for everybody and the other's actions stop being in the
 * chain. This is about saying so instead of doing it in silence.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { ACTION_KIND, spawnTemplate, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const hex = (n: number): string => n.toString(16).padStart(64, '0')

/** A hop that parses: the tags parseAction insists on, and nothing else. */
function hop(id: string, prev: string, genesis: string, createdAt: number, coord: string): NostrEvent {
  return {
    id,
    pubkey: S().identity.pubkey,
    created_at: createdAt,
    kind: ACTION_KIND,
    content: '',
    sig: '0'.repeat(128),
    tags: [
      ['A', 'hop'],
      ['C', coord],
      ['c', S().identity.pubkey],
      ['S', '0-0-0'],
      ['e', genesis, '', 'genesis'],
      ['e', prev, '', 'previous'],
      ['proof', hex(0xbeef)],
    ],
  } as NostrEvent
}

describe('a chain forked across two devices', () => {
  // Every case starts from the bare spawn: a hop left on the chain by the
  // case before it would be one more child at the branch and would decide
  // the next fork.
  let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published'>

  beforeAll(async () => {
    await placeSpawn()
    fresh = {
      events: [...S().events],
      prevEventId: S().prevEventId,
      genesisId: S().genesisId,
      published: { ...S().published },
    }
  })

  beforeEach(() => {
    useCyberspace.setState({ ...fresh, events: [...fresh.events], published: { ...fresh.published }, forkNotice: null })
  })

  it('says how many actions came from the other device', () => {
    const spawn = S().events[0]
    expect(spawn).toBeTruthy()
    const theirs = hop(hex(1), spawn.id, spawn.id, spawn.created_at + 10, hex(0xaa))
    S().adoptChain([theirs])
    expect(S().forkNotice).toMatchObject({ adopted: 1, dropped: 0 })
    expect(S().prevEventId).toBe(theirs.id)
  })

  it('says how many of this device\'s actions the fork took out', () => {
    const spawn = S().events[0]
    // Ours first, so ours is on the chain; then theirs, signed earlier, which
    // wins the branch because the earlier action continues the chain.
    const ours = hop(hex(2), spawn.id, spawn.id, spawn.created_at + 20, hex(0xbb))
    S().adoptChain([ours])
    expect(S().prevEventId).toBe(ours.id)

    const theirs = hop(hex(3), spawn.id, spawn.id, spawn.created_at + 10, hex(0xcc))
    S().adoptChain([theirs])
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().forkNotice).toMatchObject({ dropped: 1, adopted: 1 })
  })

  it('says nothing when the fold changed nothing', () => {
    const spawn = S().events[0]
    const theirs = hop(hex(4), spawn.id, spawn.id, spawn.created_at + 10, hex(0xdd))
    S().adoptChain([theirs])
    useCyberspace.setState({ forkNotice: null })
    S().adoptChain([theirs])
    expect(S().forkNotice).toBeNull()
  })

  it('is put away once it has been read', () => {
    const spawn = S().events[0]
    S().adoptChain([hop(hex(5), spawn.id, spawn.id, spawn.created_at + 10, hex(0xee))])
    expect(S().forkNotice).not.toBeNull()
    S().clearForkNotice()
    expect(S().forkNotice).toBeNull()
  })

  it('says so when another device\'s older branch overturned moves this device had published', () => {
    const spawn = S().events[0]
    const ours = hop(hex(6), spawn.id, spawn.id, spawn.created_at + 20, hex(0xbb))
    // Ours went out: on the relay, and marked so here.
    useCyberspace.setState({ events: [spawn, ours], prevEventId: ours.id, published: { ...S().published, [ours.id]: 'ok' } })
    const theirs = hop(hex(7), spawn.id, spawn.id, spawn.created_at + 10, hex(0xcc))
    S().adoptChain([theirs])
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().forkNotice).toMatchObject({ dropped: 1, overturned: 1, replaced: false, adopted: 1 })
    // The rest of the other device's branch arrives as its own fold: the
    // unread notice grows, it is not replaced by a bare adoption.
    S().adoptChain([hop(hex(10), theirs.id, spawn.id, spawn.created_at + 30, hex(0xdd))])
    expect(S().forkNotice).toMatchObject({ dropped: 1, overturned: 1, adopted: 2 })
  })

  it('names a chain replaced by a newer spawn from another device', () => {
    const spawn = S().events[0]
    const ours = hop(hex(8), spawn.id, spawn.id, spawn.created_at + 20, hex(0xbb))
    useCyberspace.setState({ events: [spawn, ours], prevEventId: ours.id, published: { ...S().published, [ours.id]: 'ok' } })
    const respawn: NostrEvent = { ...spawnTemplate(S().identity.pubkey, spawn.created_at + 100), id: hex(9), pubkey: S().identity.pubkey, sig: '0'.repeat(128) }
    S().adoptChain([respawn])
    expect(S().genesisId).toBe(respawn.id)
    // The whole previous chain left, and none of it counts as "overturned":
    // nothing forked, a newer spawn took over.
    expect(S().forkNotice).toMatchObject({ replaced: true, dropped: 2, overturned: 0, adopted: 1 })
  })
})
