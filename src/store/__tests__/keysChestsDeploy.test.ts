/**
 * keysChestsDeploy.test.ts: hiding a key and a chest through the deploy
 * (Keys and Chests B1 §3.1), and reading them back.
 *
 * A key hidden goes into the bag as a kind 3340 item signed by the hider and
 * into the hider's own LOOT at once. A chest's contents are signed one by one
 * and sealed to the lock before the bag is written; a key forged inside the
 * chest is held too; the chest opens with the key it was sealed to. A chest
 * whose contents pass NIP-44's limit is refused in words, and nothing is
 * hidden. A key a scan reads is held once. Relays are mocked; no network.
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

import { verifyEvent } from 'nostr-tools/pure'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { CHEST_KIND, KEY_KIND, chestItemOf, keyItemOf, type Hidden } from '../../lib/hidden'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useShards } from '../useShards'

const S = () => useShards.getState()
const I = () => useInventory.getState()

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; items stay in memory */ })
})

describe('hiding a key', () => {
  it('writes a signed kind 3340 item into the bag and holds the key at once, marked forged', async () => {
    const key = forgeKey('Wind Key', 'opens the first door')
    S().startDeployKey(key)
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    const d = S().mine.find((x) => x.type === 'key')!
    expect(d).toBeDefined()
    expect(d.inner.kind).toBe(KEY_KIND)
    expect(d.inner.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect(verifyEvent(d.inner)).toBe(true)
    expect(d.inner.tags).toContainEqual(['-'])
    expect(keyItemOf(d.inner)).toEqual({ ...key, about: 'opens the first door' })
    expect(d.key).toEqual(key)

    const held = I().items[d.eventId]
    expect(held?.source).toBe('forged')
    expect(held?.key).toEqual(key)
    expect(held?.place?.lookupId).toBe(d.lookupId)
    expect(held?.place?.bagId).toBe(d.bagId)
  })

  it('a key a scan reads is held once, not twice', () => {
    const forged = S().mine
    expect(forged).toHaveLength(0)
    const key = forgeKey('Found Key')
    const inner = { id: 'ab'.repeat(32), pubkey: 'cd'.repeat(32), created_at: 1, kind: KEY_KIND, tags: [['name', 'Found Key'], ['item', key.itemPubkey]], content: key.secretHex, sig: '' }
    const find: Hidden = { eventId: inner.id, inner, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: inner.pubkey, at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 4, createdAt: 1, type: 'key', key }
    S().addDiscovered([find])
    S().addDiscovered([find])
    expect(Object.keys(I().items)).toEqual([inner.id])
    expect(I().items[inner.id].source).toBe('found')
  })
})

describe('hiding a chest', () => {
  it('signs and seals its contents to the lock, holds the key forged inside, and opens with the lock', async () => {
    const lock = forgeKey('Wind Key')
    const inside = forgeKey('Fire Key')
    S().startDeployChest({
      name: 'Wind Chest',
      lock: { pubkey: lock.itemPubkey, label: 'Wind Key' },
      requires: 'the Wind Key',
      contents: [{ kind: 'message', text: 'the next door is north' }, { kind: 'key', key: inside }],
    })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    const d = S().mine.find((x) => x.type === 'chest')!
    expect(d.inner.kind).toBe(CHEST_KIND)
    expect(verifyEvent(d.inner)).toBe(true)
    const chest = chestItemOf(d.inner)!
    expect(chest.name).toBe('Wind Chest')
    expect(chest.lockPubkey).toBe(lock.itemPubkey)
    expect(chest.requires).toBe('the Wind Key')
    expect(d.chest).toEqual(chest)

    // Only the lock opens it: the hider's own identity key does not.
    expect(() => openWithSecret(chest, inside.secretHex)).toThrow()
    const contents = readContents(openWithSecret(chest, lock.secretHex))
    expect(contents.map((c) => c.body.type)).toEqual(['message', 'key'])
    expect(contents[0].body.text).toBe('the next door is north')
    expect(contents[1].body.key).toEqual(inside)
    expect(contents.every((c) => c.verified && c.event.pubkey === useCyberspace.getState().identity.pubkey)).toBe(true)

    // The key forged inside is held by the hider, with the chest's place.
    const held = Object.values(I().items).find((it) => it.key?.itemPubkey === inside.itemPubkey)
    expect(held?.source).toBe('forged')
    expect(held?.place?.lookupId).toBe(d.lookupId)
    // The lock was never hidden here, so it is not held: a chest can be sealed to a key one does not hold.
    expect(Object.values(I().items).some((it) => it.key?.itemPubkey === lock.itemPubkey)).toBe(false)
  })

  it('refuses contents past 65,535 bytes in words, and hides nothing', async () => {
    const lock = forgeKey('k')
    S().startDeployChest({
      name: 'Too much',
      lock: { pubkey: lock.itemPubkey, label: 'k' },
      requires: '',
      contents: Array.from({ length: 7 }, () => ({ kind: 'message' as const, text: 'x'.repeat(10_000) })),
    })
    await S().deploy()
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toMatch(/Too large to seal/)
    expect(S().mine).toHaveLength(0)
    expect(S().pending).not.toBeNull()
  })
})
