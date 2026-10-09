/**
 * chests.ts: sealing a chest and opening one (Keys and Chests B1 §2.2).
 *
 * A chest is a bag item whose content is a list of entries, in exactly the
 * shape of a bag's plaintext (spec §7.6), sealed with NIP-44 v2 to a public
 * key instead of to a place. The key it is sealed to is either an item's
 * public key (a key item found somewhere else, lib/hidden.ts KeyItem) or a
 * person's pubkey, which is how a chest becomes a gift.
 *
 * The seal is the gift-wrap pattern: the sealer makes a fresh keypair, uses
 * it once as the NIP-44 sender, writes its public half into the chest's
 * `lock` tag beside the lock, and discards the secret. The conversation key
 * is getConversationKey(sender secret, lock public key) when sealing and
 * getConversationKey(item secret, sender public key) when opening, which is
 * the same key by the symmetry of ECDH. So a sealer can lock a chest to a key
 * whose secret they do not hold, and nobody, the sealer included, can open it
 * without the lock's secret. A person opens it with their own identity's
 * NIP-44 decrypt, given the sender's public key.
 *
 * No cryptography is written here: nostr-tools does the ECDH, the HKDF, the
 * ChaCha20 and the HMAC, and generates the keys. This file only decides what
 * goes in, checks the one limit NIP-44 has (65,535 bytes of plaintext), and
 * reads what comes out as entries. It is pure: the signer that proves a
 * person's identity is passed in as a function, and the HUD holds the keys.
 */

import { v2 as nip44 } from 'nostr-tools/nip44'
import { generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { hexToBytes, type NostrEvent } from './events'
import { isReference, readItem, type BagEntry, type ChestItem, type ItemBody } from './hidden'

/** NIP-44 v2 seals at most this many bytes of plaintext; a chest's list of entries must fit. */
export const NIP44_MAX_PLAINTEXT = 65_535

/** How many UTF-8 bytes a chest's list of entries is as NIP-44 will see it. */
export function plaintextBytes(entries: BagEntry[]): number {
  return new TextEncoder().encode(JSON.stringify(entries)).length
}

/** Why a list of this many bytes cannot be sealed, in words, or null when it fits. */
export function sizeRefusal(bytes: number): string | null {
  if (bytes <= NIP44_MAX_PLAINTEXT) return null
  return `Too large to seal: ${bytes.toLocaleString('en-US')} of ${NIP44_MAX_PLAINTEXT.toLocaleString('en-US')} bytes. Take something out.`
}

/** A sealed list: the payload for the chest's content, and the one-time sender's public key for its lock tag. */
export interface Sealed {
  payload: string
  senderPubkey: string
}

/**
 * Seal a list of entries to a public key with a one-time sender key. Throws
 * with sizeRefusal's words when the list is too large, before any key is
 * made, so the composer and the deploy refuse the same way.
 */
export function sealEntries(entries: BagEntry[], lockPubkey: string): Sealed {
  const plaintext = JSON.stringify(entries)
  const refusal = sizeRefusal(new TextEncoder().encode(plaintext).length)
  if (refusal) throw new Error(refusal)
  const senderSecret = generateSecretKey()
  const senderPubkey = getPublicKey(senderSecret)
  const payload = nip44.encrypt(plaintext, nip44.utils.getConversationKey(senderSecret, lockPubkey))
  // Used once; nothing ever needs it again, and nothing could do anything with it.
  senderSecret.fill(0)
  return { payload, senderPubkey }
}

/**
 * The entries a decrypted chest holds: the plaintext read in the shape of
 * §7.6's list of entries. Anything that is not a list is a chest this client
 * cannot read, and it says so rather than showing an empty chest; within the
 * list, an element that is neither an item nor a reference is skipped.
 */
export function parseChestPlaintext(plaintext: string): BagEntry[] {
  let parsed: unknown
  try { parsed = JSON.parse(plaintext) } catch { throw new Error('This chest holds something this client cannot read.') }
  if (!Array.isArray(parsed)) throw new Error('This chest holds something this client cannot read.')
  return parsed.filter((e): e is BagEntry => isReference(e) || (!!e && typeof e === 'object' && !Array.isArray(e) && typeof (e as NostrEvent).kind === 'number'))
}

/** Open a chest with an item's secret: the holder's half of the conversation key. Throws on the wrong key. */
export function openWithSecret(chest: Pick<ChestItem, 'senderPubkey' | 'payload'>, secretHex: string): BagEntry[] {
  const key = nip44.utils.getConversationKey(hexToBytes(secretHex), chest.senderPubkey)
  return parseChestPlaintext(nip44.decrypt(chest.payload, key))
}

/** What a person's identity offers: NIP-44 decrypt of a payload from a sender, as NIP-07 and NIP-46 both phrase it. */
export type Nip44Decrypt = (senderPubkey: string, payload: string) => Promise<string>

/** Open a chest sealed to a person with that person's signer. */
export async function openWithSigner(chest: Pick<ChestItem, 'senderPubkey' | 'payload'>, decrypt: Nip44Decrypt): Promise<BagEntry[]> {
  return parseChestPlaintext(await decrypt(chest.senderPubkey, chest.payload))
}

/** One thing inside an opened chest, readable. */
export interface ChestEntry {
  /** The content's event id, which is what the inventory files it under. */
  id: string
  /** The event as it sits in the chest; its pubkey is a claim unless `verified`. */
  event: NostrEvent
  /** The event carried a signature and it checked out (spec §7.6: an unsigned item is allowed, and its author is then a claim). */
  verified: boolean
  body: ItemBody
}

/**
 * The readable contents of an opened chest. A signed item that fails to
 * verify is dropped, and only that item; an unsigned item is kept with its
 * author marked as a claim; a reference is skipped, because B1 produces none
 * and following one is a relay query a chest should not make on its own; a
 * kind this client does not read is skipped as §7.6 says.
 */
export function readContents(entries: BagEntry[]): ChestEntry[] {
  const out: ChestEntry[] = []
  for (const e of entries) {
    if (isReference(e)) continue
    const ev = e as NostrEvent
    const signed = typeof ev.sig === 'string' && ev.sig.length > 0
    // Verified as a plain copy: nostr-tools remembers a verification on the
    // object itself, and a copy made in memory would inherit it, so the check
    // is made on the fields alone, as it is for anything read from JSON.
    if (signed && !verifyEvent({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig })) continue
    let id: string
    try { id = typeof ev.id === 'string' && /^[0-9a-f]{64}$/.test(ev.id) ? ev.id : getEventHash(ev) } catch { continue }
    const body = readItem({ ...ev, id })
    if (!body) continue
    out.push({ id, event: { ...ev, id, sig: signed ? ev.sig : '' }, verified: signed, body })
  }
  return out
}

/** A key as the opener needs it: which inventory row it is, and its two halves. */
export interface OpeningKey {
  id: string
  itemPubkey: string
  secretHex: string
}

/** What opens a chest for this reader: a held key, the reader's own identity, or nothing. */
export type Opener = { by: 'key'; key: OpeningKey } | { by: 'self' } | null

/**
 * Which of the reader's keys opens this chest, or that the lock is the
 * reader's own pubkey, or null. A held key wins over the identity, because
 * opening with a key needs no signer.
 */
export function openerFor(chest: Pick<ChestItem, 'lockPubkey'>, keys: OpeningKey[], me: string): Opener {
  const key = keys.find((k) => k.itemPubkey === chest.lockPubkey)
  if (key) return { by: 'key', key }
  return chest.lockPubkey === me ? { by: 'self' } : null
}

/**
 * What a reader who cannot open a chest is told. The label is the hider's
 * own (`requires`), so it may say more; without one, only that an item is
 * needed, never which.
 */
export function requiresLabel(chest: Pick<ChestItem, 'requires'>): string {
  return chest.requires || 'an item you have not found'
}
