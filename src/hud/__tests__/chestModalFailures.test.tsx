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

// The card's one shared canvas lives outside the card (scene/CardSpin): here, what it is asked to draw.
vi.mock('../../scene/CardSpin', () => ({ CardSpin: ({ shard, wide }: { shard: { name: string } | null; wide?: boolean }) => <div aria-label={`${shard?.name}, turning`} style={{ width: wide ? '100%' : 160 }} /> }))
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
// The modal's Shell is a portal; the test's tree holds it where it stands.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))

import { newShard } from 'sno-core/shards'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf } from '../../lib/hidden'
import { carriesSealedParts, setLocalAuthor } from '../../lib/carried'
import { mount } from '../../test/elementRoot'
import { StashModals } from '../StashModals'
import { useStash } from '../stash'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type MyDeployment } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { ChestCompose } from '../ChestCompose'
import { TakenRow } from '../InventoryPanel'
import { topEscape } from '../../hooks/useEscape'
import type { HeldItem } from '../../lib/inventory'

const sk = generateSecretKey()
const ME = getPublicKey(sk)
const at = { x: 1n, y: 2n, z: 3n }
const REAL = { chestEntries: useShards.getState().chestEntries, resealChest: useShards.getState().resealChest }

beforeEach(() => {
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
  useInventory.setState({ owner: ME, items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, pending: null, ...REAL })
  useStash.getState().close()
  useStash.setState({ chestSaving: false })
})

function chestRow(): MyDeployment {
  const sealed = sealEntries([rumorOf(messageInnerTemplate('inside', at, 0, 1), ME)], getPublicKey(generateSecretKey()))
  const inner = finalizeEvent(chestInnerTemplate({ name: 'Wind Chest', lockPubkey: getPublicKey(generateSecretKey()), senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, at, 0, 1), sk) as NostrEvent
  return { eventId: inner.id, inner, type: 'chest', chest: chestItemOf(inner)!, bagId: 'bag', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }
}

describe('while a chest of yours opens, and while it saves', () => {
  const held = (_d: MyDeployment): never => rumorOf(messageInnerTemplate('inside', at, 0, 1), ME) as never

  it('what is added during OPENING survives it, behind what was sealed', async () => {
    const d = chestRow()
    useShards.setState({ mine: [d] })
    let open: (r: unknown[]) => void = () => undefined
    useShards.setState({ chestEntries: (() => new Promise((r) => { open = r })) as never })
    const m = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: d.eventId, fields: false }} />)
    expect(m.says('OPENING')).toBe(true)
    await m.press('+ MESSAGE')
    const box = m.all().find((h) => h.type === 'textarea')!
    ;(box.props.onChange as (e: unknown) => void)({ target: { value: 'typed while it opened' } })
    await vi.waitFor(() => expect(m.buttons(/^ADD/).some((b) => !b.props.disabled)).toBe(true))
    await m.press(/^ADD/)
    expect(m.says('typed while it opened')).toBe(true)
    open([held(d)])
    await vi.waitFor(() => expect(m.says('OPENING')).toBe(false))
    expect(m.says('typed while it opened')).toBe(true)
    expect(m.says('inside')).toBe(true)
    await m.unmount()
  })

  it('the modal cannot be closed during SAVE, so what it answers is read', async () => {
    const d = chestRow()
    useShards.setState({ mine: [d] })
    useShards.setState({ chestEntries: (async () => [held(d)]) as never })
    let answer: (why: string | null) => void = () => undefined
    useShards.setState({ resealChest: (() => new Promise((r) => { answer = r })) as never })
    useStash.getState().openChestEdit(d.eventId, false)
    const m = await mount(<StashModals />)
    await vi.waitFor(() => expect(m.says('OPENING')).toBe(false))
    await m.press(/^SAVE$/)
    expect(useStash.getState().chestSaving).toBe(true)
    const shut = m.all().find((h) => h.type === 'button' && h.props['aria-label'] === 'Close')!
    ;(shut.props.onClick as () => void)()
    expect(useStash.getState().chestEdit).not.toBeNull()
    answer('No relay took the new bag. The chest stays as it was.')
    await vi.waitFor(() => expect(m.says('No relay took the new bag')).toBe(true))
    expect(useStash.getState().chestSaving).toBe(false)
    const again = m.all().find((h) => h.type === 'button' && h.props['aria-label'] === 'Close')!
    ;(again.props.onClick as () => void)()
    expect(useStash.getState().chestEdit).toBeNull()
    await m.unmount()
  })
})

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
    await row.press(/^ACTIONS$/)
    await row.press('MOVE TO WORKSHOP')
    // MOVED INTO WORKSHOP leaves no hidden ACTIONS for Escape to close.
    expect(topEscape()).toBeNull()
    const copy = useWorkshop.getState().shards[0]
    expect(Object.keys(copy.objects!)[0].startsWith(`33331:${ME}:`)).toBe(true)
    expect(carriesSealedParts(copy)).toBe(true)
    setLocalAuthor(null)
    await row.unmount()
  })
})
