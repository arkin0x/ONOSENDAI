/**
 * hidden.test.ts - the bag model: signed inner events, encrypted to a region
 * as one addressable envelope, come back only to that region, verify, and
 * dispatch by kind. Many items share one bag.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { regionKeyAt } from './shardCrypto'
import { newShard, type ShardModel } from './shards'
import {
  HIDDEN_KIND,
  bagInners,
  bagTemplate,
  messageInnerTemplate,
  shardInnerTemplate,
  unbag,
} from './hidden'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const other = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const shard: ShardModel = { ...newShard('relic'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

const rk = regionKeyAt(at, 6, 20)

async function bag(inners: ReturnType<typeof finalizeEvent>[], key = rk.key): Promise<ReturnType<typeof finalizeEvent>> {
  return finalizeEvent(await bagTemplate(inners, key, rk.lookupId, 6, 100), sk)
}

describe('the envelope (spec 8.6)', () => {
  it('is kind 33330, keyed by d = lookup_id, with encrypted, version and h', async () => {
    const outer = await bagTemplate([finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)], rk.key, rk.lookupId, 6, 100)
    expect(outer.kind).toBe(HIDDEN_KIND)
    expect(outer.tags.find((t) => t[0] === 'd')).toEqual(['d', rk.lookupId])
    expect(outer.tags.find((t) => t[0] === 'encrypted')?.[1]).toBe('aes-256-gcm')
    expect(outer.tags.find((t) => t[0] === 'h')).toEqual(['h', '6'])
    // No NIP-70 protected tag.
    expect(outer.tags.some((t) => t[0] === '-')).toBe(false)
  })
})

describe('unbag', () => {
  it('returns every item, with its own coordinate, author and kind', async () => {
    const s = finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)
    const m = finalizeEvent(messageInnerTemplate('meet at the black sun', { ...at, x: at.x + 1n }, 1, 2), sk)
    const outer = await bag([s, m])
    const items = await unbag(outer, rk.key)
    expect(items).toHaveLength(2)
    const shardItem = items.find((i) => i.type === 'shard')!
    const msgItem = items.find((i) => i.type === 'message')!
    expect(shardItem.eventId).toBe(s.id)
    expect(shardItem.bagId).toBe(outer.id)
    expect(shardItem.author).toBe(pk)
    expect(shardItem.at).toEqual(at)
    expect(shardItem.shard!.vertices).toEqual(shard.vertices)
    expect(msgItem.text).toBe('meet at the black sun')
    expect(msgItem.plane).toBe(1)
    expect(msgItem.at.x).toBe(at.x + 1n)
  })

  it('stays shut to the wrong region', async () => {
    const outer = await bag([finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)])
    const wrong = regionKeyAt({ ...at, x: at.x + (1n << 6n) }, 6, 20).key
    expect(await unbag(outer, wrong)).toEqual([])
  })

  it('drops an item signed by someone other than the wrapper, keeps the rest', async () => {
    const mine = finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)
    const theirs = finalizeEvent(messageInnerTemplate('not mine', at, 0, 2), other)
    const outer = await bag([mine, theirs])
    const items = await unbag(outer, rk.key)
    expect(items).toHaveLength(1)
    expect(items[0].eventId).toBe(mine.id)
  })

  it('drops a tampered inner, keeps the rest', async () => {
    const good = finalizeEvent(messageInnerTemplate('real', at, 0, 1), sk)
    const inner = finalizeEvent(messageInnerTemplate('real', at, 0, 2), sk)
    const tampered = { ...inner, content: 'forged' }
    const outer = await bag([good, tampered])
    const items = await unbag(outer, rk.key)
    expect(items.map((i) => i.eventId)).toEqual([good.id])
  })
})

describe('bagInners (rebuild source)', () => {
  it('returns the verified inner events for the author', async () => {
    const s = finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)
    const m = finalizeEvent(messageInnerTemplate('two', at, 0, 2), sk)
    const outer = await bag([s, m])
    const inners = await bagInners(outer, rk.key)
    expect(inners.map((e) => e.id).sort()).toEqual([s.id, m.id].sort())
  })
})
