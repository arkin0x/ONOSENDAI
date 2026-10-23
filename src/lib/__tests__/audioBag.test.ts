/**
 * audioBag.test.ts: hidden audio sealed in a bag and in a chest (DECK-0007
 * §3). It is a rumor, vouched for by the bag's (or the chest's) signer, as a
 * message is; one claiming another author is not vouched for; a signed one
 * from another client still reads; and a bag counts it in its contents.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { regionKeyAt } from '../shardCrypto'
import { bytesToHex } from '../events'
import { RUMOR_KINDS, bagContents, bagContentsTags, bagTemplate, chestInnerTemplate, chestItemOf, innerAuthentic, readItem, rumorOf, unbag, type ChestItem, type Rumor } from '../hidden'
import { readContents, sealEntries, openWithSecret, templateBytes } from '../chests'
import { AUDIO_KIND, audioInnerTemplate, type AudioItem } from '../audioItem'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const other = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const audio: AudioItem = {
  title: 'Temple bells', about: '', url: 'https://blossom.test/' + '12'.repeat(32), mime: 'audio/mp4', hash: '12'.repeat(32),
  originalHash: '34'.repeat(32), size: 99, keyHex: '56'.repeat(32), nonceHex: '78'.repeat(12), autoplay: true, loop: false, retrigger: 'once', walkOnly: true,
}

async function bagOf(entries: Rumor[], by = sk): Promise<ReturnType<typeof finalizeEvent>> {
  return wire(finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, 100), by))
}

describe('hidden audio in a bag', () => {
  it('is written as a rumor and read as audio, vouched for by the bag', async () => {
    expect(RUMOR_KINDS.has(AUDIO_KIND)).toBe(true)
    const rumor = rumorOf(audioInnerTemplate(audio, at, 0, 50), pk)
    expect(rumor.sig).toBeUndefined()
    expect(innerAuthentic(rumor, pk)).toBe(true)
    const items = await unbag(await bagOf([rumor]), rk.key, undefined, undefined, 6)
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('audio')
    expect(items[0].audio).toEqual(audio)
    expect(items[0].eventId).toBe(rumor.id)
    expect(items[0].at).toEqual(at)
    expect(items[0].author).toBe(pk)
  })

  it('a rumor naming another author, or with an id that is not its hash, is dropped', async () => {
    const theirs = rumorOf(audioInnerTemplate(audio, at, 0, 50), getPublicKey(other))
    const forged = { ...rumorOf(audioInnerTemplate(audio, at, 0, 50), pk), id: 'ff'.repeat(32) }
    expect(await unbag(await bagOf([theirs, forged]), rk.key, undefined, undefined, 6)).toEqual([])
  })

  it('a signed one from another client still reads, when its signature holds', async () => {
    const signed = finalizeEvent(audioInnerTemplate(audio, at, 0, 50), sk)
    const items = await unbag(await bagOf([wire(signed)]), rk.key, undefined, undefined, 6)
    expect(items.map((h) => h.type)).toEqual(['audio'])
    expect(await unbag(await bagOf([{ ...wire(signed), sig: 'ab'.repeat(64) }]), rk.key, undefined, undefined, 6)).toEqual([])
  })

  it('an unencrypted kind 1063 is not hidden audio, and is skipped', () => {
    const plain = audioInnerTemplate(audio, at, 0, 1)
    plain.tags = plain.tags.filter((t) => !['encryption-algorithm', 'decryption-key', 'decryption-nonce'].includes(t[0]))
    expect(readItem({ ...plain, id: '00'.repeat(32) })).toBeNull()
  })

  it('is counted in the bag’s contents, after the kinds spec §7.7 listed first', () => {
    const rumor = rumorOf(audioInnerTemplate(audio, at, 0, 50), pk)
    const note = rumorOf({ kind: 1, created_at: 1, content: 'hi', tags: [['C', '00'.repeat(32)], ['-']] }, pk)
    expect(bagContents([rumor, note]).audio).toBe(1)
    expect(bagContentsTags([rumor, note], { contents: true, money: false })).toEqual([['contents', 'message', '1'], ['contents', 'audio', '1']])
  })
})

describe('hidden audio in a chest', () => {
  it('is vouched for by the chest’s signer and opens with the chest', () => {
    const lock = generateSecretKey()
    const rumor = rumorOf(audioInnerTemplate(audio, at, 0, 50), pk)
    const sealed = sealEntries([rumor], getPublicKey(lock))
    const item: ChestItem = { name: 'room', lockPubkey: getPublicKey(lock), senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    const chest = finalizeEvent(chestInnerTemplate(item, at, 0, 60), sk)
    const read = readContents(openWithSecret(chestItemOf(chest)!, bytesToHex(lock)), chest.pubkey)
    expect(read).toHaveLength(1)
    expect(read[0].body.type).toBe('audio')
    expect(read[0].body.audio).toEqual(audio)
    expect(read[0].verified).toBe(true)
    // Without the chest's word for it, the same rumor is a claim.
    expect(readContents(openWithSecret(chestItemOf(chest)!, bytesToHex(lock)))[0].verified).toBe(false)
  })

  it('is measured as a rumor, with no signature, by the composer’s meter', () => {
    const t = audioInnerTemplate(audio, at, 0, 1)
    const asRumor = templateBytes([t], pk)
    const asSigned = templateBytes([{ ...t, kind: 3340 }], pk)
    expect(asSigned - asRumor).toBe(`,"sig":"${'0'.repeat(128)}"`.length)
  })
})
