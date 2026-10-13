/**
 * itemListing.test.ts: the ITEM FEED's listings (kind 33340).
 *
 * A listing carries an item's public key and never its private key; the item
 * key's proof binds the lister; a reader shows a listing only when its
 * signature and its proof both hold; the feed shows each item once, newest
 * first; a chosen listing becomes a chest lock on the item's public key.
 */

import { beforeAll, describe, expect, it } from 'vitest'

// itemListing signs its proof through lib/signers.ts, which imports the
// relay layer, which imports the store, which reads localStorage as it loads.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { forgeKey } from '../chests'
import type { NostrEvent } from '../events'

// Loaded the way the app loads it: the store first (see signers.test.ts).
let L: typeof import('../itemListing')
beforeAll(async () => {
  await import('../../store/useCyberspace')
  L = await import('../itemListing')
})
const ITEM_LISTING_KIND = 33340
const feedListings = (...a: Parameters<typeof L.feedListings>) => L.feedListings(...a)
const listingOf = (...a: Parameters<typeof L.listingOf>) => L.listingOf(...a)
const listingProof = (...a: Parameters<typeof L.listingProof>) => L.listingProof(...a)
const listingTemplate = (...a: Parameters<typeof L.listingTemplate>) => L.listingTemplate(...a)
const lockFromListing = (...a: Parameters<typeof L.lockFromListing>) => L.lockFromListing(...a)
const proofHolds = (...a: Parameters<typeof L.proofHolds>) => L.proofHolds(...a)
const searchListings = (...a: Parameters<typeof L.searchListings>) => L.searchListings(...a)

const lister = generateSecretKey()
const listerPub = getPublicKey(lister)

function signed(template: ReturnType<typeof L.listingTemplate>, sk = lister): NostrEvent {
  return finalizeEvent(template, sk) as unknown as NostrEvent
}

describe('item listings (arkinox, 2026-10-13)', () => {
  it('carries the public key and never the private key', () => {
    const key = forgeKey('Vapor Key', 'opens the vault')
    const t = listingTemplate(key, listerPub, 1_700_000_000)
    expect(t.kind).toBe(ITEM_LISTING_KIND)
    expect(t.tags).toContainEqual(['d', key.itemPubkey])
    expect(t.tags).toContainEqual(['name', 'Vapor Key'])
    expect(t.content).toBe('opens the vault')
    expect(JSON.stringify(t)).not.toContain(key.secretHex)
    expect(t.tags.some((tag) => tag[0] === 'secret')).toBe(false)
  })

  it('reads back a listing whose signature and proof hold', () => {
    const key = forgeKey('Vapor Key')
    const l = listingOf(signed(listingTemplate(key, listerPub, 1_700_000_000)))
    expect(l).toMatchObject({ itemPubkey: key.itemPubkey, lister: listerPub, name: 'Vapor Key' })
  })

  it('binds the proof to the lister: lifted onto another account, it fails', () => {
    const key = forgeKey('Vapor Key')
    const other = generateSecretKey()
    // Built for listerPub, signed by someone else: the proof names listerPub.
    expect(listingOf(signed(listingTemplate(key, listerPub, 1_700_000_000), other))).toBeNull()
    expect(proofHolds(listingProof(key.secretHex, listerPub), getPublicKey(other), key.itemPubkey)).toBe(false)
  })

  it('refuses a listing of a key the lister does not hold', () => {
    const key = forgeKey('Vapor Key')
    const madeUp = forgeKey('Fake').itemPubkey
    const t = listingTemplate(key, listerPub, 1_700_000_000)
    t.tags = t.tags.map((tag) => (tag[0] === 'd' ? ['d', madeUp] : tag))
    expect(listingOf(signed(t))).toBeNull()
  })

  it('refuses a bad proof, a missing d, and a tampered event', () => {
    const key = forgeKey('Vapor Key')
    const noProof = listingTemplate(key, listerPub, 1_700_000_000)
    noProof.tags = noProof.tags.map((tag) => (tag[0] === 'proof' ? ['proof', '00'.repeat(64)] : tag))
    expect(listingOf(signed(noProof))).toBeNull()
    const noD = listingTemplate(key, listerPub, 1_700_000_000)
    noD.tags = noD.tags.filter((tag) => tag[0] !== 'd')
    expect(listingOf(signed(noD))).toBeNull()
    const ev = signed(listingTemplate(key, listerPub, 1_700_000_000))
    expect(listingOf({ ...ev, content: 'changed after signing' })).toBeNull()
  })

  it('shows each item once, newest first, and searches by name', () => {
    const a = forgeKey('Vapor Key')
    const b = forgeKey('Secret Sauce')
    const holder = generateSecretKey()
    const events = [
      signed(listingTemplate(a, listerPub, 100)),
      signed(listingTemplate(a, listerPub, 300)),
      signed(listingTemplate(a, getPublicKey(holder), 200), holder),
      signed(listingTemplate(b, listerPub, 250)),
    ]
    const feed = feedListings(events)
    expect(feed.map((l) => l.name)).toEqual(['Vapor Key', 'Secret Sauce'])
    expect(feed[0].createdAt).toBe(300)
    expect(searchListings(feed, 'sauce').map((l) => l.name)).toEqual(['Secret Sauce'])
  })

  it('a chosen listing seals the chest to the item public key', () => {
    const key = forgeKey('Vapor Key')
    const l = listingOf(signed(listingTemplate(key, listerPub, 1_700_000_000)))!
    expect(lockFromListing(l)).toEqual({ pubkey: key.itemPubkey, label: 'Vapor Key' })
  })
})
