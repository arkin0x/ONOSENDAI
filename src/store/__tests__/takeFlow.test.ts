/**
 * takeFlow.test.ts: found is not held (arkinox, 2026-10-26: "I dont want
 * items to automatically be added to my inventory the moment i decrypt them
 * from a bag. i want to TAKE them").
 *
 * What would fail silently without these: a scan putting a found item in
 * ITEMS again; TAKE holding twice; TAKE ALL of a
 * chest with two identical shards holding the model twice; an item already
 * held being dropped by the change; a find only TV showed being held as an
 * ordinary key by TAKE. What opens a chest (only OPEN) is manualOpen.test.
 * Relays are mocked; no network.
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
import { type ChestEntry } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate, shardInnerTemplate, type Hidden, type KeyItem } from '../../lib/hidden'
import { heldFromPasted } from '../../lib/inventory'
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
