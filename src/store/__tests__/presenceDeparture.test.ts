/**
 * presenceDeparture.test.ts - someone who leaves is not drawn where they were.
 *
 * arkinox, 2026-10-21: "I told XOR to go to a different block location, but
 * his avatar stays in its last local position near me. If I spectate him,
 * he's there at the other block, but when I end spectation, his avatar is
 * also at the last known local location."
 *
 * The fixture is XOR's real tail from that day: a hop and an
 * enter-hyperspace where arkinox stood, then a hyperjump to block 101 and a
 * hop there. The hyperjump lands in another sector, so the neighborhood's
 * sector filter never delivers it; presence kept the enter-hyperspace as his
 * newest action, and every backfill brought him back at it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'

/** Every live subscription opened, with its handler; `open` false once closed. */
const subs: Array<{ filter: Filter; onEvent: (ev: NostrEvent) => void; open: boolean }> = []
/** What a one-shot read of the neighborhood (the backfill) answers. */
let backfill: NostrEvent[] = []
/** What a one-shot read by author answers, per relay; null: no relay answers. */
let byAuthor: NostrEvent[] | null = []
/** Every one-shot read by author, its filter. */
const authorReads: Filter[] = []

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  subscribe: (filter: Filter, onEvent: (ev: NostrEvent) => void) => {
    const s = { filter, onEvent, open: true }
    subs.push(s)
    return () => { s.open = false }
  },
  query: async (filter: Filter) => (filter.authors ? [] : backfill),
  queryEach: async (filter: Filter) => {
    authorReads.push(filter)
    if (byAuthor === null) return [{ url: 'wss://relay.test/', outcome: 'unreachable' as const, reason: 'connection closed', events: [] }]
    const authors = new Set(filter.authors ?? [])
    const tags = filter['#A'] as string[] | undefined
    const events = byAuthor
      .filter((e) => authors.has(e.pubkey) && (filter.since === undefined || e.created_at >= filter.since))
      .filter((e) => !tags || e.tags.some((t) => t[0] === 'A' && tags.includes(t[1])))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, filter.limit ?? Infinity)
    return [{ url: 'wss://relay.test/', outcome: 'answered' as const, events }]
  },
}))
// The chain reads presence queues: nothing on the relays, so no verdict.
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => [],
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Quaternion } from 'three'
import { nip19 } from 'nostr-tools'
import { parseAction, type ActionEvent, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { MAX_TAG_FILTERS, inNeighborhood, startPresence, stopPresence, usePresence } from '../usePresence'
import xorTail from '../fixtures/xor-hyperjump-2026-10-21.json'

const [hop, enterHyperspace, hyperjump, hopThere] = xorTail as NostrEvent[]
const XOR = hop.pubkey
const act = (ev: NostrEvent): ActionEvent => parseAction(ev)!
/** Where arkinox stood: where XOR boarded. */
const here = act(enterHyperspace).position

/** The live subscription over the people here, by author: the one that can hear a departure. */
const peopleWatch = () => subs.filter((s) => s.open && s.filter.authors?.length)

beforeEach(() => {
  stopPresence()
  localStorage.clear()
  subs.length = 0
  authorReads.length = 0
  backfill = [hop, enterHyperspace]
  byAuthor = [hop, enterHyperspace]
  const me = getPublicKey(generateSecretKey())
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: me }, position: here, spectate: null, targets: {} })
})

describe('the fixture', () => {
  it('is XOR boarding where arkinox stood and jumping out of the neighborhood', () => {
    expect(act(enterHyperspace).type).toBe('enter-hyperspace')
    expect(act(hyperjump).type).toBe('hyperjump')
    expect(inNeighborhood(act(enterHyperspace).position, here)).toBe(true)
    expect(inNeighborhood(act(hyperjump).position, here)).toBe(false)
    expect(inNeighborhood(act(hopThere).position, here)).toBe(false)
  })
})

describe('a departure is heard while you are there', () => {
  it('watches the people here by author, so their next action arrives wherever it lands', async () => {
    startPresence()
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]?.actionId).toBe(enterHyperspace.id))
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    const f = peopleWatch()[0].filter
    expect(f.authors).toEqual([XOR])
    // strfry refuses more than three tag filters (#232).
    expect(Object.keys(f).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(MAX_TAG_FILTERS)
  })

  it('drops XOR the moment his hyperjump arrives, instead of drawing him where he boarded', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    expect(usePresence.getState().people[XOR]).toBeDefined()
    peopleWatch()[0].onEvent(hyperjump)
    expect(usePresence.getState().people[XOR]).toBeUndefined()
  })

  it('takes a move within the neighborhood from the same watch', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    // An older action is not news.
    peopleWatch()[0].onEvent(hop)
    expect(usePresence.getState().people[XOR].actionId).toBe(enterHyperspace.id)
  })

  it('reissues the watch only when the set of people changes, not on every move', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    const opened = subs.length
    // A newer action of someone already watched changes their entry, not the set.
    usePresence.setState((s) => ({ people: { ...s.people, [XOR]: { ...s.people[XOR], checkedAt: s.people[XOR].checkedAt + 1 } } }))
    await new Promise((r) => setTimeout(r, 400))
    expect(subs.length).toBe(opened)
    peopleWatch()[0].onEvent(hyperjump)
    await vi.waitFor(() => expect(peopleWatch().length).toBe(0))
  })
})

describe('a departure that happened before you arrived (a reload, a sector crossing)', () => {
  it('is found right after the backfill, in one read by author, and XOR is not drawn', async () => {
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]).toBeUndefined())
    expect(authorReads).toHaveLength(1)
    expect(authorReads[0].authors).toEqual([XOR])
    expect(Object.keys(authorReads[0]).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(MAX_TAG_FILTERS)
  })

  it('keeps him when no relay answers: silence is not a departure', async () => {
    byAuthor = null
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(usePresence.getState().people[XOR]?.actionId).toBe(enterHyperspace.id)
  })

  it('is found from the device cache too, before the backfill can bring him back', async () => {
    // Seen here before the reload, kept on the device, confirmed a minute ago.
    const now = Math.floor(Date.now() / 1000)
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace, now - 60)
    const kept = usePresence.getState().people
    const { savePresenceCache } = await import('../usePresence')
    savePresenceCache(useCyberspace.getState().identity.pubkey, kept)
    usePresence.setState({ people: {} })
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    startPresence()
    // Drawn from the device at once, then dropped by the confirmation.
    expect(usePresence.getState().people[XOR]?.actionId).toBe(enterHyperspace.id)
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]).toBeUndefined())
  })
})

describe('ending a spectation', () => {
  it('leaves XOR at his newest action, not where presence last saw him', async () => {
    startPresence()
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]?.actionId).toBe(enterHyperspace.id))
    // Spectating fetches his chain by author: it has the hyperjump.
    const events = [hop, enterHyperspace, hyperjump, hopThere]
    useCyberspace.setState({ spectate: {
      pubkey: XOR, npub: nip19.npubEncode(XOR), events, actions: events.map(act),
      lastActive: hopThere.created_at, status: 'live', returnView: new Quaternion(),
    } })
    useCyberspace.getState().endSpectate()
    expect(usePresence.getState().people[XOR]).toBeUndefined()
  })
})

describe('ingest', () => {
  it('drops someone whose newest action stands outside the neighborhood, whichever feed it came by', () => {
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace)
    expect(usePresence.getState().people[XOR]).toBeDefined()
    usePresence.getState().ingest(hyperjump)
    expect(usePresence.getState().people[XOR]).toBeUndefined()
  })

  it('never adds someone whose newest action is elsewhere', () => {
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(hopThere)
    expect(usePresence.getState().people[XOR]).toBeUndefined()
  })

  it('does not bring someone back on an action older than the one that took them away', () => {
    // A read by author answers newest first: the hop there, the hyperjump,
    // then the enter-hyperspace he made here.
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace)
    for (const ev of [hopThere, hyperjump, enterHyperspace, hop]) usePresence.getState().ingest(ev)
    expect(usePresence.getState().people[XOR]).toBeUndefined()
  })
})

describe('following someone who left', () => {
  it('finds XOR at block 101 when you go there too, though he left your old neighborhood on that very hop', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    peopleWatch()[0].onEvent(hyperjump)
    peopleWatch()[0].onEvent(hopThere)
    expect(usePresence.getState().people[XOR]).toBeUndefined()
    // You ride to the same block: his newest action is now beside you.
    backfill = [hyperjump, hopThere]
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    useCyberspace.setState({ position: act(hopThere).position })
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]?.actionId).toBe(hopThere.id))
  })
})

describe('a confirmation cut at its limit', () => {
  it('asks alone about whoever the cut read did not name, and drops them if they left', async () => {
    const { CONFIRM_LIMIT } = await import('../usePresence')
    // Someone busy here fills the read to its limit with newer actions.
    const busySk = generateSecretKey()
    const busy = getPublicKey(busySk)
    const { finalizeEvent } = await import('nostr-tools/pure')
    const { hopTemplate, positionHex } = await import('../../lib/events')
    const busyHop = (t: number) => finalizeEvent(hopTemplate({ createdAt: t, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(here, act(enterHyperspace).plane), to: here, plane: act(enterHyperspace).plane, proofHash: 'c'.repeat(64) }), busySk) as NostrEvent
    const busyHops = Array.from({ length: CONFIRM_LIMIT + 5 }, (_, i) => busyHop(hopThere.created_at + 10 + i))
    backfill = [hop, enterHyperspace, busyHops[0]]
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere, ...busyHops]
    startPresence()
    await vi.waitFor(() => expect(authorReads).toHaveLength(2))
    await vi.waitFor(() => expect(usePresence.getState().people[XOR]).toBeUndefined())
    expect(usePresence.getState().people[busy]).toBeDefined()
    // One batched read, then one read about XOR alone.
    expect(authorReads.map((f) => f.authors)).toEqual([[busy, XOR].sort(), [XOR]])
  })
})
