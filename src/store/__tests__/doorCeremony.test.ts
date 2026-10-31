/**
 * doorCeremony.test.ts: OPEN on a door (arkinox, 2026-10-30, door A): the
 * card closes, WALK lets you through at once, the slab decodes away upward
 * and the open look settles in, and what is behind the door appears with
 * the find ceremony where it stands; nothing floats out. A chest's OPEN
 * marks nothing as found. The calm path fades. The door's sound is its own,
 * through the same 10 s gate as a chest's. No relay is touched.
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
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate, type ChestItem, type KeyItem } from '../../lib/hidden'
import { CALM_FADE_MS, DOOR_DISSOLVE_MS, afterOpen, ceremonyLength, dissolveShare } from '../../lib/ceremony'
import { CEREMONY_BUZZ, ceremonyFeedback, resetCeremonySound } from '../../lib/ceremonySound'
import { openChestHere } from '../../hud/ItemRows'
import { lookOf } from '../../lib/looks'
import { chestLoot } from '../../lib/lootObjects'
import { useCeremony } from '../useCeremony'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { openedByHand, resetOpenedChests } from '../useOpenedChests'
import { celebrateOpen, setDrawnLooks, useOpenCeremony } from '../useOpenCeremony'
import { doorWallKey, wallItems } from '../walkWalls'

const hider = generateSecretKey()
const at = { x: 1n << 30n, y: 2n << 30n, z: 3n << 30n }
const place = { lookupId: 'l', bagId: 'b', at: { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() }, plane: 1 as const, height: 6 }
const lockSk = generateSecretKey()
const lock: KeyItem = { name: 'Brass Key', about: '', itemPubkey: getPublicKey(lockSk), secretHex: bytesToHex(lockSk) }
const lockEvent = finalizeEvent(keyInnerTemplate(lock, at, 1, 1), hider) as NostrEvent
const behind = finalizeEvent(messageInnerTemplate('behind the gate', { ...at, z: at.z + 2n }, 1, 1), hider) as NostrEvent
const sealed = sealEntries([behind], lock.itemPubkey)
const chest: ChestItem = { name: 'Iron Gate', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
const opener = { by: 'key' as const, key: { id: lockEvent.id, itemPubkey: lock.itemPubkey, secretHex: lock.secretHex } }
const ME = useCyberspace.getState().identity.pubkey

function doorEvent(door: boolean): NostrEvent {
  return { id: (door ? 'd' : 'c').repeat(64), pubkey: getPublicKey(hider), created_at: 1, kind: 3341, tags: door ? [['title', 'Iron Gate'], ['door', '6']] : [['title', 'Iron Gate']], content: sealed.payload, sig: '' }
}

function found(ev: NostrEvent) {
  return { eventId: ev.id, inner: ev, keyHex: 'aa'.repeat(32), bagId: 'b', lookupId: 'l', author: ev.pubkey, at, plane: 1 as const, height: 6, createdAt: 1, type: 'chest' as const, chest }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  resetCeremonySound()
  useCeremony.setState({ births: {}, chip: null })
  useOpenCeremony.setState({ playing: {} })
})

describe('OPEN on a door', () => {
  it('closes the card, takes the door out of WALK at once, and plays the door ceremony', async () => {
    const ev = doorEvent(true)
    useShards.setState({ mine: [], discovered: { [ev.id]: found(ev) }, selectedSecret: ev.id })
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME } })
    setDrawnLooks([ev.id])
    expect(wallItems(1).map((w) => w.key)).toContain(doorWallKey(ev.id))
    const first = !openedByHand(ME, ev.id)
    await openChestHere({ id: ev.id, chest, author: ev.pubkey, place, sealer: ev.pubkey, door: true }, opener)
    expect(wallItems(1).map((w) => w.key)).not.toContain(doorWallKey(ev.id))
    const plan = celebrateOpen({ me: ME, chestId: ev.id, kind: 'door', first, calm: false })
    expect(plan.ceremony).toBe(true)
    expect(useShards.getState().selectedSecret).toBeNull()
    expect(Object.values(useOpenCeremony.getState().playing)[0]).toMatchObject({ kind: 'door' })
  })

  it('shows what is behind it with the find ceremony, where it stands', async () => {
    const ev = doorEvent(true)
    useShards.setState({ mine: [], discovered: { [ev.id]: found(ev) } })
    await openChestHere({ id: ev.id, chest, author: ev.pubkey, place, sealer: ev.pubkey, door: true }, opener)
    expect(useCeremony.getState().births[behind.id]).toBeTypeOf('number')
    expect(useShards.getState().discovered[behind.id]?.at.z).toBe(at.z + 2n)
  })

  it('lets nothing float out: an opened door has no loot (review of #534 and #535)', async () => {
    const ev = doorEvent(true)
    useShards.setState({ mine: [], discovered: { [ev.id]: found(ev) } })
    const contents = await openChestHere({ id: ev.id, chest, author: ev.pubkey, place, sealer: ev.pubkey, door: true }, opener)
    expect(contents?.length).toBe(1)
    const look = lookOf({ type: 'chest', event: ev })!
    expect(look.name).toBe('door')
    expect(chestLoot({ look: look.kind, entries: contents!, held: () => false, chest: { at, plane: 1, height: 6 }, itemsReady: true })).toEqual([])
    // The same contents in a chest whose region does not hold their point would float out.
    expect(chestLoot({ look: 'chest', entries: contents!, held: () => false, chest: { at, plane: 1, height: 1 }, itemsReady: true })).not.toEqual([])
  })

  it('a chest marks nothing found: its contents float out instead', async () => {
    const ev = doorEvent(false)
    useShards.setState({ mine: [], discovered: { [ev.id]: found(ev) } })
    await openChestHere({ id: ev.id, chest, author: ev.pubkey, place, sealer: ev.pubkey }, opener)
    expect(useCeremony.getState().births).toEqual({})
  })

  it('opened again after a reload: the room returns without a second ceremony', async () => {
    const ev = doorEvent(true)
    useShards.setState({ mine: [], discovered: { [ev.id]: found(ev) } })
    await openChestHere({ id: ev.id, chest, author: ev.pubkey, place, sealer: ev.pubkey, door: true }, opener)
    useCeremony.setState({ births: {}, chip: null })
    resetOpenedChests()
    expect(afterOpen(!openedByHand(ME, ev.id), true).ceremony).toBe(false)
  })
})

describe('the door’s timeline', () => {
  it('the slab decodes away over DOOR_DISSOLVE_MS; the calm path fades instead', () => {
    expect(dissolveShare(0)).toBe(0)
    expect(dissolveShare(DOOR_DISSOLVE_MS / 2)).toBeGreaterThan(0)
    expect(dissolveShare(DOOR_DISSOLVE_MS)).toBe(1)
    expect(ceremonyLength('door', true)).toBe(CALM_FADE_MS)
    expect(ceremonyLength('door', false)).toBeGreaterThan(DOOR_DISSOLVE_MS)
  })

  it('a door has its own buzz, through the chest’s 10 s gate', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const t = Date.now() + 3_600_000
    expect(ceremonyFeedback('door', t)).toEqual({ sound: true, buzz: true })
    expect(vibrate).toHaveBeenLastCalledWith(CEREMONY_BUZZ.door)
    expect(ceremonyFeedback('chest', t + 5000)).toEqual({ sound: false, buzz: false })
    vi.unstubAllGlobals()
  })
})
