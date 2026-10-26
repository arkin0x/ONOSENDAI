/**
 * takeFlow.test.ts: found is not held (arkinox, 2026-10-26: "I dont want
 * items to automatically be added to my inventory the moment i decrypt them
 * from a bag. i want to TAKE them").
 *
 * What would fail silently without these: a scan putting a found item in
 * ITEMS again; a key found inside an opened chest opening the next chest in
 * the same pass, before anyone took it; TAKE holding twice; TAKE ALL of a
 * chest with two identical shards holding the model twice; an item already
 * held being dropped by the change; a find only TV showed being held as an
 * ordinary key by TAKE. Relays are mocked; no network.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { sealEntries, type ChestEntry } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, shardInnerTemplate, type ChestItem, type Hidden, type KeyItem } from '../../lib/hidden'
import { heldFromEntry, heldFromPasted, placeOf } from '../../lib/inventory'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useShards } from '../useShards'

const S = () => useShards.getState()
const I = () => useInventory.getState()
const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }
const T0 = 1_800_000_000

function keyIn(name: string): { key: KeyItem; event: NostrEvent } {
  const sk = generateSecretKey()
  const key: KeyItem = { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
  return { key, event: finalizeEvent(keyInnerTemplate(key, at, 0, T0), hider) as NostrEvent }
}

function chestIn(name: string, lock: string, inside: NostrEvent[]): { chest: ChestItem; event: NostrEvent } {
  const sealed = sealEntries(inside, lock)
  const item: ChestItem = { name, lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
  const event = finalizeEvent(chestInnerTemplate(item, at, 0, T0), hider) as NostrEvent
  return { chest: chestItemOf(event)!, event }
}

/** A find out of one bag, as a scan hands it to addDiscovered. */
function find(event: NostrEvent, body: Partial<Hidden>): Hidden {
  return { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: event.created_at, ...body } as Hidden
}

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; items stay in memory */ })
})

describe('found is not held', () => {
  it('a key a scan reads is found, and TAKE holds it once', () => {
    const { key, event } = keyIn('Wind Key')
    S().addDiscovered([find(event, { type: 'key', key })])
    expect(S().discovered[event.id]).toBeDefined()
    expect(I().items).toEqual({})
    expect(S().takeFound([event.id]).map((h) => h.id)).toEqual([event.id])
    expect(S().takeFound([event.id])).toEqual([])
    expect(Object.keys(I().items)).toEqual([event.id])
    expect(I().items[event.id].source).toBe('found')
  })

  it('takes only keypair items that are still found here', () => {
    const note = finalizeEvent(messageInnerTemplate('words', at, 0, T0), hider) as NostrEvent
    S().addDiscovered([find(note, { type: 'message', text: 'words' })])
    expect(S().takeFound([note.id, 'f'.repeat(64)])).toEqual([])
    expect(I().items).toEqual({})
  })

  it('keeps what was held before: a scan never removes an item', () => {
    const { key, event } = keyIn('Old Key')
    const row = heldFromPasted(useCyberspace.getState().identity.pubkey, event, key, true, 1)
    useInventory.setState({ items: { [row.id]: row } })
    S().addDiscovered([find(event, { type: 'key', key })])
    expect(I().items[event.id]).toEqual(row)
  })
})

describe('only what is taken opens a chest', () => {
  it('a key found inside an opened chest opens the next chest only once it is taken', () => {
    const outerKey = keyIn('Outer Key')
    const innerKey = keyIn('Inner Key')
    const behind = finalizeEvent(messageInnerTemplate('behind the second door', at, 0, T0), hider) as NostrEvent
    const second = chestIn('Second', innerKey.key.itemPubkey, [behind])
    const first = chestIn('First', outerKey.key.itemPubkey, [innerKey.event])
    const owner = useCyberspace.getState().identity.pubkey
    const held = heldFromPasted(owner, outerKey.event, outerKey.key, true, 1)
    useInventory.setState({ items: { [held.id]: held } })

    const chests = [find(first.event, { type: 'chest', chest: first.chest }), find(second.event, { type: 'chest', chest: second.chest })]
    S().addDiscovered(chests)
    // The first chest opened with the key held; the key inside is found, not held, and opens nothing yet.
    expect(S().discovered[innerKey.event.id]?.chestId).toBe(first.event.id)
    expect(I().items[innerKey.event.id]).toBeUndefined()
    expect(S().discovered[behind.id]).toBeUndefined()

    // TAKE, then the next scan: the second chest opens.
    S().takeFound([innerKey.event.id])
    expect(I().items[innerKey.event.id]?.key?.itemPubkey).toBe(innerKey.key.itemPubkey)
    S().addDiscovered(chests)
    expect(S().discovered[behind.id]?.chestId).toBe(second.event.id)
  })
})

describe('TAKE opens what the item opens, at once (review of #519)', () => {
  it('a chest found in play beside the key opens the moment the key is taken, not at the next scan', () => {
    const k = keyIn('Gate Key')
    const behind = finalizeEvent(messageInnerTemplate('the room', at, 0, T0), hider) as NostrEvent
    const chest = chestIn('Gate', k.key.itemPubkey, [behind])
    S().addDiscovered([find(k.event, { type: 'key', key: k.key }), find(chest.event, { type: 'chest', chest: chest.chest })])
    expect(S().discovered[behind.id]).toBeUndefined()
    S().takeFound([k.event.id])
    expect(S().discovered[behind.id]?.chestId).toBe(chest.event.id)
  })

  it('a chest only TV showed stays shut when a played key is taken', () => {
    const k = keyIn('Gate Key')
    const behind = finalizeEvent(messageInnerTemplate('the room', at, 0, T0), hider) as NostrEvent
    const chest = chestIn('Gate', k.key.itemPubkey, [behind])
    S().addDiscovered([find(chest.event, { type: 'chest', chest: chest.chest })], { watched: true })
    S().addDiscovered([find(k.event, { type: 'key', key: k.key })])
    S().takeFound([k.event.id])
    expect(I().items[k.event.id]?.watched).toBeUndefined()
    expect(S().discovered[behind.id]).toBeUndefined()
  })
})

describe('a key out of a chest is held one way, whichever TAKE (review of #519)', () => {
  it('TAKE on its own row holds it as taken from the chest, at the chest\'s place, as the chest\'s TAKE does', () => {
    const outer = keyIn('Outer Key')
    const inner = keyIn('Inner Key')
    const chest = chestIn('Strongbox', outer.key.itemPubkey, [inner.event])
    const owner = useCyberspace.getState().identity.pubkey
    const held = heldFromPasted(owner, outer.event, outer.key, true, 1)
    useInventory.setState({ items: { [held.id]: held } })
    const chestFind = find(chest.event, { type: 'chest', chest: chest.chest })
    S().addDiscovered([chestFind])
    S().takeFound([inner.event.id])
    const row = I().items[inner.event.id]
    const fromChest = heldFromEntry(owner, { id: inner.event.id, event: inner.event, verified: true, body: { type: 'key', key: inner.key } }, { chestId: chest.event.id, chestName: 'Strongbox' }, placeOf(chestFind), row.at)
    // As data: nostr-tools marks an event object it verified with a symbol.
    const plain = (x: unknown): unknown => JSON.parse(JSON.stringify(x))
    expect(plain(row)).toEqual(plain(fromChest))
    expect(row.source).toBe('taken')
  })
})

describe('what another identity found in play (review of #519)', () => {
  it('does not make a key TV showed this identity a played key', () => {
    const k = keyIn('TV Key')
    S().addDiscovered([find(k.event, { type: 'key', key: k.key })])
    const was = useCyberspace.getState().identity
    try {
      const other = getPublicKey(generateSecretKey())
      useCyberspace.setState({ identity: { ...was, pubkey: other } })
      useInventory.setState({ owner: other, items: {} })
      useShards.setState({ discovered: {} })
      S().addDiscovered([find(k.event, { type: 'key', key: k.key })], { watched: true })
      S().takeFound([k.event.id])
      expect(I().items[k.event.id]?.watched).toBe(true)
    } finally {
      useCyberspace.setState({ identity: was })
    }
  })
})

describe('TAKE out of a chest', () => {
  const from = { chestId: 'c'.repeat(64), chestName: 'Strongbox' }
  const entryOf = (event: NostrEvent, body: ChestEntry['body']): ChestEntry => ({ id: event.id, event, verified: true, body })

  it('TAKE ALL holds every row once, one shard per model, and again holds nothing', () => {
    const shard = { ...newShard('Column'), id: '' }
    const a = finalizeEvent(shardInnerTemplate({ ...shard, name: 'Column' }, at, 0, T0), hider) as NostrEvent
    const b = finalizeEvent(shardInnerTemplate({ ...shard, name: 'Column copy' }, at, 0, T0 + 1), hider) as NostrEvent
    const note = finalizeEvent(messageInnerTemplate('inside', at, 0, T0), hider) as NostrEvent
    const k = keyIn('Inside Key')
    const entries = [
      entryOf(a, { type: 'shard', shard: { ...shard, name: 'Column' } }),
      entryOf(b, { type: 'shard', shard: { ...shard, name: 'Column copy' } }),
      entryOf(note, { type: 'message', text: 'inside' }),
      entryOf(k.event, { type: 'key', key: k.key }),
    ]
    const taken = I().take(entries, from, null)
    expect(taken.map((h) => h.id).sort()).toEqual([a.id, note.id, k.event.id].sort())
    expect(I().take(entries, from, null)).toEqual([])
    // The key taken out of the chest opens what it is the lock of.
    expect(I().items[k.event.id].type).toBe('key')
  })
})

describe('what Cyberspace TV showed', () => {
  it('TAKE holds a key only TV showed as watched, and one found in play as an ordinary key', () => {
    const tv = keyIn('TV Key')
    const played = keyIn('Played Key')
    S().addDiscovered([find(tv.event, { type: 'key', key: tv.key })], { watched: true })
    S().addDiscovered([find(played.event, { type: 'key', key: played.key })])
    S().takeFound([tv.event.id, played.event.id])
    expect(I().items[tv.event.id]?.watched).toBe(true)
    expect(I().items[played.event.id]?.watched).toBeUndefined()
    // Found again in play, the TV key is an ordinary key from then on.
    S().addDiscovered([find(tv.event, { type: 'key', key: tv.key })])
    expect(I().items[tv.event.id]?.watched).toBeUndefined()
  })
})
