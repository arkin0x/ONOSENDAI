/**
 * protectedItems.test.ts: the two rules of 2026-10-20 (arkinox, "1 plus 2").
 *
 * 1. Every item sealed in a bag or a chest carries NIP-70's `-`: a shard
 *    (3330), a message (1), a key (3340, which already did) and a chest
 *    (3341). Never what is published on its own (a kind 33331 object), never
 *    the envelope (33330), never chat (23330, 23333).
 * 2. A message is sealed as a rumor, as chat lines are since 2026-10-13: an
 *    id that is its hash, and no `sig`. A reader accepts it only when its
 *    pubkey is the envelope's signer and its id its hash; a signed message
 *    from an older client still reads when its signature holds. In a chest,
 *    the chest's signer vouches for it the same way.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../shardCrypto'
import { bytesToHex } from '../events'
import {
  CHAT_BAG_KIND, MESSAGE_KIND, OBJECT_KIND, SHARD_KIND, bagInners, bagTemplate, chatInnerTemplate, chatRumor, chestInnerTemplate, chestItemOf, editedTemplate,
  innerAuthentic, isProtectedTags, keyInnerTemplate, messageInnerTemplate, objectTemplate, rumorOf, shardInnerTemplate, unbag, type ChestItem, type KeyItem, type Rumor,
} from '../hidden'
import { chestSealer, openWithSecret, readContents, revealedIn, sealEntries, sealerOf, templateBytes } from '../chests'
import { heldFromFind } from '../inventory'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const other = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const shard: ShardModel = { ...newShard('relic'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }
const rk = regionKeyAt(at, 6, 20)

/** An event as it comes back out of JSON: finalizeEvent's verified symbol does not travel. */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function forge(name: string): KeyItem {
  const s = generateSecretKey()
  return { name, about: '', itemPubkey: getPublicKey(s), secretHex: bytesToHex(s) }
}

function chestOf(entries: Rumor[], lock: string, by = sk): { event: ReturnType<typeof finalizeEvent>; item: ChestItem } {
  const sealed = sealEntries(entries, lock)
  const item: ChestItem = { name: 'box', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
  const event = finalizeEvent(chestInnerTemplate(item, at, 0, 10), by)
  return { event, item: chestItemOf(event)! }
}

async function bagOf(entries: Rumor[], by = sk): Promise<ReturnType<typeof finalizeEvent>> {
  return wire(finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, 100), by))
}

const dashes = (tags: string[][]): number => tags.filter((t) => t[0] === '-').length

describe('rule 1: NIP-70 `-` on every item sealed in a bag or a chest', () => {
  it('a shard, a message, a key and a chest each carry it, once', () => {
    const key = forge('k')
    const c = chestOf([], key.itemPubkey)
    expect(dashes(shardInnerTemplate(shard, at, 0, 1).tags)).toBe(1)
    expect(dashes(shardInnerTemplate(shard, at, 0, 1, { address: `${OBJECT_KIND}:${'ab'.repeat(32)}:d` }).tags)).toBe(1)
    expect(dashes(messageInnerTemplate('hi', at, 0, 1).tags)).toBe(1)
    expect(dashes(keyInnerTemplate(key, at, 0, 1).tags)).toBe(1)
    expect(dashes(c.event.tags)).toBe(1)
  })

  it('never on an object published on its own, the envelope, or chat', async () => {
    expect(isProtectedTags((await objectTemplate(shard, rk.key, 'd', 1)).tags)).toBe(false)
    expect(isProtectedTags((await bagTemplate([], rk.key, rk.lookupId, 6, 1)).tags)).toBe(false)
    expect(isProtectedTags((await bagTemplate([], rk.key, rk.lookupId, 6, 1, CHAT_BAG_KIND)).tags)).toBe(false)
    expect(isProtectedTags(chatInnerTemplate('hello', at, 0, 1, rk.lookupId).tags)).toBe(false)
  })

  it('a move gives `-` to a shard hidden before every item carried it, and never a second one', () => {
    const legacy = finalizeEvent({ kind: SHARD_KIND, created_at: 1, content: '{}', tags: [['C', '00'.repeat(32)], ['r', 'credit']] }, sk)
    const moved = editedTemplate(shardInnerTemplate(shard, at, 0, 2), legacy)
    expect(dashes(moved.tags)).toBe(1)
    expect(moved.tags).toContainEqual(['d', legacy.id])
    expect(moved.tags).toContainEqual(['r', 'credit'])
    const again = editedTemplate(shardInnerTemplate(shard, at, 0, 3), finalizeEvent(moved, sk))
    expect(dashes(again.tags)).toBe(1)
    expect(again.tags).toContainEqual(['d', legacy.id])
  })

  it('a hidden item carrying `-` still opens: the tag changes nothing for a reader', async () => {
    const s = finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)
    const items = await unbag(await bagOf([s]), rk.key)
    expect(items).toHaveLength(1)
    expect(items[0].shard?.vertices).toEqual(shard.vertices)
  })
})

describe('rule 2: a hidden message is a rumor', () => {
  const rumor = (text: string, by = pk): Rumor => rumorOf(messageInnerTemplate(text, at, 0, 5), by)

  it('has an id that is its hash and no sig at all, and is not a valid event anywhere', () => {
    const r = rumor('no proof of me')
    expect('sig' in r).toBe(false)
    expect(r.id).toBe(getEventHash({ kind: r.kind, created_at: r.created_at, tags: r.tags, content: r.content, pubkey: r.pubkey }))
    // Lifted out and given any signature, it is still not a note anyone signed.
    expect(verifyEvent({ ...r, sig: '00'.repeat(64) })).toBe(false)
    // The chat rumor is the same function.
    expect(chatRumor).toBe(rumorOf)
  })

  it('opens from a bag its author signed, as a message by that author', async () => {
    const r = rumor('meet at the black sun')
    const outer = await bagOf([r])
    const items = await unbag(outer, rk.key)
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('message')
    expect(items[0].text).toBe('meet at the black sun')
    expect(items[0].author).toBe(pk)
    expect(items[0].eventId).toBe(r.id)
    expect(items[0].inner).toEqual(r)
    expect(items[0].inner && 'sig' in items[0].inner).toBe(false)
  })

  it('is refused when its pubkey is not the envelope signer', async () => {
    const r = rumor('not mine to carry', getPublicKey(other))
    expect(await unbag(await bagOf([r]), rk.key)).toHaveLength(0)
    expect(innerAuthentic(r, pk)).toBe(false)
  })

  it('is refused when its id is not its hash, and when its content was changed under its id', async () => {
    const r = rumor('real')
    expect(await unbag(await bagOf([{ ...r, id: 'ff'.repeat(32) }]), rk.key)).toHaveLength(0)
    expect(await unbag(await bagOf([{ ...r, content: 'forged' }]), rk.key)).toHaveLength(0)
  })

  it('only a message may be a rumor: an unsigned shard, key or chest in a bag is still dropped', async () => {
    const s = rumorOf(shardInnerTemplate(shard, at, 0, 1), pk)
    const k = rumorOf(keyInnerTemplate(forge('k'), at, 0, 1), pk)
    expect(innerAuthentic(s, pk)).toBe(false)
    expect(innerAuthentic(k, pk)).toBe(false)
    expect(await unbag(await bagOf([s, k]), rk.key)).toHaveLength(0)
  })

  it('a signed message from an older client, with no `-`, still opens; one whose signature fails does not', async () => {
    const legacy = finalizeEvent({ kind: MESSAGE_KIND, created_at: 3, content: 'from before', tags: [['C', '00'.repeat(32)]] }, sk)
    const tampered = { ...finalizeEvent({ kind: MESSAGE_KIND, created_at: 4, content: 'x', tags: [] }, sk), content: 'y' }
    const items = await unbag(await bagOf([wire(legacy), wire(tampered)]), rk.key)
    expect(items.map((i) => i.text)).toEqual(['from before'])
  })

  it('a bag mixing old signed items and new rumors opens whole', async () => {
    const legacy = finalizeEvent({ kind: MESSAGE_KIND, created_at: 3, content: 'old', tags: [['C', '00'.repeat(32)]] }, sk)
    const s = finalizeEvent(shardInnerTemplate(shard, at, 0, 1), sk)
    const items = await unbag(await bagOf([wire(legacy), wire(s), rumor('new')]), rk.key)
    expect(items.map((i) => i.type).sort()).toEqual(['message', 'message', 'shard'])
  })

  it('bagInners, the test-discovery source, counts a rumor as in the bag', async () => {
    const r = rumor('counted')
    const inners = await bagInners(await bagOf([r]), rk.key)
    expect(inners.map((e) => e.id)).toEqual([r.id])
  })
})

describe('rule 2 in a chest: the chest signer vouches for its rumors', () => {
  const lock = forge('lock')
  const rumor = (text: string, by = pk): Rumor => rumorOf(messageInnerTemplate(text, at, 0, 5), by)

  it('a rumor of the chest signer is verified, with its own id', () => {
    const r = rumor('the next door is north')
    const c = chestOf([r], lock.itemPubkey)
    const contents = readContents(openWithSecret(c.item, lock.secretHex), c.event.pubkey)
    expect(contents).toHaveLength(1)
    expect(contents[0].verified).toBe(true)
    expect(contents[0].id).toBe(r.id)
    expect(contents[0].event.pubkey).toBe(pk)
  })

  it('is a claim when nobody vouches: no sealer, another sealer, or an id that is not its hash', () => {
    const r = rumor('who said this')
    const c = chestOf([r, rumor('someone else', getPublicKey(other)), { ...rumor('bad id'), id: 'ee'.repeat(32) }], lock.itemPubkey)
    const raw = openWithSecret(c.item, lock.secretHex)
    expect(readContents(raw).map((e) => e.verified)).toEqual([false, false, false])
    const vouched = readContents(raw, pk)
    expect(vouched.map((e) => e.verified)).toEqual([true, false, false])
    // An id it does not hash to is replaced by its hash, as before.
    expect(vouched[2].id).not.toBe('ee'.repeat(32))
  })

  it('an empty sig is no sig, in a chest as in a bag: the rumor reads, vouched for, and a non-empty bad one is dropped', async () => {
    const r = rumor('empty sig')
    const c = chestOf([{ ...r, sig: '' }, { ...r, sig: '00'.repeat(64) }], lock.itemPubkey)
    const read = readContents(openWithSecret(c.item, lock.secretHex), pk)
    expect(read).toHaveLength(1)
    expect(read[0].verified).toBe(true)
    expect(innerAuthentic({ ...r, sig: '' }, pk)).toBe(true)
    expect(innerAuthentic({ ...r, sig: '00'.repeat(64) }, pk)).toBe(false)
    expect(await unbag(await bagOf([{ ...r, sig: '' }]), rk.key)).toHaveLength(1)
    // Any other value is a signature, and must verify: null is dropped, never vouched for.
    const odd = chestOf([{ ...r, sig: null } as unknown as Rumor], lock.itemPubkey)
    expect(readContents(openWithSecret(odd.item, lock.secretHex), pk)).toHaveLength(0)
  })

  it('a signed message from an older client is verified by its own signature, sealer or not', () => {
    const legacy = finalizeEvent(messageInnerTemplate('signed', at, 0, 5), sk)
    const c = chestOf([legacy], lock.itemPubkey)
    expect(readContents(openWithSecret(c.item, lock.secretHex))[0].verified).toBe(true)
  })

  it('what a chest reveals says when its author is a claim, and a chest of claims vouches for nothing', () => {
    const r = rumor('vouched')
    const stray = rumor('stray', getPublicKey(other))
    const c = chestOf([r, stray], lock.itemPubkey)
    const door = { eventId: c.event.id, bagId: 'bag', lookupId: 'look', author: pk, at, plane: 0 as const, height: 6, inner: c.event }
    expect(sealerOf(door)).toBe(pk)
    const found = revealedIn(door, readContents(openWithSecret(c.item, lock.secretHex), sealerOf(door)))
    expect(found.map((f) => f.claim)).toEqual([undefined, true])
    expect(sealerOf({ inner: c.event, claim: true })).toBeUndefined()
    expect(sealerOf({})).toBeUndefined()
  })

  it('only a message is vouched for: an unsigned key of the chest signer stays a claim, as a bag would drop it', () => {
    const k = rumorOf(keyInnerTemplate(forge('loose key'), at, 0, 5), pk)
    const c = chestOf([k], lock.itemPubkey)
    const [entry] = readContents(openWithSecret(c.item, lock.secretHex), pk)
    expect(entry.body.type).toBe('key')
    expect(entry.verified).toBe(false)
    // Found that way, the key is held with its author as a claim.
    const door = { eventId: c.event.id, bagId: 'bag', lookupId: 'look', author: pk, at, plane: 0 as const, height: 6, inner: c.event }
    const [found] = revealedIn(door, [entry])
    expect(found.claim).toBe(true)
    expect(heldFromFind('me', found, 1)?.verified).toBe(false)
    expect(heldFromFind('me', { ...found, claim: undefined }, 1)?.verified).toBe(true)
  })

  it('a chest card opens with the sealer it is given, else the chest as found, else as hidden here; never anything else', () => {
    const c = chestOf([], lock.itemPubkey)
    expect(chestSealer('ab'.repeat(32), { inner: c.event, claim: true }, { pubkey: 'cd'.repeat(32) })).toBe('ab'.repeat(32))
    expect(chestSealer(undefined, { inner: c.event }, { pubkey: 'cd'.repeat(32) })).toBe(pk)
    expect(chestSealer(undefined, { inner: c.event, claim: true }, { pubkey: 'cd'.repeat(32) })).toBeUndefined()
    expect(chestSealer(undefined, undefined, { pubkey: 'cd'.repeat(32) })).toBe('cd'.repeat(32))
    expect(chestSealer(undefined, undefined, undefined)).toBeUndefined()
  })

  it('a rumor is sealed into a chest at its true size: no signature bytes counted', () => {
    const t = messageInnerTemplate('size me', at, 0, 5)
    const r = rumorOf(t, pk)
    expect(templateBytes([t], pk)).toBe(new TextEncoder().encode(JSON.stringify([{ id: r.id, pubkey: pk, created_at: t.created_at, kind: t.kind, tags: t.tags, content: t.content }])).length)
  })
})
