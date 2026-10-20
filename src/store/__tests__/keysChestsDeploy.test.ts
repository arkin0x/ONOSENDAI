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

import { getEventHash, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { CHEST_KIND, KEY_KIND, MESSAGE_KIND, chestItemOf, keyItemOf, type Hidden } from '../../lib/hidden'
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
    expect(verifyEvent(d.inner as NostrEvent)).toBe(true)
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
    expect(verifyEvent(d.inner as NostrEvent)).toBe(true)
    expect(d.inner.tags).toContainEqual(['-'])
    const chest = chestItemOf(d.inner)!
    expect(chest.name).toBe('Wind Chest')
    expect(chest.lockPubkey).toBe(lock.itemPubkey)
    expect(chest.requires).toBe('the Wind Key')
    expect(d.chest).toEqual(chest)

    // Only the lock opens it: the hider's own identity key does not.
    expect(() => openWithSecret(chest, inside.secretHex)).toThrow()
    const raw = openWithSecret(chest, lock.secretHex)
    const contents = readContents(raw, d.inner.pubkey)
    expect(contents.map((c) => c.body.type)).toEqual(['message', 'key'])
    expect(contents[0].body.text).toBe('the next door is north')
    expect(contents[1].body.key).toEqual(inside)
    expect(contents.every((c) => c.verified && c.event.pubkey === useCyberspace.getState().identity.pubkey)).toBe(true)
    // The message went in as a rumor (arkinox, 2026-10-20): no signature, its
    // id its hash, `-` on it; the key inside is signed. Without the chest
    // signer to vouch for it, its author would be a claim.
    const message = raw.find((e) => !Array.isArray(e) && e.kind === MESSAGE_KIND) as Record<string, unknown> & NostrEvent
    expect('sig' in message).toBe(false)
    expect(message.id).toBe(getEventHash(message))
    expect(message.tags).toContainEqual(['-'])
    expect(readContents(raw)[0].verified).toBe(false)

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

describe('hiding a message (arkinox, 2026-10-20)', () => {
  it('seals it as a rumor with `-` and never asks the signer for it: only the bag is signed', async () => {
    const sign = vi.spyOn(useCyberspace.getState(), 'signEvent')
    S().startDeployMessage('meet me at the black sun')
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    const d = S().mine.find((x) => x.type === 'message')!
    expect(d.inner.kind).toBe(MESSAGE_KIND)
    expect(d.inner.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect('sig' in d.inner).toBe(false)
    expect(d.inner.id).toBe(getEventHash(d.inner))
    expect(d.inner.tags).toContainEqual(['-'])
    expect(d.eventId).toBe(d.inner.id)
    // One signature: the envelope's, never the message's.
    expect(sign.mock.calls.map((c) => c[0].kind)).toEqual([33330])
    sign.mockRestore()
  })
})

describe('what your own chest holds stays in the chest (review of #409)', () => {
  it('a second device that finds your chest and holds its lock files the contents as finds, never as deployments a rewrite would carry out of the chest', async () => {
    const lock = forgeKey('Lock')
    S().startDeployKey(lock)
    await S().deploy()
    S().startDeployChest({ name: 'C', lock: { pubkey: lock.itemPubkey, label: 'Lock' }, requires: 'Lock', contents: [{ kind: 'message', text: 'secret msg' }, { kind: 'key', key: forgeKey('Inner Key') }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    // The second device: no rows of its own yet, the scan finds the bag's two items.
    const finds = S().mine.map((d) => ({ eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: d.inner.pubkey, at: { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }, plane: d.plane, height: d.height, createdAt: d.createdAt, type: d.type, key: d.key, chest: d.chest, text: d.text, bag: d.bag }) as Hidden)
    useShards.setState({ mine: [] })
    S().addDiscovered(finds)
    // The chest opened with the held lock: its message and key are found, in place...
    const revealed = Object.values(S().discovered).filter((h) => h.chestId)
    expect(revealed.map((h) => h.type).sort()).toEqual(['key', 'message'])
    // ...vouched for by the chest, so none is a claim...
    expect(revealed.every((h) => !h.claim)).toBe(true)
    // ...and only the bag's own two items became this device's deployments.
    expect(S().mine.map((d) => d.type).sort()).toEqual(['chest', 'key'])
    expect(S().mine.every((d) => d.inner.kind !== MESSAGE_KIND)).toBe(true)
  })
})
