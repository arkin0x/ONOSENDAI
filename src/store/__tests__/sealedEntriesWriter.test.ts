/**
 * sealedEntriesWriter.test.ts: ONOSENDAI writes sealed entries (kind 33335,
 * spec §7.6 "Sealed entries", cyberspace #89). A bag full of messages, which
 * before #89 could only refuse, moves its largest entries out as sealed
 * entries and fits; each sealed entry carries only `d`, `encrypted` and `alt`
 * with the fixed preview, no `client` tag, goes out before the bag to a relay
 * its hint names, and reads back as the very item; a door never leaves its
 * bag; contents count what the sealed entries hold; a DELETE empties then
 * deletes the sealed entry it no longer names; a relay that refuses a sealed
 * entry gets no bag; a lock change seals the room's entries again, under the
 * new room key with fresh `d`s, and retracts the old ones. The relay is a mock
 * that keeps what is published and answers by `d`. No network.
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

const relay = vi.hoisted(() => ({
  events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig?: string }>,
  sent: [] as string[],
  refuseKind: -1,
  /** Your relays (relaySet). */
  urls: ['wss://relay.test'],
  /** A relay among them that refuses kind 33335 outright, as relay.onosendai.tech did before it listed it (review of #645, B1). */
  refuseSealedAt: null as string | null,
  /** The relays each event was sent to, by id. */
  sentTo: new Map<string, string[]>(),
}))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; ids?: string[]; '#d'?: string[]; '#a'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')) && (!f['#a'] || e.tags.some((t) => t[0] === 'a' && f['#a']!.includes(t[1]))))
  return {
    // An addressable event replaces its older version, as a relay does; an older one is refused.
    publishMany: vi.fn(async (asked: string[], ev: (typeof relay.events)[number]) => {
      if (relay.refuseKind === ev.kind) return { ok: false, reason: 'blocked: test', refused: true }
      const urls = asked.filter((u) => !(ev.kind === 33335 && relay.refuseSealedAt !== null && u.replace(/\/$/, '') === relay.refuseSealedAt))
      if (urls.length === 0) return { ok: false, reason: 'blocked: kind 33335 is not accepted', refused: true }
      relay.sentTo.set(ev.id, [...(relay.sentTo.get(ev.id) ?? []), ...urls.map((u) => u.replace(/\/$/, ''))])
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (ev.kind >= 30000 && ev.kind < 40000) {
        const was = relay.events.find((e) => e.kind === ev.kind && e.pubkey === ev.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === d)
        if (was && was.created_at > ev.created_at) return { ok: false, reason: 'invalid: older' }
        relay.events = relay.events.filter((e) => e !== was)
      }
      if (!relay.events.includes(ev)) relay.events.push(ev)
      relay.sent.push(ev.id)
      return { ok: true, accepted: urls.map((u) => (u.endsWith('/') ? u : `${u}/`)) }
    }),
    publishRetried: vi.fn(async () => true),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => relay.urls,
  }
})

import { forgeKey } from '../../lib/chests'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { HIDDEN_KIND, MESSAGE_KIND, bagEntries, bagTemplate, readBagContents, rumorOf, unbag, type BagEntry, type KeyItem, type Rumor } from '../../lib/hidden'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import { bagBytes } from '../../lib/bagFit'
import { SEALED_KIND, SEALED_PREVIEW, forgetSealedItems, openSealed } from '../../lib/sealed'
import { roomKey, roomLookupId, ROOM_BAG_SETTINGS } from '../../lib/doors'
import { resolveReference } from '../../lib/references'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { resetOpenedChests } from '../useOpenedChests'
import { forgetSealedState, positionOf, useShards, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a3f0n, y: (1n << 60n) + 0x2a0n, z: (1n << 72n) + 0x7a0n }
const H = 4
type Ev = (typeof relay.events)[number]
const dOf = (e: { tags: string[][] }): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const newestBag = (lookupId: string): Ev => relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === lookupId).sort((a, b) => b.created_at - a.created_at)[0]
const sealedRefs = (entries: BagEntry[]): string[][] => entries.filter((e): e is string[] => Array.isArray(e) && e[1].startsWith(`${SEALED_KIND}:`))

let lock: KeyItem
/** A bag this full takes no ~9.9 KB message inline (ONE_MORE): something must move out. */
const FULL = BAG_SAFE_BYTES - 500
const ONE_MORE = `one more ${'w'.repeat(9_900)}`

async function hideMessage(text: string, h = H, contents = false): Promise<{ row: MyDeployment | undefined; error: string | null }> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployMessage(text)
  S().setDeployHeight(h)
  if (contents) S().setDeployBag({ contents: true })
  await S().deploy()
  const error = S().deployError
  S().cancelDeploy()
  return { row: S().mine.find((d) => !before.has(d.eventId)), error }
}

async function sealDoor(h = H, key: KeyItem = lock): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(h)
  S().placeChest()
  await S().sealPlacedChest({ name: 'Vault', lock: { pubkey: key.itemPubkey, label: key.name }, requires: 'x', contents: [] })
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}

/** Fill the bag at `lookupId` with messages (rumors, ~9 KB) to within 9,500 bytes under `target`, on the relay and as rows. */
async function fill(lookupId: string, key: Uint8Array, at: Position, height: number, target: number, room?: { doorId: string }): Promise<void> {
  const settings = room ? ROOM_BAG_SETTINGS : S().mine.find((d) => d.lookupId === lookupId)?.bag ?? { ...S().deployBag }
  const standing = newestBag(lookupId)
  const entries: BagEntry[] = standing ? await bagEntries(standing as NostrEvent, key) : []
  const C_TAG = S().mine.find((d) => d.lookupId === lookupId)?.inner.tags.find((t) => t[0] === 'C') ?? ['C', '']
  const now = Math.floor(Date.now() / 1000)
  const rumors: Rumor[] = []
  const message = (chars: number): Rumor => rumorOf({ kind: MESSAGE_KIND, created_at: now - 100 + rumors.length, content: `${rumors.length} ${'m'.repeat(chars)}`, tags: [C_TAG, ['-']] }, me())
  while (bagBytes(entries, lookupId, height, settings) < target - 9_500) { const r = message(9_000); rumors.push(r); entries.push(r) }
  const like = S().mine.find((d) => d.lookupId === lookupId)
  const plane = like?.plane ?? 0
  const bag = await C().signEvent(await bagTemplate(entries, key, lookupId, height, (standing?.created_at ?? now) + 5, HIDDEN_KIND, settings, { at, plane }))
  relay.events.push(bag as Ev)
  const rows: MyDeployment[] = rumors.map((r) => ({ eventId: r.id, inner: r, bagId: bag.id, bagAt: bag.created_at, type: 'message', text: r.content, at: like?.at ?? { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() }, plane, height, lookupId, keyHex: bytesToHex(key), relays: ['wss://relay.test'], createdAt: r.created_at, published: true, bag: settings, ...(room ? { room } : {}) }))
  useShards.setState({ mine: [...S().mine.map((d) => (d.lookupId === lookupId ? { ...d, bagId: bag.id, bagAt: bag.created_at } : d)), ...rows] })
}

function roomOf(door: MyDeployment): { key: Uint8Array; lookupId: string } {
  const key = roomKey(hexToBytes(door.keyHex), hexToBytes(doorSecret(me(), door.eventId)!))
  return { key, lookupId: roomLookupId(key) }
}

beforeEach(() => {
  forgetSealedState()
  forgetSealedItems()
  relay.events = []
  relay.sent = []
  relay.refuseKind = -1
  relay.urls = ['wss://relay.test']
  relay.refuseSealedAt = null
  relay.sentTo = new Map()
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a full bag moves entries out as sealed entries (spec §7.6 Size)', () => {
  it('a bag full of messages takes one more: the largest goes out as a 33335 that says nothing, before the bag, and every message reads by its own id', async () => {
    const { row: first } = await hideMessage('first', H, true)
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    const sent = relay.sent.length
    const { row, error } = await hideMessage(ONE_MORE)
    expect(error).toBeNull()
    expect(row).toBeDefined()
    const bag = newestBag(first!.lookupId)
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const entries = await bagEntries(bag as NostrEvent, key)
    const refs = sealedRefs(entries)
    expect(refs.length).toBeGreaterThan(0)
    // Each sealed entry: published before the bag, with only d, encrypted, alt, the preview, and no client tag.
    const out = relay.events.filter((e) => relay.sent.slice(sent).includes(e.id) && e.kind === SEALED_KIND)
    expect(out).toHaveLength(refs.length)
    for (const e of out) {
      expect(relay.sent.indexOf(e.id)).toBeLessThan(relay.sent.indexOf(bag.id))
      expect(e.content).toBe(SEALED_PREVIEW)
      expect(e.tags.map((t) => t[0])).toEqual(['d', 'encrypted', 'alt'])
      expect(dOf(e)).toMatch(/^[0-9a-f]{32}$/)
      expect(e.tags[1].slice(0, 2)).toEqual(['encrypted', 'aes-256-gcm'])
      expect(e.tags[1][3]).toBe('cyberspace:region')
      expect(e.tags[2]).toEqual(['alt', SEALED_PREVIEW])
      expect(e.tags.some((t) => t[0] === 'client')).toBe(false)
    }
    expect(new Set(out.map(dOf)).size).toBe(out.length)
    // The reference names its address, a relay that took it, and the item's own C; the payload is the item, byte for byte.
    for (const ref of refs) {
      const ev = out.find((e) => ref[1] === `${SEALED_KIND}:${me()}:${dOf(e)}`)!
      expect(ref[2]).toBe('')
      const item = JSON.parse((await openSealed(ev, key))!) as Rumor
      expect(ref[3]).toBe(item.tags.find((t) => t[0] === 'C')![1])
      expect(item.kind).toBe(MESSAGE_KIND)
      expect(item.sig).toBeUndefined()
      expect(item.tags).toContainEqual(['-'])
      // The row of that message now names the sealed entry, and keeps its own id.
      const r = S().mine.find((d) => d.eventId === item.id)!
      expect(r.sealedRef?.[1]).toBe(ref[1])
      expect(r.sealedEvent?.id).toBe(ev.id)
    }
    // A reader finds every message, by its own id, inline or sealed.
    const found = await unbag(bag as NostrEvent, key, resolveReference, undefined, H)
    const messages = S().mine.filter((d) => d.type === 'message')
    expect(found.map((h) => h.eventId).sort()).toEqual(messages.map((d) => d.eventId).sort())
    // Contents count the messages in sealed entries too (§7.7).
    expect(readBagContents(bag.tags).counts?.message).toBe(String(messages.length))
  }, 60000)

  it('a door never leaves its bag, however full', async () => {
    const door = await sealDoor()
    const key = hexToBytes(door.keyHex)
    await fill(door.lookupId, key, positionOf(door), H, FULL)
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    const entries = await bagEntries(newestBag(door.lookupId) as NostrEvent, key)
    expect(entries.some((e) => !Array.isArray(e) && e.id === door.eventId)).toBe(true)
    for (const ref of sealedRefs(entries)) {
      const ev = relay.events.find((e) => e.kind === SEALED_KIND && ref[1].endsWith(`:${dOf(e)}`))!
      const item = JSON.parse((await openSealed(ev, key))!) as Rumor
      expect(item.tags.some((t) => t[0] === 'door')).toBe(false)
    }
    expect(S().mine.find((d) => d.eventId === door.eventId)?.sealedRef).toBeUndefined()
  }, 60000)

  it('a relay that refuses the sealed entry gets no bag, and nothing is hidden', async () => {
    const { row: first } = await hideMessage('first')
    await fill(first!.lookupId, hexToBytes(first!.keyHex), positionOf(first!), H, FULL)
    const was = newestBag(first!.lookupId)
    relay.refuseKind = SEALED_KIND
    const { row } = await hideMessage(ONE_MORE)
    relay.refuseKind = -1
    // No relay holds the bag: the hide stays on this device, unpublished, as any hide no relay took.
    expect(row?.published).toBe(false)
    expect(newestBag(first!.lookupId).id).toBe(was.id)
    // Nothing went out naming an entry no relay has; and no row names a sealed entry that never went out.
    expect(relay.events.some((e) => e.kind === SEALED_KIND)).toBe(false)
    expect(S().mine.some((d) => d.sealedRef)).toBe(false)
  }, 60000)
})

describe('retracting a sealed entry (spec §7.6 Retracting)', () => {
  it('DELETE of a sealed message: the bag without it, then the sealed entry emptied, then its deletion naming both events', async () => {
    const { row: first } = await hideMessage('first')
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    const sealed = S().mine.find((d) => d.sealedRef)!
    expect(sealed).toBeDefined()
    const address = sealed.sealedRef![1]
    const ciphertext = sealed.sealedEvent!
    const sent = relay.sent.length
    await S().deleteInstance(sealed.eventId)
    const bag = newestBag(first!.lookupId)
    expect(sealedRefs(await bagEntries(bag as NostrEvent, key)).some((r) => r[1] === address)).toBe(false)
    const after = relay.sent.slice(sent).map((id) => relay.events.find((e) => e.id === id)!).filter(Boolean)
    const emptied = after.find((e) => e.kind === SEALED_KIND && `${SEALED_KIND}:${e.pubkey}:${dOf(e)}` === address)!
    const deletion = after.find((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === address))!
    // Emptied: only its d, empty content, no encrypted tag, newer than the ciphertext.
    expect(emptied.tags).toEqual([['d', dOf(ciphertext)]])
    expect(emptied.content).toBe('')
    expect(emptied.created_at).toBeGreaterThan(ciphertext.created_at)
    // The deletion: the address, an e for each event, and k.
    expect(deletion.tags).toContainEqual(['e', ciphertext.id])
    expect(deletion.tags).toContainEqual(['e', emptied.id])
    expect(deletion.tags).toContainEqual(['k', String(SEALED_KIND)])
    // In that order, and only once the bag that no longer names it is out.
    const order = [bag.id, emptied.id, deletion.id].map((id) => relay.sent.indexOf(id))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The relay now holds the emptied event at the address: a reader finds a missing entry, not the message.
    expect(relay.events.filter((e) => e.kind === SEALED_KIND && dOf(e) === dOf(ciphertext)).map((e) => e.id)).toEqual([emptied.id])
  }, 60000)
})

describe('changing a door’s lock (DECK-0004 §3.7.7)', () => {
  it('re-seals every sealed entry under the new room key with a fresh d, never in place, and retracts the old ones', async () => {
    const door = await sealDoor()
    const room = roomOf(door)
    expect((await hideMessage('behind')).error).toBeNull()
    await fill(room.lookupId, room.key, positionOf(door), H, FULL, { doorId: door.eventId })
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    const oldSealed = S().mine.filter((d) => d.room && d.sealedRef)
    expect(oldSealed.length).toBeGreaterThan(0)
    const oldAddresses = new Set(oldSealed.map((d) => d.sealedRef![1]))
    const ids = S().mine.filter((d) => d.room).map((d) => d.eventId).sort()
    const next = forgeKey('Gold Key')
    expect(await S().resealDoor(door.eventId, { name: 'Vault', requires: 'x', lock: { pubkey: next.itemPubkey, label: next.name } })).toBeNull()
    const newDoor = S().mine.find((d) => d.chest?.door !== undefined)!
    expect(newDoor.eventId).not.toBe(door.eventId)
    const nextRoom = roomOf(newDoor)
    expect(nextRoom.lookupId).not.toBe(room.lookupId)
    const bag = newestBag(nextRoom.lookupId)
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const refs = sealedRefs(await bagEntries(bag as NostrEvent, nextRoom.key))
    expect(refs.length).toBeGreaterThan(0)
    // New addresses only: nothing re-sealed at an old one.
    for (const r of refs) expect(oldAddresses.has(r[1])).toBe(false)
    // Each opens with the new room key, and not with the old one.
    for (const r of refs) {
      const ev = relay.events.find((e) => e.kind === SEALED_KIND && r[1].endsWith(`:${dOf(e)}`))!
      expect(await openSealed(ev, nextRoom.key)).not.toBeNull()
      expect(await openSealed(ev, room.key)).toBeNull()
    }
    // The new room reads as the old one did: the same items, by their own ids.
    const found = await unbag(bag as NostrEvent, nextRoom.key, resolveReference, undefined, H, undefined, { doorId: newDoor.eventId })
    expect(found.map((h) => h.eventId).sort()).toEqual(ids)
    // The old sealed entries are emptied (and deletion requested): no ciphertext left at an old address.
    for (const address of oldAddresses) {
      const d = address.split(':')[2]
      const at = relay.events.filter((e) => e.kind === SEALED_KIND && dOf(e) === d)
      expect(at).toHaveLength(1)
      expect(at[0].tags).toEqual([['d', d]])
      expect(relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === address))).toBe(true)
    }
  }, 120000)
})

describe('contents (§7.7) and carrying forward', () => {
  it('a rewrite from another device reads the sealed entries, counts them by their items, and keeps them sealed', async () => {
    const { row: first } = await hideMessage('first', H, true)
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    const refsBefore = sealedRefs(await bagEntries(newestBag(first!.lookupId) as NostrEvent, key))
    // This device forgets its rows' sealed state, as another device would never have had it.
    useShards.setState({ mine: S().mine.map((d) => { const { sealedRef: _r, sealedEvent: _e, ...rest } = d; void _r; void _e; return rest }) })
    expect((await hideMessage('small')).error).toBeNull()
    const bag = newestBag(first!.lookupId)
    const entries = await bagEntries(bag as NostrEvent, key)
    // The sealed entries stay referenced, never back inline beside themselves.
    for (const r of refsBefore) expect(entries.filter((e) => Array.isArray(e) && e[1] === r[1])).toHaveLength(1)
    const found = await unbag(bag as NostrEvent, key, resolveReference, undefined, H)
    expect(new Set(found.map((h) => h.eventId)).size).toBe(found.length)
    const messages = S().mine.filter((d) => d.type === 'message')
    expect(found).toHaveLength(messages.length)
    expect(readBagContents(bag.tags).counts?.message).toBe(String(messages.length))
    // And the rows took their sealed state back from the relays' copy.
    expect(S().mine.filter((d) => d.sealedRef).length).toBeGreaterThanOrEqual(refsBefore.length)
  }, 60000)
})

/** Every sealed entry this bag names, as an address, is on the relay holding ciphertext. */
function missingSealed(entries: BagEntry[]): string[][] {
  return sealedRefs(entries).filter((r) => !relay.events.some((e) => e.kind === SEALED_KIND && `${SEALED_KIND}:${e.pubkey}:${dOf(e)}` === r[1] && e.tags.some((t) => t[0] === 'encrypted')))
}

describe('review of #645', () => {
  it('B1: the first relay refuses kind 33335, the second takes it: the write still goes, and the bag goes only where its entries went', async () => {
    relay.urls = ['wss://first.test', 'wss://second.test']
    const { row: first } = await hideMessage('first')
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    relay.refuseSealedAt = 'wss://first.test'
    const { row, error } = await hideMessage(ONE_MORE)
    expect(error).toBeNull()
    expect(row?.published).toBe(true)
    const bag = newestBag(first!.lookupId)
    const refs = sealedRefs(await bagEntries(bag as NostrEvent, key))
    expect(refs.length).toBeGreaterThan(0)
    // No hint: no single relay has to take every sealed entry.
    for (const r of refs) expect(r[2]).toBe('')
    expect(relay.sentTo.get(bag.id)).toEqual(['wss://second.test'])
  }, 60000)

  it('B2: an entry sealed while LOCAL goes out before the bag on the next LIVE write to that bag', async () => {
    const { row: first } = await hideMessage('first', H, true)
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    // LOCAL: the overflow seals, and nothing is sent.
    useCyberspace.setState({ live: false })
    const sentBefore = relay.sent.length
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    expect(relay.sent.length).toBe(sentBefore)
    expect(S().mine.some((d) => d.sealedRef && d.published === false)).toBe(true)
    // LIVE again: a small hide in the same bag.
    useCyberspace.setState({ live: true })
    expect((await hideMessage('small one after going live')).error).toBeNull()
    const bag = newestBag(first!.lookupId)
    const entries = await bagEntries(bag as NostrEvent, key)
    expect(sealedRefs(entries).length).toBeGreaterThan(0)
    expect(missingSealed(entries)).toEqual([])
    const found = await unbag(bag as NostrEvent, key, resolveReference, undefined, H)
    expect(found.some((h) => h.text?.startsWith('one more'))).toBe(true)
  }, 60000)

  it('should-fix 2: a signer that refuses the bag after its sealed entries leaves no row naming a sealed entry, then or on the next write', async () => {
    const { row: first } = await hideMessage('first')
    const key = hexToBytes(first!.keyHex)
    await fill(first!.lookupId, key, positionOf(first!), H, FULL)
    const sign = C().signEvent
    useCyberspace.setState({ signEvent: async (t, ...rest) => { if (t.kind === HIDDEN_KIND) throw new Error('The signer refused.'); return sign(t, ...rest) } })
    // Smaller than the messages already there: one of those (a row of yours) is what moves out.
    const { error } = await hideMessage(`medium ${'w'.repeat(3_000)}`)
    useCyberspace.setState({ signEvent: sign })
    expect(error).not.toBeNull()
    expect(S().mine.some((d) => d.sealedRef)).toBe(false)
    // The next write commits rows: none takes on the entries the refused bag would have named.
    expect((await hideMessage('small')).error).toBeNull()
    const bag = newestBag(first!.lookupId)
    const named = new Set(sealedRefs(await bagEntries(bag as NostrEvent, key)).map((r) => r[1]))
    for (const d of S().mine.filter((m) => m.sealedRef)) expect(named.has(d.sealedRef![1])).toBe(true)
    expect(missingSealed(await bagEntries(bag as NostrEvent, key))).toEqual([])
  }, 60000)

  it('should-fix 3: a lock change retracts a sealed entry the old room bag names, though this device deleted its row', async () => {
    const door = await sealDoor()
    const room = roomOf(door)
    expect((await hideMessage('behind')).error).toBeNull()
    await fill(room.lookupId, room.key, positionOf(door), H, FULL, { doorId: door.eventId })
    expect((await hideMessage(ONE_MORE)).error).toBeNull()
    const gone = S().mine.find((d) => d.room && d.sealedRef)!
    expect(gone).toBeDefined()
    const address = gone.sealedRef![1]
    // Deleted on this device, and no relay took the rewrite: the old room bag still names it.
    useShards.setState({ mine: S().mine.filter((d) => d.eventId !== gone.eventId), deleted: { ...S().deleted, [gone.eventId]: true } })
    expect(sealedRefs(await bagEntries(newestBag(room.lookupId) as NostrEvent, room.key)).some((r) => r[1] === address)).toBe(true)
    const next = forgeKey('Gold Key')
    expect(await S().resealDoor(door.eventId, { name: 'Vault', requires: 'x', lock: { pubkey: next.itemPubkey, label: next.name } })).toBeNull()
    // No ciphertext is left at its address for the old room key to open.
    const d = address.split(':')[2]
    const at = relay.events.filter((e) => e.kind === SEALED_KIND && dOf(e) === d)
    expect(at).toHaveLength(1)
    expect(at[0].tags).toEqual([['d', d]])
  }, 120000)
})
