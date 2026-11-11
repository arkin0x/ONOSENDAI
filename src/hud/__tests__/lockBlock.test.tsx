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
// The KEYRING modal renders through a portal into document.body; here, the element itself.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))
vi.mock('../../lib/relay', () => ({ onAuthChange: () => () => {}, signInFailed: () => false, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { openWithSecret, sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate } from '../../lib/hidden'
import { lockOfHex } from '../../lib/locks'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useSecrets, type HeldKey } from '../../store/useSecrets'
import { useShards, type MyDeployment } from '../../store/useShards'
import { noteRoomKey, rebuildKeyringNow, resetKeyring } from '../../store/useKeyring'
import { useStash } from '../stash'
import { ChestCompose } from '../ChestCompose'
import { SecretsModal } from '../SecretsModal'
import { roomKey, roomLookupId, roomOf } from '../../lib/doors'
import { hexToBytes } from '../../lib/events'
import { keepDoorSecret } from '../../store/doorSecrets'
import { ChestBlock } from '../ItemRows'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }
const OTHER = '11'.repeat(32)
const held = (keyHex: string, lookupId: string, height = 6, source: HeldKey['source'] = 'scan'): HeldKey => ({ lookupId, keyHex, height, base: { x: '0', y: '0', z: '0' }, plane: 0, source, at: 1_790_000_000 })

/** A door of mine standing at `at`, its room of height `h`: a row as this device keeps it. */
function myDoor(at: { x: bigint; y: bigint; z: bigint }, plane: 0 | 1, h: number, sk: Uint8Array): MyDeployment {
  const lock = lockOfHex(OTHER)!.pubkey
  const sealed = sealEntries([], lock)
  const event = finalizeEvent(chestInnerTemplate({ name: 'Pump Door', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload, door: h }, at, plane, 1), sk) as NostrEvent
  return { eventId: event.id, inner: event, type: 'chest', chest: chestItemOf(event)!, bagId: 'bag', at: { x: String(at.x), y: String(at.y), z: String(at.z) }, plane, height: h, lookupId: 'lk', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }
}

const IDENTITY = useCyberspace.getState().identity

beforeEach(async () => {
  asked.length = 0
  // Back to the first identity, and what a change of identity sets off allowed to finish first.
  if (useCyberspace.getState().identity.pubkey !== IDENTITY.pubkey) { useCyberspace.setState({ identity: IDENTITY }); await settled() }
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
    expect(text(m)).toMatch(/A key you carry fits: a region .+ away, kept/)
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

describe('review of #648', () => {
  it('3: "Nobody keeps" warns for a key from a hop or HOSAKA, not for one a scan opened something with', async () => {
    useSecrets.setState({ keys: { hop: held(OTHER, 'hop', 6, 'hop') } })
    let m = await openPlaced()
    await m.press('REGION')
    await m.press('KEYRING')
    await vi.waitFor(() => expect(text(m)).toContain('Nobody keeps this region’s key unless something is hidden there.'))
    await m.unmount()
    S().cancelDeploy()
    useSecrets.setState({ keys: { found: held(OTHER, 'found', 6, 'scan') } })
    m = await openPlaced()
    await m.press('REGION')
    await m.press('KEYRING')
    await vi.waitFor(() => expect(has(m, 'Region key from your keyring')).toBe(true))
    expect(text(m)).not.toContain('Nobody keeps')
    await m.unmount()
    S().cancelDeploy()
  })

  it('6: the chain hint under ME and under a hop’s key, not THE CHEST nor a scan’s key', async () => {
    const HINT = 'On your public path: easy to guess.'
    useSecrets.setState({ keys: { hop: held(OTHER, 'hop', 6, 'hop'), found: { ...held('22'.repeat(32), 'found', 6, 'scan'), at: 1_700_000_000 } } })
    const m = await openPlaced()
    await m.press('REGION')
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0))
    expect(text(m)).not.toContain(HINT)
    await m.press(/^ME$/)
    expect(text(m)).toContain(HINT)
    await m.press('KEYRING')
    // Newest first: the hop's key.
    expect(text(m)).toContain(HINT)
    ;(byLabel(m, 'Region key from your keyring').props.onChange as (e: unknown) => void)({ target: { value: 'found' } })
    await vi.waitFor(() => expect(text(m)).not.toContain(HINT))
    await m.unmount()
    S().cancelDeploy()
  })

  it('9: after MOVE, a lock around THE CHEST is computed again where the chest now stands', async () => {
    const m = await openPlaced()
    await m.press('REGION')
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    const first = asked[0].at
    await m.press('MOVE')
    await m.unmount()
    const moved = { ...CURSOR, x: CURSOR.x + (1n << 20n) }
    useCyberspace.setState({ position: moved, anchor: moved, cursor: moved })
    S().placeChest()
    const m2 = await mount(<ChestCompose onDone={() => undefined} />)
    await vi.waitFor(() => expect(asked).toHaveLength(2))
    const p = S().pending
    expect(asked[1].at).toEqual(p?.type === 'chest' ? p.spot?.at : null)
    expect(asked[1].at).not.toEqual(first)
    await m2.unmount()
    S().cancelDeploy()
  })

  it('8: a door is never offered its own room; a chest in room R locked to R says so', async () => {
    // A door being placed, and a door of mine of the same room already there; the identity is its signer.
    const sk = generateSecretKey()
    useCyberspace.setState({ identity: { ...C().identity, pubkey: getPublicKey(sk) } })
    // The new identity's rows load first, so they do not land over the door set below.
    await settled()
    S().startPlaceDoor()
    S().setDeployHeight(4)
    S().placeChest()
    const p = S().pending
    // In the plane the placement is in: the build cursor's, which follows the identity.
    const spot = p?.type === 'chest' ? p.spot!.at : CURSOR
    const plane = p?.type === 'chest' ? p.spot!.plane : 0
    const door = myDoor(spot, plane, 4, sk)
    useShards.setState({ mine: [door] })
    noteRoomKey(C().identity.pubkey, { lookupId: 'own-room', keyHex: '33'.repeat(32), doorId: door.eventId, name: 'Pump Room' })
    let m = await mount(<ChestCompose onDone={() => undefined} />)
    expect(m.buttons('ROOM')).toHaveLength(0)
    await m.unmount()
    S().cancelDeploy()
    // A chest placed inside that room, locked to it.
    S().startPlaceChest({ name: 'Box', lock: null, requires: '', contents: [{ kind: 'message', text: 'x' }] })
    S().setDeployHeight(4)
    S().placeChest()
    useShards.setState({ deployRoomSnap: { room: roomOf(spot, plane, 4), chosen: 4, kept: { up: false, follow: false, hint: null } } })
    m = await mount(<ChestCompose onDone={() => undefined} />)
    await m.press('ROOM')
    await vi.waitFor(() => expect(text(m)).toContain('This chest stands in that room. Whoever opens the room opens it.'))
    await m.unmount()
    S().cancelDeploy()
  })

  it('8 (re-review): a door’s own room stays out even when the room key names a door not loaded here', async () => {
    const sk = generateSecretKey()
    useCyberspace.setState({ identity: { ...C().identity, pubkey: getPublicKey(sk) } })
    await settled()
    const at = { x: 1n << 30n, y: 1n << 30n, z: 1n << 30n }
    const door = myDoor(at, 0, 4, sk)
    useShards.setState({ mine: [door] })
    // This device sealed it: its secret is kept, so its room's `d` is known.
    const secret = '66'.repeat(32)
    keepDoorSecret(C().identity.pubkey, door.eventId, secret)
    await settled()
    const ownD = roomLookupId(roomKey(hexToBytes(door.keyHex), hexToBytes(secret)))
    // Its room key, as opened through a sibling door this device has not loaded; and another room's.
    noteRoomKey(C().identity.pubkey, { lookupId: ownD, keyHex: '55'.repeat(32), doorId: 'sibling-not-loaded', name: 'Own Room' })
    let m = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: door.eventId, fields: true }} />)
    expect(m.buttons('ROOM')).toHaveLength(0)
    await m.unmount()
    noteRoomKey(C().identity.pubkey, { lookupId: 'another-room', keyHex: '77'.repeat(32), doorId: 'elsewhere', name: 'Far Room' })
    m = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: door.eventId, fields: true }} />)
    await m.press('ROOM')
    const select = byLabel(m, 'Seal to a room you opened')
    expect(select.children.map((o) => textOf(o as Host))).toEqual(['Far Room'])
    await m.unmount()
  })

  it('10: EDIT opened before the keyring knew the lock shows REGION once it does', async () => {
    const sk = generateSecretKey()
    const at = { x: 1n, y: 2n, z: 3n }
    const lock = lockOfHex(H4)!.pubkey
    const msg = finalizeEvent(messageInnerTemplate('inside', at, 0, 1), sk) as NostrEvent
    const sealed = sealEntries([msg], lock)
    const event = finalizeEvent(chestInnerTemplate({ name: 'Grate', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: 'the key of a place', payload: sealed.payload }, at, 0, 1), sk) as NostrEvent
    useCyberspace.setState({ identity: { ...C().identity, pubkey: event.pubkey } })
    await settled()
    useShards.setState({ mine: [{ eventId: event.id, inner: event, type: 'chest', chest: chestItemOf(event)!, bagId: 'bag', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4, lookupId: 'lk', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false, sealed: [msg] }] })
    const m = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: event.id, fields: true }} />)
    expect(has(m, 'Seal to an item you hold or made')).toBe(true)
    useSecrets.setState({ keys: { h4: held(H4, 'h4', 4) } })
    rebuildKeyringNow()
    await vi.waitFor(() => expect(m.buttons('REGION')[0]?.props['aria-checked']).toBe(true))
    expect(has(m, 'Seal to an item you hold or made')).toBe(false)
    expect(text(m)).toContain('sealed to a region')
    await m.unmount()
  })

  it('12: the KEYRING header counts rooms, and says NO KEYS only with neither', async () => {
    const m = await mount(<SecretsModal onClose={() => undefined} />)
    expect(text(m)).toContain('NO KEYS')
    noteRoomKey(C().identity.pubkey, { lookupId: 'r1', keyHex: '44'.repeat(32), doorId: 'd1', name: 'Pump Room' })
    rebuildKeyringNow()
    await vi.waitFor(() => expect(text(m)).toContain('1 ROOM'))
    expect(text(m)).not.toContain('NO KEYS')
    expect(text(m)).toContain('Pump Room')
    await m.unmount()
  })

  it('12: the KEY ITEM paste still says it takes an npub', async () => {
    const m = await openPlaced()
    expect(String(byLabel(m, 'Seal to a pasted public key').props.placeholder)).toBe('an item public key (hex) or an npub')
    await m.unmount()
    S().cancelDeploy()
  })
})
