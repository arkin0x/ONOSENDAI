/**
 * useItemFeed.ts: the ITEM FEED (lib/itemListing.ts), read and written.
 *
 * Read: every kind 33340 your relays hold, verified (signature and proof),
 * one per item, newest first. Read when the picker opens and after a
 * listing goes out; kept in memory for the session.
 *
 * Write: PUBLISH TO ITEM FEED on an item you forged. Like a shard's PUBLISH
 * (usePublished.ts), deliberately not gated on LIVE: a listing is a
 * standalone public event that says nothing about where you have been, and
 * the button, behind its confirmation, is the decision.
 */

import { create } from 'zustand'
import { publishMany, query, relaySet } from '../lib/relay'
import type { KeyItem } from '../lib/hidden'
import { ITEM_LISTING_KIND, feedListings, listingTemplate, type ItemListing } from '../lib/itemListing'
import { useCyberspace } from './useCyberspace'

/** How many listings one read asks for. */
const FEED_LIMIT = 500

interface ItemFeedState {
  listings: ItemListing[]
  loading: boolean
  /** When the feed was last read, or 0 for never. */
  readAt: number
  /** The item public key being listed right now, or null. */
  publishing: string | null
  /** Read the feed from your relays. */
  load: () => Promise<void>
  /** List a key item you forged. Null when a relay took it, else the reason. */
  publish: (key: KeyItem) => Promise<string | null>
  /** Whether `itemPubkey` is listed by `lister` in what has been read. */
  listedBy: (itemPubkey: string, lister: string) => boolean
}

/** Every listing read this session, by event id, so a re-read never loses one a relay forgot. */
const seen = new Map<string, import('../lib/events').NostrEvent>()

export const useItemFeed = create<ItemFeedState>((set, get) => ({
  listings: [],
  loading: false,
  readAt: 0,
  publishing: null,

  load: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const events = await query({ kinds: [ITEM_LISTING_KIND], limit: FEED_LIMIT })
      for (const ev of events) seen.set(ev.id, ev)
      set({ listings: feedListings([...seen.values()]), readAt: Date.now() })
    } catch {
      // Unreachable relays leave what was read; the picker says when it is empty.
    } finally {
      set({ loading: false })
    }
  },

  publish: async (key) => {
    if (get().publishing) return 'Another listing is going out.'
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    set({ publishing: key.itemPubkey })
    try {
      const signed = await cs.signEvent(listingTemplate(key, me, Math.floor(Date.now() / 1000)))
      const result = await publishMany(relaySet(), signed)
      if (!result.ok) return `No relay took the listing: ${result.reason}`
      seen.set(signed.id, signed)
      set({ listings: feedListings([...seen.values()]) })
      return null
    } catch (err) {
      return `Could not list it: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      set({ publishing: null })
    }
  },

  listedBy: (itemPubkey, lister) => [...seen.values()].some((ev) => ev.pubkey === lister && ev.tags.some((t) => t[0] === 'd' && t[1] === itemPubkey) && feedListings([ev]).length === 1),
}))
