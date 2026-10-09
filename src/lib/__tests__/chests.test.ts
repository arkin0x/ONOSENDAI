/**
 * chests.test.ts: keys and chests as bag items (Keys and Chests B1 §2).
 *
 * A chest sealed to an item's public key opens with the item's secret, and
 * with nothing else; one sealed to a person opens with that person's NIP-44
 * decrypt. The plaintext is a list of entries in the bag's own shape, so a
 * chest holds a message, a shard, a key, or another chest, and the reader
 * that opens bags reads chest contents. The one limit is NIP-44's 65,535
 * bytes, refused in words before any key is made.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '../events'
import { regionKeyAt } from '../shardCrypto'
import { getEventHash } from 'nostr-tools/pure'
import {
  NIP44_MAX_PLAINTEXT, isLockPubkey, openWithSecret, openWithSigner, openerFor, parseChestPlaintext, plaintextBytes, readContents, requiresLabel, sealEntries, sizeRefusal, revealedIn } from '../chests'
import {
  CHEST_KIND, KEY_KIND, bagTemplate, chestInnerTemplate, chestItemOf, keyInnerTemplate, keyItemOf, messageInnerTemplate, unbag, type ChestItem, type KeyItem,
} from '../hidden'

// signers imports the relay layer, which imports the store, which reads
// localStorage as it loads and imports signers back; loaded the way the app
// loads it, the store first (as signers.test.ts does).
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
}

const hider = generateSecretKey()
const hiderPk = getPublicKey(hider)
const at = { x: 90_000n, y: 4_000n, z: 71n }

/** An event as it comes back out of JSON: finalizeEvent's verified symbol does not travel. */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A fresh key item, as the composer forges one. */
function forge(name: string): KeyItem {
  const sk = generateSecretKey()
  return { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
}

/** A chest sealed to `lock`, holding `entries`, as the hider's signed event. */
function chest(name: string, lock: string, entries: ReturnType<typeof finalizeEvent>[], requires = ''): { event: ReturnType<typeof finalizeEvent>; item: ChestItem } {
  const sealed = sealEntries(entries, lock)
  const item: ChestItem = { name, lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires, payload: sealed.payload }
  const event = finalizeEvent(chestInnerTemplate(item, at, 0, 10), hider)
  return { event, item: chestItemOf(event)! }
}

describe('a key item (B1 §2.1)', () => {
  it('carries its secret in a tag and never in the content, its public key and name in tags, and the NIP-70 mark', () => {
    const key = forge('Wind Key')
    const t = keyInnerTemplate(key, at, 0, 5)
    expect(t.kind).toBe(KEY_KIND)
    expect(t.content).toBe('')
    expect(t.tags).toContainEqual(['secret', key.secretHex])
    expect(t.tags).toContainEqual(['title', 'Wind Key'])
    expect(t.tags).toContainEqual(['item', key.itemPubkey])
    expect(t.tags).toContainEqual(['-'])
    expect(t.tags.find((x) => x[0] === 'C')).toBeDefined()
    const read = keyItemOf(finalizeEvent(t, hider))
    expect(read).toEqual(key)
  })

  it('is refused when its item tag is not the public key its secret derives', () => {
    const key = forge('Forged')
    const t = keyInnerTemplate({ ...key, itemPubkey: getPublicKey(generateSecretKey()) }, at, 0, 5)
    expect(keyItemOf(finalizeEvent(t, hider))).toBeNull()
  })
})

describe('sealing to an item and opening with it (B1 §2.2)', () => {
  it('round trips a message and a key through one chest, and refuses every other key', () => {
    const lock = forge('Wind Key')
    const inside = forge('Fire Key')
    const note = finalizeEvent(messageInnerTemplate('500 sats are in the next room', at, 0, 7), hider)
    const key = finalizeEvent(keyInnerTemplate(inside, at, 0, 8), hider)
    const { item } = chest('Wind Chest', lock.itemPubkey, [note, key], 'the Wind Key')

    // The one-time sender is not the hider and not the lock.
    expect(item.senderPubkey).not.toBe(hiderPk)
    expect(item.senderPubkey).not.toBe(lock.itemPubkey)
    expect(item.lockPubkey).toBe(lock.itemPubkey)
    expect(item.requires).toBe('the Wind Key')

    const entries = openWithSecret(item, lock.secretHex)
    expect(entries).toEqual(wire([note, key]))
    const contents = readContents(entries)
    expect(contents.map((c) => c.body.type)).toEqual(['message', 'key'])
    expect(contents[0].body.text).toBe('500 sats are in the next room')
    expect(contents[1].body.key).toEqual(inside)
    expect(contents.every((c) => c.verified)).toBe(true)

    expect(() => openWithSecret(item, inside.secretHex)).toThrow()
    expect(() => openWithSecret(item, bytesToHex(hider))).toThrow()
  })

  it('a sealer who does not hold the lock can still seal to it, and cannot open it', () => {
    const lock = forge('Someone else’s key')
    const note = finalizeEvent(messageInnerTemplate('for the holder', at, 0, 7), hider)
    const { item } = chest('Gift', lock.itemPubkey, [note])
    expect(() => openWithSecret(item, bytesToHex(hider))).toThrow()
    expect(readContents(openWithSecret(item, lock.secretHex))[0].body.text).toBe('for the holder')
  })
})

describe('sealing to a person and opening with their identity', () => {
  it('opens with a local nsec signer’s NIP-44 decrypt, and not with another identity’s', async () => {
    const { localSigner } = await signers()
    const me = localSigner(generateSecretKey())
    const stranger = localSigner(generateSecretKey())
    const note = finalizeEvent(messageInnerTemplate('happy birthday', at, 1, 7), hider)
    const { item } = chest('For you', me.pubkey, [note], 'being you')
    expect(openerFor(item, [], me.pubkey)).toEqual({ by: 'self' })
    expect(openerFor(item, [], stranger.pubkey)).toBeNull()
    const entries = await openWithSigner(item, me.nip44Decrypt!)
    expect(readContents(entries)[0].body.text).toBe('happy birthday')
    await expect(openWithSigner(item, stranger.nip44Decrypt!)).rejects.toThrow()
  })

  it('a held key wins over the identity when both would open the chest', () => {
    const key = forge('k')
    const opening = { id: 'row', itemPubkey: key.itemPubkey, secretHex: key.secretHex }
    expect(openerFor({ lockPubkey: key.itemPubkey }, [opening], key.itemPubkey)).toEqual({ by: 'key', key: opening })
    expect(openerFor({ lockPubkey: 'ff'.repeat(32) }, [opening], 'ee'.repeat(32))).toBeNull()
  })
})

describe('the chest plaintext is a list of entries (spec §7.6)', () => {
  it('reads items and references, skips what is neither, and refuses anything that is not a list', () => {
    const note = finalizeEvent(messageInnerTemplate('x', at, 0, 7), hider)
    const ref = ['a', '33331:ab:cd', '', 'ff'.repeat(32)]
    const entries = parseChestPlaintext(JSON.stringify([note, ref, 'junk', 7, null, { nokind: true }]))
    expect(entries).toEqual(wire([note, ref]))
    expect(() => parseChestPlaintext('{"a":1}')).toThrow(/cannot read/)
    expect(() => parseChestPlaintext('not json')).toThrow(/cannot read/)
    // References are not followed here; signed items that fail to verify are dropped, unsigned ones are claims.
    const forged = { ...note, content: 'tampered' }
    const unsigned = { ...finalizeEvent(messageInnerTemplate('claim', at, 0, 7), hider), sig: '' }
    const read = readContents([note, ref, forged, unsigned])
    expect(read.map((c) => c.body.text)).toEqual(['x', 'claim'])
    expect(read.map((c) => c.verified)).toEqual([true, false])
    // An unsigned entry's id is its hash, whatever it claimed.
    expect(read[1].id).toBe(getEventHash(unsigned))
    const claiming = { ...unsigned, id: note.id }
    expect(readContents([claiming])[0].id).toBe(getEventHash(unsigned))
  })

  it('one malformed entry never blocks the rest', () => {
    const good = finalizeEvent(messageInnerTemplate('still here', at, 0, 7), hider)
    const badSig = { ...wire(good), sig: 'not even hex' }
    const badShape = { kind: KEY_KIND, pubkey: hiderPk, created_at: 1, content: 5, tags: 'x', id: 'a', sig: '' }
    const badTags = { kind: 1, pubkey: hiderPk, created_at: 1, content: 'tags are wrong', tags: [null, 7, ['C']], id: '', sig: '' }
    const noPubkey = { kind: 1, pubkey: 'nobody', created_at: 1, content: 'no author', tags: [], id: '', sig: '' }
    const read = readContents([badSig, badShape as never, badTags as never, noPubkey as never, good])
    expect(read.map((c) => c.body.text)).toEqual(['still here'])
    // A key with a tag that is not an array of strings reads as the key it is, the tag passed over.
    const key = forge('odd tags')
    const oddKey = { ...wire(finalizeEvent(keyInnerTemplate(key, at, 0, 8), hider)) }
    oddKey.content = 'x'.repeat(1000)
    const unsignedOdd = { ...oddKey, sig: '' }
    const found = readContents([unsignedOdd])
    expect(found).toHaveLength(1)
    expect(found[0].body.key?.name).toBe('odd tags')
    expect(found[0].body.key?.about.length).toBe(280)
  })

  it('a pasted lock must name a point on the curve', () => {
    const key = forge('k')
    expect(isLockPubkey(key.itemPubkey)).toBe(true)
    expect(isLockPubkey(hiderPk)).toBe(true)
    expect(isLockPubkey('00'.repeat(32))).toBe(false)
    expect(isLockPubkey('ff'.repeat(32))).toBe(false)
    expect(isLockPubkey('abc')).toBe(false)
  })

  it('nests: a chest inside a chest parses, and opens with its own key', () => {
    const outerKey = forge('Outer')
    const innerKey = forge('Inner')
    const prize = finalizeEvent(messageInnerTemplate('the prize', at, 0, 7), hider)
    const inner = chest('Inner chest', innerKey.itemPubkey, [prize], 'the Inner key')
    const outer = chest('Outer chest', outerKey.itemPubkey, [inner.event, finalizeEvent(keyInnerTemplate(innerKey, at, 0, 8), hider)])

    const contents = readContents(openWithSecret(outer.item, outerKey.secretHex))
    expect(contents.map((c) => c.body.type)).toEqual(['chest', 'key'])
    const nested = contents[0].body.chest!
    expect(nested.name).toBe('Inner chest')
    expect(nested.lockPubkey).toBe(innerKey.itemPubkey)
    expect(requiresLabel(nested)).toBe('the Inner key')
    expect(requiresLabel({ requires: '' })).toBe('an item you have not found')
    const found = contents[1].body.key!
    expect(readContents(openWithSecret(nested, found.secretHex))[0].body.text).toBe('the prize')
  })
})

describe('the NIP-44 size limit', () => {
  it('refuses a list larger than 65,535 bytes in words, before any key is made', () => {
    expect(sizeRefusal(NIP44_MAX_PLAINTEXT)).toBeNull()
    expect(sizeRefusal(NIP44_MAX_PLAINTEXT + 1)).toMatch(/Too large to seal: 65,536 of 65,535 bytes/)
    const big = finalizeEvent({ kind: 1, created_at: 1, content: 'x'.repeat(70_000), tags: [] }, hider)
    expect(plaintextBytes([big])).toBeGreaterThan(NIP44_MAX_PLAINTEXT)
    expect(() => sealEntries([big], getPublicKey(generateSecretKey()))).toThrow(/Too large to seal/)
    const small = finalizeEvent({ kind: 1, created_at: 1, content: 'x'.repeat(60_000), tags: [] }, hider)
    expect(() => sealEntries([small], getPublicKey(generateSecretKey()))).not.toThrow()
  })

  it('counts UTF-8 bytes, as NIP-44 does, not characters', () => {
    const ev = finalizeEvent({ kind: 1, created_at: 1, content: '€'.repeat(100), tags: [] }, hider)
    expect(plaintextBytes([ev])).toBe(plaintextBytes([{ ...ev, content: 'abc'.repeat(100) }]))
  })
})

describe('keys and chests inside a bag (lib/hidden.ts)', () => {
  it('unbag returns a key as a key and a chest as a chest, each at its own point, and drops a corrupt key', async () => {
    const rk = regionKeyAt(at, 6, 20)
    const key = forge('Wind Key')
    const keyEv = finalizeEvent(keyInnerTemplate(key, at, 0, 1), hider)
    const { event: chestEv, item } = chest('Wind Chest', key.itemPubkey, [finalizeEvent(messageInnerTemplate('inside', at, 0, 2), hider)])
    const corrupt = finalizeEvent(keyInnerTemplate({ ...forge('bad'), itemPubkey: 'ab'.repeat(32) }, at, 0, 3), hider)
    const outer = finalizeEvent(await bagTemplate([keyEv, chestEv, corrupt], rk.key, rk.lookupId, 6, 100), hider)
    const items = await unbag(outer, rk.key)
    expect(items.map((i) => i.type).sort()).toEqual(['chest', 'key'])
    const k = items.find((i) => i.type === 'key')!
    const c = items.find((i) => i.type === 'chest')!
    expect(k.key).toEqual(key)
    expect(k.inner).toEqual(keyEv)
    expect(k.at).toEqual(at)
    expect(c.chest).toEqual(item)
    expect(c.inner?.kind).toBe(CHEST_KIND)
    // The chest found in the bag opens with the key found beside it.
    expect(readContents(openWithSecret(c.chest!, k.key!.secretHex))[0].body.text).toBe('inside')
  })
})

describe('a key item from before the secret moved into its tag (2026-10-09)', () => {
  it('still reads: the secret in the content, name and about in tags', () => {
    const key = forge('Old Key')
    const legacy = finalizeEvent({ kind: KEY_KIND, created_at: 5, content: key.secretHex, tags: [['name', 'Old Key'], ['item', key.itemPubkey], ['about', 'from the first day'], ['-']] }, hider)
    const read = keyItemOf(legacy)
    expect(read?.secretHex).toBe(key.secretHex)
    expect(read?.name).toBe('Old Key')
    expect(read?.about).toBe('from the first day')
  })

  it('the new form puts the sentence in the content and the secret in its tag', () => {
    const key = forge('New Key')
    const read = keyItemOf(finalizeEvent(keyInnerTemplate({ ...key, about: 'opens the gate' }, at, 0, 5), hider))
    expect(read?.secretHex).toBe(key.secretHex)
    expect(read?.about).toBe('opens the gate')
    expect(read?.name).toBe('New Key')
  })
})

describe('a door: what a chest reveals stands in the world (B1, the gate)', () => {
  it('places each content at its own point inside the region, else where the chest stands, under the chest\'s bag', () => {
    const lock = forge('Room Key')
    const inside = { ...at, x: at.x + 3n }
    const room = finalizeEvent(messageInnerTemplate('the room behind the door', inside, 0, 8), hider)
    const far = finalizeEvent(messageInnerTemplate('too far to be in this region', { ...at, x: at.x + 1_000_000n }, 0, 9), hider)
    const c = chest('Door', lock.itemPubkey, [room, far], 'Room Key')
    const contents = readContents(openWithSecret(c.item, lock.secretHex))
    const door = { bagId: 'bag', lookupId: 'look', author: hiderPk, at, plane: 0 as const, height: 6 }
    const found = revealedIn(door, contents)
    expect(found.map((f) => f.text)).toEqual(['the room behind the door', 'too far to be in this region'])
    expect(found[0].at).toEqual(inside)
    expect(found[1].at).toEqual(at)
    expect(found.every((f) => f.bagId === 'bag' && f.lookupId === 'look' && f.height === 6 && f.author === hiderPk)).toBe(true)
    expect(found[0].eventId).toBe(room.id)
  })
})
