/**
 * itemListing.ts: the ITEM FEED, a public catalog of key items (kind 33340).
 *
 * A key item is a keypair: holding it is holding its private key, and a
 * chest is sealed to its public key (Keys and Chests B1 §2). So anyone can
 * seal a chest to an item they have never held, as long as they know its
 * public key. A listing publishes exactly that, and what the item is called
 * and looks like, so it can be found (arkinox, 2026-10-13: "a catalog of
 * items ... without actually publishing the full item, because that would
 * grant it for free"). It NEVER carries the private key.
 *
 *   kind     33340, addressable, one per lister per item
 *   d        the item's public key, hex
 *   name     the item's name
 *   imeta    the item's picture, the same data URI tag the item carries
 *   proof    a BIP-340 signature by the ITEM key over
 *            sha256("cyberspace:item-listing:" + lister + ":" + item)
 *   content  the item's about sentence, or empty
 *
 * The proof is what makes a listing worth trusting: only someone holding the
 * item's private key can make it, and it names the lister, so a listing
 * cannot be lifted onto another account, and nobody can list a key they made
 * up or a name they do not hold. A reader checks the event's signature and
 * the proof, and shows nothing that fails either.
 *
 * Kind 33340 was free in the spec, ONOSENDAI, cyberspace-mcp and the NIP
 * index on 2026-10-13. It sits beside the key item's own kind, 3340, in the
 * addressable range: the creator can correct a listing in place.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from './events'
import { MAX_ABOUT, MAX_ITEM_NAME, type KeyItem } from './hidden'
import { imetaTag, pictureOf, type PictureDim } from './itemPicture'
import { signHashWithKey } from './signers'

/** An item listing (ITEM FEED). */
export const ITEM_LISTING_KIND = 33340

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/

/** What the item key signs: the lister and the item, so the proof binds both. */
export function proofMessage(lister: string, itemPubkey: string): Uint8Array {
  return sha256(new TextEncoder().encode(`cyberspace:item-listing:${lister}:${itemPubkey}`))
}

/** The proof that `lister` holds the item: a signature by the item's own key. */
export function listingProof(secretHex: string, lister: string): string {
  const itemPubkey = getPublicKey(hexToBytes(secretHex))
  return bytesToHex(signHashWithKey(proofMessage(lister, itemPubkey), hexToBytes(secretHex)))
}

/** Whether `proof` is the item key's signature for this lister. */
export function proofHolds(proof: string, lister: string, itemPubkey: string): boolean {
  if (!HEX_128.test(proof) || !HEX_64.test(itemPubkey) || !HEX_64.test(lister)) return false
  try { return schnorr.verify(hexToBytes(proof), proofMessage(lister, itemPubkey), hexToBytes(itemPubkey)) } catch { return false }
}

/** The unsigned listing for a key item, to be signed by `lister`. Carries the public key only. */
export function listingTemplate(key: KeyItem, lister: string, createdAt: number): { kind: number; created_at: number; tags: string[][]; content: string } {
  const tags: string[][] = [
    ['d', key.itemPubkey],
    ['name', key.name.slice(0, MAX_ITEM_NAME)],
    ['proof', listingProof(key.secretHex, lister)],
  ]
  const pic = key.image && key.imageDim ? imetaTag(key.image, key.imageDim) : null
  if (pic) tags.push(pic)
  const template = { kind: ITEM_LISTING_KIND, created_at: createdAt, tags, content: key.about.slice(0, MAX_ABOUT) }
  // The whole point of a listing is that the item stays secret. Checked on
  // every listing built, not trusted to the code above: a listing holding
  // the private key would give the item away to everyone who reads it.
  if (JSON.stringify(template).includes(key.secretHex)) throw new Error('A listing must never carry the item’s private key.')
  return template
}

/** A verified listing, as the ITEM FEED shows it. */
export interface ItemListing {
  id: string
  /** Who listed it: someone who holds the item, proven. */
  lister: string
  itemPubkey: string
  name: string
  about: string
  image?: string
  imageDim?: PictureDim
  createdAt: number
}

/** A listing out of its event, or null unless its signature and its proof both hold. */
export function listingOf(ev: NostrEvent): ItemListing | null {
  if (ev.kind !== ITEM_LISTING_KIND) return null
  const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  if (!HEX_64.test(d)) return null
  const proof = ev.tags.find((t) => t[0] === 'proof')?.[1] ?? ''
  if (!proofHolds(proof, ev.pubkey, d)) return null
  // Rebuilt from its fields, not spread: nostr-tools caches a verification on
  // the event object under a symbol, and a spread copies that symbol along,
  // so an event edited after it was verified would still read as verified.
  const fresh = { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig }
  if (!verifyEvent(fresh as Parameters<typeof verifyEvent>[0])) return null
  const name = (ev.tags.find((t) => t[0] === 'name')?.[1] ?? '').trim().slice(0, MAX_ITEM_NAME) || 'item'
  const picture = pictureOf(ev.tags)
  return {
    id: ev.id,
    lister: ev.pubkey,
    itemPubkey: d,
    name,
    about: ev.content.trim().replace(/\s+/g, ' ').slice(0, MAX_ABOUT),
    ...(picture ? { image: picture.image, imageDim: picture.dim } : {}),
    createdAt: ev.created_at,
  }
}

/**
 * Verified listings, one per item, newest first. A relay keeps the newest
 * per lister and item; two holders may each list the same item, and the
 * feed shows it once, as most recently listed.
 */
export function feedListings(events: readonly NostrEvent[]): ItemListing[] {
  const byItem = new Map<string, ItemListing>()
  for (const ev of events) {
    const l = listingOf(ev)
    if (!l) continue
    const was = byItem.get(l.itemPubkey)
    if (!was || l.createdAt > was.createdAt || (l.createdAt === was.createdAt && l.id > was.id)) byItem.set(l.itemPubkey, l)
  }
  return [...byItem.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
}

/** Listings whose name holds the search, ignoring case. */
export function searchListings(list: readonly ItemListing[], q: string): ItemListing[] {
  const s = q.trim().toLowerCase()
  return s ? list.filter((l) => l.name.toLowerCase().includes(s) || l.about.toLowerCase().includes(s)) : [...list]
}

/** The chest lock a chosen listing becomes: the item's public key, named. */
export function lockFromListing(l: Pick<ItemListing, 'itemPubkey' | 'name'>): { pubkey: string; label: string } {
  return { pubkey: l.itemPubkey, label: l.name }
}
