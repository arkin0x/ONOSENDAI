/**
 * chestRowsFollowItems.test.ts: an opened chest's rows follow what is in
 * ITEMS now (arkinox, 2026-11-09: "if i take everything from a chest, delete
 * it from my items, refresh onosendai, and reopen the chest, nothing comes
 * out and it says 'everything here is in your ITEMS'. it should check each
 * item against my ITEMS current state. anything missing should appear
 * again").
 *
 * The owner's steps, with the real inventory store over IndexedDB: TAKE ALL
 * on a chest of his own, each row taken off ITEMS the way ITEMS does it (a
 * key's DELETE, the X on a TAKEN row, MOVE TO WORKSHOP), a page load (the
 * store module fresh over the same database), and the chest read again.
 * Everything gone from ITEMS is offered again with TAKE; what is still in
 * ITEMS stays hidden: an ARCHIVED row (ARCHIVED is part of ITEMS), and a key
 * whose keypair is held under another row (that is holding it, review of
 * #615). TAKE ALL always finishes. No network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import type { NostrEvent } from '../../lib/events'
import { forgeKey, openWithSecret, readContents, sealEntries, type ChestEntry } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate, shardInnerTemplate, type KeyItem } from '../../lib/hidden'
import { heldFromForged, holdsEntry, type HeldItem } from '../../lib/inventory'

const SK = generateSecretKey()
const ME = getPublicKey(SK)

// The store reads the identity and follows its changes; nothing else of the
// cyberspace store is needed here.
vi.mock('../useCyberspace', () => ({
  useCyberspace: {
    getState: () => ({ identity: { pubkey: ME, npub: '' } }),
    subscribe: () => () => undefined,
  },
}))

type Mod = typeof import('../useInventory')

/** A page load: the module fresh, then the store's load for the identity. */
async function boot(): Promise<Mod> {
  vi.resetModules()
  const mod = await import('../useInventory')
  await mod.useInventory.getState().load(ME)
  return mod
}

const at = { x: 1n, y: 2n, z: 3n }
const T0 = 1_800_000_000
const from = { chestId: 'c'.repeat(64), chestName: 'Wind Chest' }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

/** A message sealed as a rumor, as the composer writes it: unsigned, its id its hash. */
function rumor(text: string): NostrEvent {
  const t = { ...messageInnerTemplate(text, at, 0, T0), pubkey: ME }
  return { ...t, id: getEventHash(t), sig: '' } as NostrEvent
}

function keyEvent(key: KeyItem, createdAt = T0): NostrEvent {
  return finalizeEvent(keyInnerTemplate(key, at, 0, createdAt), SK) as NostrEvent
}

/** The owner's own chest, sealed to a lock and opened with it: its rows as the card reads them. */
function ownChest(events: NostrEvent[]): ChestEntry[] {
  const lock = forgeKey('Wind Lock')
  const sealed = sealEntries(events, lock.itemPubkey)
  return readContents(openWithSecret({ senderPubkey: sealed.senderPubkey, payload: sealed.payload }, lock.secretHex), ME)
}

/** TAKE ALL, pressed until the list is empty, as the card offers it: it must finish. */
function takeAllUntilEmpty(m: Mod, takeable: (items: Record<string, HeldItem>) => ChestEntry[]): number {
  let presses = 0
  while (takeable(m.useInventory.getState().items).length > 0) {
    if (++presses > 3) throw new Error('TAKE ALL never finished')
    m.useInventory.getState().take(takeable(m.useInventory.getState().items), from, place)
  }
  return presses
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const takeableIn = (entries: ChestEntry[]) => (items: Record<string, HeldItem>): ChestEntry[] => entries.filter((e) => !holdsEntry(items, e))

describe('the owner\'s steps: take all, take each off ITEMS, reload, reopen', () => {
  it('everything taken off ITEMS appears again with TAKE, and TAKE ALL holds it again and finishes', async () => {
    const shard = { ...newShard('Column'), id: '' }
    const words = rumor('meet me at the gate')
    const coin = rumor('a second note')
    const key = forgeKey('Inside Key')
    const keyEv = keyEvent(key)
    const model = finalizeEvent(shardInnerTemplate({ ...shard, name: 'Column' }, at, 0, T0), SK) as NostrEvent
    const entries = ownChest([words, coin, keyEv, model])
    expect(entries.map((e) => e.body.type).sort()).toEqual(['key', 'message', 'message', 'shard'])
    const takeable = takeableIn(entries)

    const m = await boot()
    expect(takeAllUntilEmpty(m, takeable)).toBe(1)
    expect(Object.keys(m.useInventory.getState().items)).toHaveLength(4)
    await m.useInventory.getState().flush()

    // Off ITEMS, each the way ITEMS does it: DELETE on the key, the X on two
    // TAKEN rows, MOVE TO WORKSHOP on the model (which clears its row).
    expect(await m.useInventory.getState().remove(keyEv.id)).toBe(true)
    m.useInventory.getState().clearTaken([words.id, coin.id])
    m.useInventory.getState().clearTaken([model.id])
    await m.useInventory.getState().flush()
    // Nothing left in INVENTORY or ARCHIVED.
    expect(Object.values(m.useInventory.getState().items).filter((it) => !it.cleared)).toEqual([])
    // Before the reload, already: every row is offered again.
    expect(takeable(m.useInventory.getState().items).map((e) => e.id).sort()).toEqual(entries.map((e) => e.id).sort())

    // Refresh, then the chest read again.
    const again = await boot()
    expect(again.useInventory.getState().storage).toBe('indexeddb')
    expect(takeable(again.useInventory.getState().items).map((e) => e.id).sort()).toEqual(entries.map((e) => e.id).sort())

    // TAKE ALL holds all four again, in one press, and survives another reload.
    expect(takeAllUntilEmpty(again, takeable)).toBe(1)
    const held = again.useInventory.getState().items
    for (const e of entries) {
      expect(held[e.id]).toBeDefined()
      expect(held[e.id].cleared).toBeUndefined()
    }
    await again.useInventory.getState().flush()
    const third = await boot()
    expect(takeable(third.useInventory.getState().items)).toEqual([])
    expect(Object.values(third.useInventory.getState().items).every((it) => !it.cleared)).toBe(true)
  })

  it('a row ARCHIVED stays hidden on the chest, after a reload too: ARCHIVED is part of ITEMS', async () => {
    const key = forgeKey('Gate Key')
    const keyEv = keyEvent(key)
    const words = rumor('kept')
    const entries = ownChest([keyEv, words])
    const takeable = takeableIn(entries)
    const m = await boot()
    takeAllUntilEmpty(m, takeable)
    // The last copy of a key one of your chests is sealed to: DELETE refuses and ARCHIVE files it away.
    m.useInventory.getState().archive(keyEv.id)
    m.useInventory.getState().archive(words.id)
    await m.useInventory.getState().flush()
    const again = await boot()
    expect(again.useInventory.getState().items[keyEv.id]?.archived).toBeGreaterThan(0)
    expect(takeable(again.useInventory.getState().items)).toEqual([])
  })

  it('a key whose keypair is held under another row stays hidden, and TAKE adds no second copy', async () => {
    // The forged original, picked up in the world; the chest holds another instance of the same key.
    const key = forgeKey('Silver Key')
    const original = keyEvent(key, T0)
    const inChest = keyEvent(key, T0 + 5)
    const other = forgeKey('Brass Key')
    const otherEv = keyEvent(other)
    const entries = ownChest([inChest, otherEv])
    const takeable = takeableIn(entries)
    const m = await boot()
    m.useInventory.getState().add([heldFromForged(ME, original, key, place, T0)])
    expect(takeable(m.useInventory.getState().items).map((e) => e.id)).toEqual([otherEv.id])
    // TAKE on the held instance anyway adds nothing.
    expect(m.useInventory.getState().take([entries.find((e) => e.id === inChest.id)!], from, place)).toEqual([])
    expect(takeAllUntilEmpty(m, takeable)).toBe(1)
    expect(Object.values(m.useInventory.getState().items).filter((it) => it.key?.itemPubkey === key.itemPubkey)).toHaveLength(1)
    await m.useInventory.getState().flush()
    const again = await boot()
    expect(takeable(again.useInventory.getState().items)).toEqual([])
  })

  it('a taken copy deleted while the forged original is held: still hidden (same key); delete the original too and it comes back', async () => {
    const key = forgeKey('Silver Key')
    const original = keyEvent(key, T0)
    const inChest = keyEvent(key, T0 + 5)
    const entries = ownChest([inChest])
    const takeable = takeableIn(entries)
    const m = await boot()
    m.useInventory.getState().add([heldFromForged(ME, original, key, place, T0)])
    expect(await m.useInventory.getState().remove(original.id)).toBe(true)
    // Nothing of that keypair held: offered.
    expect(takeable(m.useInventory.getState().items).map((e) => e.id)).toEqual([inChest.id])
    takeAllUntilEmpty(m, takeable)
    expect(await m.useInventory.getState().remove(inChest.id)).toBe(true)
    await m.useInventory.getState().flush()
    const again = await boot()
    expect(takeable(again.useInventory.getState().items).map((e) => e.id)).toEqual([inChest.id])
  })

  it('a row sharing only an author lineage with a held item is its own item: offered, TAKE holds it, TAKE ALL finishes', async () => {
    // A held message by me, and a different message in the chest whose `d` names the held one's id.
    const held = rumor('first words')
    const t = { ...messageInnerTemplate('other words', at, 0, T0), pubkey: ME }
    const tagged = { ...t, tags: [...t.tags, ['d', held.id]] }
    const versionLike = { ...tagged, id: getEventHash(tagged), sig: '' } as NostrEvent
    const entries = ownChest([held, versionLike])
    const takeable = takeableIn(entries)
    const m = await boot()
    m.useInventory.getState().take([entries.find((e) => e.id === held.id)!], from, place)
    expect(takeable(m.useInventory.getState().items).map((e) => e.id)).toEqual([versionLike.id])
    expect(takeAllUntilEmpty(m, takeable)).toBe(1)
    expect(m.useInventory.getState().items[versionLike.id]).toBeDefined()
  })
})
