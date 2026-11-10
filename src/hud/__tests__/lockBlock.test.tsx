/**
 * lockBlock.test.tsx: the LOCK block in the chest and door modals, and OPEN
 * on a chest locked to a region (DECK-0004 §3.8, draft; arkinox 2026-11-10:
 * CHEST and DOOR share one LOCK block, THIS PLACE implied, then KEY ITEM,
 * PERSON, REGION, or ROOM when a room key is known).
 *
 * Driven by the composer's real buttons and the store's real seal. The
 * region worker is a stand-in that answers the spec's h4 region key; relays
 * are mocked, nothing goes out.
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

// The harness renders with no DOM: the bits the stores reach for.
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

const H4 = '78d749966d5bd372baccaa7f72cc844af5ffed9ad4f4415bc95330f63aefe37a'
const asked = vi.hoisted(() => [] as Array<{ at: { x: bigint; y: bigint; z: bigint }; height: number }>)
vi.mock('../../lib/regionKeyOffThread', async () => {
  const { hexToBytes } = await import('../../lib/events')
  return {
    regionKeyOffThread: vi.fn(async (at: { x: bigint; y: bigint; z: bigint }, height: number) => {
      asked.push({ at, height })
      return { key: hexToBytes('78d749966d5bd372baccaa7f72cc844af5ffed9ad4f4415bc95330f63aefe37a'), lookupId: '4108bb43f7e359d1cd2a9fbe62688e45a9fbcfe4a1848046245695850728540a' }
    }),
  }
})
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => ({ onAuthChange: () => () => {}, signInFailed: () => false, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { openWithSecret, sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate } from '../../lib/hidden'
import { lockOfHex } from '../../lib/locks'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useSecrets, type HeldKey } from '../../store/useSecrets'
import { useShards, type MyDeployment } from '../../store/useShards'
import { noteRoomKey, rebuildKeyringNow, resetKeyring } from '../../store/useKeyring'
import { useStash } from '../stash'
import { ChestCompose } from '../ChestCompose'
import { ChestBlock } from '../ItemRows'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }
const OTHER = '11'.repeat(32)
const held = (keyHex: string, lookupId: string, height = 6): HeldKey => ({ lookupId, keyHex, height, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'scan', at: 1_790_000_000 })

beforeEach(() => {
  asked.length = 0
  resetKeyring()
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null })
  useSecrets.setState({ keys: {}, current: {} })
  useBuilder.getState().exit()
  useStash.getState().close()
  useStash.setState({ chestSaving: false })
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

async function openPlaced(door = false): Promise<Mounted> {
  if (door) S().startPlaceDoor()
  else S().startPlaceChest({ name: 'Grate', lock: null, requires: '', contents: [{ kind: 'message', text: 'behind it' }] })
  S().setDeployHeight(4)
  S().placeChest()
  return mount(<ChestCompose onDone={() => undefined} />)
}

const byLabel = (m: Mounted, label: string): Host => {
  const h = m.all().find((x) => x.props['aria-label'] === label)
  if (!h) throw new Error(`nothing labelled ${label}`)
  return h
}
const has = (m: Mounted, label: string): boolean => m.all().some((x) => x.props['aria-label'] === label)
const requiresText = (m: Mounted): string => String(byLabel(m, 'Requires').props.value)
const text = (m: Mounted): string => m.all().map((h) => textOf(h)).join(' ')
const chestRow = (): MyDeployment | undefined => S().mine.find((d) => d.type === 'chest')
async function sealIt(m: Mounted): Promise<MyDeployment> {
  await vi.waitFor(() => expect(m.buttons('SEAL (LOCAL)')[0]?.props.disabled).toBe(false))
  await m.press('SEAL (LOCAL)')
  await vi.waitFor(() => expect(chestRow()).toBeDefined(), { timeout: 10_000 })
  expect(S().deployError).toBeNull()
  return chestRow()!
}

describe('the LOCK block', () => {
  it('is titled, says THIS PLACE always, and offers KEY ITEM, PERSON and REGION; ROOM only with a room key', async () => {
    const m = await openPlaced()
    const t = text(m)
    expect(t).toContain('LOCK · WHAT OPENS IT')
    expect(t).toContain('THIS PLACE · always')
    for (const b of ['KEY ITEM', 'PERSON', 'REGION']) expect(m.buttons(b)).toHaveLength(1)
    expect(m.buttons('ROOM')).toHaveLength(0)
    // KEY ITEM is where it starts, as today.
    expect(has(m, 'Seal to an item you hold or made')).toBe(true)
    await m.unmount()
    S().cancelDeploy()
  })

  it('the door modal has the same block', async () => {
    const m = await openPlaced(true)
    expect(text(m)).toContain('LOCK · WHAT OPENS IT')
    for (const b of ['KEY ITEM', 'PERSON', 'REGION']) expect(m.buttons(b)).toHaveLength(1)
    await m.press('REGION')
    expect(m.buttons('THE DOOR')).toHaveLength(1)
    await m.unmount()
    S().cancelDeploy()
  })

  it('PERSON takes an npub and seals to that person', async () => {
    const m = await openPlaced()
    await m.press('PERSON')
    const them = getPublicKey(generateSecretKey())
    const { nip19 } = await import('nostr-tools')
    ;(byLabel(m, 'Seal to a person').props.onChange as (e: unknown) => void)({ target: { value: nip19.npubEncode(them) } })
    await vi.waitFor(() => expect(requiresText(m)).toBe('being the one it was sealed for'))
    const d = await sealIt(m)
    expect(d.chest?.lockPubkey).toBe(them)
    await m.unmount()
  })
})

describe('REGION', () => {
  it('defaults to the region around the chest at its height, writes "the key of a place", warns, and seals to the region’s lock', async () => {
    const m = await openPlaced()
    await m.press('REGION')
    for (const b of ['THE CHEST', /^ME$/, 'KEYRING']) expect(m.buttons(b)).toHaveLength(1)
    expect(m.buttons('KEYRING')[0].props.disabled).toBe(true)
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0].height).toBe(4)
    const p = S().pending
    expect(asked[0].at).toEqual(p?.type === 'chest' ? p.spot?.at : null)
    expect(requiresText(m)).toBe('the key of a place')
    await vi.waitFor(() => expect(text(m)).toContain('This region holds the chest. Whoever finds it can open it.'))
    expect(text(m)).toContain('Same key in dataspace and ideaspace.')
    const d = await sealIt(m)
    const lock = lockOfHex(H4)!
    expect(d.chest?.lockPubkey).toBe(lock.pubkey)
    expect(d.chest?.requires).toBe('the key of a place')
    // Whoever carries the region key opens it.
    expect(openWithSecret(chestItemOf(d.inner)!, lock.secretHex)).toHaveLength(1)
    await m.unmount()
  })

  it('ME computes the region where you stand, and the height steps', async () => {
    const m = await openPlaced()
    await m.press('REGION')
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    await m.press(/^ME$/)
    await vi.waitFor(() => expect(asked).toHaveLength(2))
    expect(asked[1].at).toEqual(CURSOR)
    ;(byLabel(m, 'Larger region').props.onClick as () => void)()
    await vi.waitFor(() => expect(asked).toHaveLength(3))
    expect(asked[2].height).toBe(5)
    await m.unmount()
    S().cancelDeploy()
  })

  it('KEYRING seals to a region key you hold, with no warning', async () => {
    useSecrets.setState({ keys: { held1: held(OTHER, 'held1') } })
    const m = await openPlaced()
    await m.press('REGION')
    await m.press('KEYRING')
    expect(has(m, 'Region key from your keyring')).toBe(true)
    const d = await sealIt(m)
    expect(d.chest?.lockPubkey).toBe(lockOfHex(OTHER)!.pubkey)
    expect(text(m)).not.toContain('Nobody keeps')
    await m.unmount()
  })
})

describe('ROOM', () => {
  it('appears once a room key is known, and seals to the room’s lock', async () => {
    const roomKeyHex = 'f2f2c2c83702a57d35a7cd01a6ff158818442c08336d82225bfaa57d89676491'
    noteRoomKey(C().identity.pubkey, { lookupId: 'e9b3051490a55438b728e340ae5b02de39d5454b718388349efd9406eb1fcf3f', keyHex: roomKeyHex, doorId: 'door1', name: 'Pump Room' })
    const m = await openPlaced()
    await m.press('ROOM')
    await vi.waitFor(() => expect(requiresText(m)).toBe('the key of a room'))
    const d = await sealIt(m)
    expect(d.chest?.lockPubkey).toBe('24bd8076a3714248ee856dd201625a29f065b1d52a71d789ce5ae9f512a10a22')
    await m.unmount()
  })
})

describe('OPEN on a chest locked to a region', () => {
  function regionChest(): { event: NostrEvent; id: string } {
    const sk = generateSecretKey()
    const at = { x: 1n, y: 2n, z: 3n }
    const sealed = sealEntries([finalizeEvent(messageInnerTemplate('inside', at, 0, 1), sk) as NostrEvent], lockOfHex(H4)!.pubkey)
    const event = finalizeEvent(chestInnerTemplate({ name: 'Grate', lockPubkey: lockOfHex(H4)!.pubkey, senderPubkey: sealed.senderPubkey, requires: 'the key of a place', payload: sealed.payload }, at, 0, 1), sk) as NostrEvent
    return { event, id: event.id }
  }

  it('offers OPEN, with the key that fits, to whoever carries the region key', async () => {
    useSecrets.setState({ keys: { h4: held(H4, '4108bb43f7e359d1cd2a9fbe62688e45a9fbcfe4a1848046245695850728540a', 4) } })
    rebuildKeyringNow()
    const { event, id } = regionChest()
    const m = await mount(<ChestBlock id={id} chest={chestItemOf(event)!} author={event.pubkey} verified place={null} />)
    expect(m.buttons('OPEN')).toHaveLength(1)
    expect(text(m)).toContain('A key you carry fits: a region, height 4')
    await m.press('OPEN')
    await vi.waitFor(() => expect(text(m)).toContain('inside'))
    await m.unmount()
  })

  it('a region key you are standing in fits too', async () => {
    useSecrets.setState({ current: { here: { keyHex: H4, height: 4 } } })
    rebuildKeyringNow()
    const { event, id } = regionChest()
    const m = await mount(<ChestBlock id={id} chest={chestItemOf(event)!} author={event.pubkey} verified place={null} />)
    expect(m.buttons('OPEN')).toHaveLength(1)
    expect(text(m)).toContain('the region you stand in')
    await m.unmount()
  })

  it('another region’s key offers nothing: REQUIRES, no OPEN', async () => {
    useSecrets.setState({ keys: { o: held(OTHER, 'o') } })
    rebuildKeyringNow()
    const { event, id } = regionChest()
    const m = await mount(<ChestBlock id={id} chest={chestItemOf(event)!} author={event.pubkey} verified place={null} />)
    expect(m.buttons('OPEN')).toHaveLength(0)
    expect(text(m)).toContain('REQUIRES: the key of a place')
    expect(text(m)).not.toContain('A key you carry fits')
    await m.unmount()
  })
})
