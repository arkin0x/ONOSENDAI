/**
 * takeAndMetadata.test.tsx: TAKE where things are found and in a chest, and
 * METADATA on the card, rendered (arkinox, 2026-10-26).
 *
 * "i want to TAKE them": a found keypair item shows TAKE until it is held,
 * then IN YOUR ITEMS. "TAKE on each row. make the take button bigger. add a
 * TAKE ALL at the bottom of the list.": every row of an opened chest, the
 * item among them too, has the bigger TAKE, and TAKE ALL closes the list,
 * off once everything is held. "Collapse all the technical info on the
 * chest, door, and shard modal under a "METADATA" accordion.": the shard
 * card and the chest card show their name and actions, and the geometry,
 * facts and event data only once METADATA is open. Rendered to a string,
 * with each store's initial state brought up to date first (wireData.test).
 */

import { renderToStaticMarkup } from 'react-dom/server'
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'
import { newShard } from 'sno-core/shards'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { sealEntries, type ChestEntry } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, shardInnerTemplate, type ChestItem, type Hidden, type KeyItem } from '../../lib/hidden'
import { heldFromEntry, heldFromPasted, type HeldItem } from '../../lib/inventory'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { ChestContents, KeyLine, listedOnce, openChestHere, takeableOf } from '../ItemRows'
import { openedByHand, resetOpenedChests, useOpenedChests } from '../../store/useOpenedChests'
import { metadataOpen } from '../Metadata'
import { SecretModal } from '../SecretModal'

const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }
const T0 = 1_800_000_000
const from = { chestId: 'c'.repeat(64), chestName: 'Strongbox' }

function keyIn(name: string): { key: KeyItem; event: NostrEvent } {
  const sk = generateSecretKey()
  const key: KeyItem = { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
  return { key, event: finalizeEvent(keyInnerTemplate(key, at, 0, T0), hider) as NostrEvent }
}

function find(event: NostrEvent, body: Partial<Hidden>): Hidden {
  return { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: event.created_at, ...body } as Hidden
}

function render(el: JSX.Element): string {
  for (const store of [useShards, useInventory, useCyberspace] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(el)
}

/** The bigger TAKE buttons and their words, in order. */
const takes = (html: string): string[] => [...html.matchAll(/<button class="chest__act chest__act--take[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  localStorage.removeItem('onosendai:metadataOpen')
})

describe('a found keypair item', () => {
  it('shows TAKE, the bigger one, until it is held, then IN YOUR ITEMS', () => {
    const { key, event } = keyIn('Wind Key')
    useShards.setState({ discovered: { [event.id]: find(event, { type: 'key', key }) } })
    const before = render(<KeyLine id={event.id} name="Wind Key" author={event.pubkey} />)
    expect(takes(before)).toEqual(['TAKE'])
    expect(before).not.toContain('IN YOUR ITEMS')
    const row = heldFromPasted(useCyberspace.getState().identity.pubkey, event, key, true, 1)
    useInventory.setState({ items: { [row.id]: row } })
    const after = render(<KeyLine id={event.id} name="Wind Key" author={event.pubkey} />)
    expect(takes(after)).toEqual([])
    expect(after).toContain('IN YOUR ITEMS')
  })

  it('offers no TAKE for one that is not among this device\'s finds', () => {
    const { event } = keyIn('Own Key')
    expect(takes(render(<KeyLine id={event.id} name="Own Key" author={event.pubkey} />))).toEqual([])
  })
})

describe('an opened chest\'s rows', () => {
  const shard = { ...newShard('Column'), id: '' }
  const s = finalizeEvent(shardInnerTemplate({ ...shard, name: 'Column' }, at, 0, T0), hider) as NostrEvent
  const note = finalizeEvent(messageInnerTemplate('inside', at, 0, T0), hider) as NostrEvent
  const k = keyIn('Inside Key')
  const entries: ChestEntry[] = [
    { id: s.id, event: s, verified: true, body: { type: 'shard', shard: { ...shard, name: 'Column' } } },
    { id: note.id, event: note, verified: true, body: { type: 'message', text: 'inside' } },
    { id: k.event.id, event: k.event, verified: true, body: { type: 'key', key: k.key } },
  ]

  it('have TAKE on every row, the item too, and TAKE ALL at the bottom', () => {
    const html = render(<ChestContents entries={entries} from={from} place={null} />)
    expect(takes(html)).toEqual(['TAKE', 'TAKE', 'TAKE', 'TAKE ALL'])
    expect(html).not.toContain('IN YOUR ITEMS')
    expect(html).not.toMatch(/disabled=""[^>]*>TAKE ALL/)
    expect(html.lastIndexOf('chest__all')).toBeGreaterThan(html.lastIndexOf('chest__row'))
  })

  it('read TAKEN once held, and TAKE ALL is off with nothing left to take', () => {
    const owner = useCyberspace.getState().identity.pubkey
    const items: Record<string, HeldItem> = {}
    for (const e of entries) items[e.id] = heldFromEntry(owner, e, from, null, 1)
    useInventory.setState({ items })
    expect(takeableOf(entries, items)).toEqual([])
    const html = render(<ChestContents entries={entries} from={from} place={null} />)
    expect(takes(html)).toEqual(['TAKEN', 'TAKEN', 'TAKEN', 'TAKE ALL'])
    expect(html).toMatch(/disabled=""[^>]*>TAKE ALL/)
  })
})

describe('OPEN and TAKE on a chest (review of #519)', () => {
  const placeAt = { lookupId: 'lookup', bagId: 'bag', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

  it('OPEN holds nothing: what is inside is found in place and waits for TAKE', async () => {
    const lock = keyIn('Boss Key')
    const inner = keyIn('Fire Key')
    const words = finalizeEvent(messageInnerTemplate('inside', at, 0, T0), hider) as NostrEvent
    const sealed = sealEntries([inner.event, words], lock.key.itemPubkey)
    const chest: ChestItem = { name: 'Strongbox', lockPubkey: lock.key.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    const contents = await openChestHere({ id: 'd'.repeat(64), chest, author: getPublicKey(hider), place: placeAt, sealer: getPublicKey(hider) }, { by: 'key', key: { id: lock.event.id, itemPubkey: lock.key.itemPubkey, secretHex: lock.key.secretHex } })
    expect(contents?.map((e) => e.id).sort()).toEqual([inner.event.id, words.id].sort())
    expect(useInventory.getState().items).toEqual({})
    expect(useShards.getState().discovered[inner.event.id]?.chestId).toBe('d'.repeat(64))
    const me = useCyberspace.getState().identity.pubkey
    expect(useOpenedChests.getState().opened[`${me}/${'d'.repeat(64)}`]).toHaveLength(2)
    // Opened by hand: kept, so a reload opens it again.
    expect(openedByHand(me, 'd'.repeat(64))).toBe(true)
  })

  it('keeps nothing and finds nothing when the identity changes while the signer decrypts (re-review of #519)', async () => {
    const lockSk = generateSecretKey()
    const words = finalizeEvent(messageInnerTemplate('for A only', at, 0, T0), hider) as NostrEvent
    const sealed = sealEntries([words], getPublicKey(lockSk))
    const chest: ChestItem = { name: 'Sealed to A', lockPubkey: getPublicKey(lockSk), senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    const was = useCyberspace.getState()
    const other = getPublicKey(generateSecretKey())
    try {
      useCyberspace.setState({
        decryptSealed: async (sender: string, payload: string) => {
          // The switch lands while the signer is still answering.
          useCyberspace.setState({ identity: { ...was.identity, pubkey: other } })
          return nip44.decrypt(payload, nip44.getConversationKey(lockSk, sender))
        },
      })
      const contents = await openChestHere({ id: 'e'.repeat(64), chest, author: getPublicKey(hider), place: placeAt, sealer: getPublicKey(hider) }, { by: 'self' })
      expect(contents).toBeNull()
      expect(useShards.getState().discovered[words.id]).toBeUndefined()
      expect(useOpenedChests.getState().opened).toEqual({})
      expect(openedByHand(was.identity.pubkey, 'e'.repeat(64))).toBe(false)
      expect(openedByHand(other, 'e'.repeat(64))).toBe(false)
      expect(useInventory.getState().items).toEqual({})
    } finally {
      useCyberspace.setState({ identity: was.identity, decryptSealed: was.decryptSealed })
    }
  })

  it('TAKE of an item on a chest\'s row leaves the chest it opens closed, for OPEN (arkinox, 2026-10-26)', () => {
    const k = keyIn('Gate Key')
    const behind = finalizeEvent(messageInnerTemplate('the room', at, 0, T0), hider) as NostrEvent
    const sealed = sealEntries([behind], k.key.itemPubkey)
    const item: ChestItem = { name: 'Gate', lockPubkey: k.key.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    const gate = finalizeEvent(chestInnerTemplate(item, at, 0, T0), hider) as NostrEvent
    useShards.getState().addDiscovered([find(gate, { type: 'chest', chest: chestItemOf(gate)! })])
    expect(useShards.getState().discovered[behind.id]).toBeUndefined()
    useInventory.getState().take([{ id: k.event.id, event: k.event, verified: true, body: { type: 'key', key: k.key } }], from, null)
    expect(useInventory.getState().items[k.event.id]).toBeDefined()
    expect(useShards.getState().discovered[behind.id]).toBeUndefined()
    expect(openedByHand(useCyberspace.getState().identity.pubkey, gate.id)).toBe(false)
  })

  it('lists a thing out of a chest once: under the chest while it is open in the same list, else on its own', () => {
    const rows = [{ id: 'c', type: 'chest' }, { id: 'k', type: 'key', chestId: 'c' }, { id: 'm', type: 'message', chestId: 'elsewhere' }, { id: 'n', type: 'message' }]
    const ids = (open: (c: string) => boolean): string[] => listedOnce(rows, (r) => r.id, open).map((r) => r.id)
    expect(ids(() => false)).toEqual(['c', 'k', 'm', 'n'])
    expect(ids((c) => c === 'c' || c === 'elsewhere')).toEqual(['c', 'm', 'n'])
  })
})

describe('METADATA on the card', () => {
  function chestFind(): Hidden {
    const lock = keyIn('Wind Key')
    const sealed = sealEntries([note()], lock.key.itemPubkey)
    const item: ChestItem = { name: 'Wind Chest', lockPubkey: lock.key.itemPubkey, senderPubkey: sealed.senderPubkey, requires: 'the Wind Key', payload: sealed.payload }
    const event = finalizeEvent(chestInnerTemplate(item, at, 0, T0), hider) as NostrEvent
    return find(event, { type: 'chest', chest: chestItemOf(event)! })
  }
  const note = (): NostrEvent => finalizeEvent(messageInnerTemplate('behind it', at, 0, T0), hider) as NostrEvent
  const technical = ['aria-label="Event data"', 'class="secret__facts"', 'eventdata__json']

  it('is closed by default on the chest card: its name, what it requires and the actions show, the technical facts do not', () => {
    const h = chestFind()
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    expect(metadataOpen()).toBe(false)
    const html = render(<SecretModal />)
    expect(html).toContain('Wind Chest')
    expect(html).toContain('REQUIRES: the Wind Key')
    expect(html).toContain('secret__actions')
    expect(html).toMatch(/aria-expanded="false"[^>]*>METADATA/)
    for (const t of technical) expect(html).not.toContain(t)
    expect(html).not.toContain(h.eventId)
  })

  it('holds every technical fact once open, under the actions, remembered on this device', () => {
    const h = chestFind()
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    localStorage.setItem('onosendai:metadataOpen', '1')
    expect(metadataOpen()).toBe(true)
    const html = render(<SecretModal />)
    expect(html).toMatch(/aria-expanded="true"[^>]*>METADATA/)
    for (const t of technical) expect(html).toContain(t)
    expect(html).toContain(h.eventId)
    expect(html.indexOf('aria-label="Metadata"')).toBeGreaterThan(html.indexOf('secret__actions'))
  })

  it('folds a shard\'s geometry with the rest, and keeps its name in view', () => {
    const shard = { ...newShard('Column'), id: '' }
    const event = finalizeEvent(shardInnerTemplate({ ...shard, name: 'Column' }, at, 0, T0), hider) as NostrEvent
    const h = find(event, { type: 'shard', shard: { ...shard, name: 'Column' } })
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    const closed = render(<SecretModal />)
    expect(closed).toContain('secret__shard-name">Column<')
    expect(closed).not.toContain('secret__shard-meta')
    localStorage.setItem('onosendai:metadataOpen', '1')
    const open = render(<SecretModal />)
    expect(open).toContain('secret__shard-meta')
    expect(open.indexOf('secret__shard-meta')).toBeGreaterThan(open.indexOf('aria-label="Metadata"'))
  })
})
