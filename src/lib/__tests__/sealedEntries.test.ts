/**
 * sealedEntries.test.ts: ONOSENDAI reads sealed entries (kind 33335, spec
 * §7.6 "Sealed entries", cyberspace #89) as the spec's golden vectors say
 * (decks/kinds-vectors.json `sealed_entries`, copied in unchanged): the bag
 * reads as its three entries with the ids they would have inline, the room bag
 * reads as its one message under the room key, and each refused entry is
 * refused for the reason given. Then the rules around them: emptied and
 * placed entries are missing, duplicates keep the first, an `e` reference
 * reads too, objects and sealed entries mix, contents count the item inside,
 * and a bag of more than 64 references opens whole. Resolvers are local maps:
 * no network.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import vectors from './vectors/sealed-entries.json'
import { hexToBytes, type NostrEvent } from '../events'
import { HIDDEN_KIND, MAX_REFERENCES_PER_BAG, bagContents, bagReading, bagTemplate, innerAuthentic, objectTemplate, unbag, type BagEntry, type Reference, type ResolveReference } from '../hidden'
import { SEALED_KIND, SEALED_PREVIEW, emptiedTemplate, forgetSealedItems, openSealed, sealedItemOf, sealedTemplate } from '../sealed'

const K = vectors.keys
const V = vectors.sealed_entries
const hiderSk = hexToBytes(K.hider_secret)
const speakerSk = hexToBytes(K.speaker_secret)
const regionKey = hexToBytes(K.region_key)
const COORD = 'c4924924924924924924920c53c81e9d260623340e5c3a75b6de6e4715cd1724'

/** A resolver over these events, by address or id, that records what it was asked for. */
function resolverOf(events: NostrEvent[]): ResolveReference & { asked: Reference[] } {
  const asked: Reference[] = []
  const fn = (async (ref: Reference) => {
    asked.push(ref)
    if (ref[0] === 'e') return events.find((e) => e.id === ref[1]) ?? null
    const [kind, pubkey, ...rest] = ref[1].split(':')
    return events.filter((e) => String(e.kind) === kind && e.pubkey === pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === rest.join(':')).sort((a, b) => b.created_at - a.created_at)[0] ?? null
  }) as ResolveReference & { asked: Reference[] }
  fn.asked = asked
  return fn
}

/** A bag of the hider's over these entries, sealed with `key`. */
async function bagOf(entries: BagEntry[], key: Uint8Array = regionKey, at = 1791800100): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, key, K.lookup_id, 12, at, HIDDEN_KIND), hiderSk) as NostrEvent
}

/** A sealed entry of the hider's holding `item`. */
async function sealOf(item: object, d: string, key: Uint8Array = regionKey, sk: Uint8Array = hiderSk): Promise<NostrEvent> {
  return finalizeEvent(await sealedTemplate(item, key, d, 1791800000), sk) as NostrEvent
}

beforeEach(() => forgetSealedItems())

describe('the spec vectors (§7.6 Golden vectors)', () => {
  it('the bag reads as its three entries, with the ids they would have inline, in the order of its list', async () => {
    const resolve = resolverOf([V.key_item.event, V.message.event] as NostrEvent[])
    const found = await unbag(V.bag.event as NostrEvent, regionKey, resolve, undefined, 12)
    expect(found.map((h) => h.eventId)).toEqual(V.bag.reads_as)
    expect(found.map((h) => h.type)).toEqual(['chest', 'key', 'message'])
    // Placement is the bag's author; the message is a rumor the bag vouches for (Reading, rule 5).
    for (const h of found) expect(h.author).toBe(K.hider)
    const message = found[2]
    expect(message.text).toBe('You found the secret sauce.')
    expect(message.inner?.sig).toBeUndefined()
    expect(innerAuthentic(message.inner!, K.hider)).toBe(true)
    // Read from sealed entries: the reference and the sealed entry come with it; `ref` stays unset.
    expect(found[1].sealedRef?.[1]).toBe(`33335:${K.hider}:8cd8c91c7fe29332151ad6dbcb863c97`)
    expect(found[1].sealedEvent?.id).toBe(V.key_item.event.id)
    expect(found[1].ref).toBeUndefined()
    expect(found[0].sealedRef).toBeUndefined()
    // The key item is the vector's own, byte for byte.
    expect(JSON.stringify(found[1].inner)).toBe(V.key_item.plaintext)
    expect(found[1].key?.name).toBe('Vapor Key')
  })

  it('each sealed payload decrypts to the item, byte for byte, with the bag key', async () => {
    expect(await openSealed(V.key_item.event, regionKey)).toBe(V.key_item.plaintext)
    expect(await openSealed(V.message.event, regionKey)).toBe(V.message.plaintext)
  })

  it('contents count each sealed entry by the item inside, once read (§7.7)', async () => {
    const plain = JSON.parse(V.bag.plaintext) as BagEntry[]
    // Unread, a sealed entry counts as nothing.
    expect(bagContents(plain)).toMatchObject({ chest: 1, key: 0, message: 0, shard: 0 })
    await unbag(V.bag.event as NostrEvent, regionKey, resolverOf([V.key_item.event, V.message.event] as NostrEvent[]), undefined, 12)
    expect(bagContents(plain)).toMatchObject({ chest: 1, key: 1, message: 1, shard: 0 })
    // The counts the vector bag publishes.
    const said = V.bag.event.tags.filter((t) => t[0] === 'contents').map((t) => `${t[1]}:${t[2]}`)
    expect(said).toEqual(['message:1', 'key:1', 'chest:1'])
    expect(sealedItemOf(plain[2] as Reference)?.id).toBe(V.bag.reads_as[2])
  })

  it('the room bag reads as its one message, sealed with the room key; the region key does not open it', async () => {
    const roomKey = hexToBytes(V.room.room_key)
    const found = await unbag(V.room.bag.event as NostrEvent, roomKey, resolverOf([V.room.message.event] as NostrEvent[]))
    expect(found.map((h) => h.eventId)).toEqual(V.room.bag.reads_as)
    expect(found[0].type).toBe('message')
    expect(await openSealed(V.room.message.event, regionKey)).toBeNull()
    expect(V.room.bag.event.tags.find((t) => t[0] === 'd')?.[1]).toBe(V.room.room_lookup_id)
  })

  it('refuses each rejected entry for its reason: another signer (never fetched), a nested sealed entry, a door', async () => {
    const reject = V.reject
    const bag = await bagOf([reject.foreign_signer.reference, reject.nested.reference, reject.door.reference, JSON.parse(V.bag.plaintext)[2]] as BagEntry[])
    const resolve = resolverOf([reject.foreign_signer.sealed.event, reject.nested.sealed.event, reject.door.sealed.event, V.message.event] as NostrEvent[])
    const found = await unbag(bag, regionKey, resolve, undefined, 12)
    // Only the sealed message reads.
    expect(found.map((h) => h.eventId)).toEqual([V.bag.reads_as[2]])
    // Rule 1: the foreign address is dropped without fetching it.
    expect(resolve.asked.some((r) => r[1] === reject.foreign_signer.reference[1])).toBe(false)
    expect(resolve.asked.some((r) => r[1] === reject.nested.reference[1])).toBe(true)
    // The reader is told something was found and refused, not that nothing was.
    expect(bagReading(bag.id)).toMatchObject({ entries: 4, readable: 1, refused: 3 })
    // DISCOVERED says so though something in the bag reads (review of #645): not only when nothing does.
    const { openedTitle } = await import('../../hud/DiscoveredPanel')
    expect(openedTitle(bag.id, 1)).toBe('Opened: 1 items. 3 refused')
    // The door's payload decrypts to a door, so the refusal is the reader's, not the cipher's.
    const door = JSON.parse((await openSealed(reject.door.sealed.event, regionKey))!) as NostrEvent
    expect(door.kind).toBe(3341)
    expect(door.tags.some((t) => t[0] === 'door')).toBe(true)
  })
})

describe('reading rules (§7.6 Reading)', () => {
  const message = JSON.parse(V.message.plaintext) as NostrEvent

  it('an emptied sealed entry (no encrypted tag) is a missing entry', async () => {
    const emptied = finalizeEvent(emptiedTemplate('42708e003321d2ebaf7233f55a0bbb7a', 1791800050), hiderSk) as NostrEvent
    const bag = await bagOf([JSON.parse(V.bag.plaintext)[2]])
    expect(await unbag(bag, regionKey, resolverOf([V.message.event as NostrEvent, emptied]), undefined, 12)).toEqual([])
  })

  it('a sealed entry that says where it is (a C, an H, a hint, a sector tag) is dropped', async () => {
    for (const extra of [['C', COORD], ['H', '12'], ['hint', COORD, '30', '30', '30'], ['S', '1-2-3']]) {
      const t = await sealedTemplate(message, regionKey, 'aa'.repeat(16), 1791800000)
      const placed = finalizeEvent({ ...t, tags: [...t.tags, extra] }, hiderSk) as NostrEvent
      const bag = await bagOf([['a', `33335:${K.hider}:${'aa'.repeat(16)}`, '', COORD]])
      expect(await unbag(bag, regionKey, resolverOf([placed]), undefined, 12)).toEqual([])
    }
  })

  it('a sealed entry signed by another key, named by an `e` reference, is dropped after fetching', async () => {
    const foreign = await sealOf(message, 'bb'.repeat(16), regionKey, speakerSk)
    const bag = await bagOf([['e', foreign.id, '', COORD]])
    expect(await unbag(bag, regionKey, resolverOf([foreign]), undefined, 12)).toEqual([])
  })

  it('an `e` reference to a sealed entry of the bag signer reads like an `a` one', async () => {
    const bag = await bagOf([['e', V.message.event.id, '', COORD]])
    const found = await unbag(bag, regionKey, resolverOf([V.message.event as NostrEvent]), undefined, 12)
    expect(found.map((h) => h.eventId)).toEqual([message.id])
  })

  it('duplicates keep the first in the list: the same item inline and sealed is one item', async () => {
    const sealedRef = JSON.parse(V.bag.plaintext)[2] as Reference
    const sealedFirst = await unbag(await bagOf([sealedRef, message]), regionKey, resolverOf([V.message.event as NostrEvent]), undefined, 12)
    expect(sealedFirst).toHaveLength(1)
    expect(sealedFirst[0].sealedRef).toEqual(sealedRef)
    const inlineFirst = await unbag(await bagOf([message, sealedRef]), regionKey, resolverOf([V.message.event as NostrEvent]), undefined, 12)
    expect(inlineFirst).toHaveLength(1)
    expect(inlineFirst[0].sealedRef).toBeUndefined()
  })

  it('a version of the same item by lineage is one item too, the first kept', async () => {
    // A moved message carries its first version's id as its lineage `d` (DECK-0006 §2.2).
    const moved = { ...message, created_at: message.created_at + 5, tags: [['C', COORD], ['d', message.id], ['-']] }
    const { getEventHash } = await import('nostr-tools/pure')
    const movedRumor = { ...moved, id: getEventHash(moved) }
    const sealed = await sealOf(movedRumor, 'cc'.repeat(16))
    const found = await unbag(await bagOf([message, ['a', `33335:${K.hider}:${'cc'.repeat(16)}`, '', COORD]]), regionKey, resolverOf([sealed]), undefined, 12)
    expect(found.map((h) => h.eventId)).toEqual([message.id])
  })

  it('the item’s own C decides where it stands, not the reference’s coordinate', async () => {
    const other = 'c4924924924924924924920c53c81e9d260623340e5c3a75b6de6e4715cd1700'
    const found = await unbag(await bagOf([['a', `33335:${K.hider}:42708e003321d2ebaf7233f55a0bbb7a`, '', other]]), regionKey, resolverOf([V.message.event as NostrEvent]), undefined, 12)
    expect(found).toHaveLength(1)
    const fromItem = await unbag(await bagOf([message]), regionKey, undefined, undefined, 12)
    expect(found[0].at).toEqual(fromItem[0].at)
  })

  it('a payload that is a list, or a reference, is refused', async () => {
    const list = finalizeEvent({ kind: SEALED_KIND, created_at: 1791800000, content: SEALED_PREVIEW, tags: [['d', 'dd'.repeat(16)], ['encrypted', 'aes-256-gcm', (await sealedTemplate([message] as unknown as object, regionKey, 'x', 0)).tags[1][2], 'cyberspace:region']] }, hiderSk) as NostrEvent
    const bag = await bagOf([['a', `33335:${K.hider}:${'dd'.repeat(16)}`, '', COORD]])
    expect(await unbag(bag, regionKey, resolverOf([list]), undefined, 12)).toEqual([])
    expect(bagReading(bag.id)?.refused).toBe(1)
  })
})

describe('mixed and many references', () => {
  it('a kind 33331 object and sealed entries in one bag both read; contents count the object as a shard', async () => {
    const shard = { ...newShard('mixed'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }, { p: [1, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }, { p: [0, 1, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }], faces: [[0, 1, 2]] as Array<[number, number, number]> }
    const object = finalizeEvent(await objectTemplate(shard, regionKey, 'ee'.repeat(16), 1791800000), hiderSk) as NostrEvent
    const entries: BagEntry[] = [['a', `33331:${K.hider}:${'ee'.repeat(16)}`, '', COORD], ...JSON.parse(V.bag.plaintext).slice(1)]
    const found = await unbag(await bagOf(entries), regionKey, resolverOf([object, V.key_item.event, V.message.event] as NostrEvent[]), undefined, 12)
    expect(found.map((h) => h.type)).toEqual(['shard', 'key', 'message'])
    expect(bagContents(entries)).toMatchObject({ shard: 1, key: 1, message: 1 })
  })

  it('a bag of 200 sealed entries opens whole (the old cap was 64)', async () => {
    const sealed: NostrEvent[] = []
    const refs: BagEntry[] = []
    for (let i = 0; i < 200; i++) {
      const rumor = { pubkey: K.hider, created_at: 1791800000 + i, kind: 1, content: `note ${i}`, tags: [['C', COORD], ['-']] }
      const { getEventHash } = await import('nostr-tools/pure')
      const d = i.toString(16).padStart(32, '0')
      sealed.push(await sealOf({ ...rumor, id: getEventHash(rumor) }, d))
      refs.push(['a', `33335:${K.hider}:${d}`, '', COORD])
    }
    const found = await unbag(await bagOf(refs), regionKey, resolverOf(sealed), undefined, 12)
    expect(found).toHaveLength(200)
    expect(found.map((h) => h.text)).toEqual(Array.from({ length: 200 }, (_, i) => `note ${i}`))
  }, 60000)

  it('past the cap, the rest are not fetched, and the reading says how many', async () => {
    const refs: BagEntry[] = Array.from({ length: MAX_REFERENCES_PER_BAG + 5 }, (_, i) => ['a', `33335:${K.hider}:${i.toString(16).padStart(32, '0')}`, '', COORD])
    const resolve = resolverOf([])
    const bag = await bagOf(refs)
    await unbag(bag, regionKey, resolve, undefined, 12)
    expect(resolve.asked).toHaveLength(MAX_REFERENCES_PER_BAG)
    expect(bagReading(bag.id)?.skipped).toBe(5)
    const { openedTitle } = await import('../../hud/DiscoveredPanel')
    expect(openedTitle(bag.id, 3)).toBe('Opened: 3 items. 5 more not fetched')
  })
})
