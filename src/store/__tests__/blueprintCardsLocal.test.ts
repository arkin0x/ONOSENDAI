/**
 * blueprintCardsLocal.test.ts: the same as blueprintCards.test.ts with
 * BLUEPRINT_RELAY_READY set false (records and cards kept on this device), so
 * the switch stays honest both ways; and a card refused, in words, where your
 * things are already on the relays (review of #943, 2026-11-27).
 *
 * blueprintCards.test.ts's own header: blueprint cards in the hide-and-find machinery
 * (DECK-0010 §7). A card is a kind 3343 item signed by its placer, whose
 * content is the creator's whole signed record: it reads only when that
 * record passes §5.4 with its signature, it counts as `blueprint` after
 * `dna`, it goes into a bag or a chest LOCAL only until blueprints go live
 * (no relay is ever sent a bag that carries one), and taking it copies the
 * record into BLUEPRINTS with who left it, removing nothing. Relays are
 * mocked; nothing touches the network.
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

vi.mock('../../lib/blueprint/format', async (orig) => ({ ...(await orig<typeof import('../../lib/blueprint/format')>()), BLUEPRINT_RELAY_READY: false }))

const sent: Array<{ kind: number }> = []
vi.mock('../../lib/relay', async () => ({
  ...(await import('../../test/offlineRelay')).offlineRelay,
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number }) => { sent.push(ev); return { ok: true, accepted: ['wss://relay.test'] } }),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { publishMany } from '../../lib/relay'
import type { NostrEvent } from '../../lib/events'
import { BLUEPRINT_RELAY_READY, recordTemplate, sheetShape, type Arrangement } from '../../lib/blueprint/format'
import type { BlueprintCard } from '../../lib/blueprint/blueprintDb'
import {
  BLUEPRINT_KIND, CHEST_KIND, CONTENTS_KINDS, HIDDEN_KIND, bagContents, bagContentsTags, blueprintInnerTemplate, hiddenLabel, readItem, type Hidden,
} from '../../lib/hidden'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { lootOf } from '../../lib/lootObjects'
import { holdsEntry } from '../../lib/inventory'
import { takeContents } from '../../hud/ItemRows'
import { startPlaceBlueprint } from '../../lib/blueprint/place'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useBlueprints } from '../useBlueprints'
import { CARDS_LIVE_BAG, CARDS_LOCAL_NOTE, cardsStayLocal, forgetCardMemory, useShards } from '../useShards'

const S = () => useShards.getState()
const B = () => useBlueprints.getState()

const creatorKey = generateSecretKey()
const creator = getPublicKey(creatorKey)
const placerKey = generateSecretKey()
const placer = getPublicKey(placerKey)

/** A plus of Gridstone around a Ferrovein: the Compiler's base layer, every block revealed but one. */
const ARRANGEMENT: Arrangement = { size: [3, 1, 3], cells: Uint16Array.from([0, 1, 0, 1, 40, 1, 0, 1, 0]) }

function signedRecord(title = 'Ferro Plus'): NostrEvent {
  const shape = sheetShape(ARRANGEMENT, (i) => i !== 4)
  const t = recordTemplate({ lookup: 'ab'.repeat(32), sheet: { ...shape, lock: 'standard', prize: { reveal: 'description', text: 'A small lamp.' } }, sealed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', title, createdAt: 1_790_000_000 })
  return finalizeEvent(t, creatorKey) as unknown as NostrEvent
}

function signedCard(record: NostrEvent, key: Uint8Array = placerKey): NostrEvent {
  return finalizeEvent(blueprintInnerTemplate(record, { x: 5n, y: 6n, z: 7n }, 0, 1_790_000_100), key) as unknown as NostrEvent
}

function cardOf(record: NostrEvent): BlueprintCard {
  return { rowKey: `me/${record.id}`, owner: 'me', lookup: 'ab'.repeat(32), record, source: 'found', at: 1 }
}

beforeEach(() => {
  sent.length = 0
  vi.mocked(publishMany).mockClear()
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, placedLast: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  useBlueprints.setState({ owner: useCyberspace.getState().identity.pubkey, cards: [], fresh: new Set() })
  useCyberspace.setState({ live: true })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('reading a card (DECK-0010 §7.2)', () => {
  it('reads a card whose record passes §5.4 with its signature: the record unchanged, its title', () => {
    const record = signedRecord()
    const card = signedCard(record)
    expect(card.kind).toBe(BLUEPRINT_KIND)
    expect(card.tags).toContainEqual(['-'])
    expect(card.tags.some((t) => t[0] === 'C')).toBe(true)
    const body = readItem(card, placer)
    expect(body?.type).toBe('blueprint')
    expect(body?.blueprint?.title).toBe('Ferro Plus')
    expect(body?.blueprint?.record).toEqual(record)
    expect(body?.blueprint?.record.pubkey).toBe(creator)
    expect(hiddenLabel(body!)).toBe('Ferro Plus')
  })

  it('drops a card whose record was altered after its creator signed it', () => {
    const record = signedRecord()
    const tampered = { ...record, tags: record.tags.map((t) => (t[0] === 'title' ? ['title', 'Stolen'] : t)) }
    expect(readItem(signedCard(tampered), placer)).toBeNull()
    // Re-signed by someone else under the creator's pubkey: still not the creator's.
    const forged = { ...finalizeEvent({ kind: record.kind, created_at: record.created_at, tags: record.tags, content: record.content }, placerKey), pubkey: creator } as unknown as NostrEvent
    expect(readItem(signedCard(forged), placer)).toBeNull()
    // A card whose content is not a record at all.
    expect(readItem({ ...signedCard(record), content: '{"nope":1}' }, placer)).toBeNull()
  })
})

describe('contents (DECK-0010 §7.6)', () => {
  it('counts a card as `blueprint`, written after `dna`, a chest\'s cards included', () => {
    expect(CONTENTS_KINDS.slice(-2)).toEqual(['dna', 'blueprint'])
    const card = signedCard(signedRecord())
    const chest = { id: 'c'.repeat(64), pubkey: placer, created_at: 1, kind: CHEST_KIND, tags: [['C', '0'.repeat(64)]], content: 'x', sig: '' }
    expect(bagContents([card]).blueprint).toBe(1)
    expect(bagContents([card, chest], undefined, new Map([[chest.id, 2]])).blueprint).toBe(3)
    expect(bagContents([card, chest], undefined, new Map([[chest.id, 2]])).chest).toBe(1)
    expect(bagContentsTags([card], { contents: true, money: false })).toEqual([['contents', 'blueprint', '1']])
  })
})

describe('placing a card stays LOCAL until blueprints go live', () => {
  it('is gated', () => {
    expect(BLUEPRINT_RELAY_READY).toBe(false)
    expect(cardsStayLocal({ type: 'blueprint', card: cardOf(signedRecord()) })).toBe(true)
    expect(cardsStayLocal({ type: 'message', text: 'hi' })).toBe(false)
    expect(CARDS_LOCAL_NOTE).toBe('Kept on this device until blueprints go live.')
  })

  it('a card left here is a kind 3343 signed by you, the record unchanged, and no relay is sent anything, LIVE as the app is', async () => {
    const record = signedRecord()
    expect(startPlaceBlueprint(cardOf(record), 'here')).toBeNull()
    expect(S().pending?.type).toBe('blueprint')
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    expect(publishMany).not.toHaveBeenCalled()
    const d = S().mine.find((x) => x.type === 'blueprint')!
    expect(d.published).toBe(false)
    expect(d.inner.kind).toBe(BLUEPRINT_KIND)
    expect(d.inner.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect(verifyEvent(d.inner as NostrEvent)).toBe(true)
    expect(JSON.parse(d.inner.content)).toEqual(JSON.parse(JSON.stringify(record)))
    expect(d.blueprint?.title).toBe('Ferro Plus')
    // The world draws it, with its record, and its placer is you.
    const w = S().worldItems().find((x) => x.key === d.eventId)!
    expect(w.type).toBe('blueprint')
    expect(w.blueprint?.record.id).toBe(record.id)
  })

  it('a later LIVE hide into the same bag keeps the bag on this device too', async () => {
    S().startDeployBlueprint(cardOf(signedRecord()))
    await S().deploy()
    S().startDeployMessage('beside the card')
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(sent.filter((e) => e.kind === HIDDEN_KIND)).toHaveLength(0)
    expect(S().mine.every((d) => !d.published)).toBe(true)
  })

  it('a chest holding a card seals it to the lock, stays LOCAL, and opens to the same card', async () => {
    const lock = forgeKey('Vault Key')
    const record = signedRecord('In the vault')
    S().startDeployChest({ name: 'Vault', lock: { pubkey: lock.itemPubkey, label: 'Vault Key' }, requires: 'the Vault Key', contents: [{ kind: 'blueprint', card: cardOf(record) }, { kind: 'message', text: 'build it in open air' }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    expect(publishMany).not.toHaveBeenCalled()
    const d = S().mine.find((x) => x.type === 'chest')!
    expect(d.published).toBe(false)
    const contents = readContents(openWithSecret(d.chest!, lock.secretHex), d.inner.pubkey)
    expect(contents.map((c) => c.body.type)).toEqual(['blueprint', 'message'])
    const c = contents[0]
    expect(c.verified).toBe(true)
    expect(c.event.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect(c.body.blueprint?.record).toEqual(record)
    // Floats out of the opened chest as a scroll of its own.
    expect(lootOf(contents, () => false).map((o) => [o.kind, o.ids])).toEqual([['scroll', [c.id]], ['scroll', [contents[1].id]]])
  })

  it('BROADCAST sends nothing for a bag holding a chest with a card, not even its sealed entries or looks', async () => {
    const lock = forgeKey('Crate Key')
    S().startDeployChest({ name: 'Crate', lock: { pubkey: lock.itemPubkey, label: 'Crate Key' }, requires: 'the Crate Key', contents: [{ kind: 'blueprint', card: cardOf(signedRecord('In the crate')) }] })
    await S().deploy()
    const d = S().mine.find((x) => x.type === 'chest')!
    vi.mocked(publishMany).mockClear()
    expect(await S().broadcast(d.lookupId)).toBe(false)
    expect(publishMany).not.toHaveBeenCalled()
    expect(S().broadcastError).toBe(CARDS_LOCAL_NOTE)
  })

  it.each([false, true])('a chest moved to another place with a card inside stays on this device (after a reload: %s)', async (reloaded) => {
    const lock = forgeKey('Mover Key')
    S().startDeployChest({ name: 'Mover', lock: { pubkey: lock.itemPubkey, label: 'Mover Key' }, requires: 'the Mover Key', contents: [{ kind: 'blueprint', card: cardOf(signedRecord('Carried along')) }] })
    await S().deploy()
    const before = S().mine.find((x) => x.type === 'chest')!
    expect(before.published).toBe(false)
    // A reload forgets the session's memory of which chest payloads hold cards: the move must still know.
    if (reloaded) forgetCardMemory()
    vi.mocked(publishMany).mockClear()
    sent.length = 0
    const c = useCyberspace.getState().cursor
    useCyberspace.setState({ cursor: { x: c.x + (1n << 20n), y: c.y + (1n << 20n), z: c.z + (1n << 20n) }, live: true })
    S().startMoveChest(before.eventId)
    expect(S().pending?.type).toBe('chest')
    await S().deploy()
    expect(publishMany).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
    const moved = S().mine.filter((x) => x.type === 'chest' && x.goneFrom === undefined)
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.every((x) => !x.published)).toBe(true)
  })

  it('a card is refused, in words, where your things are already on the relays: nothing changes, and a later DELETE still reaches them', async () => {
    useCyberspace.setState({ live: true })
    S().startDeployMessage('on the relays')
    await S().deploy()
    const msg = S().mine.find((d) => d.type === 'message')!
    expect(msg.published).toBe(true)
    vi.mocked(publishMany).mockClear()
    sent.length = 0
    S().startDeployBlueprint(cardOf(signedRecord()))
    await S().deploy()
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toBe(CARDS_LIVE_BAG)
    expect(publishMany).not.toHaveBeenCalled()
    expect(S().mine.some((d) => d.type === 'blueprint')).toBe(false)
    expect(S().mine.find((d) => d.eventId === msg.eventId)?.published).toBe(true)
    // The message's DELETE goes to the relays as ever.
    await S().deleteInstance(msg.eventId)
    expect(sent.length).toBeGreaterThan(0)
  })

  it('PUT IN CHEST lines up a new chest with the card inside', () => {
    const card = cardOf(signedRecord())
    expect(startPlaceBlueprint(card, 'chest')).toBeNull()
    const p = S().pending
    expect(p?.type).toBe('chest')
    expect(p?.type === 'chest' && p.contents).toEqual([{ kind: 'blueprint', card }])
    expect(cardsStayLocal(p)).toBe(true)
    // Something lined up already: it says so, and nothing changes.
    expect(startPlaceBlueprint(card, 'here')).toMatch(/lined up/)
  })
})

describe('taking a card (DECK-0010 §7.4)', () => {
  it('TAKE copies the record into BLUEPRINTS with who left it, never into ITEMS, and the card stays found', () => {
    const record = signedRecord()
    const card = signedCard(record)
    const find: Hidden = { eventId: card.id, inner: card, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: placer, at: { x: 5n, y: 6n, z: 7n }, plane: 0, height: 4, createdAt: card.created_at, ...readItem(card, placer)! }
    S().addDiscovered([find])
    expect(S().takeFound([card.id])).toEqual([])
    expect(B().cards).toHaveLength(1)
    expect(B().cards[0].record.id).toBe(record.id)
    expect(B().cards[0].leftBy).toBe(placer)
    expect(B().cards[0].source).toBe('found')
    expect(Object.keys(useInventory.getState().items)).toEqual([])
    // Still there for the next finder.
    expect(S().discovered[card.id]).toBeDefined()
    // Taking again holds it once.
    S().takeFound([card.id])
    expect(B().cards).toHaveLength(1)
  })

  it('TAKE ALL on a chest puts its cards in BLUEPRINTS, left by the card\'s signer, and the rest in ITEMS', () => {
    const record = signedRecord()
    const message = { kind: 1, created_at: 1, tags: [['-']], content: 'hello', pubkey: placer }
    const entries = readContents([signedCard(record), message as never], placer)
    expect(entries.map((e) => e.body.type)).toEqual(['blueprint', 'message'])
    expect(holdsEntry({}, entries[0])).toBe(false)
    takeContents(entries, { chestId: 'chest', chestName: 'Vault' }, null)
    expect(B().cards.map((c) => [c.record.id, c.leftBy])).toEqual([[record.id, placer]])
    expect(Object.values(useInventory.getState().items).map((i) => i.type)).toEqual(['message'])
    // Held now: the chest lists it as taken.
    expect(holdsEntry({}, entries[0])).toBe(true)
  })

  it('a card its own creator left has no "left here by"', () => {
    const record = signedRecord()
    B().addFound(record, creator)
    expect(B().cards[0].leftBy).toBeUndefined()
  })
})
