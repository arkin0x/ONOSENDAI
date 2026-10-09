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
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from './events'
import { isReference, readItem, type BagEntry, type ChestItem, type ItemBody, type KeyItem } from './hidden'

/** A new key item: a fresh keypair under a name (B1 §3.1). The secret is shown to nobody; the public key is what chests are sealed to. */
export function forgeKey(name: string, about = ''): KeyItem {
  const sk = generateSecretKey()
  return { name, about, itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
}

/**
 * How many bytes a chest's contents will be once signed, before they are:
 * each template as the event it becomes, with the id, pubkey and signature
 * at their fixed lengths, so the composer's meter reads what the seal will
 * see, give or take nothing.
 */
export function templateBytes(templates: EventTemplate[], pubkey: string): number {
  const events = templates.map((t) => ({ id: '0'.repeat(64), pubkey, created_at: t.created_at, kind: t.kind, tags: t.tags, content: t.content, sig: '0'.repeat(128) }))
  return new TextEncoder().encode(JSON.stringify(events)).length
}

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
  const refusal = sizeRefusal(plaintextBytes(entries))
  if (refusal) throw new Error(refusal)
  const plaintext = JSON.stringify(entries)
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

const HEX_64 = /^[0-9a-f]{64}$/

/** Whether an entry has the fields an event is read by, each of its type; a chest's plaintext may hold anything. */
function wellFormed(ev: Partial<NostrEvent>): ev is NostrEvent {
  return typeof ev.kind === 'number' && typeof ev.content === 'string' && typeof ev.created_at === 'number'
    && typeof ev.pubkey === 'string' && HEX_64.test(ev.pubkey)
    && Array.isArray(ev.tags) && ev.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
}

/**
 * One entry of an opened chest, readable, or null: not well formed, signed
 * but failing to verify, or a kind this client does not read. Anything that
 * throws on the way (a signature that is not even hex) is null too, so one
 * malformed entry never blocks the chest.
 */
function readEntry(e: BagEntry): ChestEntry | null {
  try {
    if (isReference(e) || !wellFormed(e as Partial<NostrEvent>)) return null
    const ev = e
    const signed = typeof ev.sig === 'string' && ev.sig.length > 0
    // The fields alone, as a plain copy: nostr-tools remembers a verification
    // on the object itself, and a copy made in memory would inherit it.
    const plain = { pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content }
    if (signed && !verifyEvent({ ...plain, id: ev.id, sig: ev.sig })) return null
    // An unsigned entry's id is its hash, whatever it claims: a claimed id
    // could otherwise stand in for a real item's in the inventory.
    const id = signed ? ev.id : getEventHash(plain)
    const body = readItem({ ...plain, id })
    return body ? { id, event: { ...plain, id, sig: signed ? ev.sig : '' }, verified: signed, body } : null
  } catch {
    return null
  }
}

/**
 * The readable contents of an opened chest. A signed item that fails to
 * verify is dropped, and only that item; an unsigned item is kept with its
 * author marked as a claim (spec §7.6); a reference is skipped, because B1
 * produces none and following one is a relay query a chest should not make
 * on its own; a kind this client does not read, or an entry that is not an
 * event at all, is skipped as §7.6 says.
 */
export function readContents(entries: BagEntry[]): ChestEntry[] {
  const out: ChestEntry[] = []
  for (const e of entries) {
    const entry = readEntry(e)
    if (entry) out.push(entry)
  }
  return out
}

/**
 * Whether a pasted lock is a public key a chest can be sealed to: 64 hex
 * characters that name a point on the curve. NIP-44's own conversation key
 * says so by refusing anything else, asked with a throwaway secret.
 */
export function isLockPubkey(hex: string): boolean {
  if (!HEX_64.test(hex)) return false
  try {
    nip44.utils.getConversationKey(generateSecretKey(), hex)
    return true
  } catch {
    return false
  }
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
