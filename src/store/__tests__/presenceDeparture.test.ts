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
 *
 * His real chain is valid through all four (buildChain finds no break), so
 * the chain read is stood in for by one that places each action where it
 * says, unless a test freezes someone.
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
/** Every event the chain read knows, by id. */
const known = new Map<string, NostrEvent>()
/** By pubkey: the event their chain froze at, for a broken chain. */
const frozenAt = new Map<string, NostrEvent>()

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
vi.mock('../../lib/neighborChains', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/neighborChains')>()
  return {
    ...orig,
    readChain: async (pubkey: string, actionId: string) => {
      const ev = known.get(actionId)
      if (!ev) return null
      const froze = frozenAt.get(pubkey)
      const a = parseAction(froze ?? ev)!
      return { actionId, spawnId: 's'.repeat(64), stand: { coordHex: a.coordHex, position: a.position, plane: a.plane, sector: a.sector }, frozen: !!froze }
    },
  }
})

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Quaternion } from 'three'
import { nip19 } from 'nostr-tools'
import { hopTemplate, parseAction, positionHex, type ActionEvent, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../useCyberspace'
import {
  CONFIRM_LIMIT, MAX_TAG_FILTERS, drainChainChecks, inNeighborhood, savePresenceCache, startPresence, stopPresence, usePresence,
} from '../usePresence'
import xorTail from '../fixtures/xor-hyperjump-2026-10-21.json'

const [hop, enterHyperspace, hyperjump, hopThere] = xorTail as NostrEvent[]
const XOR = hop.pubkey
const act = (ev: NostrEvent): ActionEvent => parseAction(ev)!
/** Where arkinox stood: where XOR boarded. */
const here = act(enterHyperspace).position
const plane = act(enterHyperspace).plane

/** A hop by `sk` to `to` at `createdAt`: the parser checks its shape, not its proof. */
function hopBy(sk: Uint8Array, to: Position, createdAt: number): NostrEvent {
  const ev = finalizeEvent(hopTemplate({ createdAt, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(to, plane), to, plane, proofHash: 'c'.repeat(64) }), sk) as NostrEvent
  known.set(ev.id, ev)
  return ev
}

/** The live subscription over the people here, by author: the one that can hear a departure. */
const peopleWatch = () => subs.filter((s) => s.open && s.filter.authors?.length)
const xor = () => usePresence.getState().people[XOR]

beforeEach(() => {
  stopPresence()
  localStorage.clear()
  subs.length = 0
  authorReads.length = 0
  known.clear()
  frozenAt.clear()
  for (const ev of xorTail as NostrEvent[]) known.set(ev.id, ev)
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
    await vi.waitFor(() => expect(xor()?.actionId).toBe(enterHyperspace.id))
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    const f = peopleWatch()[0].filter
    expect(f.authors).toEqual([XOR])
    // strfry refuses more than three tag filters (#232).
    expect(Object.keys(f).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(MAX_TAG_FILTERS)
  })

  it('drops XOR once his hyperjump arrives and his chain holds it, instead of drawing him where he boarded', async () => {
    startPresence()
    await vi.waitFor(() => expect(xor()?.actionId).toBe(enterHyperspace.id))
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    peopleWatch()[0].onEvent(hyperjump)
    await vi.waitFor(() => expect(xor()).toBeUndefined())
  })

  it('opens the watch after a reload that finds exactly the people it remembered', async () => {
    // Kept on the device a minute ago; the relays hold nothing newer.
    usePresence.getState().ingest(enterHyperspace, Math.floor(Date.now() / 1000) - 60)
    savePresenceCache(useCyberspace.getState().identity.pubkey, usePresence.getState().people)
    usePresence.setState({ people: {} })
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    expect(xor()?.actionId).toBe(enterHyperspace.id)
    peopleWatch()[0].onEvent(hyperjump)
    await vi.waitFor(() => expect(xor()).toBeUndefined())
  })

  it('moves someone who moves within the neighborhood, through the same watch', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const first = hopBy(sk, here, hopThere.created_at + 10)
    const next = hopBy(sk, { ...here, x: here.x + 3n }, hopThere.created_at + 20)
    backfill = [hop, enterHyperspace, first]
    byAuthor = [hop, enterHyperspace, first]
    startPresence()
    await vi.waitFor(() => expect(peopleWatch()[0]?.filter.authors).toEqual([XOR, pk].sort()))
    peopleWatch()[0].onEvent(next)
    expect(usePresence.getState().people[pk]).toMatchObject({ actionId: next.id, position: { x: here.x + 3n } })
    // An older action is not news.
    peopleWatch()[0].onEvent(hop)
    expect(xor().actionId).toBe(enterHyperspace.id)
  })

  it('reissues the watch only when the set of people changes, not on every move', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    const opened = subs.length
    usePresence.setState((s) => ({ people: { ...s.people, [XOR]: { ...s.people[XOR], checkedAt: s.people[XOR].checkedAt + 1 } } }))
    await new Promise((r) => setTimeout(r, 400))
    expect(subs.length).toBe(opened)
    peopleWatch()[0].onEvent(hyperjump)
    await vi.waitFor(() => expect(peopleWatch().length).toBe(0))
  })
})

describe('a frozen chain still stands where it froze', () => {
  it('keeps a neighbor whose chain broke here, though their newer broken hop lands far away', async () => {
    // XOR's chain, as if it broke at the enter-hyperspace: from there on he
    // stands where it froze, beside you, whatever his hyperjump says.
    frozenAt.set(XOR, enterHyperspace)
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(xor()).toMatchObject({ actionId: hopThere.id, frozen: true, position: here }))
  })
})

describe('a departure that happened before you arrived (a reload, a sector crossing)', () => {
  it('is found right after the backfill, in one read by author, and XOR is not drawn', async () => {
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(xor()).toBeUndefined())
    expect(authorReads).toHaveLength(1)
    expect(authorReads[0].authors).toEqual([XOR])
    expect(Object.keys(authorReads[0]).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(MAX_TAG_FILTERS)
  })

  it('keeps him when no relay answers: silence is not a departure', async () => {
    byAuthor = null
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(xor()?.actionId).toBe(enterHyperspace.id)
  })

  it('is found from the device cache too, before the backfill can bring him back', async () => {
    usePresence.getState().ingest(enterHyperspace, Math.floor(Date.now() / 1000) - 60)
    savePresenceCache(useCyberspace.getState().identity.pubkey, usePresence.getState().people)
    usePresence.setState({ people: {} })
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    startPresence()
    // Drawn from the device at once, then dropped by the confirmation.
    expect(xor()?.actionId).toBe(enterHyperspace.id)
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(xor()).toBeUndefined())
  })

  it('marks everyone a whole read covered as confirmed, so the sweep does not ask about them alone', async () => {
    const longAgo = Math.floor(Date.now() / 1000) - 20 * 60
    usePresence.getState().ingest(enterHyperspace, longAgo)
    savePresenceCache(useCyberspace.getState().identity.pubkey, usePresence.getState().people)
    usePresence.setState({ people: {} })
    startPresence()
    await vi.waitFor(() => expect(authorReads.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(xor().checkedAt).toBeGreaterThan(longAgo))
  })
})

describe('ending a spectation', () => {
  it('leaves XOR at his newest action, not where presence last saw him', async () => {
    startPresence()
    await vi.waitFor(() => expect(xor()?.actionId).toBe(enterHyperspace.id))
    // Spectating fetches his chain by author: it has the hyperjump.
    const events = [hop, enterHyperspace, hyperjump, hopThere]
    useCyberspace.setState({ spectate: {
      pubkey: XOR, npub: nip19.npubEncode(XOR), events, actions: events.map(act),
      lastActive: hopThere.created_at, status: 'live', returnView: new Quaternion(),
    } })
    useCyberspace.getState().endSpectate()
    await vi.waitFor(() => expect(xor()).toBeUndefined())
  })

  it('does not count someone first seen through a spectation as an arrival', async () => {
    startPresence()
    await vi.waitFor(() => expect(usePresence.getState().loading).toBe(false))
    const before = usePresence.getState().arrivals
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const theirs = hopBy(sk, here, hopThere.created_at + 10)
    useCyberspace.setState({ spectate: {
      pubkey: pk, npub: nip19.npubEncode(pk), events: [theirs], actions: [act(theirs)],
      lastActive: theirs.created_at, status: 'live', returnView: new Quaternion(),
    } })
    expect(usePresence.getState().people[pk]).toBeDefined()
    expect(usePresence.getState().arrivals).toBe(before)
  })
})

describe('ingest', () => {
  it('drops someone whose newest action stands outside the neighborhood, once their chain holds it', async () => {
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace)
    await drainChainChecks()
    expect(xor()).toBeDefined()
    usePresence.getState().ingest(hyperjump)
    // Until the chain is read there, he stays where he was.
    expect(xor()).toMatchObject({ actionId: hyperjump.id, position: here })
    await drainChainChecks()
    expect(xor()).toBeUndefined()
  })

  it('never adds someone whose newest action is elsewhere', async () => {
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(hopThere)
    await drainChainChecks()
    expect(xor()).toBeUndefined()
  })

  it('does not bring someone back on an action older than the one that took them away', async () => {
    // A read by author answers newest first: the hop there, the hyperjump,
    // then the enter-hyperspace he made here.
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace)
    await drainChainChecks()
    for (const ev of [hopThere, hyperjump, enterHyperspace, hop]) usePresence.getState().ingest(ev)
    await drainChainChecks()
    expect(xor()).toBeUndefined()
    for (const ev of [enterHyperspace, hop]) usePresence.getState().ingest(ev)
    expect(xor()).toBeUndefined()
  })
})

describe('a chain read that fails', () => {
  it('leaves the far action to the next sweep, not ten minutes later', async () => {
    const { CONFIRM_AFTER_S, sweep } = await import('../usePresence')
    // Last confirmed long enough ago that the next sweep asks about him.
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace, Math.floor(Date.now() / 1000) - CONFIRM_AFTER_S - 1)
    await drainChainChecks()
    // The read for his hyperjump comes back with nothing.
    known.delete(hyperjump.id)
    usePresence.getState().ingest(hyperjump)
    await drainChainChecks()
    expect(xor()).toMatchObject({ actionId: hyperjump.id, position: here })
    byAuthor = [hop, enterHyperspace, hyperjump]
    await sweep()
    expect(xor()).toBeUndefined()
  })

  it('reads a far action ahead of the reads a backfill queued', async () => {
    const { pendingChainChecks } = await import('../usePresence')
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(enterHyperspace)
    await drainChainChecks()
    // A backfill queues a read for each person it brings; then XOR's
    // hyperjump arrives, last in line.
    const others = Array.from({ length: 3 }, (_, i) => hopBy(generateSecretKey(), { ...here, y: here.y + BigInt(i + 1) }, enterHyperspace.created_at + i))
    for (const ev of others) usePresence.getState().ingest(ev)
    usePresence.getState().ingest(hyperjump)
    expect(pendingChainChecks().map(([pk]) => pk)).toEqual([...others.map((e) => e.pubkey), XOR])
    // Each read placed as it lands: XOR's goes first and drops him.
    const settled: string[] = []
    const stop = usePresence.subscribe((st, prev) => {
      for (const pk of Object.keys(prev.people)) if (st.people[pk] !== prev.people[pk]) settled.push(pk)
    })
    await drainChainChecks()
    stop()
    expect(settled[0]).toBe(XOR)
    expect(xor()).toBeUndefined()
  })
})

describe('following someone who left', () => {
  it('finds XOR at block 101 when you go there too, though he left your old neighborhood on that very hop', async () => {
    startPresence()
    await vi.waitFor(() => expect(peopleWatch().length).toBe(1))
    peopleWatch()[0].onEvent(hyperjump)
    await vi.waitFor(() => expect(xor()).toBeUndefined())
    // You ride to the same block: his newest action is now beside you.
    backfill = [hyperjump, hopThere]
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere]
    useCyberspace.setState({ position: act(hopThere).position })
    await vi.waitFor(() => expect(xor()?.actionId).toBe(hopThere.id))
  })
})

describe('a confirmation cut at its limit', () => {
  it('asks again in one batched read for the people it did not name, not one read per person', async () => {
    // Someone busy here fills the read to its limit with newer actions;
    // five more neighbors are idle, and XOR has left.
    const busySk = generateSecretKey()
    const busy = getPublicKey(busySk)
    const busyHops = Array.from({ length: CONFIRM_LIMIT + 5 }, (_, i) => hopBy(busySk, here, hopThere.created_at + 10 + i))
    const idle = Array.from({ length: 5 }, (_, i) => {
      const sk = generateSecretKey()
      return hopBy(sk, { ...here, z: here.z + BigInt(i + 1) }, enterHyperspace.created_at - 1000 - i)
    })
    backfill = [hop, enterHyperspace, busyHops[0], ...idle]
    byAuthor = [hop, enterHyperspace, hyperjump, hopThere, ...busyHops, ...idle]
    startPresence()
    await vi.waitFor(() => expect(authorReads).toHaveLength(2))
    await vi.waitFor(() => expect(xor()).toBeUndefined())
    expect(usePresence.getState().people[busy]).toBeDefined()
    for (const ev of idle) expect(usePresence.getState().people[ev.pubkey]).toBeDefined()
    // Both batched: everyone, then everyone but the busy one.
    expect(authorReads[0].authors).toHaveLength(7)
    expect(authorReads[1].authors).toEqual([XOR, ...idle.map((e) => e.pubkey)].sort())
    expect(authorReads[1].limit).toBe(CONFIRM_LIMIT)
    await new Promise((r) => setTimeout(r, 50))
    expect(authorReads).toHaveLength(2)
  })
})
