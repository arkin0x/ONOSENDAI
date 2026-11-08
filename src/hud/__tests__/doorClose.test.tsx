/**
 * doorClose.test.tsx: CLOSE on an opened door, by its real button (arkinox,
 * 2026-11-01). The door closes and its room dissolves; every door inside the
 * room closes with it, all the way down (DECK-0004 §3.7.6); OPEN opens it again
 * with no key, from the secret kept here, and the doors inside stay closed until
 * their own OPEN. Closing is local: nothing is published and no relay is asked.
 * Closed stays closed, per identity, across a reload: no scan opens it again
 * (arkinox, 2026-10-26). The relay is a mock that answers by `d`. No network.
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
import { mount, settled } from '../../test/elementRoot'
import { doorSecret, reopenRoom, resetDoorSecrets, resetReopens } from '../../store/rooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { closedByMe, openedByHand, resetOpenedChests } from '../../store/useOpenedChests'
import { useShards } from '../../store/useShards'
import { setDrawnLooks, useOpenCeremony } from '../../store/useOpenCeremony'
import { doorWallKey, wallItems } from '../../store/walkWalls'
import { SecretModal } from '../SecretModal'

const hider = generateSecretKey()
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

/** A door sealed to `lock` at AT, of height `h`, its room bag holding `inside`; `room` when it stands in another door's room. */
async function sealedDoor(name: string, lock: ReturnType<typeof forgeKey>, h: number, inside: (signer: string) => BagEntry[]): Promise<{ event: NostrEvent; room: NostrEvent; secret: string }> {
  const secret = newDoorSecret()
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
const worldTexts = (): string[] => S().worldItems().map((w) => w.text ?? w.chest?.name ?? '').sort()
const published = (): number => vi.mocked(publish).mock.calls.length + vi.mocked(publishMany).mock.calls.length + vi.mocked(publishLight).mock.calls.length

/** Open a door's card and press a button on it. */
async function press(id: string, words: RegExp): Promise<void> {
  useShards.setState({ selectedSecret: id })
  const card = await mount(<SecretModal />)
  await card.press(words)
  await settled()
  await card.unmount()
}

async function buttonsOn(id: string): Promise<string[]> {
  useShards.setState({ selectedSecret: id })
  const card = await mount(<SecretModal />)
  const out = ['OPEN', 'CLOSE'].filter((w) => card.buttons(new RegExp(`^${w}$`)).length > 0)
  await card.unmount()
  return out
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
  resetReopens()
  vi.mocked(publish).mockClear()
  vi.mocked(publishMany).mockClear()
  vi.mocked(publishLight).mockClear()
  useOpenCeremony.setState({ playing: {} })
  setDrawnLooks([])
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null })
})

describe('CLOSE on an opened door', () => {
  it('an open door offers CLOSE, not OPEN; a door never opened offers OPEN, not CLOSE', async () => {
    const n = await nested()
    useShards.setState({ discovered: { [n.outer.eventId]: n.outer } })
    expect(await buttonsOn(n.outer.eventId)).toEqual(['OPEN'])
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts().length).toBe(2))
    expect(await buttonsOn(n.outer.eventId)).toEqual(['CLOSE'])
  })

  it('shuts the door and dissolves its room, at once, with nothing published and no relay asked', async () => {
    const n = await nested()
    useShards.setState({ discovered: { [n.outer.eventId]: n.outer } })
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    expect(wallItems(1).map((w) => w.key)).not.toContain(doorWallKey(n.outer.eventId))
    const asked = relay.asked
    // Drawn in the scene: the card yields so the door is seen closing.
    setDrawnLooks([n.outer.eventId])
    await press(n.outer.eventId, /^CLOSE$/)
    expect(openedByHand(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(false)
    expect(closedByMe(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(true)
    expect(roomTexts()).toEqual([])
    expect(worldTexts()).toEqual(['Outer Door'])
    // A wall again, as its closed look.
    expect(wallItems(1).map((w) => w.key)).toContain(doorWallKey(n.outer.eventId))
    // The card went, and the door plays its close.
    expect(S().selectedSecret).toBeNull()
    expect(Object.values(useOpenCeremony.getState().playing).some((p) => p.closing)).toBe(true)
    // Its secret is kept: OPEN needs no key.
    expect(doorSecret(me(), n.outer.eventId)).not.toBeNull()
    expect(published()).toBe(0)
    expect(relay.asked).toBe(asked)
    expect(await buttonsOn(n.outer.eventId)).toEqual(['OPEN'])
  })

  it('closes every door inside its room with it, and their rooms dissolve too (§3.7.6)', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    expect(closedByMe(me(), n.innerId)).toBe(true)
    expect(roomTexts()).toEqual([])
    expect(worldTexts()).toEqual(['Outer Door'])
    expect(published()).toBe(0)
  })

  it('OPEN again needs no key and no signer: the room comes back, and a door inside stays closed until its own OPEN', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    // The key is gone from ITEMS, and no signer may be asked.
    useInventory.setState({ items: {} })
    const signer = vi.fn(async () => { throw new Error('no signer here') })
    useCyberspace.setState({ decryptSealed: signer as never })
    expect(await buttonsOn(n.outer.eventId)).toEqual(['OPEN'])
    setDrawnLooks([n.outer.eventId])
    await press(n.outer.eventId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['Inner Door', 'in the outer room']))
    expect(signer).not.toHaveBeenCalled()
    expect(openedByHand(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(true)
    // The short reveal: the calm crossfade, not the first OPEN's slab decoding away.
    const playing = Object.values(useOpenCeremony.getState().playing)
    expect(playing).toEqual([expect.objectContaining({ kind: 'door', calm: true })])
    expect(playing[0].closing).toBeUndefined()
    // The inner door is back, closed, its room not opened by anything but its own OPEN.
    await settled()
    expect(closedByMe(me(), n.innerId)).toBe(true)
    expect(roomTexts()).not.toContain('deep inside')
    expect(await buttonsOn(n.innerId)).toEqual(['OPEN'])
    await press(n.innerId, /^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toContain('deep inside'))
    expect(signer).not.toHaveBeenCalled()
    expect(published()).toBe(0)
  })
})

describe('closed stays closed (arkinox, 2026-10-26: nothing opens by itself)', () => {
  it('across a reload, per identity: the scan finds the door and opens nothing, and no room is asked for', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    // A reload: what is in memory goes; what is kept comes back from storage.
    resetOpenedChests()
    resetDoorSecrets()
    resetReopens()
    useShards.setState({ discovered: {} })
    const asked = relay.asked
    S().addDiscovered([n.outer])
    await settled()
    await new Promise((r) => setTimeout(r, 20))
    expect(relay.asked).toBe(asked)
    expect(roomTexts()).toEqual([])
    expect(closedByMe(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(true)
    expect(openedByHand(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(false)
    expect(doorSecret(me(), n.outer.eventId)).not.toBeNull()
    expect(await buttonsOn(n.outer.eventId)).toEqual(['OPEN'])
    // Kept under this identity, and no other.
    const kept = JSON.parse(localStorage.getItem('onosendai:doors-closed')!) as Record<string, string[]>
    expect(Object.keys(kept)).toEqual([me()])
    expect(kept[me()]).toContain(`${n.outer.eventId}:${n.outer.chest!.lockPubkey}`)
    expect(closedByMe('9'.repeat(64), n.outer.eventId)).toBe(false)
  })

  it('a reopening asked for directly opens nothing either', async () => {
    const n = await openBoth()
    await press(n.outer.eventId, /^CLOSE$/)
    resetReopens()
    const asked = relay.asked
    await reopenRoom(n.outer)
    expect(relay.asked).toBe(asked)
    expect(roomTexts()).toEqual([])
    expect(openedByHand(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(false)
  })

  it('a room still on its way when CLOSE is pressed stays dissolved when it arrives', async () => {
    const n = await nested()
    useShards.setState({ discovered: { [n.outer.eventId]: n.outer } })
    const { query } = await import('../../lib/relay')
    let answer: (v: unknown[]) => void = () => {}
    vi.mocked(query).mockImplementationOnce(() => new Promise((r) => { answer = r as typeof answer }))
    await press(n.outer.eventId, /^OPEN$/)
    await press(n.outer.eventId, /^CLOSE$/)
    answer([relay.events[0]])
    await settled()
    await new Promise((r) => setTimeout(r, 20))
    expect(roomTexts()).toEqual([])
    expect(openedByHand(me(), n.outer.eventId, n.outer.chest!.lockPubkey)).toBe(false)
  })
})
