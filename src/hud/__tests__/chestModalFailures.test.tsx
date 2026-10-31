/**
 * chestModalFailures.test.tsx: the chest modal and MOVE TO WORKSHOP by their real
 * buttons (review of #544). A chest this device cannot open offers no way to seal it
 * again, or it would be wiped. MOVE TO WORKSHOP re-keys what an object carries, and
 * marks it. No network.
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
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))

import { newShard } from 'sno-core/shards'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf } from '../../lib/hidden'
import { carriesSealedParts, setLocalAuthor } from '../../lib/carried'
import { mount } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type MyDeployment } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { ChestCompose } from '../ChestCompose'
import { TakenRow } from '../InventoryPanel'
import type { HeldItem } from '../../lib/inventory'

const sk = generateSecretKey()
const ME = getPublicKey(sk)
const at = { x: 1n, y: 2n, z: 3n }

beforeEach(() => {
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
  useInventory.setState({ owner: ME, items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, pending: null })
})

function chestRow(): MyDeployment {
  const sealed = sealEntries([rumorOf(messageInnerTemplate('inside', at, 0, 1), ME)], getPublicKey(generateSecretKey()))
  const inner = finalizeEvent(chestInnerTemplate({ name: 'Wind Chest', lockPubkey: getPublicKey(generateSecretKey()), senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, at, 0, 1), sk) as NostrEvent
  return { eventId: inner.id, inner, type: 'chest', chest: chestItemOf(inner)!, bagId: 'bag', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }
}

describe('ADD and EDIT on a chest this device cannot open', () => {
  it('say why, offer nothing to add, and SAVE stays off', async () => {
    const d = chestRow()
    useShards.setState({ mine: [d] })
    const m = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: d.eventId, fields: false }} />)
    await vi.waitFor(() => expect(m.says('needs the key')).toBe(true))
    expect(m.buttons('+ MESSAGE')).toEqual([])
    expect(m.buttons(/^SAVE$/)[0].props.disabled).toBe(true)
    await m.unmount()
  })
})

describe('MOVE TO WORKSHOP', () => {
  it('keys what it carries under you, so your copy keeps it, and marks it', async () => {
    setLocalAuthor(() => ME)
    const hider = 'a'.repeat(64)
    const piece = `33331:${hider}:piece`
    const shard = { ...newShard('Statue'), author: hider, refs: [['a', piece]] as never, parts: [{ ref: 0, at: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 }], objects: { [piece]: { v: 2 } } }
    useWorkshop.setState({ shards: [] })
    const item = { id: 'i'.repeat(64), type: 'shard', name: 'Statue', shard, at: 1 } as unknown as HeldItem
    const row = await mount(<TakenRow item={item} />)
    await row.press('MOVE TO WORKSHOP')
    const copy = useWorkshop.getState().shards[0]
    expect(Object.keys(copy.objects!)[0].startsWith(`33331:${ME}:`)).toBe(true)
    expect(carriesSealedParts(copy)).toBe(true)
    setLocalAuthor(null)
    await row.unmount()
  })
})
