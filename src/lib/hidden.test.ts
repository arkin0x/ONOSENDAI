/**
 * hidden.test.ts - the wrap model: a signed inner event, encrypted to a
 * region, comes back only to that region, verifies, and dispatches by kind.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { regionKeyAt } from './shardCrypto'
import { newShard, type ShardModel } from './shards'
import {
  HIDDEN_KIND,
  REGION_TAG,
  hideTemplate,
  messageInnerTemplate,
  shardInnerTemplate,
  unhide,
} from './hidden'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const other = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const shard: ShardModel = { ...newShard('relic'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

async function hide(innerTemplate: ReturnType<typeof shardInnerTemplate>, key = sk, height = 6): Promise<ReturnType<typeof finalizeEvent>> {
  const inner = finalizeEvent(innerTemplate, key)
  const rk = regionKeyAt(at, height, 20)
  const outer = await hideTemplate(inner, rk.key, rk.lookupId, height)
  return finalizeEvent(outer, key)
}

describe('hidden shard', () => {
  it('wraps a signed kind:3330 in a kind:33330 with d, encrypted, version, h and the - tag', async () => {
    const rk = regionKeyAt(at, 6, 20)
    const inner = finalizeEvent(shardInnerTemplate(shard, at, 0, 10), sk)
    expect(inner.kind).toBe(3330)
    const outer = await hideTemplate(inner, rk.key, rk.lookupId, 6)
    expect(outer.kind).toBe(HIDDEN_KIND)
    // Unique d (so items in one region do not replace each other), region in l.
    const d = outer.tags.find((t) => t[0] === 'd')?.[1]
    expect(d).toMatch(/^[0-9a-f]{32}$/)
    expect(d).not.toBe(rk.lookupId)
    expect(outer.tags.find((t) => t[0] === REGION_TAG)).toEqual([REGION_TAG, rk.lookupId])
    expect(outer.tags.find((t) => t[0] === 'encrypted')?.[1]).toBe('aes-256-gcm')
    expect(outer.tags.find((t) => t[0] === 'h')).toEqual(['h', '6'])
    expect(outer.tags.some((t) => t[0] === '-')).toBe(true)
  })

  it('comes back to the region key, with the shard, coordinate and author', async () => {
    const ev = await hide(shardInnerTemplate(shard, at, 0, 10))
    const key = regionKeyAt(at, 6, 20).key
    const got = await unhide(ev, key)
    expect(got).not.toBeNull()
    expect(got!.type).toBe('shard')
    expect(got!.at).toEqual(at)
    expect(got!.plane).toBe(0)
    expect(got!.author).toBe(pk)
    expect(got!.shard!.mode).toBe('points')
    expect(got!.shard!.unit).toBe(4)
    expect(got!.shard!.vertices).toEqual(shard.vertices)
    expect(got!.height).toBe(6)
  })
})

describe('multiplicity', () => {
  it('gives two items in the same region different addresses', async () => {
    const rk = regionKeyAt(at, 6, 20)
    const a = await hideTemplate(finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk), rk.key, rk.lookupId, 6)
    const b = await hideTemplate(finalizeEvent(messageInnerTemplate('hi', at, 0, 2), sk), rk.key, rk.lookupId, 6)
    const da = a.tags.find((t) => t[0] === 'd')![1]
    const db = b.tags.find((t) => t[0] === 'd')![1]
    expect(da).not.toBe(db)
    // Both share the region handle, so one #l query finds both.
    expect(a.tags.find((t) => t[0] === REGION_TAG)![1]).toBe(b.tags.find((t) => t[0] === REGION_TAG)![1])
  })
})

describe('hidden message', () => {
  it('wraps a signed kind:1 and comes back as text', async () => {
    const ev = await hide(messageInnerTemplate('meet me at the black sun', at, 1, 20))
    const key = regionKeyAt(at, 6, 20).key
    const got = await unhide(ev, key)
    expect(got!.type).toBe('message')
    expect(got!.text).toBe('meet me at the black sun')
    expect(got!.plane).toBe(1)
    expect(got!.author).toBe(pk)
  })
})

describe('refusals', () => {
  it('stays shut to the wrong region', async () => {
    const ev = await hide(shardInnerTemplate(shard, at, 0, 10))
    const wrong = regionKeyAt({ ...at, x: at.x + (1n << 6n) }, 6, 20).key
    expect(await unhide(ev, wrong)).toBeNull()
  })

  it('refuses an envelope whose inner event is signed by someone else', async () => {
    // Inner signed by `other`, envelope signed by `sk`: not the wrapper's to place.
    const inner = finalizeEvent(shardInnerTemplate(shard, at, 0, 10), other)
    const rk = regionKeyAt(at, 6, 20)
    const outer = finalizeEvent(await hideTemplate(inner, rk.key, rk.lookupId, 6), sk)
    expect(await unhide(outer, rk.key)).toBeNull()
  })

  it('refuses a tampered inner event (bad signature)', async () => {
    const inner = finalizeEvent(shardInnerTemplate(shard, at, 0, 10), sk)
    const tampered = { ...inner, content: JSON.stringify({ ...JSON.parse(inner.content), name: 'evil' }) }
    const rk = regionKeyAt(at, 6, 20)
    const outer = finalizeEvent(await hideTemplate(tampered, rk.key, rk.lookupId, 6), sk)
    expect(await unhide(outer, rk.key)).toBeNull()
  })
})
