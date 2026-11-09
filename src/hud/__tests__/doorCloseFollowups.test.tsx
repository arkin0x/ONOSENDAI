/**
 * doorCloseFollowups.test.tsx: the owner's rulings of 2026-11-09 on CLOSE, by the
 * real card buttons. (1) CLOSE plays a soft lock tick with the door's buzz, through
 * the gate every opening shares; OPEN on a closed door stays silent. (2) The found
 * chip leaves out finds standing in a room you closed, and counts them again when
 * it opens, with no find ceremony replayed. (3) NEARBY says CLOSED for a door you
 * closed (it opens with no key), LOCKED for one never opened. The relay is a mock
 * that answers by `d`. No network.
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

const relay = vi.hoisted(() => ({ asked: 0, events: [] as Array<{ pubkey: string; tags: string[][] }> }))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
const sounds = vi.hoisted(() => ({ close: 0, open: 0 }))
vi.mock('../../lib/ceremonySound', async (orig) => ({
  ...(await orig<typeof import('../../lib/ceremonySound')>()),
  closeFeedback: () => { sounds.close++; return { sound: true, buzz: true } },
  ceremonyFeedback: () => { sounds.open++; return { sound: true, buzz: true } },
}))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  publishLight: vi.fn(async () => true),
  query: vi.fn(async (f: { authors?: string[]; '#d'?: string[] }) => {
    relay.asked++
    return relay.events.filter((e) => (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  }),
  queryAny: vi.fn(async () => []),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf, type BagEntry, type Hidden } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, newDoorSecret, roomEntries, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { publish, publishLight, publishMany } from '../../lib/relay'
import { mount, settled, textOf } from '../../test/elementRoot'
import { doorSecret, resetDoorSecrets, resetReopens } from '../../store/rooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { lockWord, resetOpenedChests } from '../../store/useOpenedChests'
import { resetClosedDoors } from '../../store/closedDoors'
import { useShards } from '../../store/useShards'
import { setDrawnLooks, useOpenCeremony } from '../../store/useOpenCeremony'
import { SecretModal } from '../SecretModal'
import { KeyFoundChip } from '../KeyFoundChip'
import { Row } from '../NearbyLootModal'
import { chipCount, useCeremony } from '../../store/useCeremony'
import type { NearbyItem } from '../../hooks/useNearbyLoot'
import { renderToStaticMarkup } from 'react-dom/server'

const hider = generateSecretKey()
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

/** A door sealed to `lock` at AT, of height `h`, its room bag holding `inside`; `room` when it stands in another door's room. */
async function sealedDoor(name: string, lock: ReturnType<typeof forgeKey>, h: number, inside: (signer: string) => BagEntry[], secret = newDoorSecret()): Promise<{ event: NostrEvent; room: NostrEvent; secret: string }> {
  const sealed = sealEntries(roomEntries(secret) as BagEntry[], lock.itemPubkey)
  const t = chestInnerTemplate({ name, lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, AT, 1, T)
  t.tags.splice(t.tags.length - 1, 0, ['door', String(h)])
  const event = finalizeEvent(t, hider) as NostrEvent
  const key = roomKey((await regionKeyOffThread(AT, h, 20)).key, hexToBytes(secret))
  const room = finalizeEvent(await bagTemplate(inside(event.pubkey), key, roomLookupId(key), h, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), hider) as NostrEvent
  return { event, room, secret }
}

/**
 * An outer door of height 3, whose room holds a note and an inner door of height
 * 2, whose own room holds a note. One Silver Key opens both, and is held.
 */
async function nested(): Promise<{ lock: ReturnType<typeof forgeKey>; outer: Hidden; innerId: string }> {
  const lock = forgeKey('Silver Key')
  const held = finalizeEvent({ kind: 3340, created_at: T, content: '', tags: [] }, hider) as NostrEvent
  useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: 1, height: 3 })
  const inner = await sealedDoor('Inner Door', lock, 2, (signer) => [rumorOf(messageInnerTemplate('deep inside', AT, 1, T), signer)])
  const outer = await sealedDoor('Outer Door', lock, 3, (signer) => [rumorOf(messageInnerTemplate('in the outer room', AT, 1, T), signer), inner.event])
  relay.events = [outer.room, inner.room]
  const bagKey = (await regionKeyOffThread(AT, 3, 20)).key
  const found: Hidden = { eventId: outer.event.id, inner: outer.event, keyHex: bytesToHex(bagKey), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: outer.event.pubkey, at: AT, plane: 1, height: 3, createdAt: T, type: 'chest', chest: chestItemOf(outer.event)! }
  return { lock, outer: found, innerId: inner.event.id }
}

const S = () => useShards.getState()
const roomTexts = (): string[] => Object.values(S().discovered).filter((h) => h.room).map((h) => h.text ?? h.chest?.name ?? '').sort()

/** Open a door's card and press a button on it. */
async function press(id: string, words: RegExp): Promise<void> {
  useShards.setState({ selectedSecret: id })
  const card = await mount(<SecretModal />)
  await card.press(words)
  await settled()
  await card.unmount()
}


/** Both doors opened by hand, the inner after the outer, each room in. */
async function openBoth(): Promise<{ lock: ReturnType<typeof forgeKey>; outer: Hidden; innerId: string }> {
  const n = await nested()
  useShards.setState({ discovered: { [n.outer.eventId]: n.outer } })
  await press(n.outer.eventId, /^OPEN$/)
  await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
  await press(n.innerId, /^OPEN$/)
  await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'deep inside', 'in the outer room']))
  return n
}

beforeEach(() => {
  relay.asked = 0
  relay.events = []
  for (const k of ['onosendai:door-secrets', 'onosendai:door-secrets-only-said', 'onosendai:chests-opened', 'onosendai:doors-closed']) localStorage.removeItem(k)
  resetDoorSecrets()
  resetOpenedChests()
  resetClosedDoors()
  resetReopens()
  vi.mocked(publish).mockClear()
  vi.mocked(publishMany).mockClear()
  vi.mocked(publishLight).mockClear()
  useOpenCeremony.setState({ playing: {} })
  setDrawnLooks([])
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null })
  useCeremony.setState({ chip: null, births: {} })
  sounds.close = 0
  sounds.open = 0
})

/** What the found chip shows now, or null when it is not drawn. */
async function chipSays(): Promise<string | null> {
  const w = window as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }
  w.requestAnimationFrame = () => 0
  w.cancelAnimationFrame = () => undefined
  const chip = await mount(<KeyFoundChip />)
  const words = chip.all().length === 0 ? null : chip.all().filter((h) => h.props.className === 'hyperbar__label').map(textOf).join('')
  await chip.unmount()
  return words
}

/** A door as NEARBY lists it, by its real event. */
const nearbyRow = (d: Hidden): string => {
  const item = { key: d.eventId, type: 'chest', chest: d.chest, event: d.inner, at: d.at, plane: d.plane, height: d.height, mine: false, author: d.author, createdAt: T, distance: 0n, lookupId: d.lookupId, bagId: d.bagId } as unknown as NearbyItem
  return renderToStaticMarkup(<ul><Row item={item} me={me()} onView={() => undefined} /></ul>)
}

describe('(1) CLOSE sounds a soft lock tick; OPEN again is silent', () => {
  it('CLOSE offers the close tick and buzz once per press; the re-open offers neither, nor the opening sound', async () => {
    const n = await openBoth()
    // The two first OPENs each offered the opening sound (its gate is lib/ceremonySound's).
    expect(sounds.open).toBe(2)
    expect(sounds.close).toBe(0)
    await press(n.outer.eventId, /^CLOSE$/)
    expect(sounds.close).toBe(1)
    // OPEN on the closed door: silent.
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    expect(sounds.close).toBe(1)
    expect(sounds.open).toBe(2)
    // CLOSE again: offered again (the 10 s gate itself is lib/ceremonySound's).
    await press(n.outer.eventId, /^CLOSE$/)
    expect(sounds.close).toBe(2)
  })

  it('offered even when the door is not drawn in the scene', async () => {
    const n = await openBoth()
    setDrawnLooks([])
    await press(n.outer.eventId, /^CLOSE$/)
    expect(sounds.close).toBe(1)
  })
})

describe('(2) the found chip leaves out finds in a room you closed', () => {
  it('the room’s finds leave the count on CLOSE, and come back on OPEN with no ceremony replayed', async () => {
    const n = await openBoth()
    // Each first OPEN marked its room: 2, then 1 more.
    expect(chipCount(useCeremony.getState().chip)).toBe(3)
    expect(await chipSays()).toBe('3 FOUND HERE')
    const { births, chip: before } = useCeremony.getState()
    await press(n.outer.eventId, /^CLOSE$/)
    // Every find counted stood in the closed rooms: the chip waits unseen.
    expect(chipCount(useCeremony.getState().chip)).toBe(0)
    expect(await chipSays()).toBeNull()
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    // The outer room is back; the inner door's room stays closed, so its note stays out.
    expect(chipCount(useCeremony.getState().chip)).toBe(2)
    expect(await chipSays()).toBe('2 FOUND HERE')
    await press(n.innerId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toContain('deep inside'))
    expect(chipCount(useCeremony.getState().chip)).toBe(3)
    // Nothing was marked again: the same births, the chip's line not decoding anew.
    const after = useCeremony.getState()
    expect(after.births).toEqual(births)
    expect(after.chip?.at).toBe(before?.at)
    expect(after.chip?.label).toBe(before?.label)
    expect(after.chip?.count).toBe(before?.count)
  })

  it('a find outside the room keeps its count through the close', async () => {
    const n = await openBoth()
    const outside: Hidden = { eventId: '9'.repeat(64), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: 'a'.repeat(64), at: AT, plane: 1, height: 3, createdAt: T, type: 'message', text: 'by the road' }
    useShards.getState().addDiscovered([outside])
    useCeremony.getState().mark([outside])
    expect(chipCount(useCeremony.getState().chip)).toBe(4)
    await press(n.outer.eventId, /^CLOSE$/)
    expect(chipCount(useCeremony.getState().chip)).toBe(1)
    expect(await chipSays()).toBe('1 FOUND HERE')
  })

  it('a tap clears it all: a room opened after the tap brings nothing back', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    useCeremony.getState().dismiss()
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    expect(useCeremony.getState().chip).toBeNull()
  })

  it('leave() counts out only what the chip counted', () => {
    const a: Hidden = { eventId: '7'.repeat(64), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: 'a'.repeat(64), at: AT, plane: 1, height: 3, createdAt: T, type: 'message', text: 'one' }
    useShards.getState().addDiscovered([a])
    useCeremony.getState().mark([a])
    useCeremony.getState().leave(['8'.repeat(64)])
    expect(useCeremony.getState().chip?.away).toEqual([])
    expect(chipCount(useCeremony.getState().chip)).toBe(1)
  })
})

describe('(3) NEARBY says CLOSED for a door you closed, LOCKED for one never opened', () => {
  it('LOCKED, then OPEN, then CLOSED after CLOSE, then OPEN again', async () => {
    const n = await nested()
    useShards.setState({ discovered: { [n.outer.eventId]: n.outer } })
    const lock = n.outer.chest!.lockPubkey
    expect(lockWord(me(), n.outer.eventId, lock)).toBe('LOCKED')
    expect(nearbyRow(n.outer)).toContain('nearby__lock--locked">LOCKED<')
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts().length).toBe(2))
    expect(nearbyRow(n.outer)).toContain('nearby__lock--open">OPEN<')
    await press(n.outer.eventId, /^CLOSE$/)
    expect(lockWord(me(), n.outer.eventId, lock)).toBe('CLOSED')
    expect(nearbyRow(n.outer)).toContain('nearby__lock--closed">CLOSED<')
    expect(nearbyRow(n.outer)).not.toContain('LOCKED')
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts().length).toBe(2))
    expect(lockWord(me(), n.outer.eventId, lock)).toBe('OPEN')
  })

  it('the doors inside a closed room, closed with it and opening with no key, read CLOSED too', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    const inner = S().discovered[n.innerId]
    expect(lockWord(me(), n.innerId, inner.chest!.lockPubkey)).toBe('CLOSED')
    expect(nearbyRow(inner)).toContain('nearby__lock--closed">CLOSED<')
  })

  it('a closed door whose secret is gone needs its key again: LOCKED', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    // The kept secret lost (a cleared store): only the key opens it now.
    resetDoorSecrets()
    for (const k of ['onosendai:door-secrets', 'onosendai:door-secrets-only-said']) localStorage.removeItem(k)
    expect(doorSecret(me(), n.outer.eventId)).toBeNull()
    expect(lockWord(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe('LOCKED')
  })
})
