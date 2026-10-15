/**
 * useSellerLink.ts - where a listing's BUY button goes, and what it says.
 *
 * The fallback first (sno-core `sellerLink` with no handler: a known key
 * service's app, else njump), then the seller's own app once its NIP-89
 * handler arrives (store/useHandlers.ts). Null only when the listing has no
 * encodable address.
 */

import { useEffect, useMemo } from 'react'
import { sellerLink, type FeedListing, type SellerLink } from 'sno-core/feed'
import { listingNaddr } from '../lib/listing'
import { useHandlers } from '../store/useHandlers'

export function useSellerLink(listing: FeedListing): SellerLink | null {
  const address = listing.app?.address
  const handler = useHandlers((s) => (address ? s.handlers[address] : undefined))
  // Once per app, keyed by its coordinate rather than the listing object, which each feed change replaces.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (listing.app) useHandlers.getState().request(listing.app) }, [address])
  const seen = (listing.seen ?? []).join(' ')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const naddr = useMemo(() => listingNaddr(listing), [listing.pubkey, listing.d, seen])
  return useMemo(() => (naddr ? sellerLink(listing, naddr, handler ?? null) : null), [listing, naddr, handler])
}
