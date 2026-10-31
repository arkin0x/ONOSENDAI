/**
 * doorOpens.test.tsx: OPEN on a door, by its real button (his ruling, 2026-10-30:
 * "OPEN closes the modal", the door decodes away, "WALK passes at once"). The relay
 * here never answers until told to, so nothing of the door's opening may wait on it.
 * A room that does not come back is said in a toast, since the card has gone
 * (§3.7.3). No network.
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

const relay = vi.hoisted(() => ({ answer: null as null | ((events: unknown[]) => void), asked: 0, events: [] as unknown[], hold: false }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(() => { relay.asked++; return relay.hold ? new Promise((r) => { relay.answer = r }) : Promise.resolve(relay.events) }),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf, type BagEntry, type Hidden } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, newDoorSecret, roomEntries, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { mount, settled } from '../../test/elementRoot'
import { resetDoorSecrets } from '../../store/rooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { openedByHand, resetOpenedChests } from '../../store/useOpenedChests'
import { useShards } from '../../store/useShards'
import { useToast } from '../../store/useToast'
import { setDrawnLooks } from '../../store/useOpenCeremony'
import { doorWallKey, wallItems } from '../../store/walkWalls'
import { SecretModal } from '../SecretModal'

const hider = generateSecretKey()
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

async function door(): Promise<{ found: Hidden; room: NostrEvent }> {
  const lock = forgeKey('Silver Key')
  const held = finalizeEvent({ kind: 3340, created_at: T, content: '', tags: [] }, hider) as NostrEvent
  useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: 1, height: 3 })
  const secret = newDoorSecret()
  const sealed = sealEntries(roomEntries(secret) as BagEntry[], lock.itemPubkey)
  const t = chestInnerTemplate({ name: 'North Door', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, AT, 1, T)
  t.tags.splice(t.tags.length - 1, 0, ['door', '3'])
  const event = finalizeEvent(t, hider) as NostrEvent
  const bagKey = (await regionKeyOffThread(AT, 3, 20)).key
  const key = roomKey(bagKey, hexToBytes(secret))
  const room = finalizeEvent(await bagTemplate([rumorOf(messageInnerTemplate('behind it', AT, 1, T), event.pubkey)], key, roomLookupId(key), 3, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), hider) as NostrEvent
  return { room, found: { eventId: event.id, inner: event, keyHex: bytesToHex(bagKey), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: event.pubkey, at: AT, plane: 1, height: 3, createdAt: T, type: 'chest', chest: chestItemOf(event)! } }
}

beforeEach(() => {
  relay.answer = null
  relay.asked = 0
  relay.events = []
  relay.hold = false
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useToast.getState().dismiss()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null })
})

describe('OPEN on a door', () => {
  it('opens at once while the relay says nothing: remembered, the card gone, WALK through; the room comes when it comes', async () => {
    relay.hold = true
    const { found, room } = await door()
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    expect(wallItems(1).map((w) => w.key)).toContain(doorWallKey(found.eventId))
    // Drawn in the scene: the card yields to it (scene/ChestLooks).
    setDrawnLooks([found.eventId])
    const card = await mount(<SecretModal />)
    await card.press(/^OPEN$/)
    await settled()
    // The relay was asked, and has not answered.
    await vi.waitFor(() => expect(relay.answer).not.toBeNull())
    expect(openedByHand(me(), found.eventId, found.chest!.lockPubkey)).toBe(true)
    expect(useShards.getState().selectedSecret).toBeNull()
    expect(wallItems(1).map((w) => w.key)).not.toContain(doorWallKey(found.eventId))
    expect(Object.values(useShards.getState().discovered).some((h) => h.room)).toBe(false)
    relay.answer!([room])
    await vi.waitFor(() => expect(Object.values(useShards.getState().discovered).some((h) => h.room)).toBe(true))
    expect(useToast.getState().toast).toBeNull()
    await card.unmount()
  })

  it('says in a toast when the room does not come back: not found is not empty (§3.7.3)', async () => {
    const { found } = await door()
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    const card = await mount(<SecretModal />)
    await card.press(/^OPEN$/)
    await vi.waitFor(() => expect(useToast.getState().toast?.label).toBe('THE ROOM COULD NOT BE RETRIEVED'))
    expect(openedByHand(me(), found.eventId, found.chest!.lockPubkey)).toBe(true)
    await card.unmount()
  })

  it('says so too when the relay fails outright, and the door stays open', async () => {
    const { query } = await import('../../lib/relay')
    vi.mocked(query).mockRejectedValueOnce(new Error('every relay fell over'))
    const { found } = await door()
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    const card = await mount(<SecretModal />)
    await card.press(/^OPEN$/)
    await vi.waitFor(() => expect(useToast.getState().toast?.label).toBe('THE ROOM COULD NOT BE RETRIEVED'))
    expect(openedByHand(me(), found.eventId, found.chest!.lockPubkey)).toBe(true)
    await card.unmount()
  })
})
