/**
 * inventory.test.ts: what an identity holds (Keys and Chests B1 §3.3), as
 * pure functions. A key read is held once; a key travels as text and comes
 * back the same, or not at all when tampered with; DISCOVERED and LOOT split
 * the same finds and holdings two ways.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '../events'
import { sealEntries, readContents } from '../chests'
import { chestInnerTemplate, keyInnerTemplate, keyItemOf, messageInnerTemplate, type Hidden, type KeyItem } from '../hidden'
import {
  KEY_TEXT_PREFIX, addHeld, chestsOpenedBy, heldFromEntry, heldFromFind, heldFromForged, keyText, openingKeys, parseKeyText, splitPanels, type HeldItem,
} from '../inventory'

const hider = generateSecretKey()
const hiderPk = getPublicKey(hider)
const me = 'ee'.repeat(32)
const at = { x: 1n, y: 2n, z: 3n }

function forge(name: string): KeyItem {
  const sk = generateSecretKey()
  return { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
}

/** A key found in a bag, as unbag would report it. */
function keyFind(key: KeyItem, createdAt = 10, bagId = 'bag-1'): Hidden {
  const inner = finalizeEvent(keyInnerTemplate(key, at, 0, createdAt), hider)
  return { eventId: inner.id, inner, keyHex: 'aa'.repeat(32), bagId, lookupId: `lookup-${bagId}`, author: hiderPk, at, plane: 0, height: 6, createdAt, type: 'key', key }
}

function messageFind(text: string, createdAt: number, bagId: string): Hidden {
  const inner = finalizeEvent(messageInnerTemplate(text, at, 0, createdAt), hider)
  return { eventId: inner.id, inner, keyHex: 'aa'.repeat(32), bagId, lookupId: `lookup-${bagId}`, author: hiderPk, at, plane: 0, height: 6, createdAt, type: 'message', text }
}

describe('a key read is held once', () => {
  it('the same find added twice is one row, with the first holding kept', () => {
    const key = forge('Wind Key')
    const find = keyFind(key)
    const first = heldFromFind(me, find, 100)!
    const again = heldFromFind(me, { ...find, bagId: 'bag-rewritten' }, 200)!
    expect(first.id).toBe(find.eventId)
    expect(first.key).toEqual(key)
    expect(first.source).toBe('found')
    expect(first.place?.bagId).toBe('bag-1')

    const once = addHeld({}, [first])
    expect(once.added).toHaveLength(1)
    const twice = addHeld(once.items, [again, first])
    expect(twice.added).toHaveLength(0)
    expect(twice.items).toBe(once.items)
    expect(Object.values(twice.items)).toHaveLength(1)
    expect(twice.items[find.eventId].at).toBe(100)
  })

  it('a find that is not a key, or has no event, is not held', () => {
    expect(heldFromFind(me, messageFind('x', 1, 'b'), 1)).toBeNull()
    const find = keyFind(forge('k'))
    expect(heldFromFind(me, { ...find, inner: undefined }, 1)).toBeNull()
  })
})

describe('a key as text (COPY and PASTE)', () => {
  it('round trips, prefix and all, and the pasted key is the same item', () => {
    const key = forge('Wind Key')
    const find = keyFind(key)
    const held = heldFromFind(me, find, 1)!
    const text = keyText(held)
    expect(text.startsWith(KEY_TEXT_PREFIX)).toBe(true)
    const back = parseKeyText(`  ${text}\n`)
    expect(back).not.toBeNull()
    expect(back!.event).toEqual(find.inner)
    expect(back!.key).toEqual(key)
    expect(keyItemOf(back!.event)).toEqual(key)
  })

  it('refuses text that is not a key, a tampered signature, and a secret that does not match its item tag', () => {
    const held = heldFromFind(me, keyFind(forge('k')), 1)!
    const text = keyText(held)
    expect(parseKeyText(text.slice(KEY_TEXT_PREFIX.length))).toBeNull()
    expect(parseKeyText('cyberspace-key:not json')).toBeNull()
    expect(parseKeyText('cyberspace-key:[1,2]')).toBeNull()
    const tampered = { ...held.event, tags: held.event.tags.map((t) => (t[0] === 'name' ? ['name', 'Renamed'] : t)) }
    expect(parseKeyText(KEY_TEXT_PREFIX + JSON.stringify(tampered))).toBeNull()
    const wrongSecret = { ...held.event, sig: '', content: bytesToHex(generateSecretKey()) }
    expect(parseKeyText(KEY_TEXT_PREFIX + JSON.stringify(wrongSecret))).toBeNull()
    // Unsigned, consistent: read, the hider a claim.
    const unsigned = { ...held.event, sig: '' }
    expect(parseKeyText(KEY_TEXT_PREFIX + JSON.stringify(unsigned))?.key).toEqual(held.key)
  })
})

describe('the DISCOVERED and LOOT split', () => {
  it('groups finds by bag, newest first, and keeps keys apart from taken contents', () => {
    const wind = forge('Wind Key')
    const fire = forge('Fire Key')
    const k = keyFind(wind, 50, 'bag-A')
    const m1 = messageFind('older', 10, 'bag-A')
    const m2 = messageFind('elsewhere', 30, 'bag-B')
    const heldKey = heldFromFind(me, k, 100)!
    const forged = heldFromForged(me, finalizeEvent(keyInnerTemplate(fire, at, 0, 1), hider), fire, { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4 }, 300)
    // A message taken out of a chest.
    const note = finalizeEvent(messageInnerTemplate('taken note', at, 0, 2), hider)
    const sealed = sealEntries([note], fire.itemPubkey)
    const chestEv = finalizeEvent(chestInnerTemplate({ name: 'Chest', lockPubkey: fire.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, at, 0, 3), hider)
    const taken = heldFromEntry(me, readContents([note])[0], { chestId: chestEv.id, chestName: 'Chest' }, null, 200)

    const { discovered, loot } = splitPanels([m1, m2, k], [heldKey, taken, forged])
    expect(discovered.map((p) => p.bagId)).toEqual(['bag-A', 'bag-B'])
    expect(discovered[0].items.map((h) => h.type)).toEqual(['key', 'message'])
    expect(discovered[0].at).toBe(50)
    expect(loot.keys.map((it) => it.name)).toEqual(['Fire Key', 'Wind Key'])
    expect(loot.taken.map((it) => it.name)).toEqual(['taken note'])
    expect(loot.taken[0].from?.chestName).toBe('Chest')

    // Which found chests the held keys open, from the lock tags of chests seen.
    const chests = [{ id: chestEv.id, chest: { name: 'Chest', lockPubkey: fire.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload } }]
    expect(chestsOpenedBy(fire, chests)).toEqual([chestEv.id])
    expect(chestsOpenedBy(wind, chests)).toEqual([])
    expect(openingKeys({ [heldKey.id]: heldKey, [taken.id]: taken }).map((o) => o.itemPubkey)).toEqual([wind.itemPubkey])
  })

  it('a key read is in both panels: DISCOVERED where it stands, LOOT as held', () => {
    const key = forge('k')
    const find = keyFind(key)
    const held: HeldItem = heldFromFind(me, find, 1)!
    const { discovered, loot } = splitPanels([find], [held])
    expect(discovered[0].items[0].eventId).toBe(loot.keys[0].id)
  })
})
