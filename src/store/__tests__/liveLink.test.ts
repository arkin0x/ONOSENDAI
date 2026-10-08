/**
 * liveLink.test.ts - LIVE LINK, from the review of #233.
 *
 * B1: a finder looks a reference up on their own relays, so the author's
 * object goes onto yours before the bag, the hint names one of yours, and a
 * LIVE LINK is refused when no relay takes it.
 * B2: one object placed twice is two items, keyed by the bag entry (address
 * and point), never by the author's event id.
 * B3: the author's edit refreshes the item; it does not add a second one or
 * a second find.
 * Comments on a LIVE LINK answer the bag only, naming no object.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

type Sent = { kind: number; tags: string[][]; id: string; content: string; pubkey: string }
const sent: Sent[] = []
/** Event ids every relay refuses in the current test. */
const refusedIds = new Set<string>()
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (relays: string[], ev: Sent) => {
    // The first relay of yours is down and takes nothing.
    if (refusedIds.has(ev.id) || (relays.length === 1 && relays[0] === 'wss://down.test')) return { ok: false }
    sent.push(ev)
    return { ok: true }
  }),
  // The relay holds the newest bag sent, as a relay keeps an addressable event.
  query: vi.fn(async () => { const b = [...sent].reverse().find((e) => e.kind === 33330); return b ? [b] : [] }),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://down.test', 'wss://mine.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { objectFromEvent, type FeedObject } from 'sno-core/feed'
import { useCyberspace } from '../useCyberspace'
import { LINK_REFUSED, useShards } from '../useShards'
import { useBuilder } from '../useBuilder'
import { HIDDEN_KIND, OBJECT_KIND, entryKey, unbag } from '../../lib/hidden'
import { commentTemplate, itemParent, itemTargetOf, threadComments, bagAddress, type CommentSubject } from '../../lib/comments'
import { hexToBytes, type NostrEvent } from '../../lib/events'

const AUTHOR = generateSecretKey()
/** The author's object, at a version: same address, a new event each edit. */
function version(name: string, createdAt: number, vertexCount = 3): FeedObject {
  const shard: ShardModel = {
    id: 'statue', name, unit: 0, extent: 32, mode: 'points', up: false, spin: 0, updatedAt: 0,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [],
  }
  const ev = finalizeEvent({ kind: OBJECT_KIND, created_at: createdAt, tags: [['d', 'statue']], content: JSON.stringify(toPayload(shard)) }, AUTHOR)
  return { ...objectFromEvent(ev)!, seen: ['wss://elsewhere.test'] }
}

const S = () => useCyberspace.getState()
const bags = () => sent.filter((e) => e.kind === HIDDEN_KIND)

async function placeLinked(o: FeedObject): Promise<void> {
  useShards.getState().startDeployObject(o)
  useShards.getState().setDeployLink(true)
  useShards.setState({ deployHeight: 4 })
  await useShards.getState().deploy()
}

beforeEach(() => {
  sent.length = 0
  refusedIds.clear()
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  S().clearFocus()
  useCyberspace.setState({ live: true })
})

describe('B1: a finder can follow it', () => {
  it('puts the author\'s signed object on your relays before the bag, and hints one that took it', async () => {
    const o = version('Statue', 1_700_000_000)
    await placeLinked(o)
    expect(useShards.getState().deployStatus).toBe('done')
    expect(sent[0].id).toBe(o.id)
    expect(sent[1].kind).toBe(HIDDEN_KIND)
    expect(useShards.getState().mine[0].ref?.[2]).toBe('wss://mine.test')
  })

  it('refuses, in one line, when no relay of yours takes the author\'s object', async () => {
    const o = version('Statue', 1_700_000_000)
    refusedIds.add(o.id)
    await placeLinked(o)
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toBe(LINK_REFUSED)
    expect(bags()).toHaveLength(0)
  })
})

describe('B2: one object placed twice is two items', () => {
  it('two placements, two rows, two finds; deleting one leaves the other placed', async () => {
    const o = version('Statue', 1_700_000_000)
    // Building, so the second placement is at a point of its own.
    useBuilder.getState().enter('build')
    await placeLinked(o)
    S().moveCursor({ axis: 'x', dir: 1 })
    await placeLinked(o)
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((d) => d.eventId)).size).toBe(2)
    expect(mine.map((d) => d.eventId)).toEqual(mine.map((d) => entryKey(d.ref!)))

    // A finder sees both.
    const last = mine[1]
    const found = await unbag(bags().at(-1) as unknown as NostrEvent, hexToBytes(last.keyHex), async () => o.event as NostrEvent, undefined, last.height)
    const inThisBag = mine.filter((d) => d.lookupId === last.lookupId).length
    expect(found).toHaveLength(inThisBag)
    expect(new Set(found.map((h) => h.eventId)).size).toBe(inThisBag)

    // Deleting the second removes only the second.
    await useShards.getState().deleteInstance(last.eventId)
    const left = useShards.getState().mine
    expect(left).toHaveLength(1)
    expect(left[0].eventId).toBe(mine[0].eventId)
  })
})

describe('B3: the author edits the object', () => {
  it('the same row and the same find, refreshed; no second row, no second ceremony', async () => {
    const v1 = version('Statue', 1_700_000_000)
    await placeLinked(v1)
    const dep = useShards.getState().mine[0]
    const open = (o: FeedObject) => unbag(bags().at(-1) as unknown as NostrEvent, hexToBytes(dep.keyHex), async () => o.event as NostrEvent, undefined, dep.height)
    const first = await open(v1)
    useShards.getState().addDiscovered(first)
    const v2 = version('Statue, repainted', 1_700_000_500)
    const second = await open(v2)
    expect(second[0].eventId).toBe(first[0].eventId)
    // Not fresh: no ceremony for an edit.
    expect(useShards.getState().freshOf(second)).toEqual([])
    useShards.getState().addDiscovered(second)
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    expect(mine[0].inner.id).toBe(v2.id)
    expect(mine[0].shard?.name).toBe('Statue, repainted')
    expect(Object.keys(useShards.getState().discovered)).toEqual([first[0].eventId])
    expect(useShards.getState().discovered[first[0].eventId].inner?.id).toBe(v2.id)
  })
})

describe('comments on a LIVE LINK', () => {
  it('answer the bag only: no e, a, k or p naming the author\'s object', async () => {
    const o = version('Statue', 1_700_000_000)
    await placeLinked(o)
    const dep = useShards.getState().mine[0]
    const me = S().identity.pubkey
    const subject: CommentSubject = { author: me, lookupId: dep.lookupId, itemId: dep.eventId, type: 'shard', target: itemTargetOf(dep.inner, dep.ref), at: { x: 0n, y: 0n, z: 0n }, height: dep.height }
    const t = commentTemplate(subject, itemParent(subject), 'sealed', 1)
    const flat = JSON.stringify(t.tags)
    expect(flat).not.toContain(o.id)
    expect(flat).not.toContain(o.address)
    expect(flat).not.toContain(o.pubkey)
    expect(t.tags.find((x) => x[0] === 'e')).toBeUndefined()
    expect(t.tags.find((x) => x[0] === 'a')?.[1]).toBe(bagAddress(subject))
    expect(t.tags.find((x) => x[0] === 'k')?.[1]).toBe(String(HIDDEN_KIND))
    // And it threads under the item.
    const ev = finalizeEvent(t, generateSecretKey()) as unknown as NostrEvent
    expect(threadComments([ev], subject)).toHaveLength(1)
  })
})

describe('a copy from the feed', () => {
  it('keeps the pose its author published', () => {
    const o = version('Standing', 1_700_000_000)
    useShards.getState().startDeployObject({ ...o, shard: { ...o.shard, up: true, spin: 90 } })
    expect(useShards.getState().deployUp).toBe(true)
    expect(useShards.getState().deploySpin).toBe(90)
  })
})
