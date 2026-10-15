/**
 * listing.ts - an object for sale, as a card shows it.
 *
 * A kind 33331 sealed with an `https:` key service (NIP-FF-1) is a listing
 * (sno-core/feed `listingFromEvent`): its shape is encrypted until someone
 * buys the key, from whichever seller's key service sells it, so the card
 * shows its title, price and preview picture, and a BUY button that opens the
 * seller's page. Where that page is comes from sno-core's `sellerLink`: the
 * seller's app through its NIP-89 handler (store/useHandlers.ts), a known key
 * service's app, or njump.
 *
 * Unlocking a bought object here, with the key the seller's service sold, is
 * a later step.
 */

import { nip19 } from 'nostr-tools'
import { listingPointer, type FeedListing } from 'sno-core/feed'

/** The listing's NIP-19 address, with the relays it was seen on as hints; null if it cannot be encoded. */
export function listingNaddr(listing: Pick<FeedListing, 'pubkey' | 'd' | 'seen'>): string | null {
  try {
    return nip19.naddrEncode(listingPointer(listing))
  } catch {
    return null
  }
}

/** A price as the card shows it: `2,100 sats`, `1 sat`. */
export function satsLabel(sats: number): string {
  return `${sats.toLocaleString('en-US')} ${sats === 1 ? 'sat' : 'sats'}`
}

/**
 * A remote picture's URL when it is `https:`, else null. sno-core already
 * admits nothing else; this checks once more, so no other scheme reaches an
 * `<img>` from a listing whatever an event holds.
 */
export function httpsImage(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** A listing's pictures in the order to try them: the turntable GIF, then the still. */
export function listingPictures(listing: Pick<FeedListing, 'preview' | 'thumb'>): string[] {
  return [listing.preview?.url, listing.thumb?.url].map(httpsImage).filter((u): u is string => u !== null)
}
