/**
 * hiddenReferences.test.ts - spec §7.6 references and DECK-0003 §3.4 objects:
 * a bag's list may name an event published on its own, which opens with the
 * same region key; rewrites carry references forward untouched.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure'
import { regionKeyAt } from './shardCrypto'
import { newShard, type ShardModel } from 'sno-core/shards'
import { positionHex } from './events'
import {
  OBJECT_KIND,
  OBJECT_PREVIEW,
  REFERENCE_THRESHOLD_BYTES,
  REGION_KEY_DERIVATION,
  bagEntries,
  bagTemplate,
  entryKey,
  isReference,
  messageInnerTemplate,
  objectTemplate,
  referenceTo,
  unbag,
  wantsReference,
  type Reference,
} from './hidden'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const stranger = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const wrong = regionKeyAt({ ...at, x: at.x + 10_000n }, 6, 20)
const shard: ShardModel = { ...newShard('relic'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

async function object(key = rk.key, signer = sk, d = 'placement-1'): Promise<NostrEvent> {
  return finalizeEvent(await objectTemplate(shard, key, d, 50), signer)
}
async function bag(entries: (NostrEvent | Reference)[]): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, 100), sk)
}
const relay = (events: NostrEvent[]) => async (ref: Reference) => {
  if (ref[0] === 'e') return events.find((e) => e.id === ref[1]) ?? null
  const [kind, author, d] = ref[1].split(':')
  return events.filter((e) => String(e.kind) === kind && e.pubkey === author && e.tags.some((t) => t[0] === 'd' && t[1] === d)).sort((a, b) => b.created_at - a.created_at)[0] ?? null
}

describe('the object (DECK-0003 §3.4)', () => {
  it('is kind 33331 with a preview, a d tag, and cyberspace:region, and says nothing about where', async () => {
    const o = await object()
    expect(o.kind).toBe(OBJECT_KIND)
    expect(o.content).toBe(OBJECT_PREVIEW)
    expect(o.tags.find((t) => t[0] === 'd')).toEqual(['d', 'placement-1'])
    const enc = o.tags.find((t) => t[0] === 'encrypted')!
    expect(enc[1]).toBe('aes-256-gcm')
    expect(enc[3]).toBe(REGION_KEY_DERIVATION)
    for (const name of ['C', 'h', 'hint', 'X', 'Y', 'Z', 'S', 'name']) expect(o.tags.some((t) => t[0] === name)).toBe(false)
  })
  it('is referenced by its coordinate and the exact point', async () => {
    const o = await object()
    expect(referenceTo(o, at, 0, 'wss://r')).toEqual(['a', `33331:${pk}:placement-1`, 'wss://r', positionHex(at, 0)])
  })
})

describe('unbag with references (spec §7.6)', () => {
  it('opens an a reference and an e reference with the bag key, beside an inline item', async () => {
    const o = await object()
    const m = finalizeEvent(messageInnerTemplate('inline note', at, 0, 2), sk)
    const eRef: Reference = ['e', o.id, '', positionHex(at, 0)]
    const outer = await bag([m, referenceTo(o, at, 0, ''), eRef])
    const items = await unbag(outer, rk.key, relay([o]))
    expect(items).toHaveLength(3)
    const refs = items.filter((i) => i.ref)
    expect(refs.map((i) => i.ref![0]).sort()).toEqual(['a', 'e'])
    for (const i of refs) {
      expect(i.type).toBe('shard')
      expect(i.shard!.vertices).toEqual(shard.vertices)
      expect(i.eventId).toBe(o.id)
      expect(i.inner).toEqual(o)
      expect(i.at).toEqual(at)
      expect(i.author).toBe(pk)
    }
  })
  it('without a resolver, references are skipped and inline items still open', async () => {
    const o = await object()
    const m = finalizeEvent(messageInnerTemplate('inline note', at, 0, 2), sk)
    expect(await unbag(await bag([m, referenceTo(o, at, 0, '')]), rk.key)).toHaveLength(1)
  })
  it('drops a reference that cannot be fetched, that names another event, or that another key sealed', async () => {
    const o = await object()
    const sealedElsewhere = await object(wrong.key, sk, 'placement-2')
    // Through JSON, as a relay delivers it: nostr-tools caches verification on the object itself.
    const forged = JSON.parse(JSON.stringify({ ...o, content: 'tampered' }))
    const outer = await bag([referenceTo(o, at, 0, ''), referenceTo(sealedElsewhere, at, 0, ''), ['e', 'f'.repeat(64), '', positionHex(at, 0)]])
    expect(await unbag(outer, rk.key, relay([sealedElsewhere]))).toHaveLength(0)
    expect(await unbag(outer, rk.key, relay([forged as NostrEvent]))).toHaveLength(0)
  })
  it("accepts another author's object, placed by the bag author", async () => {
    const theirs = await object(rk.key, stranger)
    const items = await unbag(await bag([referenceTo(theirs, at, 0, '')]), rk.key, relay([theirs]))
    expect(items).toHaveLength(1)
    expect(items[0].author).toBe(pk)
    expect(items[0].inner!.pubkey).toBe(getPublicKey(stranger))
  })
  it('a resolver that throws costs only that entry', async () => {
    const m = finalizeEvent(messageInnerTemplate('still here', at, 0, 2), sk)
    const o = await object()
    const items = await unbag(await bag([m, referenceTo(o, at, 0, '')]), rk.key, async () => { throw new Error('relay down') })
    expect(items.map((i) => i.text)).toEqual(['still here'])
  })
})

describe('rewriting a bag keeps its references', () => {
  it('bagEntries returns inline items and references, in order', async () => {
    const o = await object()
    const m = finalizeEvent(messageInnerTemplate('note', at, 0, 2), sk)
    const ref = referenceTo(o, at, 0, '')
    const entries = await bagEntries(await bag([m, ref]), rk.key)
    // By JSON: nostr-tools marks a verified event with a symbol, which the decrypted copy does not carry.
    expect(JSON.parse(JSON.stringify(entries))).toEqual(JSON.parse(JSON.stringify([m, ref])))
    expect(entries.map(entryKey)).toEqual([m.id, `a:33331:${pk}:placement-1@${positionHex(at, 0)}`])
    expect(isReference(entries[1])).toBe(true)
  })
})

describe('the review fixes', () => {
  it('a reference without a point is drawn at the region origin, and dropped without one', async () => {
    const o = await object()
    const bare: Reference = ['a', `33331:${pk}:placement-1`, '']
    const outer = await bag([bare])
    expect(await unbag(outer, rk.key, relay([o]))).toHaveLength(0)
    const origin = { at: { x: 1n, y: 2n, z: 3n }, plane: 1 as const }
    const items = await unbag(outer, rk.key, relay([o]), origin)
    expect(items).toHaveLength(1)
    expect(items[0].at).toEqual(origin.at)
    expect(items[0].plane).toBe(1)
  })
  it('one bag makes at most MAX_REFERENCES_PER_BAG lookups', async () => {
    const { MAX_REFERENCES_PER_BAG } = await import('./hidden')
    const refs: Reference[] = Array.from({ length: MAX_REFERENCES_PER_BAG + 20 }, (_, i) => ['e', i.toString(16).padStart(64, '0'), '', positionHex(at, 0)])
    let calls = 0
    await unbag(await bag(refs), rk.key, async () => { calls++; return null })
    expect(calls).toBe(MAX_REFERENCES_PER_BAG)
  })
  it('one object placed at two points is two entries', () => {
    const a1: Reference = ['a', `33331:${pk}:x`, '', 'aa']
    const a2: Reference = ['a', `33331:${pk}:x`, '', 'bb']
    expect(entryKey(a1)).not.toBe(entryKey(a2))
  })
  it('a rewrite carries forward inline items this client cannot verify, such as unsigned ones', async () => {
    const unsigned = { kind: 1, pubkey: pk, created_at: 5, tags: [], content: 'from the CLI' }
    const entries = await bagEntries(await bag([unsigned as unknown as NostrEvent]), rk.key)
    expect(entries).toEqual([unsigned])
  })
})

describe('wantsReference', () => {
  it('is false for a small shard and true past the threshold', () => {
    expect(wantsReference(shard)).toBe(false)
    const big: ShardModel = { ...shard, vertices: Array.from({ length: 2000 }, (_, i) => ({ p: [i % 60, (i * 7) % 60, (i * 13) % 60] as [number, number, number], c: [1, 1, 1] as [number, number, number] })) }
    expect(JSON.stringify(big).length).toBeGreaterThan(REFERENCE_THRESHOLD_BYTES)
    expect(wantsReference(big)).toBe(true)
  })
})
