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
/** Deletions (kind 5) the relays hold in the current test. */
const deletions: Sent[] = []
/** The first relay never answers a publish, in the current test. */
let silentDown = false
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (relays: string[], ev: Sent) => {
    if (silentDown && relays.length === 1 && relays[0] === 'wss://down.test') return new Promise(() => {})
    // The first relay of yours is down and takes nothing.
    if (refusedIds.has(ev.id) || (relays.length === 1 && relays[0] === 'wss://down.test')) return { ok: false }
    sent.push(ev)
    return { ok: true }
  }),
  // The relay holds the newest bag sent, as a relay keeps an addressable event.
  query: vi.fn(async (f: { kinds: number[]; '#d'?: string[] }) => {
    if (f.kinds.includes(5)) return deletions
    // Each bag by its own d: the newest version of it.
    const b = [...sent].reverse().find((e) => e.kind === 33330 && (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))))
    return b ? [b] : []
  }),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://down.test', 'wss://mine.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { objectFromEvent, type FeedObject } from 'sno-core/feed'
import { useCyberspace } from '../useCyberspace'
import { LINK_DELETED, LINK_PROTECTED, LINK_REFUSED, forgetLinkCopies, useShards } from '../useShards'
import { useBuilder } from '../useBuilder'
import { HIDDEN_KIND, OBJECT_KIND, linkKey, unbag } from '../../lib/hidden'
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

async function placeLinked(o: FeedObject, height = 4): Promise<void> {
  useShards.getState().startDeployObject(o)
  useShards.getState().setDeployLink(true)
  useShards.setState({ deployHeight: height })
  await useShards.getState().deploy()
}

const shardOf = (name: string): ShardModel => ({
  id: 'mine', name, unit: 0, extent: 32, mode: 'points', up: false, spin: 0, updatedAt: 0,
  vertices: [0, 1, 2].map((i) => ({ p: [i, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [],
})

beforeEach(() => {
  sent.length = 0
  forgetLinkCopies()
  refusedIds.clear()
  deletions.length = 0
  silentDown = false
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
    expect(mine.map((d) => d.eventId)).toEqual(mine.map((d) => linkKey(d.lookupId, d.ref!)))

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
    // And, opened with the bag's key, it threads under the item (the item named inside the seal).
    const { openComments, sealedComment } = await import('../../lib/comments')
    const key = hexToBytes(dep.keyHex)
    const sealed = finalizeEvent(await sealedComment(subject, itemParent(subject), 'hello', 1, key), generateSecretKey()) as unknown as NostrEvent
    expect(threadComments([sealed], subject, await openComments([sealed], key))).toHaveLength(1)
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

describe('verification review of #233', () => {
  it('a LIVE LINK of your OWN object is one row: the deploy and the scan key it the same way', async () => {
    const ev = await S().signEvent({ kind: OBJECT_KIND, created_at: 1_700_000_000, tags: [['d', 'mine-obj']], content: JSON.stringify(toPayload(shardOf('Mine'))) })
    const o = { ...objectFromEvent(ev as never)!, seen: ['wss://elsewhere.test'] }
    await placeLinked(o)
    const dep = useShards.getState().mine[0]
    const found = await unbag(bags().at(-1) as unknown as NostrEvent, hexToBytes(dep.keyHex), async () => ev as NostrEvent, undefined, dep.height)
    expect(found[0].eventId).toBe(dep.eventId)
    useShards.getState().addDiscovered(found)
    expect(useShards.getState().mine).toHaveLength(1)
  })

  it('one object at one point in two bags (two heights) is two items; deleting one leaves the other', async () => {
    const o = version('Statue', 1_700_000_000)
    await placeLinked(o, 4)
    await placeLinked(o, 6)
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((d) => d.lookupId)).size).toBe(2)
    expect(mine[0].eventId).not.toBe(mine[1].eventId)
    const bagOf = (lookupId: string) => sent.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === lookupId)).at(-1)! as unknown as NostrEvent
    const f4 = await unbag(bagOf(mine[0].lookupId), hexToBytes(mine[0].keyHex), async () => o.event as NostrEvent, undefined, 4)
    const f6 = await unbag(bagOf(mine[1].lookupId), hexToBytes(mine[1].keyHex), async () => o.event as NostrEvent, undefined, 6)
    // A finder (another identity) keeps both.
    const realMe = S().identity
    useCyberspace.setState({ identity: { ...realMe, pubkey: 'f'.repeat(64) } })
    useShards.getState().addDiscovered([...f4, ...f6])
    expect(Object.keys(useShards.getState().discovered)).toHaveLength(2)
    useCyberspace.setState({ identity: realMe })
    useShards.setState({ discovered: {} })
    // The hider deletes the height-4 one; the height-6 one stays, and a rescan keeps it.
    await useShards.getState().deleteInstance(mine[0].eventId)
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual([mine[1].eventId])
    useShards.getState().addDiscovered(f6)
    expect(useShards.getState().mine).toHaveLength(1)
  })

  it('two LIVE LINKs in one bag have their own comment threads, told apart only inside the seal', async () => {
    const { openComments, sealedComment } = await import('../../lib/comments')
    const a = version('Statue', 1_700_000_000)
    useBuilder.getState().enter('build')
    await placeLinked(a)
    S().moveCursor({ axis: 'x', dir: 1 })
    await placeLinked(a)
    const [d1, d2] = useShards.getState().mine
    expect(d1.lookupId).toBe(d2.lookupId)
    const me = S().identity.pubkey
    const subj = (d: typeof d1): CommentSubject => ({ author: me, lookupId: d.lookupId, itemId: d.eventId, type: 'shard', target: itemTargetOf(d.inner, d.ref), at: { x: 0n, y: 0n, z: 0n }, height: d.height })
    const key = hexToBytes(d1.keyHex)
    const t = await sealedComment(subj(d1), itemParent(subj(d1)), 'on the first', 1, key)
    // In public it names only the bag.
    expect(JSON.stringify(t.tags)).not.toContain(d1.eventId)
    const ev = finalizeEvent(t, generateSecretKey()) as unknown as NostrEvent
    const opened = await openComments([ev], key)
    expect(threadComments([ev], subj(d1), opened).map((c) => c.text)).toEqual(['on the first'])
    expect(threadComments([ev], subj(d2), opened)).toHaveLength(0)
  })

  it('a NIP-70 protected object is never LIVE LINKed: the toggle refuses and nothing is republished', async () => {
    const ev = finalizeEvent({ kind: OBJECT_KIND, created_at: 1_700_000_000, tags: [['d', 'prot'], ['-']], content: JSON.stringify(toPayload(shardOf('Protected'))) }, AUTHOR)
    const o = { ...objectFromEvent(ev)!, seen: ['wss://elsewhere.test'] }
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    expect(useShards.getState().deployLink).toBe(false)
    // Forced on anyway: the deploy refuses.
    useShards.setState({ deployLink: true, deployHeight: 4 })
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBe(LINK_PROTECTED)
    expect(sent.some((e) => e.id === ev.id)).toBe(false)
  })

  it('an object its author deleted is not republished by a LIVE LINK', async () => {
    const o = version('Statue', 1_700_000_000)
    deletions.push({ kind: 5, id: 'd'.repeat(64), pubkey: o.pubkey, content: '', tags: [['a', o.address]], created_at: 1_700_000_100 } as unknown as Sent)
    await placeLinked(o)
    expect(useShards.getState().deployError).toBe(LINK_DELETED)
    expect(sent.some((e) => e.id === o.id)).toBe(false)
  })

  it('the republish goes on as soon as one relay takes it, not waiting on a silent one', async () => {
    silentDown = true
    const o = version('Statue', 1_700_000_000)
    await placeLinked(o)
    expect(useShards.getState().deployStatus).toBe('done')
    expect(useShards.getState().mine[0].ref?.[2]).toBe('wss://mine.test')
  })

  it('LOCAL sends nothing; BROADCAST sends the object, then the bag, and re-hints a relay that took it', async () => {
    useCyberspace.setState({ live: false })
    const o = version('Statue', 1_700_000_000)
    await placeLinked(o)
    expect(sent).toHaveLength(0)
    expect(useShards.getState().mine[0].ref?.[2]).toBe('wss://down.test')
    useCyberspace.setState({ live: true })
    expect(await useShards.getState().broadcast(useShards.getState().mine[0].lookupId)).toBe(true)
    expect(sent[0].id).toBe(o.id)
    expect(sent.at(-1)?.kind).toBe(HIDDEN_KIND)
    expect(useShards.getState().mine[0].ref?.[2]).toBe('wss://mine.test')
    // The bag that went out carries the re-hinted entry.
    const dep = useShards.getState().mine[0]
    const found = await unbag(bags().at(-1) as unknown as NostrEvent, hexToBytes(dep.keyHex), async (ref) => { expect(ref[2]).toBe('wss://mine.test'); return o.event as NostrEvent }, undefined, dep.height)
    expect(found).toHaveLength(1)
  })
})

describe('reactions on an addressable object', () => {
  it('carry its a tag (NIP-25), and count across the author\'s edits', async () => {
    const { reactionTemplate, groupReactions } = await import('../../lib/social')
    const v1 = version('Statue', 1_700_000_000)
    const v2 = version('Statue, repainted', 1_700_000_500)
    const t = reactionTemplate({ id: v1.id, pubkey: v1.pubkey, kind: OBJECT_KIND, address: v1.address }, '+', 1)
    expect(t.tags).toContainEqual(['a', v1.address, ''])
    const r = finalizeEvent(t, generateSecretKey()) as unknown as NostrEvent
    expect(groupReactions([r], v2.id, new Set(), v2.address)[0]?.pubkeys).toHaveLength(1)
  })
})

describe('copy on pick (arkinox, 2026-10-08): the object goes out when LIVE LINK is picked, not with the bag', () => {
  const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

  it('while LIVE, picking LIVE LINK puts the author\'s object on your relays before any bag; the deploy does not send it again', async () => {
    const o = version('Statue', 1_700_000_000)
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    await settle()
    expect(sent.map((e) => e.id)).toEqual([o.id])
    expect(bags()).toHaveLength(0)
    useShards.setState({ deployHeight: 4 })
    await useShards.getState().deploy()
    expect(sent.filter((e) => e.id === o.id)).toHaveLength(1)
    expect(sent.at(-1)?.kind).toBe(HIDDEN_KIND)
    expect(useShards.getState().mine[0].ref?.[2]).toBe('wss://mine.test')
  })

  it('while LOCAL, picking LIVE LINK sends nothing, and neither does the deploy', async () => {
    useCyberspace.setState({ live: false })
    const o = version('Statue', 1_700_000_000)
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    await settle()
    useShards.setState({ deployHeight: 4 })
    await useShards.getState().deploy()
    expect(sent).toHaveLength(0)
  })

  it('a cancel after the pick does nothing more: the copy simply stays on your relay', async () => {
    const o = version('Statue', 1_700_000_000)
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    await settle()
    useShards.getState().cancelDeploy()
    expect(sent.map((e) => e.id)).toEqual([o.id])
    expect(bags()).toHaveLength(0)
  })

  it('a copy no relay took at the pick is tried again by the deploy', async () => {
    const o = version('Statue', 1_700_000_000)
    refusedIds.add(o.id)
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    await settle()
    refusedIds.delete(o.id)
    useShards.setState({ deployHeight: 4 })
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    expect(sent[0].id).toBe(o.id)
  })
})
