/**
 * inventoryStorage.test.ts: held items kept in IndexedDB, per identity,
 * through the store. A page load is a fresh copy of the store module over
 * the same database. A key held before the load has answered is kept; a key
 * read twice is held once; another identity's items are not shown.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '../../lib/events'
import { keyInnerTemplate, type Hidden, type KeyItem } from '../../lib/hidden'
import { keyText } from '../../lib/inventory'

const ME = 'ee'.repeat(32)
const OTHER = 'dd'.repeat(32)
let identity = ME

// The store reads the identity and follows its changes; nothing else of the
// cyberspace store is needed here.
vi.mock('../useCyberspace', () => ({
  useCyberspace: {
    getState: () => ({ identity: { pubkey: identity, npub: '' } }),
    subscribe: () => () => undefined,
  },
}))

type Mod = typeof import('../useInventory')

/** A page load: the module fresh, then the store's load for the identity. */
async function boot(owner = identity): Promise<Mod> {
  vi.resetModules()
  const mod = await import('../useInventory')
  await mod.useInventory.getState().load(owner)
  return mod
}

const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }

function forge(name: string): KeyItem {
  const sk = generateSecretKey()
  return { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
}

function keyFind(key: KeyItem, createdAt = 10): Hidden {
  const inner = finalizeEvent(keyInnerTemplate(key, at, 0, createdAt), hider)
  return { eventId: inner.id, inner, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: getPublicKey(hider), at, plane: 0, height: 6, createdAt, type: 'key', key }
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  identity = ME
  vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('held items in IndexedDB', () => {
  it('a key found is held once, survives a reload, and is this identity’s only', async () => {
    const m = await boot()
    expect(m.useInventory.getState().storage).toBe('indexeddb')
    const find = keyFind(forge('Wind Key'))
    expect(m.useInventory.getState().holdFinds([find, find])).toHaveLength(1)
    expect(m.useInventory.getState().holdFinds([find])).toHaveLength(0)
    expect(Object.keys(m.useInventory.getState().items)).toEqual([find.eventId])
    await m.useInventory.getState().flush()

    const again = await boot()
    const held = again.useInventory.getState().items[find.eventId]
    expect(held?.key).toEqual(find.key)
    expect(held?.source).toBe('found')
    expect(held?.verified).toBe(true)
    expect(held?.place?.lookupId).toBe('lookup')

    const other = await boot(OTHER)
    expect(Object.keys(other.useInventory.getState().items)).toEqual([])
  })

  it('a key held before the load answered is kept and written', async () => {
    vi.resetModules()
    const mod = await import('../useInventory')
    const loading = mod.useInventory.getState().load(ME)
    const find = keyFind(forge('Early'))
    mod.useInventory.getState().holdFinds([find])
    await loading
    expect(mod.useInventory.getState().items[find.eventId]).toBeDefined()
    await mod.useInventory.getState().flush()
    const again = await boot()
    expect(again.useInventory.getState().items[find.eventId]?.name).toBe('Early')
  })

  it('PASTE holds a key from its text once, and says when it was already held', async () => {
    const m = await boot()
    const find = keyFind(forge('Pasted'))
    const held = m.useInventory.getState().holdFinds([find])[0]
    const text = keyText(held)
    const other = await boot(OTHER)
    const first = other.useInventory.getState().paste(text)
    expect(first.ok).toBe(true)
    expect(first.already).toBe(false)
    expect(first.item?.source).toBe('pasted')
    expect(first.item?.verified).toBe(true)
    expect(first.item?.place).toBeNull()
    const second = other.useInventory.getState().paste(text)
    expect(second.already).toBe(true)
    expect(other.useInventory.getState().paste('cyberspace-key:junk').ok).toBe(false)
    expect(Object.keys(other.useInventory.getState().items)).toEqual([find.eventId])
  })

  it('switching identity shows that identity’s items', async () => {
    const m = await boot()
    const mine = keyFind(forge('Mine'))
    m.useInventory.getState().holdFinds([mine])
    await m.useInventory.getState().flush()
    identity = OTHER
    await m.useInventory.getState().load()
    expect(m.useInventory.getState().owner).toBe(OTHER)
    expect(Object.keys(m.useInventory.getState().items)).toEqual([])
    const theirs = keyFind(forge('Theirs'))
    m.useInventory.getState().holdFinds([theirs])
    await m.useInventory.getState().flush()
    identity = ME
    await m.useInventory.getState().load()
    expect(Object.keys(m.useInventory.getState().items)).toEqual([mine.eventId])
  })
})
