/**
 * feedDeploy.test.ts - placing someone else's object from the Shard Feed.
 *
 * Ruling B1 (arkinox, 2026-10-07): a copy by default, the payload carried in
 * the placement with a tag crediting the original, so a level stays exactly
 * as built; LIVE LINK places it by reference to the author's object (an `a`
 * entry, spec §7.6), following their edits; REMIX copies it into the
 * workshop as your own, still credited. And a reader opens a LIVE LINK.
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

const sent: { kind: number; tags: string[][]; id: string; content: string }[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => { sent.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { objectFromEvent, readCredit, type FeedObject } from 'sno-core/feed'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop, creditOf } from '../useWorkshop'
import { useBuilder } from '../useBuilder'
import { HIDDEN_KIND, OBJECT_KIND, SHARD_KIND, unbag } from '../../lib/hidden'
import { hexToBytes, type NostrEvent } from '../../lib/events'

/** Someone else's published object, signed by them, as the feed reads it. */
const AUTHOR = generateSecretKey()
function published(name: string, vertexCount = 3, unit = 5): FeedObject {
  const shard: ShardModel = {
    id: name, name, unit, extent: 32, mode: 'points', up: false, spin: 0, updatedAt: 0,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i % 30, Math.floor(i / 30) % 30, Math.floor(i / 900)] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] })),
    faces: [],
  }
  const ev = finalizeEvent({ kind: OBJECT_KIND, created_at: 1_700_000_000, tags: [['d', name]], content: JSON.stringify(toPayload(shard)) }, AUTHOR)
  const o = objectFromEvent(ev)
  if (!o) throw new Error('not an object')
  return { ...o, seen: ['wss://feed.relay'] }
}

const lastBag = () => [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent

beforeEach(() => {
  sent.length = 0
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useCyberspace.getState().clearFocus()
  useCyberspace.setState({ live: true })
})

describe('lining up a feed object', () => {
  it('enters BUILD mode with the object at the build cursor, at its own size', () => {
    const o = published('Lamp', 3, 7)
    useShards.getState().startDeployObject(o)
    expect(useBuilder.getState().active).toBe(true)
    expect(useShards.getState().pendingShard()?.name).toBe('Lamp')
    expect(useShards.getState().deployUnit).toBe(7)
    expect(useShards.getState().deployLink).toBe(false)
  })
})

describe('a copy (the default)', () => {
  it('carries the payload in a sealed item that credits the original with the q tag', async () => {
    const o = published('Chair')
    useShards.getState().startDeployObject(o)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const dep = useShards.getState().mine[0]
    expect(dep.ref).toBeUndefined()
    expect(dep.inner.kind).toBe(SHARD_KIND)
    expect(dep.inner.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect(readCredit(dep.inner.tags)).toEqual({ address: o.address, relay: 'wss://feed.relay' })
    expect(JSON.parse(dep.inner.content).name).toBe('Chair')
  })

  it('a large copy goes out as its own sealed object with no credit in plain view', async () => {
    const o = published('Hall', 3000)
    useShards.getState().startDeployObject(o)
    await useShards.getState().deploy()
    const object = sent.find((e) => e.kind === OBJECT_KIND)!
    expect(object).toBeTruthy()
    // The sealed object's tags are public: they must not say what is hidden.
    expect(readCredit(object.tags)).toBeNull()
    expect(object.tags.some((t) => t[0] === 'q' || t[0] === 'p')).toBe(false)
  })
})

describe('LIVE LINK', () => {
  it('places the author\'s own object by reference, signing nothing new for the item', async () => {
    const o = published('Statue', 3, 4)
    useShards.getState().startDeployObject(o)
    // Turned and resized before linking: a reference carries none of it.
    useShards.getState().setDeployUnit(9)
    useShards.getState().turnDeploy(1)
    useShards.getState().setDeployLink(true)
    expect(useShards.getState().deployUnit).toBe(4)
    expect(useShards.getState().deployTurn).toEqual([0, 0, 0])
    await useShards.getState().deploy()
    const dep = useShards.getState().mine[0]
    expect(dep.ref?.slice(0, 3)).toEqual(['a', o.address, 'wss://feed.relay'])
    expect(dep.inner.id).toBe(o.id)
    // Only the bag went out: no object of ours, no item.
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND])
  })

  it('opens for a reader: the bag names the public object and it draws', async () => {
    const o = published('Fountain')
    useShards.getState().startDeployObject(o)
    useShards.getState().setDeployLink(true)
    await useShards.getState().deploy()
    const dep = useShards.getState().mine[0]
    const items = await unbag(lastBag(), hexToBytes(dep.keyHex), async () => o.event as NostrEvent, undefined, dep.height)
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('shard')
    expect(items[0].shard?.name).toBe('Fountain')
  })
})

describe('REMIX', () => {
  it('copies into the workshop as your own, still credited, and a deploy of it carries the credit', async () => {
    const o = published('Tower')
    const id = useWorkshop.getState().importShard(o.shard, { address: o.address })
    const model = useWorkshop.getState().shards.find((s) => s.id === id)!
    expect(model.id).not.toBe(o.shard.id)
    expect(creditOf(model)).toEqual({ address: o.address })
    useShards.getState().startDeployShard(id)
    await useShards.getState().deploy()
    expect(readCredit(useShards.getState().mine[0].inner.tags)?.address).toBe(o.address)
  })

  it('your own model carries no credit', async () => {
    const o = published('Mine')
    const id = useWorkshop.getState().importShard(o.shard)
    useShards.getState().startDeployShard(id)
    await useShards.getState().deploy()
    expect(readCredit(useShards.getState().mine[0].inner.tags)).toBeNull()
  })
})
