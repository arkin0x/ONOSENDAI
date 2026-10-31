/**
 * manualOpen.test.ts: nothing opens by itself (arkinox, 2026-10-26:
 * "taking a key opens a chest or door right away? no, everything must be
 * opened or taken manually. that's the whole Zelda experience.").
 *
 * What would fail silently without these: a scan opening a chest because a
 * held item is its lock; TAKE of an item opening the chest beside it; a
 * chest inside an opened chest opening with it; a reload opening a chest
 * that was never opened by hand, or closing one that was; TV's finds
 * reopening a chest; a key out of a chest held two ways. Every decryption
 * of a chest with an item's secret is counted, so "opens nothing" means no
 * decrypt at all. Relays are mocked; no network.
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

vi.mock('../../lib/chests', async (actual) => {
  const real = await actual<typeof import('../../lib/chests')>()
  return { ...real, openWithSecret: vi.fn(real.openWithSecret) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { openWithSecret, sealEntries, sealerOf } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, type ChestItem, type Hidden, type KeyItem } from '../../lib/hidden'
import { heldFromEntry, heldFromPasted, placeOf } from '../../lib/inventory'
import { openChestHere } from '../../hud/ItemRows'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { openedByHand, openedKey, resetOpenedChests, useOpenedChests } from '../useOpenedChests'
import { useShards } from '../useShards'

const S = () => useShards.getState()
const I = () => useInventory.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }
const T0 = 1_800_000_000
const decrypts = (): number => vi.mocked(openWithSecret).mock.calls.length

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

const note = (text: string): NostrEvent => finalizeEvent(messageInnerTemplate(text, at, 0, T0), hider) as NostrEvent

function find(event: NostrEvent, body: Partial<Hidden>): Hidden {
  return { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: event.created_at, ...body } as Hidden
}

const chestFind = (c: { chest: ChestItem; event: NostrEvent }): Hidden => find(c.event, { type: 'chest', chest: c.chest })

function hold(k: { key: KeyItem; event: NostrEvent }): void {
  const row = heldFromPasted(me(), k.event, k.key, true, 1)
  useInventory.setState({ items: { ...I().items, [row.id]: row } })
}

/** OPEN, tapped, on a chest found here, with the held item it is locked to. */
async function tapOpen(h: Hidden, k: { key: KeyItem; event: NostrEvent }): Promise<void> {
  await openChestHere({ id: h.eventId, chest: h.chest!, author: h.author, place: placeOf(h), sealer: sealerOf(h) }, { by: 'key', key: { id: k.event.id, itemPubkey: k.key.itemPubkey, secretHex: k.key.secretHex } })
}

/** A reload: this session's finds and opened chests gone, what is kept on the device kept. */
function reload(): void {
  useShards.setState({ discovered: {} })
  resetOpenedChests()
}

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  vi.mocked(openWithSecret).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; items stay in memory */ })
})

describe('a scan opens nothing', () => {
  it('a chest whose item you hold is found closed: no decrypt, nothing inside found', () => {
    const k = keyIn('Boss Key')
    hold(k)
    const behind = note('behind the door')
    const c = chestIn('Strongbox', k.key.itemPubkey, [behind])
    S().addDiscovered([chestFind(c)])
    S().addDiscovered([chestFind(c)])
    expect(S().discovered[c.event.id]).toBeDefined()
    expect(S().discovered[behind.id]).toBeUndefined()
    expect(decrypts()).toBe(0)
    expect(useOpenedChests.getState().opened).toEqual({})
  })
})

describe('TAKE opens nothing', () => {
  it('taking the key a chest beside it is locked to leaves the chest closed', () => {
    const k = keyIn('Gate Key')
    const behind = note('the room')
    const c = chestIn('Gate', k.key.itemPubkey, [behind])
    S().addDiscovered([find(k.event, { type: 'key', key: k.key }), chestFind(c)])
    S().takeFound([k.event.id])
    expect(I().items[k.event.id]).toBeDefined()
    expect(S().discovered[behind.id]).toBeUndefined()
    expect(decrypts()).toBe(0)
  })
})

describe('OPEN opens', () => {
  it('lists what is inside and finds it in place, holding none of it', async () => {
    const k = keyIn('Boss Key')
    hold(k)
    const behind = note('behind the door')
    const inner = keyIn('Fire Key')
    const c = chestIn('Strongbox', k.key.itemPubkey, [behind, inner.event])
    S().addDiscovered([chestFind(c)])
    await tapOpen(S().discovered[c.event.id], k)
    expect(S().discovered[behind.id]?.chestId).toBe(c.event.id)
    expect(S().discovered[inner.event.id]?.chestId).toBe(c.event.id)
    expect(useOpenedChests.getState().opened[openedKey(me(), c.event.id)]).toHaveLength(2)
    expect(Object.keys(I().items)).toEqual([k.event.id])
    expect(openedByHand(me(), c.event.id, k.key.itemPubkey)).toBe(true)
  })

  it('a chest inside an opened chest is found closed, and opens only with its own OPEN', async () => {
    const k = keyIn('Boss Key')
    hold(k)
    const deep = note('the inner room')
    const nested = chestIn('Inner box', k.key.itemPubkey, [deep])
    const outer = chestIn('Outer box', k.key.itemPubkey, [nested.event])
    S().addDiscovered([chestFind(outer)])
    await tapOpen(S().discovered[outer.event.id], k)
    expect(S().discovered[nested.event.id]?.chestId).toBe(outer.event.id)
    expect(S().discovered[deep.id]).toBeUndefined()
    expect(decrypts()).toBe(1)
    await tapOpen(S().discovered[nested.event.id], k)
    expect(S().discovered[deep.id]?.chestId).toBe(nested.event.id)
  })

  it('a key found inside opens the next chest only by OPEN, after TAKE', async () => {
    const outerKey = keyIn('Outer Key')
    const innerKey = keyIn('Inner Key')
    const behind = note('behind the second door')
    const second = chestIn('Second', innerKey.key.itemPubkey, [behind])
    const first = chestIn('First', outerKey.key.itemPubkey, [innerKey.event])
    hold(outerKey)
    S().addDiscovered([chestFind(first), chestFind(second)])
    await tapOpen(S().discovered[first.event.id], outerKey)
    expect(I().items[innerKey.event.id]).toBeUndefined()
    S().takeFound([innerKey.event.id])
    expect(S().discovered[behind.id]).toBeUndefined()
    await tapOpen(S().discovered[second.event.id], innerKey)
    expect(S().discovered[behind.id]?.chestId).toBe(second.event.id)
  })
})

describe('a reload', () => {
  it('opens again a chest opened by hand, as it was, and opens nothing new', async () => {
    const k = keyIn('Boss Key')
    hold(k)
    const behind = note('behind the door')
    const deep = note('the inner room')
    const nested = chestIn('Inner box', k.key.itemPubkey, [deep])
    const opened = chestIn('Opened', k.key.itemPubkey, [behind, nested.event])
    const never = chestIn('Never opened', k.key.itemPubkey, [note('still shut')])
    S().addDiscovered([chestFind(opened), chestFind(never)])
    await tapOpen(S().discovered[opened.event.id], k)

    reload()
    vi.mocked(openWithSecret).mockClear()
    S().addDiscovered([chestFind(opened), chestFind(never)])
    // The hand-opened chest is open again, its contents found and listed under it.
    expect(S().discovered[behind.id]?.chestId).toBe(opened.event.id)
    expect(useOpenedChests.getState().opened[openedKey(me(), opened.event.id)]).toHaveLength(2)
    // The one never opened stays closed, and so does the chest inside, which was never opened by hand.
    expect(useOpenedChests.getState().opened[openedKey(me(), never.event.id)]).toBeUndefined()
    expect(S().discovered[nested.event.id]?.chestId).toBe(opened.event.id)
    expect(S().discovered[deep.id]).toBeUndefined()
    expect(decrypts()).toBe(1)
  })

  it('reopens a hand-opened chest inside a hand-opened chest too', async () => {
    const k = keyIn('Boss Key')
    hold(k)
    const deep = note('the inner room')
    const nested = chestIn('Inner box', k.key.itemPubkey, [deep])
    const outer = chestIn('Outer box', k.key.itemPubkey, [nested.event])
    S().addDiscovered([chestFind(outer)])
    await tapOpen(S().discovered[outer.event.id], k)
    await tapOpen(S().discovered[nested.event.id], k)
    reload()
    S().addDiscovered([chestFind(outer)])
    expect(S().discovered[deep.id]?.chestId).toBe(nested.event.id)
  })

  it('keeps a hand-opened chest closed when the item is no longer held, or for another identity, or from TV', async () => {
    const k = keyIn('Boss Key')
    hold(k)
    const behind = note('behind the door')
    const c = chestIn('Strongbox', k.key.itemPubkey, [behind])
    S().addDiscovered([chestFind(c)])
    await tapOpen(S().discovered[c.event.id], k)

    // From TV: watching opens nothing.
    reload()
    S().addDiscovered([chestFind(c)], { watched: true })
    expect(S().discovered[behind.id]).toBeUndefined()

    // Another identity on this device.
    reload()
    const was = useCyberspace.getState().identity
    try {
      useCyberspace.setState({ identity: { ...was, pubkey: getPublicKey(generateSecretKey()) } })
      S().addDiscovered([chestFind(c)])
      expect(S().discovered[behind.id]).toBeUndefined()
    } finally {
      useCyberspace.setState({ identity: was })
    }

    // The item gone from ITEMS: OPEN would need it, and so does the reload.
    reload()
    useInventory.setState({ items: {} })
    S().addDiscovered([chestFind(c)])
    expect(S().discovered[behind.id]).toBeUndefined()
  })
})

describe('a key out of a chest is held one way, whichever TAKE (review of #519)', () => {
  it('TAKE on its own row holds it as taken from the chest, at the chest\'s place, as the chest\'s TAKE does', async () => {
    const outer = keyIn('Outer Key')
    const inner = keyIn('Inner Key')
    const c = chestIn('Strongbox', outer.key.itemPubkey, [inner.event])
    hold(outer)
    const h = chestFind(c)
    S().addDiscovered([h])
    await tapOpen(S().discovered[c.event.id], outer)
    S().takeFound([inner.event.id])
    const row = I().items[inner.event.id]
    const fromChest = heldFromEntry(me(), { id: inner.event.id, event: inner.event, verified: true, body: { type: 'key', key: inner.key } }, { chestId: c.event.id, chestName: 'Strongbox' }, placeOf(h), row.at)
    // As data: nostr-tools marks an event object it verified with a symbol.
    const plain = (x: unknown): unknown => JSON.parse(JSON.stringify(x))
    expect(plain(row)).toEqual(plain(fromChest))
    expect(row.source).toBe('taken')
  })
})
