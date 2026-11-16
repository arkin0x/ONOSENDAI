/**
 * keyItemComments.test.tsx: COMMENT on key items you find and take (owner,
 * 2026-11-15: "we should be able to comment on key items we find and take").
 * Pressed for real: COMMENT in KEY ITEMS > MINE (each row's ACTIONS), on a
 * key item's DISCOVERED NEARBY row and its row in an opened chest. A comment
 * posted from MINE lands in the thread the item's card opens where it was
 * found, sealed under the same bag key; a thing in a room never gets the
 * region key around it; during the tutorial it carries the no-broadcast tag
 * (signEvent). The relay is a mock that keeps what is published. No network.
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

const relay = vi.hoisted(() => ({ published: [] as Array<{ id: string; kind: number; tags: string[][] }> }))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async (ev: { id: string; kind: number; tags: string[][] }) => { relay.published.push(ev); return { ok: true } }),
  publishMany: vi.fn(async () => ({ ok: true })),
  publishLight: vi.fn(async () => true),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryChecked: vi.fn(async (f: { kinds?: number[]; '#A'?: string[] }) => ({
    events: relay.published.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f['#A'] || f['#A'].includes(e.tags.find((t) => t[0] === 'A')?.[1] ?? ''))),
    trouble: null,
  })),
  queryEach: vi.fn(async () => []),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { keyInnerTemplate, type Hidden } from '../../lib/hidden'
import { heldFromFind, type HeldItem } from '../../lib/inventory'
import { openComments } from '../../lib/comments'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import { NO_BROADCAST, holdBroadcastWhile } from '../../lib/noBroadcast'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useSecrets } from '../../store/useSecrets'
import { useShards } from '../../store/useShards'
import { setGuideBags } from '../../tutorial/guideBags'
import { InventoryPanel } from '../InventoryPanel'
import { SecretModal } from '../SecretModal'
import { ChestContents } from '../ItemRows'
import { Row } from '../NearbyLootModal'
import type { NearbyItem } from '../../hooks/useNearbyLoot'

const hiderSk = generateSecretKey()
const HIDER = getPublicKey(hiderSk)
const AT = { x: (1n << 30n) + 0x35n, y: (1n << 29n) + 0x12n, z: (1n << 28n) + 0x2an }
const HEIGHT = 4
const T = 1_800_000_000
const me = (): string => useCyberspace.getState().identity.pubkey

/** The Silver Key, hidden inline in the hider's bag at AT, as the scan keeps it, with the region key that opened it. */
async function silverKey(): Promise<{ found: Hidden; regionKey: Uint8Array; lookupId: string; secretHex: string }> {
  const lock = forgeKey('Silver Key')
  const ev = finalizeEvent(keyInnerTemplate(lock, AT, 0, T), hiderSk) as NostrEvent
  const rk = await regionKeyOffThread(AT, HEIGHT, 20)
  const found: Hidden = { eventId: ev.id, inner: ev, keyHex: bytesToHex(rk.key), bagId: 'bag-1', lookupId: rk.lookupId, author: HIDER, at: AT, plane: 0, height: HEIGHT, createdAt: T, type: 'key', key: lock }
  return { found, regionKey: rk.key, lookupId: rk.lookupId, secretHex: lock.secretHex }
}

/** Hold it in ITEMS, as TAKE does, and let it leave the world (taken and gone from here). */
function hold(found: Hidden): HeldItem {
  const row = heldFromFind(me(), found, T)!
  useInventory.setState({ owner: me(), items: { [row.id]: row }, storage: 'memory' })
  return row
}

/** Type in the open composer and press POST. */
async function post(m: Mounted, words: string): Promise<void> {
  const box = m.all().find((h) => h.type === 'textarea')
  if (!box) throw new Error('no composer')
  ;(box.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: words } })
  await settled()
  await m.press(/^POST$/)
  await settled(30)
}

/** KEY ITEMS > MINE, the one row's ACTIONS open. */
async function mineActions(): Promise<Mounted> {
  const m = await mount(createElement(InventoryPanel))
  await m.press(/^KEY ITEMS · 1$/)
  await m.press(/^ACTIONS$/)
  return m
}

const publicTags = (e: { tags: string[][] }): string[][] => e.tags.filter((t) => t[0] !== 'encrypted')

let open: Mounted[] = []
const keep = (m: Mounted): Mounted => { open.push(m); return m }

beforeEach(() => {
  relay.published = []
  useCyberspace.setState({ live: true, signerKind: 'local' })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, selectedSecret: null, curated: null, pending: null, deployStatus: 'idle' })
  useSecrets.setState({ keys: {}, current: {} })
})
afterEach(async () => {
  for (const m of open) await m.unmount()
  open = []
  setGuideBags(null)
})

describe('KEY ITEMS > MINE', () => {
  it('each key row\'s ACTIONS has COMMENT, which opens the composer and the comments on it', async () => {
    const { found } = await silverKey()
    hold(found)
    const m = keep(await mineActions())
    expect(m.buttons(/^COMMENT$/)).toHaveLength(1)
    await m.press(/^COMMENT$/)
    await settled(30)
    expect(m.says('Comments')).toBe(true)
    expect(m.all().find((h) => h.type === 'textarea')?.props.placeholder).toBe('Say something to the author')
    expect(m.buttons(/^POST$/)).toHaveLength(1)
    expect(m.says('No comments yet.')).toBe(true)
  })

  it('a comment from MINE lands in the thread the card opens where it was found, sealed under the same bag key', async () => {
    const { found, regionKey, secretHex } = await silverKey()
    hold(found)
    const m = keep(await mineActions())
    await m.press(/^COMMENT$/)
    await settled(30)
    await post(m, 'from my items')
    expect(relay.published).toHaveLength(1)
    const fromMine = relay.published[0] as NostrEvent

    // The card where it was found: it shows the comment made from MINE, and its own lands beside it.
    useShards.setState({ discovered: { [found.eventId]: found }, selectedSecret: found.eventId })
    const card = keep(await mount(createElement(SecretModal)))
    await settled(30)
    expect(card.says('from my items')).toBe(true)
    await post(card, 'from the bag')
    expect(relay.published).toHaveLength(2)
    const fromCard = relay.published[1] as NostrEvent

    expect(publicTags(fromMine)).toEqual(publicTags(fromCard))
    expect(fromMine.tags).toEqual(expect.arrayContaining([['A', `33330:${HIDER}:${found.lookupId}`], ['e', found.eventId, '', HIDER], ['k', '3340']]))
    const opened = await openComments([fromMine, fromCard], regionKey)
    expect(opened.get(fromMine.id)).toBe('from my items')
    expect(opened.get(fromCard.id)).toBe('from the bag')
    // Nothing secret in either.
    for (const e of [fromMine, fromCard]) {
      const out = JSON.stringify(e)
      expect(out).not.toContain(secretHex)
      expect(out).not.toContain(bytesToHex(regionKey))
      expect(out).not.toContain('from my items')
      expect(out).not.toContain('from the bag')
    }
  })

  it('a held region key that fits the bag is the one used; posting during the tutorial carries the no-broadcast tag', async () => {
    const { found, regionKey } = await silverKey()
    hold(found)
    useSecrets.setState({ keys: { [found.lookupId]: { lookupId: found.lookupId, keyHex: bytesToHex(regionKey), height: HEIGHT, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'hop', at: T } } })
    const off = holdBroadcastWhile(() => true)
    try {
      const m = keep(await mineActions())
      await m.press(/^COMMENT$/)
      await settled(30)
      await post(m, 'in the tutorial')
    } finally { off() }
    expect(relay.published).toHaveLength(1)
    expect(relay.published[0].tags).toContainEqual([NO_BROADCAST])
    expect((await openComments([relay.published[0] as NostrEvent], regionKey)).get(relay.published[0].id)).toBe('in the tutorial')
  })

  it('in a room: never the region key around it. With no room key here, COMMENTS UNAVAILABLE and no composer', async () => {
    const { found } = await silverKey()
    // A room bag's lookup id is sha256 of the room key, never the region's.
    const roomKey = new Uint8Array(32).map((_, i) => i + 40)
    const { lookupIdOf } = await import('../../lib/regionKeyCheck')
    const inRoom = { ...found, lookupId: lookupIdOf(roomKey), keyHex: bytesToHex(roomKey) }
    hold(inRoom)
    const m = keep(await mineActions())
    await m.press(/^COMMENT$/)
    await settled(30)
    expect(m.says('COMMENTS UNAVAILABLE')).toBe(true)
    expect(m.buttons(/^POST$/)).toHaveLength(0)
    await m.unmount(); open = []

    // The room known here (its bag found here): its key, and the thread opens.
    useShards.setState({ discovered: { other: { ...inRoom, eventId: 'other', type: 'message', key: undefined } } })
    const again = keep(await mineActions())
    await again.press(/^COMMENT$/)
    await settled(30)
    expect(again.says('COMMENTS UNAVAILABLE')).toBe(false)
    await post(again, 'behind the door')
    expect(relay.published).toHaveLength(1)
    expect((await openComments([relay.published[0] as NostrEvent], roomKey)).get(relay.published[0].id)).toBe('behind the door')
  })

  it('a key pasted from another device has no COMMENT: it was found nowhere', async () => {
    const { found } = await silverKey()
    const row = { ...hold(found), source: 'pasted' as const, place: null }
    useInventory.setState({ items: { [row.id]: row } })
    const m = keep(await mineActions())
    expect(m.buttons(/^COMMENT$/)).toHaveLength(0)
    expect(m.buttons(/^COPY$/)).toHaveLength(1)
  })
})

describe('before TAKE', () => {
  /** The key as NEARBY lists it, mounted as a row. */
  const nearby = (d: Hidden): Promise<Mounted> => {
    const item = { key: d.eventId, type: 'key', keyItem: d.key, event: d.inner, at: d.at, plane: d.plane, height: d.height, mine: false, author: d.author, createdAt: T, distance: 0n, lookupId: d.lookupId, bagId: d.bagId, bagKeyHex: d.keyHex, lineage: d.eventId } as unknown as NearbyItem
    return mount(<ul><Row item={item} me={me()} onView={() => undefined} /></ul>)
  }
  const acts = (r: Mounted): string[] => (r.all().find((h) => h.props.className === 'nearby__acts')?.children ?? [])
    .flatMap((c) => (typeof c !== 'string' && c.props.className === 'nearby__door' ? c.children : [c]))
    .map((c) => textOf(c as Host))

  it('DISCOVERED NEARBY: COMMENT beside TAKE and VIEW, and still there once taken', async () => {
    const { found } = await silverKey()
    useShards.setState({ discovered: { [found.eventId]: found } })
    const r = keep(await nearby(found))
    expect(acts(r)).toEqual(['TAKE', 'COMMENT', 'VIEW'])
    await r.press(/^COMMENT$/)
    await settled(30)
    expect(r.all().find((h) => h.type === 'textarea')?.props.placeholder).toBe('Say something to the author')
    await r.unmount(); open = []
    hold(found)
    const after = keep(await nearby(found))
    expect(acts(after)).toEqual(['COMMENT', 'VIEW'])
  })

  it('DISCOVERED NEARBY: nothing a tutorial guide sealed has COMMENT', async () => {
    const { found } = await silverKey()
    // A guide key of its own: one staged stays a guide key for the visit (guideBags).
    const staged = finalizeEvent({ kind: 33330, created_at: T, tags: [['d', 'x']], content: '' }, generateSecretKey()) as NostrEvent
    setGuideBags([staged])
    const guided = { ...found, author: staged.pubkey }
    useShards.setState({ discovered: { [found.eventId]: guided } })
    const r = keep(await nearby(guided))
    expect(r.buttons(/^COMMENT$/)).toHaveLength(0)
  })

  it('in an opened chest: the key item\'s row has COMMENT beside TAKE', async () => {
    const { found } = await silverKey()
    const revealed = { ...found, chestId: 'chest-1' }
    useShards.setState({ discovered: { [found.eventId]: revealed } })
    const entry = { id: found.eventId, event: found.inner as NostrEvent, verified: true, body: { type: 'key' as const, key: found.key } }
    const r = keep(await mount(createElement(ChestContents, { entries: [entry], from: { chestId: 'chest-1', chestName: 'Box' }, place: { lookupId: found.lookupId, bagId: 'bag-1', at: { x: AT.x.toString(), y: AT.y.toString(), z: AT.z.toString() }, plane: 0, height: HEIGHT, author: HIDER } })))
    expect(r.buttons(/^COMMENT$/)).toHaveLength(1)
    expect(r.buttons(/^TAKE$/)).toHaveLength(1)
    await r.press(/^COMMENT$/)
    await settled(30)
    await post(r, 'in the chest')
    // TAKE: the row it is held under names the same thread.
    await r.press(/^TAKE ALL$/)
    const m = keep(await mineActions())
    await m.press(/^COMMENT$/)
    await settled(30)
    expect(m.says('in the chest')).toBe(true)
  })
})
