/**
 * itemsArchive.test.tsx: "refuse and offer archive instead to file it away
 * behind a modal. Inventory and Archived" (arkinox, 2026-11-06). Mounted and
 * pressed, each store brought up to date first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate } from '../../lib/hidden'
import { heldFromForged } from '../../lib/inventory'
import { mount, textOf } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type MyDeployment } from '../../store/useShards'
import { SecretModal } from '../SecretModal'
import { DeleteItem, InventoryPanel } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const where = { at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], published: false }

/** You, a key you placed and never picked up, and a chest of yours sealed to it. */
function setup(): { me: string; key: MyDeployment; lock: ReturnType<typeof forgeKey>; restore: () => void } {
  const was = useCyberspace.getState().identity
  const sk = generateSecretKey()
  const me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  const lock = forgeKey('Wind Key')
  const keyEv = finalizeEvent(keyInnerTemplate(lock, at, 0, 2), sk) as NostrEvent
  const key: MyDeployment = { ...where, eventId: keyEv.id, inner: keyEv, type: 'key', key: lock, bagId: 'bag-k', createdAt: 2 }
  const sealed = sealEntries([finalizeEvent(messageInnerTemplate('inside', at, 0, 1), sk) as NostrEvent], lock.itemPubkey)
  const chestEv = finalizeEvent(chestInnerTemplate({ name: 'Wind Chest', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, at, 0, 3), sk) as NostrEvent
  const chest: MyDeployment = { ...where, eventId: chestEv.id, inner: chestEv, type: 'chest', chest: chestItemOf(chestEv)!, bagId: 'bag-c', createdAt: 3 }
  useShards.setState({ mine: [key, chest], discovered: {}, deleted: {}, selectedSecret: keyEv.id, pending: null, deployStatus: 'idle' })
  useInventory.setState({ owner: me, items: {}, storage: 'memory' })
  return { me, key, lock, restore: () => useCyberspace.setState({ identity: was }) }
}

beforeEach(() => {
  useInventory.setState({ items: {} })
})

describe('DELETE refused on the card', () => {
  it('offers ARCHIVE beside its words; ARCHIVE files the key away in ITEMS with its secret, and DELETE may then go ahead', async () => {
    const { key, lock, restore } = setup()
    const m = await mount(createElement(SecretModal))
    expect(m.buttons(/^ARCHIVE$/)).toHaveLength(0)
    await m.press(/^DELETE$/)
    expect(m.says('This key opens chest “Wind Chest”. Delete or reseal that first.')).toBe(true)
    expect(m.buttons(/^ARCHIVE$/)).toHaveLength(1)
    // No confirmation was opened: the delete was refused.
    expect(m.all().some((h) => textOf(h).includes('DELETE ITEM'))).toBe(false)
    await m.press(/^ARCHIVE$/)
    const row = useInventory.getState().items[key.eventId]
    expect(row?.archived).toBeGreaterThan(0)
    expect(row?.key?.secretHex).toBe(lock.secretHex)
    expect(m.says('ARCHIVED')).toBe(true)
    expect(m.buttons(/^ARCHIVE$/)).toHaveLength(0)
    await m.unmount()
    restore()
  })
})

describe('ITEMS', () => {
  it('DELETE of the last copy of a key is refused with ARCHIVE offered; ARCHIVE files it away', async () => {
    const { me, key, lock, restore } = setup()
    // Picked up, then its world copy gone: this row is the last copy.
    useShards.setState({ mine: useShards.getState().mine.filter((d) => d.eventId !== key.eventId) })
    const row = heldFromForged(me, key.inner as NostrEvent, lock, { lookupId: 'l', bagId: 'b', at: where.at, plane: 0, height: 4 }, 1)
    useInventory.setState({ items: { [row.id]: row } })
    const m = await mount(createElement(DeleteItem, { item: row }))
    await m.press(/^DELETE$/)
    expect(m.says('This key opens chest “Wind Chest”. Delete or reseal that first.')).toBe(true)
    await m.press(/^ARCHIVE$/)
    expect(useInventory.getState().items[row.id].archived).toBeGreaterThan(0)
    await m.unmount()
    restore()
  })

  it('shows INVENTORY and ARCHIVED once something is archived; an archived row is only under ARCHIVED, and UNARCHIVE brings it back', async () => {
    const { me, key, lock, restore } = setup()
    const row = heldFromForged(me, key.inner as NostrEvent, lock, { lookupId: 'l', bagId: 'b', at: where.at, plane: 0, height: 4 }, 1)
    useInventory.setState({ items: { [row.id]: row } })
    const m = await mount(createElement(InventoryPanel))
    expect(m.buttons(/^INVENTORY$/)).toHaveLength(0)
    expect(m.says('Wind Key')).toBe(true)
    await m.press(/^ARCHIVE$/)
    expect(m.buttons(/^INVENTORY$/)).toHaveLength(1)
    expect(m.buttons(/^ARCHIVED 1$/)).toHaveLength(1)
    expect(m.says('Wind Key')).toBe(false)
    await m.press(/^ARCHIVED 1$/)
    expect(m.says('Wind Key')).toBe(true)
    await m.press(/^UNARCHIVE$/)
    expect(useInventory.getState().items[row.id].archived).toBeUndefined()
    expect(m.buttons(/^ARCHIVED/)).toHaveLength(0)
    expect(m.says('Wind Key')).toBe(true)
    await m.unmount()
    restore()
  })
})

describe('the world', () => {
  it('does not draw an archived row as held: it reads ITEMS without them', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../scene/WorldMessages.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/const held = useUnarchived\(\)/)
    expect(source).toMatch(/return useMemo\(\(\) => unarchived\(items\), \[items\]\)/)
  })
})
