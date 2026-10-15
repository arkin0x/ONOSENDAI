/**
 * fanfares.ts - where an object for sale is bought.
 *
 * A kind 33331 sealed with an `https:` key service (NIP-FF-1) is a listing
 * (sno-core/feed `listingFromEvent`): its shape is encrypted until someone
 * buys the key, so ONOSENDAI shows its title, price and preview picture and
 * sends the buyer to Fanfares. Fanfares opens any addressable event at
 * `/naddr/<naddr>` (fanfares-next `src/app/(routes)/naddr/[naddr]`, the same
 * link its own share and paywall text writes), so that is the page.
 *
 * Unlocking a bought object here, with the key Fanfares sold, is a later step.
 */

import { nip19 } from 'nostr-tools'
import { listingPointer, type FeedListing } from 'sno-core/feed'

/** Fanfares on the web (fanfares-next `APP_URL`). */
export const FANFARES_WEB = 'https://fanfares.io'

/** The Fanfares page for a listing: `https://fanfares.io/naddr/<naddr>`, with the relays it was seen on as hints. */
export function fanfaresUrl(listing: Pick<FeedListing, 'pubkey' | 'd' | 'seen'>): string {
  return `${FANFARES_WEB}/naddr/${nip19.naddrEncode(listingPointer(listing))}`
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
