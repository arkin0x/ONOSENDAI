/**
 * lockShowsKey.test.tsx: OPENS WITH, the listed key item a locked door or
 * chest is sealed to, drawn under it as KEY ITEMS > FEED draws a listing
 * (owner, 2026-11-15: "if a door or chest is locked to a key item that is
 * published, i want to display the key item picture and name on the door
 * modal (or chest modal, etc) in the same style its displayed in the
 * items/nearby").
 *
 * Matched by the item's public key, as the FEED matches, so a renamed copy
 * still shows; NOT FOUND or IN YOUR ITEMS for whether you hold it; nothing
 * at all for a key nobody listed; nothing secret ever. Relays are mocked,
 * nothing goes out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

const queried = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  queryChecked: vi.fn(async () => { queried.count++; return { events: [], trouble: null } }),
  queryEach: vi.fn(async () => []),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, type KeyItem } from '../../lib/hidden'
import { heldFromForged } from '../../lib/inventory'
import { listingForLock, type ItemListing } from '../../lib/itemListing'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useItemFeed } from '../../store/useItemFeed'
import { useMutes } from '../../store/useMutes'
import { useShards } from '../../store/useShards'
import { rememberOpened } from '../../store/useOpenedChests'
import { doorSecret, keepDoorSecret } from '../../store/doorSecrets'
import { NOTHING_MUTED } from '../../lib/muteList'
import { ChestBlock } from '../ItemRows'
import { IN_YOUR_ITEMS, NOT_FOUND, OPENS_WITH, YOU_HAVE_IT } from '../KeyListingRow'

const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }
/** A one-pixel PNG, as a listing's imeta carries one. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const listing = (key: KeyItem, name: string, lister: string, extra: Partial<ItemListing> = {}): ItemListing => ({ id: `${name}-id`.padEnd(64, '0'), lister, itemPubkey: key.itemPubkey, name, about: `about ${name}`, createdAt: 9, image: PIXEL, imageDim: { w: 1, h: 1 }, ...extra })

/** A chest (or a door, with `door`) sealed to `key`, its hider's label `requires`, holding one note. */
function chestFor(key: KeyItem, requires: string, door?: number): { id: string; event: NostrEvent; hider: Uint8Array } {
  const hider = generateSecretKey()
  const sealed = sealEntries([finalizeEvent(messageInnerTemplate('inside', at, 0, 1), hider) as NostrEvent], key.itemPubkey)
  const event = finalizeEvent(chestInnerTemplate({ name: door ? 'Pump Door' : 'Grate', lockPubkey: key.itemPubkey, senderPubkey: sealed.senderPubkey, requires, payload: sealed.payload, ...(door ? { door } : {}) }, at, 0, 1), hider) as NostrEvent
  return { id: event.id, event, hider }
}

const block = (c: { id: string; event: NostrEvent }) => createElement(ChestBlock, { id: c.id, chest: chestItemOf(c.event)!, author: c.event.pubkey, verified: true, place })
const lockRows = (hosts: Host[]): Host[] => hosts.filter((h) => String(h.props.className ?? '').split(' ').includes('lockkey'))
const imgs = (hosts: Host[]): Host[] => hosts.filter((h) => h.type === 'img')
/** Everything drawn, words and attributes alike, to look for what must never be there. */
const everything = (hosts: Host[]): string => JSON.stringify(hosts.map((h) => ({ t: h.type, p: Object.fromEntries(Object.entries(h.props).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) })))

let me = ''
let wasIdentity = useCyberspace.getState().identity
const wasFeed = useItemFeed.getState()

beforeEach(() => {
  wasIdentity = useCyberspace.getState().identity
  const sk = generateSecretKey()
  me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...wasIdentity, pubkey: me }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me, items: {}, storage: 'memory' })
  useMutes.setState({ muted: NOTHING_MUTED })
  // Read already this session: no relay is asked.
  useItemFeed.setState({ listings: [], loading: false, trouble: null, readAt: 1 })
  queried.count = 0
})

afterEach(() => {
  useCyberspace.setState({ identity: wasIdentity })
  useItemFeed.setState({ listings: wasFeed.listings, loading: wasFeed.loading, trouble: wasFeed.trouble, readAt: wasFeed.readAt })
})

/** Hold `key` as a key item named `name`. */
function hold(key: KeyItem, name = key.name): void {
  const sk = generateSecretKey()
  const ev = finalizeEvent(keyInnerTemplate({ ...key, name }, at, 0, 2), sk) as NostrEvent
  const row = heldFromForged(getPublicKey(sk), ev, { ...key, name }, place, 2)
  useInventory.setState({ items: { [row.id]: row } })
}

describe('OPENS WITH', () => {
  it('a chest locked to a listed key shows the key item’s picture and name with NOT FOUND', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing(moon, 'Moon Key', getPublicKey(generateSecretKey()))] })
    const m = await mount(block(chestFor(moon, 'the moon key')))
    const rows = lockRows(m.all())
    expect(rows).toHaveLength(1)
    const words = textOf(rows[0])
    expect(words).toContain(OPENS_WITH)
    expect(words).toContain('Moon Key')
    expect(words).toContain(NOT_FOUND)
    expect(words).not.toContain(IN_YOUR_ITEMS)
    // The listing's picture, in the FEED's chamfered thumbnail.
    expect(imgs(m.all()).map((h) => h.props.src)).toEqual([PIXEL])
    expect(m.all().some((h) => String(h.props.className ?? '').includes('chamfer'))).toBe(true)
    // Still REQUIRES the hider's own words above it, as before.
    expect(m.says('REQUIRES: the moon key')).toBe(true)
    // DETAILS opens the listing's keys and words, as in the FEED.
    await m.press(/^DETAILS$/)
    expect(m.says('about Moon Key')).toBe(true)
    await m.unmount()
  })

  it('says IN YOUR ITEMS once you hold the key', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing(moon, 'Moon Key', getPublicKey(generateSecretKey()))] })
    hold(moon)
    const m = await mount(block(chestFor(moon, '')))
    const words = textOf(lockRows(m.all())[0])
    expect(words).toContain(IN_YOUR_ITEMS)
    expect(words).not.toContain(NOT_FOUND)
    // OPEN is offered, as it was.
    expect(m.buttons(/^OPEN$/)).toHaveLength(1)
    await m.unmount()
  })

  it('shows nothing new for a key nobody listed: no heading, no hint, no picture', async () => {
    const moon = forgeKey('Moon Key')
    const other = forgeKey('Other Key')
    useItemFeed.setState({ listings: [listing(other, 'Other Key', getPublicKey(generateSecretKey()))] })
    const m = await mount(block(chestFor(moon, 'the moon key')))
    expect(lockRows(m.all())).toHaveLength(0)
    expect(m.says(OPENS_WITH)).toBe(false)
    expect(m.says('Other Key')).toBe(false)
    expect(m.says(NOT_FOUND)).toBe(false)
    expect(imgs(m.all())).toHaveLength(0)
    await m.unmount()
  })

  it('a renamed copy still matches, by the key item’s public key, and shows the listing’s name', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing(moon, 'Lunar Sigil', getPublicKey(generateSecretKey()))] })
    hold(moon, 'My Moon')
    const m = await mount(block(chestFor(moon, 'a silver thing')))
    const words = textOf(lockRows(m.all())[0])
    expect(words).toContain('Lunar Sigil')
    expect(words).toContain(IN_YOUR_ITEMS)
    expect(listingForLock(useItemFeed.getState().listings, moon.itemPubkey)?.name).toBe('Lunar Sigil')
    await m.unmount()
  })

  it('a door locked to a listed key shows it too, and nothing secret: no private key, no door secret', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing(moon, 'Moon Key', getPublicKey(generateSecretKey()))] })
    hold(moon)
    const door = chestFor(moon, 'the moon key', 4)
    // Found where it stands, so ChestBlock reads it as a door (its `door` tag), not a chest.
    useShards.getState().addDiscovered([{ eventId: door.id, inner: door.event, keyHex: 'aa'.repeat(32), bagId: 'b', lookupId: 'l', author: door.event.pubkey, at, plane: 0, height: 4, createdAt: 1, type: 'chest', chest: chestItemOf(door.event)! }])
    expect(useShards.getState().discovered[door.id]?.inner?.tags.some((t) => t[0] === 'door')).toBe(true)
    const m = await mount(block(door))
    expect(textOf(lockRows(m.all())[0])).toContain('Moon Key')
    await m.press(/^DETAILS$/)
    const drawn = everything(m.all())
    expect(drawn).not.toContain(moon.secretHex)
    // What the lock is sealed around never shows: its payload stays in the event.
    expect(drawn).not.toContain(chestItemOf(door.event)!.payload.slice(0, 32))
    await m.unmount()
    // Opened here with its secret kept on this device: CLOSE, and no OPENS WITH; the secret is never drawn.
    const secret = 'cd'.repeat(32)
    keepDoorSecret(me, door.id, secret)
    rememberOpened(me, door.id, moon.itemPubkey, [])
    await vi.waitFor(() => expect(doorSecret(me, door.id)).toBe(secret))
    const n = await mount(block(door))
    expect(n.buttons(/^CLOSE$/)).toHaveLength(1)
    expect(lockRows(n.all())).toHaveLength(0)
    expect(everything(n.all())).not.toContain(secret)
    await n.unmount()
  })

  it('says YOU HAVE IT, never NOT FOUND, when what opens it is not a key item in ITEMS (a lock to your own identity that was listed)', async () => {
    const self = { name: 'me', about: '', itemPubkey: me, secretHex: '' } as KeyItem
    useItemFeed.setState({ listings: [listing(self, 'My Sigil', me)] })
    const m = await mount(block(chestFor(self, '')))
    const words = textOf(lockRows(m.all())[0])
    expect(words).toContain(YOU_HAVE_IT)
    expect(words).not.toContain(NOT_FOUND)
    expect(m.buttons(/^OPEN$/)).toHaveLength(1)
    await m.unmount()
  })

  it('leaves out a listing by someone you muted, as the FEED does', async () => {
    const moon = forgeKey('Moon Key')
    const lister = getPublicKey(generateSecretKey())
    useItemFeed.setState({ listings: [listing(moon, 'Moon Key', lister)] })
    useMutes.setState({ muted: { pubkeys: new Set([lister]), items: new Set() } })
    const m = await mount(block(chestFor(moon, '')))
    expect(lockRows(m.all())).toHaveLength(0)
    await m.unmount()
  })

  it('is gone once the chest is open here: only a lock that still stands shows its key', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing(moon, 'Moon Key', getPublicKey(generateSecretKey()))] })
    const c = chestFor(moon, '')
    rememberOpened(me, c.id, moon.itemPubkey, [])
    const m = await mount(block(c))
    expect(lockRows(m.all())).toHaveLength(0)
    await m.unmount()
  })

  it('reads the feed once a session for every lock shown, never once per card', async () => {
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [], readAt: 0 })
    const a = chestFor(moon, '')
    const b = chestFor(moon, '')
    const m = await mount(createElement('div', null, block(a), block(b), block(a)))
    expect(queried.count).toBe(1)
    await m.unmount()
    const n = await mount(block(b))
    expect(queried.count).toBe(1)
    await n.unmount()
  })
})

describe('listingForLock', () => {
  it('matches by public key, and nothing for a lock that is not a key', () => {
    const moon = forgeKey('Moon Key')
    const l = listing(moon, 'Moon Key', 'aa'.repeat(32))
    expect(listingForLock([l], moon.itemPubkey)).toBe(l)
    expect(listingForLock([l], forgeKey('x').itemPubkey)).toBeNull()
    expect(listingForLock([l], '')).toBeNull()
    expect(listingForLock([l], moon.itemPubkey, () => true)).toBeNull()
  })
})
