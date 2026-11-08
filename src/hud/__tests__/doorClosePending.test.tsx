/**
 * doorClosePending.test.tsx: OPEN on a door closed with CLOSE while the hidden store
 * (door secrets and closes, store/hiddenStorage.ts) is still being read (review of
 * #616, N4). The card says CLOSED and OPEN waits for the store: once read, the kept
 * secret opens the door with the short reveal and no key. Only a secret truly gone
 * falls back to a first OPEN, with what opens it. The store's mode and readiness are
 * the test's to say; everything else is real. No network.
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

const h = vi.hoisted(() => {
  const store = {
    mode: 'pending' as 'pending' | 'indexeddb' | 'local',
    ready: Promise.resolve('indexeddb' as const) as Promise<'pending' | 'indexeddb' | 'local'>,
    release: () => {},
    secrets: {} as Record<string, Record<string, { owner: string; doorId: string; secret: string }>>,
    closed: {} as Record<string, Record<string, unknown>>,
  }
  return { store, relay: { events: [] as Array<{ pubkey: string; tags: string[][] }> } }
})

vi.mock('../../store/hiddenStorage', async (orig) => {
  const real = await orig<typeof import('../../store/hiddenStorage')>()
  return {
    ...real,
    storageMode: () => h.store.mode,
    hiddenDecided: () => h.store.ready,
    secretRecord: (owner: string, doorId: string) => h.store.secrets[owner]?.[doorId],
    putSecret: async () => true,
    closedOf: (owner: string) => h.store.closed[owner] ?? {},
    putClosed: async (r: { owner: string; doorId: string }) => { (h.store.closed[r.owner] ??= {})[r.doorId] = r; return true },
    dropClosed: async (owner: string, doorId: string) => { delete h.store.closed[owner]?.[doorId]; return true },
    refreshClosed: async () => {},
  }
})
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async (f: { authors?: string[]; '#d'?: string[] }) => h.relay.events.filter((e) => (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))),
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
import { ROOM_BAG_SETTINGS, newDoorSecret, roomEntries, roomKey, roomKeyOf, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { mount, settled } from '../../test/elementRoot'
import { resetDoorSecrets, resetReopens } from '../../store/rooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { openedByHand, resetOpenedChests } from '../../store/useOpenedChests'
import { resetClosedDoors } from '../../store/closedDoors'
import { useShards } from '../../store/useShards'
import { setDrawnLooks, useOpenCeremony } from '../../store/useOpenCeremony'
import { SecretModal } from '../SecretModal'

const hider = generateSecretKey()
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

/** A door opened before and closed with CLOSE, as a reload finds it: the close copied in localStorage, the secret only in the database. */
async function closedDoor(): Promise<{ found: Hidden; secret: string; lock: ReturnType<typeof forgeKey> }> {
  const lock = forgeKey('Silver Key')
  const secret = newDoorSecret()
  const sealed = sealEntries(roomEntries(secret) as BagEntry[], lock.itemPubkey)
  const t = chestInnerTemplate({ name: 'North Door', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, AT, 1, T)
  t.tags.splice(t.tags.length - 1, 0, ['door', '3'])
  const event = finalizeEvent(t, hider) as NostrEvent
  const bagKey = (await regionKeyOffThread(AT, 3, 20)).key
  const key = roomKey(bagKey, hexToBytes(secret))
  h.relay.events = [finalizeEvent(await bagTemplate([rumorOf(messageInnerTemplate('behind it', AT, 1, T), event.pubkey)], key, roomLookupId(key), 3, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), hider) as NostrEvent]
  const found: Hidden = { eventId: event.id, inner: event, keyHex: bytesToHex(bagKey), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: event.pubkey, at: AT, plane: 1, height: 3, createdAt: T, type: 'chest', chest: chestItemOf(event)! }
  const rec = { lock: lock.itemPubkey, room: roomKeyOf(found)!, shut: true, below: true }
  localStorage.setItem('onosendai:chests-opened', JSON.stringify({ [me()]: [`${event.id}:${lock.itemPubkey}`] }))
  localStorage.setItem('onosendai:doors-closed', JSON.stringify({ [me()]: { [event.id]: rec } }))
  // What the database holds, read once it is decided.
  h.store.closed = { [me()]: { [event.id]: { owner: me(), doorId: event.id, ...rec } } }
  return { found, secret, lock }
}

const roomTexts = (): string[] => Object.values(useShards.getState().discovered).filter((x) => x.room).map((x) => x.text ?? '')
const decide = (): void => { h.store.mode = 'indexeddb'; h.store.release() }

beforeEach(() => {
  h.store.mode = 'pending'
  h.store.ready = new Promise((r) => { h.store.release = () => r('indexeddb') })
  h.store.secrets = {}
  h.store.closed = {}
  for (const k of ['onosendai:door-secrets', 'onosendai:door-secrets-only-said', 'onosendai:chests-opened', 'onosendai:doors-closed']) localStorage.removeItem(k)
  resetDoorSecrets()
  resetOpenedChests()
  resetClosedDoors()
  resetReopens()
  useOpenCeremony.setState({ playing: {} })
  setDrawnLooks([])
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null })
})

describe('OPEN on a closed door while the store is read (N4)', () => {
  it('says CLOSED with OPEN, which waits for the store, then opens with the kept secret: short reveal, no key', async () => {
    const { found, secret } = await closedDoor()
    h.store.secrets = { [me()]: { [found.eventId]: { owner: me(), doorId: found.eventId, secret } } }
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    setDrawnLooks([found.eventId])
    const card = await mount(<SecretModal />)
    expect(card.says('CLOSED')).toBe(true)
    expect(card.buttons(/^OPEN$/).length).toBe(1)
    await card.press(/^OPEN$/)
    await settled()
    // Nothing yet: the store has not been read.
    expect(openedByHand(me(), found.eventId, found.chest!.lockPubkey)).toBe(false)
    expect(useOpenCeremony.getState().playing).toEqual({})
    decide()
    await vi.waitFor(() => expect(roomTexts()).toEqual(['behind it']))
    expect(openedByHand(me(), found.eventId, found.chest!.lockPubkey)).toBe(true)
    expect(Object.values(useOpenCeremony.getState().playing)).toEqual([expect.objectContaining({ kind: 'door', calm: true })])
    await card.unmount()
  })

  it('a secret truly gone once the store is read: a first OPEN with the key held, the full ceremony', async () => {
    const { found, lock } = await closedDoor()
    const held = finalizeEvent({ kind: 3340, created_at: T, content: '', tags: [] }, hider) as NostrEvent
    useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: 1, height: 3 })
    decide()
    await settled()
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    setDrawnLooks([found.eventId])
    const card = await mount(<SecretModal />)
    expect(card.says('CLOSED')).toBe(false)
    await card.press(/^OPEN$/)
    await vi.waitFor(() => expect(roomTexts()).toEqual(['behind it']))
    expect(Object.values(useOpenCeremony.getState().playing)).toEqual([expect.objectContaining({ kind: 'door', calm: false })])
    await card.unmount()
  })
})
