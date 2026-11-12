/**
 * nearbyDoorActions.test.tsx: a door row in DISCOVERED NEARBY has its OPEN or
 * CLOSE beside VIEW (arkinox, 2026-11-12: "For doors, we should have an OPEN /
 * CLOSE button here as well for convenience"), the door card's own buttons
 * (ItemRows ChestBlock), pressed for real. With nothing held to open it, OPEN
 * is there and disabled, what it requires as its title. A chest row is as it
 * was. The relay is a mock that answers by `d`. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ pubkey: string; tags: string[][] }> }))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../lib/ceremonySound', async (orig) => ({
  ...(await orig<typeof import('../../lib/ceremonySound')>()),
  closeFeedback: () => ({ sound: false, buzz: false }),
  ceremonyFeedback: () => ({ sound: false, buzz: false }),
}))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  publishLight: vi.fn(async () => true),
  query: vi.fn(async (f: { authors?: string[]; '#d'?: string[] }) =>
    relay.events.filter((e) => (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))),
  queryAny: vi.fn(async () => []),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf, type Hidden } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, newDoorSecret, roomEntries, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { resetDoorSecrets, resetReopens } from '../../store/rooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { resetOpenedChests } from '../../store/useOpenedChests'
import { resetClosedDoors } from '../../store/closedDoors'
import { useShards } from '../../store/useShards'
import { setDrawnLooks, useOpenCeremony } from '../../store/useOpenCeremony'
import { useCeremony } from '../../store/useCeremony'
import { Row } from '../NearbyLootModal'
import type { NearbyItem } from '../../hooks/useNearbyLoot'

const hider = generateSecretKey()
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

/** A chest, or with `door` a door of height 3 whose room holds a note, sealed to the Silver Key; the key held when `held`. */
async function found(opts: { door: boolean; held: boolean }): Promise<Hidden> {
  const lock = forgeKey('Silver Key')
  if (opts.held) {
    const ev = finalizeEvent({ kind: 3340, created_at: T, content: '', tags: [] }, hider) as NostrEvent
    useInventory.getState().holdForged(ev, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: 1, height: 3 })
  }
  const secret = newDoorSecret()
  const sealed = sealEntries((opts.door ? roomEntries(secret) : [rumorOf(messageInnerTemplate('a note', AT, 1, T), getPublicKey(hider))]) as never, lock.itemPubkey)
  const t = chestInnerTemplate({ name: opts.door ? 'Sealed Crawlspace' : 'Old Chest', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: 'the Silver Key', payload: sealed.payload }, AT, 1, T)
  if (opts.door) t.tags.splice(t.tags.length - 1, 0, ['door', '3'])
  const event = finalizeEvent(t, hider) as NostrEvent
  if (opts.door) {
    const key = roomKey((await regionKeyOffThread(AT, 3, 20)).key, hexToBytes(secret))
    relay.events = [finalizeEvent(await bagTemplate([rumorOf(messageInnerTemplate('in the room', AT, 1, T), event.pubkey)], key, roomLookupId(key), 3, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), hider) as NostrEvent]
  }
  const bagKey = (await regionKeyOffThread(AT, 3, 20)).key
  const h: Hidden = { eventId: event.id, inner: event, keyHex: bytesToHex(bagKey), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: event.pubkey, at: AT, plane: 1, height: 3, createdAt: T, type: 'chest', chest: chestItemOf(event)! }
  useShards.setState({ discovered: { [h.eventId]: h } })
  return h
}

/** The thing as NEARBY lists it, mounted as a row. */
const row = (d: Hidden): Promise<Mounted> => {
  const item = { key: d.eventId, type: 'chest', chest: d.chest, event: d.inner, at: d.at, plane: d.plane, height: d.height, mine: false, author: d.author, createdAt: T, distance: 0n, lookupId: d.lookupId, bagId: d.bagId } as unknown as NearbyItem
  return mount(<ul><Row item={item} me={me()} onView={() => undefined} /></ul>)
}

/** The buttons beside VIEW, by their words, VIEW last. */
const actions = (r: Mounted): string[] => (r.all().find((h) => h.props.className === 'nearby__acts')?.children ?? [])
  .flatMap((c) => (typeof c !== 'string' && c.props.className === 'nearby__door' ? c.children : [c]))
  .map((c) => textOf(c as Host))
const button = (r: Mounted, words: RegExp): Host => r.buttons(words)[0]

beforeEach(() => {
  useCyberspace.setState({ anchorPlane: 1, headPlane: 1, plane: 1 })
  relay.events = []
  for (const k of ['onosendai:door-secrets', 'onosendai:door-secrets-only-said', 'onosendai:chests-opened', 'onosendai:doors-closed']) localStorage.removeItem(k)
  resetDoorSecrets()
  resetOpenedChests()
  resetClosedDoors()
  resetReopens()
  useOpenCeremony.setState({ playing: {} })
  setDrawnLooks([])
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null })
  useCeremony.setState({ chip: null, births: {} })
})

describe('a door row in DISCOVERED NEARBY', () => {
  it('without the key: OPEN beside VIEW, disabled, what it requires as its title', async () => {
    const r = await row(await found({ door: true, held: false }))
    expect(actions(r)).toEqual(['OPEN', 'VIEW'])
    const open = button(r, /^OPEN$/)
    expect(open.props.disabled).toBe(true)
    expect(open.props.title).toBe('Requires the Silver Key')
    // Only the one OPEN: the body says what it requires, as the card does.
    expect(r.buttons(/^OPEN$/)).toHaveLength(1)
    expect(r.says('REQUIRES: the Silver Key')).toBe(true)
    await r.unmount()
  })

  it('with the key: OPEN beside VIEW opens it, then CLOSE there shuts it, then OPEN again needs no key', async () => {
    const d = await found({ door: true, held: true })
    const r = await row(d)
    expect(actions(r)).toEqual(['OPEN', 'VIEW'])
    expect(button(r, /^OPEN$/).props.disabled).toBeFalsy()
    await r.press(/^OPEN$/)
    await vi.waitFor(() => expect(actions(r)).toEqual(['CLOSE', 'VIEW']))
    expect(r.says('OPEN · hidden by')).toBe(true)
    await r.press(/^CLOSE$/)
    await vi.waitFor(() => expect(actions(r)).toEqual(['OPEN', 'VIEW']))
    expect(r.says('CLOSED · hidden by')).toBe(true)
    // Closed with CLOSE: its secret is kept, so OPEN works with the key gone.
    useInventory.setState({ items: {} })
    await vi.waitFor(() => expect(button(r, /^OPEN$/).props.disabled).toBeFalsy())
    expect(button(r, /^OPEN$/).props.title).toBe('Open it again here. Its secret is kept on this device.')
    await r.press(/^OPEN$/)
    await vi.waitFor(() => expect(actions(r)).toEqual(['CLOSE', 'VIEW']))
    await r.unmount()
  })
})

describe('a chest row in DISCOVERED NEARBY', () => {
  it('is as it was: VIEW alone in the row’s end, OPEN in the chest’s head, nothing when nothing held opens it', async () => {
    const held = await row(await found({ door: false, held: true }))
    expect(actions(held)).toEqual(['VIEW'])
    expect(held.buttons(/^OPEN$/)).toHaveLength(1)
    await held.unmount()
    useInventory.setState({ items: {} })
    const none = await row(await found({ door: false, held: false }))
    expect(actions(none)).toEqual(['VIEW'])
    expect(none.buttons(/^OPEN$/)).toHaveLength(0)
    await none.unmount()
  })
})
